/*
 * Component to upload files
 */
import {
  useEffect, useState, useCallback, useRef, useLayoutEffect,
} from 'preact/hooks';
import { memo } from 'preact/compat';
import { t } from 'ttag';
import ImAttachment from '../icons/ImAttachment.svg';

import {
  requestFileUpload, requestFileUploadPreflight,
} from '../store/actions/fetch.js';
import {
  addIdToFilename, extractIdFromFilename,
} from '../utils/media/utils.js';


const FileUploadElement = ({
  // id of this file upload
  id,
  // file
  file,
  // boolean if field is active
  active,
  // number of upload progress (parent does the uploading)
  completion,
  // minimum height / width of elements
  size,

  // callback to call to close, argument must be id
  close,
  // callback to inform parent that a file shall be removed, argument must be id
  removeFile,
}) => {
  const [render, setRender] = useState(false);
  const [previewUrl, setPreviewUrl] = useState(null);

  useEffect(() => {
    if (file.type.startsWith('image/')) {
      const url = URL.createObjectURL(file);

      setPreviewUrl(url);

      return () => {
        URL.revokeObjectURL(url);
      };
    }
    return undefined;
  }, [file]);

  useEffect(() => {
    if (active && !render) {
      requestAnimationFrame(() => {
        setRender(true);
      });
    }
  }, [active, render]);

  let progressWidth = 0;
  if (completion > 0) {
    progressWidth = completion;
  }
  progressWidth = `${String(progressWidth)}%`;

  let progressColor;
  switch (completion) {
    case 100:
      progressColor = '#22c55e';
      break;
    default:
      progressColor = '#3b82f6';
  }

  const resultContainerWidth = size || 40;

  return (
    <div
      style={{
        width: active && render ? resultContainerWidth : 0,
        height: size,
      }}
      className="fileupload-result-container"
      onTransitionEnd={active ? undefined : () => close(id)}
    >
      <button
        tabIndex={0}
        type="button"
        className="fileupload-result-btn"
        onClick={() => removeFile(id)}
        title={t`Click to remove`}
      >
        <div
          style={(previewUrl) ? {
            backgroundImage: `url(${previewUrl})`,
            filter: (completion === 100) ? undefined : 'grayscale(100%)',
          } : undefined}
          className={(previewUrl)
            ? 'fileupload-result-btn-preview'
            : 'fileupload-result-btn-placeholder'}
        >
          {!previewUrl && '📷'}
        </div>

        <div
          style={{
            width: progressWidth,
            backgroundColor: progressColor,
          }}
          className="fileupload-result-progress"
        />

        <span
          className="fileupload-result-x"
          style={{
            backgroundColor: (completion === -1)
              ? '#ef4444'
              : 'rgba(0, 0, 0, 0.7)',
          }}
        >
          {completion === -1 ? '!' : '×'}
        </span>
      </button>
    </div>
  );
};


const FileUpload = ({
  acceptedTypes = 'image/*,video/*',
  maxFiles = 4,
  // minimum height / width of elements
  size,
  // callback to print errors, gets array of error messages
  printErrors,
  // ref that we define a function on, that the parent calls when all should
  // be uploaded
  uploadRef,
  /*
   * boolean whether or not we keep files after upload
   */
  keepFiles,
  /*
   * routes to use for upload within /api/media, is only used if we need a
   * route doing specific things, like a flag upload that resizes an image
   * to 16x11 and only allowed images
   */
  uploadRoute,
  preflightRoute,
  /*
   * For small, explicit save actions such as avatars, skip the automatic
   * preflight queue and upload only when the parent calls uploadRef.
   */
  manualUpload = false,
}) => {
  /*
   * whether or not input button is active and rendered, used for animating it
   * similar to FileUploadElement
   * 0: fade-in width:0
   * 1: shown
   * 2: fade-out width:0
   * 3: hidden
   */
  const [inputButtonState, setInputButtonState] = useState(1);
  /*
   * amount of currently displayed FileUploadElements, tracked for efficient
   * inputButton fade-in fade-out
   */
  const [displayedUploadElements, setDisplayedUploadElements] = useState(0);
  /*
   * array with information for selected files
   * [{ id, file, active, completion, [fileInfo] }, ...]
   * completion:
   *   undefined if file not checked
   *   null if checked and upload not started yet
   *   -1 when upload failed,
   *   0-100 progress otherwise
   */
  const [fileInfos, setFileInfos] = useState([]);
  /*
   * object with informations of uploads
   * {
   *   uploads: [{
   *     controller: AbortController,
   *     promise,
   *     ids: Set<id>,
   *   }], // also includes preflights
   *   uploadTimeout, // timeout for auto-upload
   *   preflightTimeout, // timeout for preflight
   *   incrId, // incrmeneting id for files
   *   unmounted, // boolean
   * }
   */
  const uploadInfoRef = useRef({
    preflightTimeout: null, uploadTimeout: null,
    incrId: 1, uploads: [], unmounted: false,
  });
  /*
   * Keep completed upload results outside React state as well. The parent can
   * request the result immediately after an XHR resolves, before Preact has
   * committed the corresponding fileInfos update.
   */
  const completedFileInfosRef = useRef(new Map());
  const selectedFilesRef = useRef([]);

  const inputRef = useRef(null);

  const handleInputClick = useCallback(() => {
    const inputElement = inputRef.current;
    if (!inputElement) {
      return;
    }
    // TODO no need to cancel uploads here, its for testing
    if (uploadInfoRef.current.uploadTimeout) {
      clearTimeout(uploadInfoRef.current.uploadTimeout);
      uploadInfoRef.current.uploadTimeout = null;
    }
    if (uploadInfoRef.current.preflightTimeout) {
      clearTimeout(uploadInfoRef.current.preflightTimeout);
      uploadInfoRef.current.preflightTimeout = null;
    }
    inputElement.click();
  }, []);

  /**
   * upload file or preflight
   */
  const uploadFile = useCallback(async (preflight) => {
    const files = [];
    const ids = new Set();

    const timeoutName = (preflight) ? 'preflightTimeout' : 'uploadTimeout';
    const completionCheck = (preflight) ? undefined : null;

    await new Promise((resolve) => {
      setFileInfos((oldInfos) => {
        const newInfos = oldInfos.map((info) => {
          if (info.active && info.completion === completionCheck) {
            files.push(info.file);
            ids.add(info.id);
            return {
              ...info,
              completion: 0,
            };
          }
          return info;
        });
        resolve();
        return newInfos;
      });
    });

    if (!files.length) {
      return;
    }

    if (uploadInfoRef.current[timeoutName]) {
      clearTimeout(uploadInfoRef.current[timeoutName]);
      uploadInfoRef.current[timeoutName] = null;
    }

    const uploadInfo = { ids };
    let resolvePromise;
    uploadInfo.promise = new Promise((resolve) => {
      resolvePromise = () => {
        uploadInfoRef.current.uploads = uploadInfoRef.current.uploads.filter(
          (p) => p !== uploadInfo,
        );
        resolve();
      };
    });
    uploadInfo.controller = new AbortController();
    uploadInfoRef.current.uploads.push(uploadInfo);

    let response;
    if (preflight) {
      response = await requestFileUploadPreflight(
        files, uploadInfo.controller, preflightRoute,
      );
    } else {
      response = await requestFileUpload(
        files, uploadInfo.controller, (complete) => {
          setFileInfos((oldInfos) => oldInfos.map((info) => {
            if (ids.has(info.id)) {
              return {
                ...info,
                completion: complete,
              };
            }
            return info;
          }));
        }, uploadRoute,
      );
    }

    // if component is already unmounted, get out
    if (uploadInfoRef.current.unmounted) {
      resolvePromise();
      return;
    }

    if (response === null) {
      // aborted
      setFileInfos((oldInfos) => oldInfos.map((info) => {
        if (ids.has(info.id)) {
          return {
            ...info,
            completion: completionCheck,
          };
        }
        return info;
      }));
      resolvePromise();
      return;
    }

    const { availableFiles, readyToUpload, errors } = response;
    if (availableFiles) {
      for (let i = 0; i < availableFiles.length; i += 1) {
        /*
         *   hash,
         *   extension,
         *   mimeType,
         *   shortId,
         *   name,
         *   originalFilename,
         *   [existed],
         */
        const fileInfo = availableFiles[i];
        const [name, id] = extractIdFromFilename(fileInfo.name);
        fileInfo.name = name;
        fileInfo.id = id;
        completedFileInfosRef.current.set(id, fileInfo);
      }
    }
    /* readyToUpload is only set when preflight */
    if (readyToUpload) {
      for (let i = 0; i < readyToUpload.length; i += 1) {
        const fileInfo = readyToUpload[i];
        const [name, id] = extractIdFromFilename(fileInfo.name);
        fileInfo.name = name;
        fileInfo.id = id;
      }
    }

    setFileInfos((oldInfos) => oldInfos.map((info) => {
      const { id } = info;
      if (ids.has(id)) {
        const fileInfo = availableFiles?.find((ui) => ui.id === id);
        if (fileInfo) {
          completedFileInfosRef.current.set(id, fileInfo);
          return {
            ...info,
            fileInfo,
            completion: 100,
          };
        }
        if (readyToUpload?.find((ui) => ui.id === id)) {
          return {
            ...info,
            completion: null,
          };
        }
        return {
          ...info,
          completion: -1,
        };
      }
      return info;
    }));

    if (errors) {
      // error
      if (printErrors) {
        printErrors(errors);
      } else {
        errors.forEach(console.log);
      }
    }

    resolvePromise();
  }, [printErrors, uploadRoute, preflightRoute]);

  const doPreflight = useCallback(async () => {
    await uploadFile(true);
    if (uploadInfoRef.current.uploadTimeout) {
      clearTimeout(uploadInfoRef.current.uploadTimeout);
    }
    uploadInfoRef.current.uploadTimeout = setTimeout(uploadFile, 2000);
  }, [uploadFile]);

  const handleInputChange = useCallback((evt) => {
    let file = evt.target.files?.[0];
    if (file) {
      uploadInfoRef.current.incrId += 1;
      // add id to filename
      const id = uploadInfoRef.current.incrId;
      file = new File([file], addIdToFilename(file.name, id), {
        type: file.type,
        lastModified: file.lastModified,
      });
      selectedFilesRef.current = [file];

      setFileInfos((oldInfos) => [
        ...oldInfos, {
          id, file, active: true,
        },
      ]);
      setDisplayedUploadElements((c) => c + 1);
      evt.target.value = '';
      // schedule upload for the normal shared uploader
      if (manualUpload) {
        return;
      }
      if (uploadInfoRef.current.uploadTimeout) {
        clearTimeout(uploadInfoRef.current.uploadTimeout);
        uploadInfoRef.current.uploadTimeout = null;
      }
      if (uploadInfoRef.current.preflightTimeout) {
        clearTimeout(uploadInfoRef.current.preflightTimeout);
      }
      uploadInfoRef.current.preflightTimeout = setTimeout(doPreflight, 500);
    }
  }, [doPreflight, manualUpload]);

  useEffect(() => {
    /**
     * function called by the parent when it wants to force all uploads
     * and get the files
     * @return [{
     *   hash,
     *   extension,
     *   mimeType,
     *   shortId,
     *   name,
     *   originalFilename,
     *   [existed],
     * }, ...]
     */
    uploadRef.current = async () => {
      if (manualUpload) {
        const files = selectedFilesRef.current;
        if (!files.length) {
          return [];
        }
        const controller = new AbortController();
        const response = await requestFileUpload(
          files,
          controller,
          (complete) => {
            setFileInfos((oldInfos) => oldInfos.map((info) => ({
              ...info,
              completion: complete,
            })));
          },
          uploadRoute,
        );
        if (!response || response.errors || !response.availableFiles?.length) {
          if (response?.errors && printErrors) {
            printErrors(response.errors);
          }
          return [];
        }
        const fileInfo = response.availableFiles[0];
        const [name, id] = extractIdFromFilename(fileInfo.name || '');
        fileInfo.name = name;
        fileInfo.id = id;
        selectedFilesRef.current = [];
        setFileInfos([]);
        setDisplayedUploadElements(0);
        return [fileInfo];
      }

      // upload the rest
      if (uploadInfoRef.current.preflightTimeout) {
        clearTimeout(uploadInfoRef.current.preflightTimeout);
        uploadInfoRef.current.preflightTimeout = null;
      }
      await doPreflight(true);
      /*
       * Preflight changes completion from undefined to null. On mobile the
       * state update can commit after the promise resolves, so give Preact a
       * frame before collecting the files for the real upload.
       */
      await new Promise((resolve) => {
        if (typeof requestAnimationFrame === 'function') {
          requestAnimationFrame(resolve);
        } else {
          setTimeout(resolve, 0);
        }
      });
      if (uploadInfoRef.current.uploadTimeout) {
        clearTimeout(uploadInfoRef.current.uploadTimeout);
        uploadInfoRef.current.uploadTimeout = null;
      }
      await uploadFile();
      /* wait for running uploads */
      await Promise.all(uploadInfoRef.current.uploads.map((i) => i.promise));

      /*
       * uploadFile updates fileInfos immediately before resolving its
       * internal promise. Preact may commit that update on the next render,
       * especially on mobile, so wait one frame before reading the result.
       */
      await new Promise((resolve) => {
        if (typeof requestAnimationFrame === 'function') {
          requestAnimationFrame(resolve);
        } else {
          setTimeout(resolve, 0);
        }
      });

      const oldInfos = await new Promise((resolve) => {
        setFileInfos((infos) => {
          resolve(infos);
          return infos;
        });
      });

      if (!keepFiles) {
        setDisplayedUploadElements(0);
        setFileInfos([]);
      }

      const finishedFileInfos = [];
      for (let i = 0; i < oldInfos.length; i += 1) {
        const { id, fileInfo } = oldInfos[i];
        const completedFileInfo = fileInfo
          || completedFileInfosRef.current.get(id);
        if (completedFileInfo) {
          finishedFileInfos.push(completedFileInfo);
        }
      }
      /*
       * The component is single-use for the parent save action. Clear only
       * after collecting the result so a later avatar save cannot reuse it.
       */
      completedFileInfosRef.current.clear();
      return finishedFileInfos;
    };
  }, [
    uploadRef, uploadFile, doPreflight, keepFiles, manualUpload, printErrors,
    uploadRoute,
  ]);

  useEffect(() => () => {
    // clear timeouts
    if (uploadInfoRef.current.uploadTimeout) {
      clearTimeout(uploadInfoRef.current.uploadTimeout);
      uploadInfoRef.current.uploadTimeout = null;
    }
    if (uploadInfoRef.current.preflightTimeout) {
      clearTimeout(uploadInfoRef.current.preflightTimeout);
      uploadInfoRef.current.preflightTimeout = null;
    }
    /*
      * null on this ref used to detect that component is unmounted
      */
    uploadInfoRef.current.unmounted = true;
    // cancel uploads
    const uploadInfos = uploadInfoRef.current.uploads;
    for (let i = 0; i < uploadInfos.length; i += 1) {
      const { controller } = uploadInfos[i];
      if (!controller.signal.aborted) {
        controller.abort();
      }
    }
  }, []);

  const removeFile = useCallback((id) => {
    // cancel current upload that includes field
    const uploadInfo = uploadInfoRef.current.uploads.find(
      ({ ids }) => ids.includes(id),
    );
    if (uploadInfo) {
      const { controller } = uploadInfo;
      if (controller && !controller.signal.aborted) {
        controller.abort();
      }
    }
    // remove file
    setFileInfos((oldInfos) => oldInfos.map((info) => {
      if (info.id !== id) {
        return info;
      }
      return {
        ...info,
        active: false,
      };
    }));
    setDisplayedUploadElements((c) => c - 1);
  }, []);

  const closeFileUploadElement = useCallback((id) => {
    setFileInfos((oldInfos) => oldInfos.filter((info) => info.id !== id));
  }, []);

  useLayoutEffect(() => {
    if (maxFiles - displayedUploadElements > 0) {
      if (inputButtonState > 1) {
        setInputButtonState(0);
      }
    } else if (inputButtonState < 2) {
      setInputButtonState(2);
    }
  }, [maxFiles, displayedUploadElements, inputButtonState]);

  useEffect(() => {
    if (inputButtonState === 0) {
      requestAnimationFrame(() => {
        setInputButtonState(1);
      });
    }
  }, [inputButtonState]);

  const inputContainerWidth = size || 24;

  return (
    <>
      {fileInfos.map(({ id, file, active, completion }) => (
        <FileUploadElement
          key={id}
          id={id}
          file={file}
          active={active}
          completion={completion}
          close={closeFileUploadElement}
          removeFile={removeFile}
          size={size}
        />
      ))}
      {inputButtonState !== 3 && (
        <div
          style={{
            width: inputButtonState === 1 ? inputContainerWidth : 0,
            height: size,
          }}
          className="fileupload-input-container"
          onTransitionEnd={inputButtonState !== 2 ? undefined
            : () => setInputButtonState(3)}
        >
          <button
            key="ipt"
            type="button"
            className="fileupload-input-btn"
            tabIndex={0}
            title={t`Attach File`}
            onClick={handleInputClick}
          >
            <ImAttachment />
          </button>
          <input
            key="fi"
            ref={inputRef}
            type="file"
            accept={acceptedTypes}
            onChange={handleInputChange}
            className="fileupload-input-hidden"
          />
        </div>
      )}
    </>
  );
};

export default memo(FileUpload);
