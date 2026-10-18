/*
 *
 * Database layout for Chat Messages
 *
 */
import pool from './mariadb.js';
import { CHANNEL_TYPES } from '../../core/constants.js';
import mapFlag from '../../utils/flagMapping.js';
import parseAttachmentsFromMd from '../../utils/markdown/attachmentParser.js';
import { getMediaFromLinks } from '../../utils/media/serverUtils.js';


/**
 * store message, may throw an Error
 * @param message
 * @param cid channel id
 * @param uid user id
 * @return message id or null
 */
export async function storeMessage(message, cid, uid) {
  if (message.length > 200) {
    throw new Error('too_long');
  }
  const media = getMediaFromLinks(parseAttachmentsFromMd(message));
  if (media.length > 3) {
    throw new Error('too_many_files');
  }

  let models;
  let retries = 3;
  while (!models && retries) {
    retries -= 1;
    try {
      // eslint-disable-next-line no-await-in-loop
      models = await pool.query(
        'CALL STORE_CHAT_MESSAGE(?, ?, ?, ?)', [
          cid, uid, message,
          (media.length) ? JSON.stringify(media) : null,
        ],
      );
    } catch (error) {
      /*
       * message storing can deadlock
       */
      if (error.code !== 'ER_LOCK_DEADLOCK') {
        console.error(
          `SQL Error on storeMessage ${cid} | ${uid}: ${error.message}`,
        );
        throw new Error('store_error');
      }
      // eslint-disable-next-line no-await-in-loop
      await new Promise((resolve) => { setTimeout(resolve, 500); });
    }
  }

  if (!models) {
    console.error(
      // eslint-disable-next-line max-len
      `SQL Error on storeMessage ${cid} | ${uid}: Could not aquire lock within three tries`,
    );
    throw new Error('store_error');
  }
  const [[{ result, id }]] = models;
  if (result === 1) {
    throw new Error('no_such_channel');
  }
  if (result !== 0) {
    throw new Error('store_error');
  }
  /*
    * if second result set exists, media got attached
    */
  const attachments = [];
  if (models[1]) {
    [, models] = models;
    for (let i = 0; i < models.length; i += 1) {
      const {
        mediaId, mediaType, mediaSize, mediaWidth, mediaHeight, mediaAvgColor,
      } = models[i];
      attachments.push([
        mediaId, mediaType, mediaSize, mediaWidth, mediaHeight, mediaAvgColor,
      ]);
    }
  }

  return [id, attachments];
}

/**
 * delete all messages of a user written in public channels
 * @param uid user id
 * @return success
 */
export async function deletePublicUserMessages(uid) {
  if (!uid) {
    return false;
  }
  try {
    await pool.query(
      `DELETE m FROM Messages m
  INNER JOIN Channels c ON m.cid = c.id
WHERE m.uid = ? AND c.type = ?`,
      [uid, CHANNEL_TYPES.PUBLIC],
    );
    return true;
  } catch (error) {
    console.error(`SQL Error on deleteUserMessages: ${error.message}`);
  }
  return false;
}

/**
 * delete all messages of a user written in public channels
 * @param uid user id
 * @return success
 */
export async function deleteUserChannelMessages(uid, cid) {
  try {
    await pool.query(
      'DELETE FROM Messages WHERE uid = ? AND cid = ?', [uid, cid],
    );
    return true;
  } catch (error) {
    console.error(`SQL Error on deleteUserChannelMessages: ${error.message}`);
  }
  return false;
}

/**
 * delete messages by ids
 * @param ids ids of messages
 * @return success
 */
export async function deleteMessagesByIds(ids) {
  if (!ids) {
    return false;
  }
  if (!Array.isArray(ids)) {
    ids = [ids];
  }
  if (!ids.length) {
    return false;
  }
  try {
    await pool.query(
      `DELETE m FROM Messages m WHERE id in (${
        ids.map(() => '?').join(', ')
      })`,
      ids,
    );
    return true;
  } catch (error) {
    console.error(`SQL Error on deleteMessagesByIds: ${error.message}`);
  }
  return false;
}

/**
 * delete speciic message
 * @param mid message id
 * @return success
 */
export async function deleteMessage(mid) {
  if (!mid) {
    return false;
  }
  try {
    await pool.query('DELETE FROM Messages WHERE id = ?', [mid]);
    return true;
  } catch (error) {
    console.error(`SQL Error on deleteUserMessages: ${error.message}`);
  }
  return false;
}

/**
 * get recent history of channel
 * @param cid channel id
 * @param limit amount of last messages to get
 * @return [[name, message, flag, userId, ts, msgId, avatarId], ...]
 */
export async function getMessagesForChannel(cid, limit) {
  try {
    const models = await pool.query(
      /* eslint-disable max-len */
      `SELECT DISTINCT m.createdAt, m.id AS msgId, m.message, m.uid AS userId,
UNIX_TIMESTAMP(m.createdAt) AS 'ts',
u.name, u.userlvl, p.customFlag,
COALESCE((SELECT s.country FROM Sessions s WHERE s.uid = u.id ORDER BY s.id DESC LIMIT 1), 'xx') AS country,
CONCAT(b.shortId, ':', b.extension) AS mediaId, b.type AS mediaType, b.size AS mediaSize, b.width AS mediaWidth, b.height AS mediaHeight, b.avgColor AS mediaAvgColor,
CONCAT(a.shortId, ':', a.extension) AS avatarId,
CONCAT(frm.shortId, ':', frm.extension) AS customRoleFlagId FROM Messages m
  INNER JOIN Users u ON u.id = m.uid
  LEFT JOIN Profiles p ON p.uid = u.id
  LEFT JOIN Media a ON a.id = p.avatar
  LEFT JOIN FactionRoles fr ON fr.id = p.activeRole
  LEFT JOIN Media frm ON frm.id = fr.customFlag
  LEFT JOIN MessageMedia mm ON mm.sid = m.id
  LEFT JOIN Media b ON b.id = mm.mid
WHERE m.cid = ? ORDER BY m.id DESC LIMIT ?`,
      /* eslint-enable max-len */
      [cid, limit],
    );
    const rows = [];
    const mediaReferences = new Map();

    let i = models.length;
    while (i > 0) {
      i -= 1;
      const model = models[i];
      const { name, message, userId, ts, msgId, avatarId, mediaId } = model;
      const [flagLegit, flag] = mapFlag(
        model.customRoleFlagId, model.customFlag, model.userlvl, model.country,
      );
      if (mediaId) {
        let attachments = mediaReferences.get(msgId);
        if (!attachments) {
          attachments = [];
          rows.push(
            [
              name, message, flag, userId, ts, msgId, flagLegit, avatarId,
              attachments,
            ],
          );
          mediaReferences.set(msgId, attachments);
        }
        const {
          mediaType, mediaSize, mediaWidth, mediaHeight, mediaAvgColor,
        } = model;
        attachments.push([
          mediaId, mediaType, mediaSize, mediaWidth, mediaHeight, mediaAvgColor,
        ]);
      } else {
        rows.push(
          [name, message, flag, userId, ts, msgId, flagLegit, avatarId, []],
        );
      }
    }
    return rows;
  } catch (error) {
    console.error(`SQL Error on getMessagesForChannel: ${error.message}`);
  }
  return [];
}
