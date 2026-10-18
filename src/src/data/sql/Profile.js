import pool from './mariadb.js';

/**
 * set custom flag of a user
 * @param uid userId
 * @param code two letter flag code
 */
export async function setCustomFlag(uid, code = null) {
  try {
    if (!uid) {
      return false;
    }
    await pool.query(
      // eslint-disable-next-line max-len
      'INSERT INTO Profiles (uid, customFlag) VALUES (?, ?) ON DUPLICATE KEY UPDATE customFlag = VALUES(customFlag)',
      [uid, code],
    );
    return true;
  } catch (err) {
    console.error('SQL Error on createCustomFlag:', err.message);
    return false;
  }
}

/**
 * set avatar of a user
 * @param uid userId
 * @param mediaId shortId:extension of media
 */
export async function setUserAvatar(uid, mediaId = null) {
  try {
    if (!mediaId) {
      await pool.query(
        // eslint-disable-next-line max-len
        'INSERT INTO Profiles (uid, avatar) VALUES (?, ?) ON DUPLICATE KEY UPDATE avatar = VALUES(avatar)',
        [uid, null],
      );
      return true;
    }

    const [shortId, extension] = mediaId.split(':');
    if (!shortId || !extension) {
      return false;
    }
    const [media] = await pool.query(
      'SELECT id FROM Media WHERE shortId = ? AND extension = ?',
      [shortId, extension],
    );
    if (!media) {
      return false;
    }
    await pool.query(
      // eslint-disable-next-line max-len
      'INSERT INTO Profiles (uid, avatar) SELECT ?, m.id FROM Media m WHERE m.shortId = ? AND m.extension = ? ON DUPLICATE KEY UPDATE avatar = VALUES(avatar)',
      [uid, shortId, extension],
    );
    return true;
  } catch (err) {
    console.error('SQL Error on setUserAvatar:', err.message);
    return false;
  }
}

/**
 * set active faction role of user
 * @param uid userId
 * @param factionRole uuid of faction role
 * @return boolean if successful
 */
export async function setActiveFactionRole(uid, factionRole = null) {
  if (!uid) {
    return false;
  }

  let conn;
  try {
    conn = await pool.getConnection();

    let activeRole = null;
    if (factionRole) {
      /* make sure user has that role and is in that faction */
      const [model] = await conn.query(
        `SELECT fr.id AS sqlFrid FROM UserFactionRoles ufr
  INNER JOIN FactionRoles fr ON ufr.frid = fr.id
  INNER JOIN Factions f ON fr.fid = f.id
  INNER JOIN UserFactions uf ON uf.fid = f.id
WHERE ufr.uid = ? AND uf.uid = ? AND fr.uuid = UUID_TO_BIN(?)`,
        [uid, uid, factionRole],
      );
      if (!model) {
        return false;
      }
      activeRole = model.sqlFrid;
    }

    await conn.query(
      // eslint-disable-next-line max-len
      'INSERT INTO Profiles (uid, activeRole) VALUES (?, ?) ON DUPLICATE KEY UPDATE activeRole = VALUES(activeRole)',
      [uid, activeRole],
    );
    return true;
  } catch (err) {
    console.error('SQL Error on setActiveFactionRole:', err.message);
    return false;
  } finally {
    if (conn) conn.release();
  }
}

/**
 * get custom flag of user
 * @param uid user id
 * @return two letter flag code or null
 */
export async function getCustomFlagById(uid) {
  try {
    const [flag] = await pool.query(
      'SELECT code FROM CustomFlags WHERE uid = ?', [uid],
    );
    if (flag) {
      return flag.code;
    }
  } catch (error) {
    console.error(`SQL Error on getCustomFlagById: ${error.message}`);
  }
  return null;
}

/**
 * get avatar of user
 * @param uid user id
 * @return two letter flag code or null
 */
export async function getAvatarById(uid) {
  try {
    const [model] = await pool.query(
      `SELECT CONCAT(a.shortId, ':', a.extension) AS avatarId FROM Profiles p
  LEFT JOIN Media a ON a.id = p.avatar
WHERE p.uid = ?`,
      [uid],
    );
    if (model) {
      return model.avatarId;
    }
  } catch (error) {
    console.error(`SQL Error on getAvatarById: ${error.message}`);
  }
  return null;
}
