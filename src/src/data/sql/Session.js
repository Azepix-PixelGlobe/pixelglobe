import pool from './mariadb.js';
import { generateToken, generateTokenHash } from '../../utils/hash.js';
import { USER_FLAGS, HOUR } from '../../core/constants.js';

/**
 * create session for a user
 * @param uid id of user
 * @param durationHours how long session is valid in hours or null for permanent
 * @param ip ip to store in the session
 * @return [
 *    null | token: session token,
 *   newLocation: boolean
 * ]
 */
export async function createSession(
  uid, durationHours, ip = null, device = null,
) {
  if (durationHours !== null && !durationHours) {
    /*
     * if we have a duration of 0, which would be a cookie that deletes on
     * browser close, we still store it for two days, cause we don't know when
     * a browser closes
     */
    durationHours = 48;
  }

  let conn;
  try {
    conn = await pool.getConnection();

    /*
     * make sure ip and device are parsed
     */
    const [deviceId] = await Promise.all([
      device?.getDeviceId(),
      ip?.getAllowance(),
    ]);
    /*
     * limit the amount of open sessions a user can have, and check if new
     * location
     */
    const openSessions = await conn.query(
      // eslint-disable-next-line max-len
      'SELECT country FROM Sessions WHERE uid = ? AND (expires > NOW() OR expires IS NULL)',
      [uid],
    );
    let newLocation = false;
    if (openSessions.length > 0) {
      if (openSessions.length > 50) {
        await conn.query(
          `DELETE t FROM Sessions t JOIN (
    SELECT id FROM Sessions WHERE uid = ? ORDER BY id ASC LIMIT 5
  ) AS oldest ON t.id = oldest.id`,
          [uid],
        );
      }
      newLocation = !openSessions.some(({ country }) => country === ip.country);
    }

    const token = generateToken();
    // eslint-disable-next-line max-len
    const expires = durationHours && new Date(Date.now() + durationHours * HOUR);

    await conn.query(
      // eslint-disable-next-line max-len
      'INSERT INTO Sessions (uid, token, expires, ip, country, did, createdAt) VALUES (?,?,?,IP_TO_BIN(?),?,?, NOW())', [
        uid, generateTokenHash(token), expires,
        ip?.ipString, ip?.country || 'xx', deviceId,
      ],
    );
    return [token, newLocation];
  } catch (error) {
    console.error(`SQL Error on createSession: ${error.message}`);
  } finally {
    if (conn) conn.release();
  }
  return [null, false];
}

/**
 * remove session
 * @param token
 * @return boolean success
 */
export async function removeSession(token) {
  if (!token) {
    return false;
  }
  try {
    const { affectedRows } = await pool.query(
      'DELETE FROM Sessions WHERE token = ?', [generateTokenHash(token)],
    );
    return affectedRows !== 0;
  } catch (error) {
    console.error(`SQL Error on removeSession: ${error.message}`);
  }
  return false;
}

/**
 * remove session by id
 * @param id session id
 * @param uid user id
 * @return boolean success
 */
export async function removeSessionById(id, uid) {
  if (!id) {
    return false;
  }
  try {
    const { affectedRows } = await pool.query(
      'DELETE FROM Sessions WHERE id = ? AND uid = ?', [id, uid],
    );
    return affectedRows !== 0;
  } catch (error) {
    console.error(`SQL Error on removeSessionById: ${error.message}`);
  }
  return false;
}

/**
 * resolve only uid of session of given token
 * @param token
 * @return uid: number | null
 */
export async function resolveSessionUid(token) {
  if (!token) {
    return null;
  }
  try {
    const [session] = await pool.query(
      // eslint-disable-next-line max-len
      'SELECT uid FROM Sessions WHERE token = ? AND (expires > NOW() OR expires IS NULL)',
      [generateTokenHash(token)],
    );
    if (session) {
      return session.uid;
    }
  } catch (error) {
    console.error(`SQL Error on resolveSessionUid: ${error.message}`);
  }
  return null;
}

/**
 * resolve uid and age of session of given token in seconds
 * Additionally return if a user is valid for oauth login, which currently
 * only means that a username must be set.
 * @param token
 * @return [uid: number | null, age: number | null, isValid: boolean]
 */
export async function resolveSessionUidAndAge(token) {
  if (!token) {
    return [null, null];
  }
  try {
    const [session] = await pool.query(
      // eslint-disable-next-line max-len
      `SELECT s.uid, s.createdAt, u.username NOT LIKE 'pp\\_%' AS isValid FROM Sessions s
  INNER JOIN Users u ON u.id = s.uid
WHERE token = ? AND (expires > NOW() OR expires IS NULL)`,
      [generateTokenHash(token)],
    );
    if (session) {
      return [
        session.uid,
        Math.floor(session.createdAt.getTime() / 1000),
        !!session.isValid,
      ];
    }
  } catch (error) {
    console.error(`SQL Error on resolveSessionUidAndAge: ${error.message}`);
  }
  return [null, null];
}

/**
 * resolve a session for a given token
 * @param token
 * @return null | {
 *   id,
 *   name,
 *   username,
 *   password,
 *   userlvl,
 *   blockDm,
 *   priv,
 *   lastSeen,
 *   createdAt,
 *   customFlag,
 *   customRoleFlagId,
 *   activeFactionId,
 *   bans: [ { expires, flags }, ... ],
 *   userChannels: [ [cid, muted], ...],
 * }
 */
export async function resolveSession(token) {
  if (!token) {
    return null;
  }

  try {
    const models = await pool.query(
      'CALL RESOLVE_SESSION(?)', [generateTokenHash(token)],
    );
    if (!Array.isArray(models)) {
      /*
       * mariadb-connector returns an OkPacket object if no result sets are
       * present
       */
      return null;
    }
    const [userModels, banModels, channelModels] = models;
    if (!userModels.length) {
      return null;
    }
    const [userModel] = userModels;
    /*
     * userModel: {
     *   id, name, username, password, userlvl, flags,
     *   lastSeen, createdAt, customFlag,
     *   avatarId, customRoleFlagId,
     *   activeFactionId,
     * }
     * banModels: [
     *   { expires, flags }, ...
     * ]
     * channelModels: [
     *   { cid, muted }, ...
     * ]
     */
    userModel.bans = banModels;
    userModel.userChannels = channelModels.map(
      ({ cid, muted }) => [cid, muted !== 0],
    );

    userModel.blockDm = (userModel.flags & (0x01 << USER_FLAGS.BLOCK_DM)) !== 0;
    userModel.priv = (userModel.flags & (0x01 << USER_FLAGS.PRIV)) !== 0;
    delete userModel.flags;
    return userModel;
  } catch (error) {
    console.error(`SQL Error on resolveSession: ${error.message}`);
  }
  return null;
}

/**
 * get all Sessions for a User
 * @param userId
 * @return [{
 *   id: session id,
 *   token: session token,
 *   country,
 *   os,
 *   browser,
 * }, ...]
 */
export async function getAllSessionsOfUser(userId) {
  if (userId) {
    try {
      return await pool.query(
        `SELECT s.id, s.token, s.country, d.os, d.browser FROM Sessions s
    LEFT JOIN Devices d ON d.id = s.did
  WHERE s.uid = ? AND (s.expires > NOW() OR s.expires IS NULL)`,
        [userId],
      );
    } catch (error) {
      console.error(`SQL Error on getAllSessionsOfUser: ${error.message}`);
    }
  }
  return [];
}
