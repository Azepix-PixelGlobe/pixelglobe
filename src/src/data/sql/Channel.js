/*
 *
 * Database layout for Chat Channels
 *
 */

import pool from './mariadb.js';

import { CHANNEL_TYPES } from '../../core/constants.js';

/**
 * DM kanalındaki karşı tarafı bul (özel arama başlatmak için uid gerekir).
 * @param cid channel id of the DM
 * @param myUid own user id
 * @return { uid, name } | null
 */
export async function getDmPartner(cid, myUid) {
  if (!cid || !myUid) return null;
  try {
    const [row] = await pool.query(
      /* eslint-disable max-len */
      `SELECT u.id AS uid, u.name FROM UserChannels uc
  INNER JOIN Channels c ON c.id = uc.cid
  INNER JOIN Users u ON u.id = uc.uid
WHERE uc.cid = ? AND uc.uid <> ? AND c.type = ?`,
      /* eslint-enable max-len */
      [cid, myUid, CHANNEL_TYPES.DM],
    );
    if (row) {
      return { uid: row.uid, name: row.name };
    }
  } catch (error) {
    console.error(`SQL Error on getDmPartner: ${error.message}`);
  }
  return null;
}

/**
 * add a user to a channel
 * @param uid user id
 * @param cid channel id
 * @return boolean success
 */
export async function addUserToChannel(uid, cid) {
  try {
    const { affectedRows } = await pool.query(
      `INSERT INTO UserChannels (uid, cid) VALUES (?, ?, NOW())
  ON DUPLICATE KEY UPDATE uid = VALUES(uid), cid = VALUES(cid))`,
      [uid, cid],
    );
    return affectedRows === 1;
  } catch (error) {
    console.error(`SQL Error on :wqaddUserToChannel: ${error.message}`);
  }
  return false;
}

/**
 * find DM channel between users
 * @param uidA user id of user A
 * @param uidB user id of user B
 * @return channel id of DM channel or null if none exists
 */
export async function findDMChannel(uidA, uidB) {
  if (!uidA || !uidB) {
    return null;
  }
  try {
    const [channel] = await pool.query(
      /* eslint-disable max-len */
      `SELECT c.id FROM Channels c
  INNER JOIN UserChannels uc ON c.id = uc.cid
WHERE c.type = ? AND uc.uid IN (?, ?) GROUP BY c.id HAVING COUNT(DISTINCT uc.uid) = 2`,
      /* eslint-disable max-len */
      [CHANNEL_TYPES.DM, uidA, uidB],
    );
    if (channel) {
      return channel.id;
    }
  } catch (error) {
    console.error(`SQL Error on findDMChannel: ${error.message}`);
  }
  return null;
}

/**
 * create DM between two users
 * @param uidA user id of user A
 * @param uidB user id of user B
 * @return [cid, created] cid can be set and created false if DM channel
 *   already exists
 */
export async function createDMChannel(uidA, uidB) {
  try {
    const [[{ cid, created }]] = await pool.query(
      'CALL CREATE_DM_CHANNEL(?, ?)', [uidA, uidB],
    );
    return [cid, created !== 0];
  } catch (error) {
    console.error(`SQL Error on createDMChannel: ${error.message}`);
    throw error;
  }
}

/**
 * delete dem channel between users if one exists
 * @param uidA user id of user A
 * @param uidB user id of user B
 * @return channelId if success, null if not
 */
export async function deleteDMChannel(uidA, uidB) {
  try {
    const [[{ cid }]] = await pool.query(
      'CALL DELETE_DM_CHANNEL(?, ?)', [uidA, uidB],
    );
    return cid;
  } catch (error) {
    console.error(`SQL Error on deleteDMChannel: ${error.message}`);
  }
  return null;
}

/**
 * user leaving a channel
 * @param uid user id
 * @param cid channel id
 * @return [affectedUsers, channelType] | null
 */
export async function leaveChannel(uid, cid) {
  try {
    const [[{ result, channelType }], affectedUsers] = await pool.query(
      'CALL LEAVE_CHANNEL(?, ?)', [uid, cid],
    );
    if (result === 0) {
      return [affectedUsers.map(({ uid: id }) => id), channelType];
    }
  } catch (error) {
    console.error(`SQL Error on leaveChannel: ${error.message}`);
  }
  return null;
}

/**
 * find or create a default channel
 * @param name name of channel
 * @return { id, lastTs }
 */
export async function getDefaultChannel(name) {
  let conn;
  try {
    conn = await pool.getConnection();

    const [model] = await conn.query(
      'SELECT id, UNIX_TIMESTAMP(lastMessage) AS lastTs FROM Channels WHERE name = ? AND type = ?',
      [name, CHANNEL_TYPES.PUBLIC],
    );
    if (model) {
      return model;
    }
    const { insertId } = await conn.query(
      'INSERT INTO Channels (name, type) VALUES (?, ?)',
      [name, CHANNEL_TYPES.PUBLIC],
    );
    if (!insertId) {
      throw new Error('Could not create new channel');
    }
    return { id: insertId, lastTs: Math.floor(Date.now() / 1000) };
  } finally {
    if (conn) conn.release();
  }
}

export async function setUserChannelMute(channelId, userId, mute) {
  try {
    await pool.query(
      'UPDATE UserChannels SET muted = ? WHERE cid = ? AND uid = ?',
      [(mute) ? 1 : 0, channelId, userId],
    );
    return true;
  } catch {
    return false;
  }
}

/**
 * get chat related data of user like channels and blocked users
 * @param uid userId
 * @return {
 *   channels: {
 *     [CHANNEL_TYPE]: [
 *        [cid, name, lastTs, lastReadTs, muted, avatarIdOrCc,
 *      ], ...],
 *   ... },
 *   blocked: [[uid, name], ...],
 * }
 */
export async function getUserChatData(uid) {
  const channels = {};
  const blocked = [];
  try {
    const [blockedModels, channelModels] = await pool.query(
      'CALL GET_USER_CHANNEL_INFO(?)', [uid],
    );

    for (let i = 0; i < blockedModels.length; i += 1) {
      const { buid, name } = blockedModels[i];
      blocked.push([buid, name]);
    }

    for (let i = 0; i < channelModels.length; i += 1) {
      const {
        type, id, name, lastTs, lastReadTs, muted, avatarId,
      } = channelModels[i];
      let typeArray = channels[type];
      if (!typeArray) {
        typeArray = [];
        channels[type] = typeArray;
      }
      typeArray.push([
        id, name, lastTs, lastReadTs, muted !== 0, avatarId,
      ]);
    }
  } catch (error) {
    console.error('SQL Error on getUserChatData:', error.message);
  }
  return { channels, blocked };
}

/**
 * mark channels as read
 * @param channelIds one or more channelIds
 * @param userIds one or more userIds
 * @return boolean success
 */
export async function markChannelsRead(channelIds, userIds) {
  if (!channelIds || !userIds) {
    return false;
  }

  let replacements = [];
  let channelWhere;
  if (Array.isArray(channelIds)) {
    if (channelIds.length) {
      channelWhere = `cid in ( ${channelIds.map(() => '?').join(', ')} )`;
      replacements = replacements.concat(channelIds);
    } else {
      return false;
    }
  } else {
    channelWhere = 'cid = ?';
    replacements.push(channelIds);
  }

  let userWhere;
  if (Array.isArray(userIds)) {
    if (userIds.length) {
      userWhere = `uid in ( ${userIds.map(() => '?').join(', ')} )`;
      replacements = replacements.concat(userIds);
    } else {
      return false;
    }
  } else {
    userWhere = 'uid = ?';
    replacements.push(userIds);
  }

  try {
    await pool.query(

      `UPDATE UserChannels SET lastRead = NOW() WHERE ${channelWhere} AND ${userWhere}`,
      replacements,
    );
    return true;
  } catch (error) {
    console.error(`SQL Error on markChannelsRead: ${error.message}`);
  }
  return false;
}
