/*
 * media upload API, multipart form data requests with json responses
 */
import express from 'express';
import busboy from 'busboy';

import {
  storeMediaStream, isMimeTypeAllowed, mimeTypeFitsToExt, MAX_UPLOAD_BYTES,
} from '../../utils/media/index.js';
import { splitFilename } from '../../utils/media/utils.js';
import {
  checkTotalQuotaReached, checkUserQuotaReached,
} from '../../utils/media/quotas.js';
import { mediaBanReasonToDescription } from '../../utils/media/serverUtils.js';
import {
  MAX_FILE_SIZE_MB, MAX_UPLOAD_AMOUNT, MAX_USER_MEDIA_SIZE_MB,
} from '../../core/config.js';
import { hasMedia, linkMedia } from '../../data/sql/Media.js';
import { checkIfMediaBanned } from '../../core/ban.js';
import socketEvents from '../../socket/socketEvents.js';
import { setUserAvatar } from '../../data/sql/Profile.js';

const router = express.Router();


/**
 * generate upload route based on restrictions
 * @param restrictType type like "image"
 * @param resize size to scale to [16, 11]
 */
function preflightRouteFactory(restrictType, resize) {
  return (req, res) => {
    req.tickRateLimiter(1000);
    const { ttag: { t } } = req;
    const bb = busboy({
      headers: req.headers,
      limits: { fields: 50, files: 1, fieldSize: 8192 },
    });

    const errors = [];
    const mimeTypes = [];
    const filenames = [];
    const hashes = [];
    const sizes = [];

    bb.on('file', () => {
      if (!bb.destroyed) {
        bb.destroy();
      }
      req.destroy();
    });

    bb.on('field', (name, value) => {
      switch (name) {
        case 'mimeType':
          mimeTypes.push(value);
          break;
        case 'filename':
          filenames.push(value);
          break;
        case 'size':
          sizes.push(Number(value));
          break;
        case 'hash':
          hashes.push(value);
          break;
        default:
          // nothing
      }
    });

    bb.on('error', () => {
      if (res.headersSent) {
        return;
      }
      res.status(500).json({
        readyToUpload: [],
        availableFiles: [],
        errors: ['Processing failed'],
      });
    });

    bb.on('close', async () => {
      if (res.headersSent) {
        return;
      }

      try {
        // eslint-disable-next-line max-len
        if (mimeTypes.length !== filenames.length || filenames.length !== hashes.length || hashes.length !== sizes.length) {
          throw new Error(t`You did not provide all necessary information`);
        }
        if (mimeTypes.length > MAX_UPLOAD_AMOUNT) {
          const amountOfFiles = mimeTypes.length;
          errors.push(
            // eslint-disable-next-line max-len
            t`Can not upload this many files at once, only 5 are allowed, you have ${amountOfFiles}`,
          );
        }

        let allowUploads = true;
        if (await checkTotalQuotaReached()) {
          allowUploads = false;
          errors.push(t`We currently do not allow file uploads`);
        }

        if (await checkUserQuotaReached(req.user?.id, req.ip?.ipString)) {
          allowUploads = false;
          errors.push(
            // eslint-disable-next-line max-len
            t`You reached your maximum upload quota of ${MAX_USER_MEDIA_SIZE_MB} MB`,
          );
        }

        const models = [];

        let i = Math.min(MAX_UPLOAD_AMOUNT * 3, mimeTypes.length);

        while (i > 0) {
          i -= 1;
          let fileErrors = false;
          const mimeType = decodeURIComponent(mimeTypes[i]);
          const filename = decodeURIComponent(filenames[i]);
          const hash = hashes[i];
          const size = sizes[i];

          if (MAX_FILE_SIZE_MB && size > MAX_FILE_SIZE_MB * 1024 * 1024) {
            const sizeMB = Math.floor(size / 1024 / 102.4) / 10;
            errors.push(
              // eslint-disable-next-line max-len
              t`File ${filename} has ${sizeMB} MB and is too large. It may only be ${MAX_FILE_SIZE_MB} MB`,
            );
            fileErrors = true;
          }
          if (!isMimeTypeAllowed(mimeType)) {
            errors.push(
              // eslint-disable-next-line max-len
              t`Mimetype ${mimeType} of file ${filename} is invalid or not allowed`,
            );
            fileErrors = true;
          } else if (!mimeTypeFitsToExt(mimeType, filename)) {
            errors.push(
              t`File ${filename} has an invalid extension`,
            );
            fileErrors = true;
          } else if (restrictType
            && mimeType.substring(0, mimeType.indexOf('/')) !== restrictType
          ) {
            errors.push(
              t`Invalid type of media`,
            );
            fileErrors = true;
          }

          if (!fileErrors) {
            const [name, extension] = splitFilename(filename);
            models.push({
              hash, name, mimeType, extension,
              originalFilename: filename,
            });
          }
        }
        mimeTypes.length = 0;
        filenames.length = 0;
        sizes.length = 0;

        const bans = await checkIfMediaBanned(
          hashes, null, req.user?.id, req.ip?.ipString,
        );
        for (let u = 0; u < bans.length; u += 1) {
          const { hash, reason, mbid } = bans[u];
          const modelIndex = models.findIndex((h) => h.hash === hash);
          if (modelIndex !== -1) {
            errors.push(mediaBanReasonToDescription(
              req.ttag, reason, mbid, models[modelIndex].originalFilename,
            ));
            models.splice(modelIndex, 1);
          }
        }

        if (!(await hasMedia(models))) {
          allowUploads = false;
          errors.push(t`Server Error`);
        }
        const readyToUpload = [];
        const availableFiles = [];

        i = models.length;
        while (i > 0) {
          i -= 1;
          const model = models[i];
          /*
            *  [{
            *    hash, name, mimeType, extension, shortId, originalFilename,
            *  }, ... ]
            */
          if (model.shortId && (
            !resize || (resize[0] === model.width && resize[1] === model.height)
          )) {
            availableFiles.push(model);
          } else if (allowUploads) {
            readyToUpload.push(model);
          }
        }

        if (readyToUpload.length > MAX_UPLOAD_AMOUNT) {
          readyToUpload.splice(MAX_UPLOAD_AMOUNT);
        }

        linkMedia(availableFiles, req.user?.id, req.ip?.ipString);
        const data = { readyToUpload, availableFiles };
        if (errors.length) {
          data.errors = errors;
          res.status(400);
        }
        res.json(data);
      } catch (error) {
        if (res.headersSent) {
          return;
        }
        res.status(400).json({
          errors: [error.message],
        });
      }
    });

    req.pipe(bb);
  };
}

/*
 * preflight route tells whether or not the upload is likely to succeed,
 * and if the file is already uploaded
 */
router.post('/preflight', preflightRouteFactory());

router.post('/flagpreflight', preflightRouteFactory('image', [16, 11]));

/**
 * generate upload route based on restrictions
 * @param restrictType type like "image"
 * @param resize size to scale to [16, 11]
 */
function uploadRouteFactory(restrictType, resize, savesAvatar = false) {
  return (req, res) => {
    req.tickRateLimiter(1000);
    const { ttag: { t } } = req;
    /*
     * GÜVENLİK: çok parçalı (multipart) gövdeye sert tavanlar. Eskiden hiç
     * limit yoktu: sınırsız boyutta dosya ve sınırsız dosya sayısı ile
     * disk/bellek tüketilebiliyordu. fileSize → akış kesilir, fields/
     * fieldSize → dev "dosya adı" alanlarıyla bellek şişirilemez.
     */
    const bb = busboy({
      headers: req.headers,
      limits: {
        fileSize: MAX_UPLOAD_BYTES,
        files: Math.max(1, MAX_UPLOAD_AMOUNT || 5) * 2,
        fields: 50,
        fieldSize: 8192,
      },
    });

    /*
    * amount of files currently being read
    */
    let readingFiles = 0;
    /*
    * amount of files already read
    */
    let loadedFiles = 0;
    /*
    * whee reading the request body is done
    */
    let requestDone = false;
    /*
    * file modals
    * [{ hash, name, mimeType, extension, shortId}, ...]
    */
    const availableFiles = [];

    let ended = false;

    const finalize = (error) => {
      if (ended || (!error && (!requestDone || readingFiles > 0))) {
        return;
      }
      ended = true;

      if (error && typeof error !== 'string') {
        error = error.message;
      }

      linkMedia(availableFiles, req.user?.id, req.ip.ipString);
      const data = { availableFiles };
      let status = 200;

      if (error) {
        status = 400;
        if (error.startsWith('media_banned_reason_')) {
          const reason = Number(error[20]);
          const mbid = error.substring(22);
          error = mediaBanReasonToDescription(req.ttag, reason, mbid);
        } else {
          switch (error) {
            case 'no_info':
              error = 'No file metadata given';
              break;
            case 'unknown_type':
              error = t`MimeType or extension not known or supported`;
              break;
            case 'invalid_type':
              error = t`Invalid type of media`;
              break;
            case 'total_quota_reached':
              error = t`We currently do not allow file uploads`;
              break;
            case 'user_quota_reached':
              // eslint-disable-next-line max-len
              error = t`You reached your maximum upload quota of ${MAX_USER_MEDIA_SIZE_MB} MB`;
              break;
            case 'broken_file':
              error = t`File is broken`;
              break;
            case 'image_moderation_rejected':
              error = t`This image cannot be uploaded because it does not meet our safety rules`;
              break;
            case 'image_moderation_unavailable':
              error = t`Image safety review is temporarily unavailable; please try again later`;
              status = 503;
              break;
            case 'server_error':
              error = t`Server Error`;
              status = 500;
              break;
            case 'stalled':
              error = t`Request stalled`;
              break;
            case 'too_long':
              error = t`A file was too large`;
              status = 413;
              break;
            case 'too_many_files':
              error = t`Could not upload all files`;
              status = 413;
              break;
            case 'already_exists':
              /* this is not an error, but treated as one to cancel request */
              error = null;
              status = 200;
              break;
            default:
              // nothing
          }
        }
      }
      res.status(status);
      if (error) {
        data.errors = [error];

        req.tickRateLimiter(3000);
      }
      res.json(data);
    };

    bb.on('file', async (name, fileStream, info) => {
      if (name !== 'file') {
        if (!fileStream.destroyed) {
          fileStream.destroy();
        }
        finalize(t`Unknown field ${name} in request`);
        return;
      }
      readingFiles += 1;
      /*
        * can be multiple files with same fieldname
        */
      loadedFiles += 1;
      if (loadedFiles > MAX_UPLOAD_AMOUNT) {
        if (!fileStream.destroyed) {
          fileStream.destroy();
        }
        finalize('too_many_files');
        return;
      }

      let model;
      try {
        model = await storeMediaStream(
          fileStream, info, req.user?.id, req.ip?.ipString,
          null, restrictType, resize,
        );
        if (savesAvatar) {
          if (!req.user?.id || model.type !== 'image' || !model.mediaId) {
            throw new Error('Could not set your avatar');
          }
          const saved = await setUserAvatar(req.user.id, model.mediaId);
          if (!saved) {
            throw new Error('Could not set your avatar');
          }
          socketEvents.patchUserState(req.user.id, 'profile', {
            op: 'set',
            path: 'avatarId',
            value: model.mediaId,
          });
        }
      } catch (error) {
        if (!fileStream.destroyed && !fileStream.closed) {
          fileStream.destroy();
        }
        finalize(error);
        return;
      }

      availableFiles.push(model);
      if (!fileStream.closed) {
        fileStream.resume();
      }

      readingFiles -= 1;
      if (readingFiles === 0 && requestDone) {
        finalize();
      }
    });

    bb.on('field', (name) => {
      finalize(t`Unknown field ${name} in request`);
    });

    bb.on('error', () => {
      finalize('server_error');
    });

    bb.on('close', () => {
      requestDone = true;
      finalize();
    });

    req.pipe(bb);
  };
}

router.post('/upload', uploadRouteFactory());

/*
 * Avatar uploads are persisted in the same request as the media upload.
 * This avoids losing the mediaId between the mobile uploader and the profile
 * save request.
 */
router.post('/avatar', uploadRouteFactory('image', null, true));

router.post('/flagupload', uploadRouteFactory('image', [16, 11]));

export default router;
