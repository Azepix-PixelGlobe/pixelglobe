import { randomUUID } from 'crypto';

import pool from './mariadb.js';
import { nestQuery } from './utils.js';
import { generateHash } from '../../utils/hash.js';
import {
  USERLVL, THREEPID_PROVIDERS, USER_FLAGS, USER_FACTION_FLAGS,
} from '../../core/constants.js';
import { ADMIN_IDS } from '../../core/config.js';

export { USERLVL, THREEPID_PROVIDERS, USER_FLAGS };


/**
 * update lastSeen timestamps of User
 * @param id user id
 * @param ipString ip as string
 */
export async function touchUser(id, ipString) {
  let conn;
  try {
    conn = await pool.getConnection();

    /* TODO maybe use prepared statements? */
    await Promise.all([
      conn.query('UPDATE Users SET lastSeen = NOW() WHERE id = ?', [id]),
      (ipString) && conn.query(
        // eslint-disable-next-line max-len
        'INSERT INTO UserIPs (lastSeen, ip, uid) VALUES (NOW(), IP_TO_BIN(?), ?) ON DUPLICATE KEY UPDATE lastSeen = VALUES(lastSeen)',
        [ipString, id],
      ),
    ]);
  } catch (error) {
    console.error(
      `SQL Error on touchUser ${id}, ${ipString}: ${error.message}`,
    );
  } finally {
    if (conn) conn.release();
  }
}

/**
 * get last used IP of user
 * @param id user id
 * @return ipString or null
 */
export async function getLastIPOfUser(id) {
  try {
    const [model] = await pool.query(
      // eslint-disable-next-line max-len
      'SELECT BIN_TO_IP(ip) AS ipString FROM UserIPs WHERE lastSeen > NOW() - INTERVAL 1 DAY AND uid = ? ORDER BY lastSeen DESC LIMIT 1',
      [id],
    );
    if (model) {
      return model.ipString;
    }
  } catch (error) {
    console.error(`SQL Error on getLastIPOfUser: ${error.message}`);
  }
  return null;
}

/**
 * find or create a dummmy user. This is used for bot users.
 * @param name name of user
 */
export async function getDummyUser(name) {
  let conn;
  try {
    conn = await pool.getConnection();

    let result = await conn.query(
      'INSERT IGNORE INTO Users (name, username, userlvl) VALUES (?, ?, ?)',
      [name, '=', USERLVL.VERIFIED],
    );
    if (result.insertId) {
      return result.insertId;
    }

    [result] = await conn.query(
      'SELECT id FROM Users WHERE name = ?', [name],
    );
    return result.id;
  } finally {
    if (conn) conn.release();
  }
}

/**
 * get basic userinfo by username or id
 * @param username or id
 * @return {
 *   uid, name, country, userlvl, isMuted,
 *   customFlag, customRoleFlagId, avatarId,
 * }
 */
export async function getBasicUserInfo(uidOrUsername) {
  if (!uidOrUsername) {
    return null;
  }
  try {
    const [model] = await pool.query(
      /* eslint-disable max-len */
      `SELECT u.id AS uid, u.name, u.username, s.country, u.userlvl, p.customFlag,
CONCAT(a.shortId, ':', a.extension) AS avatarId,
CONCAT(frm.shortId, ':', frm.extension) AS customRoleFlagId,
EXISTS(SELECT 1 FROM Bans b INNER JOIN UserBans ub ON ub.bid = b.id WHERE ub.uid = u.id AND (b.flags & 0x02) != 0 AND (b.expires > NOW() OR b.expires IS NULL)) AS isMuted
FROM Users u
    LEFT JOIN Profiles p ON p.uid = u.id
    LEFT JOIN Media a ON a.id = p.avatar
    LEFT JOIN FactionRoles fr ON fr.id = p.activeRole
    LEFT JOIN Media frm ON frm.id = fr.customFlag
    LEFT JOIN Sessions s ON s.uid = u.id AND s.country != 'xx'
WHERE ${Number(uidOrUsername) ? 'u.id = ?' : 'u.username = ?'}`,
      /* eslint-enable max-len */
      [uidOrUsername],
    );
    if (model) {
      return model;
    }
  } catch (error) {
    console.error(`SQL Error on getBasicUserInfo: ${error.message}`);
  }
  return null;
}

/**
 * get extended userinfo by username or id
 * @param uidOrUsername uid or username
 * @return {
 *   uid,
 *   name,
 *   username,
 *   avatarId,
 *   customFlag,
 *   age,
 *   isPrivate,
 *   activeFactionRoleName,
 *   activeFactionTitle,
 *   activeFactionRoleFlag,
 *   factions: [{
 *     title,
 *     name,
 *   }, ...]
 * }
 */
export async function getUserInfo(uidOrUsername) {
  if (!uidOrUsername) {
    return null;
  }
  try {
    let model = await pool.query(
      /* eslint-disable max-len */
      `SELECT u.id AS uid, u.name, u.username, u.flags,
DATEDIFF(CURRENT_TIMESTAMP(), u.createdAt) AS age,
p.customFlag,
CONCAT(a.shortId, ':', a.extension) AS avatarId,
CONCAT(afrm.shortId, ':', afrm.extension) AS activeFactionRoleFlag,
afr.name AS activeFactionRoleName,
af.title AS activeFactionTitle,
f.title AS 'factions.title',
f.name AS 'factions.name'
FROM Users u
    LEFT JOIN Profiles p ON p.uid = u.id
    LEFT JOIN Media a ON a.id = p.avatar
    LEFT JOIN FactionRoles afr ON afr.id = p.activeRole
    LEFT JOIN UserFactions auf ON auf.uid = u.id AND auf.fid = afr.fid AND (auf.flags & ${0x01 << USER_FACTION_FLAGS.HIDDEN}) = 0
    LEFT JOIN Factions af ON auf.fid = af.id
    LEFT JOIN Media afrm ON afrm.id = afr.customFlag
    LEFT JOIN UserFactions uf ON uf.uid = u.id AND (uf.flags & ${0x01 << USER_FACTION_FLAGS.HIDDEN}) = 0
    LEFT JOIN Factions f ON f.id = uf.fid
WHERE ${Number(uidOrUsername) ? 'u.id = ?' : 'u.username = ?'}`,
      /* eslint-enable max-len */
      [uidOrUsername],
    );

    model = nestQuery(model);
    if (model) {
      model.isPrivate = (model.flags & (0x01 << USER_FLAGS.PRIV)) !== 0;
      delete model.flags;
      return model;
    }
  } catch (error) {
    console.error(`SQL Error on getUserInfo: ${error.message}`);
  }
  return null;
}

export async function name2Id(name) {
  try {
    const [user] = await pool.query(
      'SELECT id FROM Users WHERE name = ?', [name],
    );
    if (user) {
      return user.id;
    }
  } catch {
    // nothing
  }
  return null;
}

export async function id2Name(id) {
  try {
    const [user] = await pool.query(
      'SELECT name FROM Users WHERE id = ?', [id],
    );
    if (user) {
      return user.name;
    }
  } catch {
    // nothing
  }
  return null;
}

export async function findIdByNameOrId(searchString) {
  let id;
  if (!Number.isNaN(Number(searchString))) {
    id = parseInt(searchString, 10);
    if (!Number.isNaN(id)) {
      const name = await id2Name(id);
      if (name) {
        return { name, id };
      }
    }
  }

  id = await name2Id(searchString);
  if (id) {
    return { name: searchString, id };
  }
  return null;
}

export async function getNamesToIds(ids) {
  const idToNameMap = new Map();
  if (!ids.length) {
    return idToNameMap;
  }
  try {
    const models = await pool.query(
      `SELECT id, name FROM Users WHERE id IN (${
        ids.map(() => '?').join(', ')
      })`,
      ids,
    );
    models.forEach((obj) => {
      idToNameMap.set(obj.id, obj.name);
    });
  } catch {
    // nothing
  }
  return idToNameMap;
}

/**
 * get User by id
 * @param id user id
 * @return { id, name, username, password, flags, userlvl }
 */
export async function findUserById(id) {
  if (!id) {
    return null;
  }
  try {
    const [model] = pool.query(
      // eslint-disable-next-line max-len
      'SELECT id, name, username, password, flags, userlvl FROM Users WHERE id = ?',
      [id],
    );
    if (model) {
      return model;
    }
  } catch (error) {
    console.error(`SQL Error on findUserById: ${error.message}`);
  }
  return null;
}

/**
 * get User ids of all users with nameOrEmails
 * @param nameIdsOrEmails Array or singular name or email or id
 * @return Array of ids
 */
export async function getUserIdsByNamesOrEmails(nameIdsOrEmails) {
  const ids = [];
  if (!nameIdsOrEmails) {
    return ids;
  }
  if (!Array.isArray(nameIdsOrEmails)) {
    nameIdsOrEmails = [nameIdsOrEmails];
  }
  /* if there are already ids in nameOrEmails, pass them through */
  const nameOrEmails = [];
  for (let i = 0; i < nameIdsOrEmails.length; i += 1) {
    const n = nameIdsOrEmails[i];
    const id = parseInt(n, 10);
    if (Number.isNaN(id)) {
      nameOrEmails.push(n);
    } else {
      ids.push(id);
    }
  }

  try {
    /* eslint-disable max-len */
    const where = [];
    const replacements = [];
    if (nameOrEmails.length) {
      where.push(
        'u.name IN (?)',
        `u.username IN (SELECT l.username FROM (${
          nameOrEmails.map(() => 'SELECT CONVERT(? USING ascii) AS \'usename\'').join(' UNION ALL ')
        }) AS l)`,
        'EXISTS (SELECT 1 FROM ThreePIDs t WHERE t.uid = u.id AND t.tpid IN (?) AND t.provider = ?)',
      );
      replacements.push(nameOrEmails, ...nameOrEmails, nameOrEmails, THREEPID_PROVIDERS.EMAIL);
    }

    let users = [];
    if (where.length) {
      users = await pool.query(
        `SELECT u.id FROM Users u WHERE ${where.join(' OR ')}`, replacements,
      );
    }
    /* eslint-enable max-len */

    return ids.concat(users.map((i) => i.id));
  } catch (error) {
    console.error(`SQL Error on getUserIdsByNamesOrEmails: ${error.message}`);
  }
  return ids;
}

/**
 * people tend to get their credentials leaked, reset them to the oldest
 * email available and mark their password as 'hacked'
 * @param nameIdsOrEmails Array or singular name or email or id
 * @return [emailSet, mailExists] Arrays of UserIds that we could set mails for
 *   or not. If not, it only means that that mail is still assigned to the user
 */
export async function markUserAccountsAsHacked(nameIdsOrEmails) {
  const emailSet = [];
  const mailExists = [];
  const affectedIds = await getUserIdsByNamesOrEmails(nameIdsOrEmails);
  if (!affectedIds.length) {
    return [emailSet, mailExists];
  }

  let conn;
  try {
    conn = await pool.getConnection();

    for (let i = 0; i < affectedIds.length; i += 1) {
      const id = affectedIds[i];
      if (id) {
        // eslint-disable-next-line no-await-in-loop
        const [result] = await conn.query(
          'CALL MARK_USER_AS_HACKED(?)', [id],
        );
        if (result[0].result !== 0) {
          emailSet.push(id);
        } else {
          mailExists.push(id);
        }
      }
    }

    return [emailSet, mailExists];
  } finally {
    if (conn) conn.release();
  }
}

/**
 * get User by id or name
 * @param id user id
 * @param name user name
 * @return [{ id, name, password, userlvl }, ... ]
 */
export async function findUserByIdOrName(id, name) {
  if (!id && !name) {
    return null;
  }
  try {
    const where = [];
    const replacements = [];
    if (id) {
      if (Number.isNaN(parseInt(id, 10))) {
        /* first argument is a name instead */
        name = id;
      } else {
        where.push('u.id = ?');
        replacements.push(id);
      }
    }
    if (name) {
      where.push('u.username = ?');
      where.push('u.name = ?');
      replacements.push(name, name);
    }
    const userdata = await pool.query(
      // eslint-disable-next-line max-len
      `SELECT u.id, u.name, u.username, u.password, u.flags, u.userlvl FROM Users u WHERE ${
        where.join(' OR ')
      }`,
      replacements,
    );
    if (!userdata.length) {
      return null;
    }
    if (userdata.length === 1) {
      return userdata[0];
    }
    /* priorities: uid > username > name */
    let tmpData;
    for (let i = 0; i < userdata.length; i += 1) {
      const data = userdata[i];
      if (data.id === id) {
        return data;
      } if (data.username === name) {
        tmpData = data;
      }
    }
    if (tmpData) {
      return tmpData;
    }
    return userdata[0];
  } catch (error) {
    console.error(`SQL Error on findUserByIdOrName: ${error.message}`);
  }
  return null;
}

/**
 * find name and mail of user by id
 * @param id user id
 * @return [name, email]
 */
export async function getMailAndNameOfUserId(id) {
  try {
    const [result] = await pool.query(
      `SELECT u.name, t.tpid FROM Users u
  INNER JOIN ThreePIDs t ON t.uid = u.id
WHERE u.id = ? AND t.provider = 1 AND t.verified = ? LIMIT 1`,
      [id, true],
    );
    if (result) {
      return [result.name, result.tpid];
    }
  } catch (error) {
    console.error(`SQL Error on getMailAndNameOfUserId: ${error.message}`);
  }
  return [null, null];
}

/**
 * get basic profile info for openid
 * @param id user id
 * @return { name, username, mail, verified}
 */
export async function getUserOIDCProfile(id) {
  try {
    const [model] = await pool.query(
      // eslint-disable-next-line max-len
      `SELECT u.name, u.userlvl, u.username, u.createdAt, t.tpid AS email, t.verified FROM Users u
  LEFT JOIN ThreePIDs t ON t.uid = u.id AND t.provider = 1
WHERE u.id = ? ORDER BY t.verified DESC LIMIT 1`,
      [id],
    );
    if (model) {
      return model;
    }
  } catch (error) {
    console.error(`SQL Error on getUserOIDCProfile: ${error.message}`);
  }
  return null;
}

/**
 * set one bit in flags of user
 * @param id user id
 * @param index index of flag (see order in Model definition up there)
 * @param value 0 or 1, true or false
 * @return success boolean
 */
export async function setFlagOfUser(id, index, value) {
  try {
    const mask = 0x01 << index;
    if (value) {
      await pool.query(
        'UPDATE Users SET flags = flags | ? WHERE id = ?',
        [mask, id],
      );
    } else {
      await pool.query(
        'UPDATE Users SET flags = flags & ~(?) WHERE id = ?',
        [mask, id],
      );
    }
    return true;
  } catch (error) {
    console.error(`SQL Error on setFlagOfUser: ${error.message}`);
  }
  return false;
}

/**
 * get User by tpid
 * @param provider
 * @param tpid
 * @return limited user object or null if not found
 */
export async function getUserByTpid(provider, tpid) {
  if (!tpid || !provider) {
    return null;
  }
  try {
    const [models] = await pool.query(
      // eslint-disable-next-line max-len
      `SELECT u.id, u.name, u.username, u.password, u.flags, u.userlvl FROM Users u
  INNER JOIN ThreePIDs t ON t.uid = u.id
WHERE provider = ? AND (
  tpid = ? OR (
    normalizedTpid IS NOT NULL AND normalizedTpid = NORMALIZE_TPID(?, ?)
  )
)`,
      [provider, tpid, provider, tpid],
    );
    return models || null;
  } catch (error) {
    console.error(`SQL Error on getUserByTpid: ${error.message}`);
    throw error;
  }
}

/**
 * get User by email
 * @param email
 * @return limited user object or null if not found
 */
export function getUserByEmail(email) {
  return getUserByTpid(THREEPID_PROVIDERS.EMAIL, email);
}

/**
 * check if name is taken and if it is,
 * modify it till we find a name that is available
 * @param name
 * @return unique name
 */
export async function getNameThatIsNotTaken(name) {
  let limit = 5;

  let [user] = await pool.query('SELECT id FROM Users WHERE name = ?', [name]);
  while (user) {
    limit -= 1;
    if (limit <= 0) {
      name = randomUUID().split('-').join('');
    } else {
      // eslint-disable-next-line max-len
      name = name.substring(0, 18) + ' ' + Math.random().toString(36).substring(2, 7) + (new Date()).getUTCFullYear().toString().substring(2);
    }
    // eslint-disable-next-line no-await-in-loop
    [user] = await pool.query(
      'SELECT id FROM Users WHERE name = ?', [name],
    );
  }
  return name;
}

/**
 * verify a users email
 * @param email
 * @return id if successful, otherwise false
 */
export async function verifyEmail(email) {
  if (!email) {
    return false;
  }

  let conn;
  try {
    conn = await pool.getConnection();

    /* eslint-disable max-len */
    const result = await conn.query(
      `UPDATE Users u
  INNER JOIN ThreePIDs t ON t.uid = u.id
SET t.verified = 1, u.userlvl =
  CASE
    WHEN u.userlvl = ? THEN ?
    ELSE u.userlvl
  END
WHERE t.provider = ? AND normalizedTpid IS NOT NULL AND normalizedTpid = NORMALIZE_TPID(?, ?)`,
      [USERLVL.REGISTERED, USERLVL.VERIFIED,
        THREEPID_PROVIDERS.EMAIL, THREEPID_PROVIDERS.EMAIL, email],
    );

    if (result.affectedRows === 0) {
      return false;
    }

    const [user] = await conn.query(
      `SELECT u.id FROM Users u
  INNER JOIN ThreePIDs t ON t.uid = u.id
WHERE t.provider = ? AND normalizedTpid IS NOT NULL AND normalizedTpid = NORMALIZE_TPID(?, ?)`,
      [THREEPID_PROVIDERS.EMAIL, THREEPID_PROVIDERS.EMAIL, email],
    );
    /* eslint-enable max-len */

    if (user) {
      return user.id;
    }
  } catch (error) {
    console.error(`SQL Error on verifyEmail: ${error.message}`);
  } finally {
    if (conn) conn.release();
  }
  return false;
}

/**
 * get Users by name or email
 * @param name (or either name or email if email not given)
 * @param email (optional)
 * @param username (optional)
 * @param populate boolean
 * @return [{ id, name, username, password, userlvl, byEmail }, ... ] | null
 *   on error
 */
export async function getUsersByNameOrEmail(name, email, username) {
  if (!name) {
    return [];
  }
  if (!email) {
    email = name;
  }
  if (!username) {
    username = name;
  }
  try {
    const emailProvider = THREEPID_PROVIDERS.EMAIL;

    return await pool.query(
      /* eslint-disable max-len */
      `SELECT u.id, u.name, u.username, u.password, u.flags, u.userlvl,
EXISTS (
  SELECT 1 FROM ThreePIDs WHERE uid = u.id AND provider = ? AND normalizedTpid = NORMALIZE_TPID(?, ?)
) AS 'byEMail'
FROM Users u
WHERE u.name = ? OR u.username = CONVERT(? USING ascii) OR EXISTS (
  SELECT 1 FROM ThreePIDs WHERE uid = u.id AND provider = ? AND normalizedTpid = NORMALIZE_TPID(?, ?)
)`,
      /* eslint-enable max-len */
      [
        emailProvider, emailProvider, email,
        name, username,
        emailProvider, emailProvider, email,
      ],
    );
  } catch (err) {
    console.error(`SQL Error on getUsersByNameOrEmail: ${err.message}`);
    return null;
  }
}

/**
 * create new User
 * @param name
 * @param [password]
 * @return limited user object or null if not successful
 */
export async function createNewUser(
  name, password, username, userlvl = USERLVL.REGISTERED,
) {
  if (!username) {
    username = '=';
  }
  const hashedPassword = (password) ? generateHash(password) : null;
  try {
    const { insertId } = await pool.query(
      // eslint-disable-next-line max-len
      'INSERT INTO Users (name, userlvl, username, password) VALUES (?, ?, ?, ?)',
      [name, userlvl, username, hashedPassword],
    );
    if (!insertId) {
      throw new Error('Could not insert User');
    }
    /*
     * return dummy user object
     */
    return {
      id: insertId,
      name,
      username: (username === '=') ? `pp_${insertId}` : username,
      password: hashedPassword,
      userlvl,
      flags: 0,
      lastSeen: new Date(),
      createdAt: new Date(),
    };
  } catch (error) {
    console.error(`SQL Error on createNewUser: ${error.message}`);
    return null;
  }
}

/**
 * change a property of a user
 * @param id user id
 * @param property
 * @param value
 * @return success
 */
export async function setUserProperty(id, property, value) {
  try {
    await pool.query(
      `UPDATE Users SET ${property} = ? WHERE id = ?`,
      [value, id],
    );
    return true;
  } catch (error) {
    if (error.code !== 'ER_DUP_ENTRY') {
      console.error(`SQL Error on setUserProperty: ${error.message}`);
    }
  }
  return false;
}

/**
 * set password
 * @param id user id
 * @param password password in cleartext (we hash it here)
 */
export function setPassword(id, password) {
  return setUserProperty(id, 'password', generateHash(password));
}

/**
 * delete user
 * @param id user id
 * @return [{ cid, dmuid }, ...] destroyed DM channels
 */
export async function deleteUser(id) {
  try {
    const [models] = await pool.query('CALL DELETE_USER(?)', [id]);
    return Object.values(models);
  } catch (error) {
    console.error(`SQL Error on deleteUser: ${error.message}`);
    return null;
  }
}

/**
 * get staff
 * @param userlvl userlevel
 * @return { id, name }
 */
export async function getHighUserLvlUsers() {
  try {
    const models = await pool.query(
      'SELECT name, id, userlvl FROM Users WHERE userlvl >= ?',
      [USERLVL.CHATMOD],
    );
    const usersByLvl = {};
    for (let i = 0; i < models.length; i += 1) {
      const { name, id, userlvl } = models[i];
      if (!usersByLvl[userlvl]) {
        usersByLvl[userlvl] = [];
      }
      usersByLvl[userlvl].push([id, name]);
    }
    return usersByLvl;
  } catch (error) {
    console.error(`SQL Error on getHighUserLvlUsers: ${error.message}`);
  }
  return {};
}

/**
 * ensure correct admins based on ADMIN_IDS configuration
 */
export async function ensureAdminPowers() {
  let conn;
  try {
    conn = await pool.getConnection();

    const existingAdmins = await conn.query(
      'SELECT id FROM Users WHERE userlvl = ?', [USERLVL.ADMIN],
    );
    const adminsToDemoteIds = [];
    const adminsToPromoteIds = [];
    for (let i = 0; i < existingAdmins.length; i += 1) {
      const existingAdminId = existingAdmins[i].id;
      if (!ADMIN_IDS.includes(existingAdminId)) {
        adminsToDemoteIds.push(existingAdminId);
      }
    }
    for (let i = 0; i < ADMIN_IDS.length; i += 1) {
      const shouldBeAdminId = ADMIN_IDS[i];
      if (!existingAdmins.some((a) => a.id === shouldBeAdminId)) {
        adminsToPromoteIds.push(shouldBeAdminId);
      }
    }
    const promises = [];
    if (adminsToDemoteIds.length) {
      console.log('Demote Admins', adminsToDemoteIds);
      promises.push(conn.query(
        `UPDATE Users SET userlvl = ? WHERE id IN (${
          adminsToDemoteIds.map(() => '?').join(', ')
        })`,
        [USERLVL.VERIFIED, ...adminsToDemoteIds],
      ));
    }
    if (adminsToPromoteIds.length) {
      console.log('Promote to Admin', adminsToPromoteIds);
      promises.push(conn.query(
        `UPDATE Users SET userlvl = ? WHERE id IN (${
          adminsToPromoteIds.map(() => '?').join(', ')
        })`,
        [USERLVL.ADMIN, ...adminsToPromoteIds],
      ));
    }
    if (promises.length) {
      await Promise.all(promises);
    }
  } catch (error) {
    console.error(`SQL Error on ensureAdminPowers: ${error.message}`);
  } finally {
    if (conn) conn.release();
  }
}

/**
 * get staff with chat moderation rights
 * @return [ [username, isAdmin], ... ]
 */
export async function getChatStaff() {
  let conn;
  try {
    conn = await pool.getConnection();
    const [adminModels, modModels] = await Promise.all([
      conn.query(
        `SELECT id, username FROM Users WHERE id IN (${
          ADMIN_IDS.map(() => '?').join(', ')
        })`,
        [...ADMIN_IDS],
      ),
      conn.query(
        'SELECT id, username FROM Users WHERE userlvl >= ?', [USERLVL.CHATMOD],
      ),
    ]);
    const staff = [];
    for (const { id, username } of adminModels) {
      staff.push([id, username, true]);
    }
    for (const { id, username } of modModels) {
      if (!staff.find((staffProps) => staffProps[0] === id)) {
        staff.push([id, username, false]);
      }
    }
    return staff;
  } catch (error) {
    console.error(`SQL Error on getChatStaff: ${error.message}`);
  } finally {
    if (conn) conn.release();
  }
  return [];
}

/**
 * take array of objects that include user ids and add user informations if
 * user if not private
 * @param rawRanks array of {id: userId, ...} objects
 * @param
 */
export async function populateUserIdObj(rawRanks) {
  if (!rawRanks.length) {
    return rawRanks;
  }
  try {
    const uids = rawRanks.map((r) => r.id);
    const userData = await pool.query(
      `SELECT u.id, u.name, u.username,
  CONCAT(a.shortId, ':', a.extension) AS avatarId
  FROM Users u
    LEFT JOIN Profiles p ON p.uid = u.id
    LEFT JOIN Media a ON a.id = p.avatar
  WHERE (u.flags & ?) = 0 AND u.id IN (?)`,
      [0x01 << USER_FLAGS.PRIV, uids],
    );
    for (const { id, name, username, avatarId } of userData) {
      const rank = rawRanks.find((r) => r.id === id);
      if (rank) {
        rank.name = name;
        rank.username = username;
        rank.avatarId = avatarId;
      }
    }
  } catch (error) {
    console.error('SQL Error on populateUserIdObj:', error.message);
  }
  return rawRanks;
}

/**
 * get users by search term
 * @param term search term
 * @return [{
 *   uid,
 *   name,
 *   username,
 *   customFlagId,
 *   avatarId,
 *   ts,
 * }, ...]
 */
export async function searchUser(term) {
  try {
    const sqlTerm = `%${term}%`;
    const model = await pool.query(
      `SELECT u.id AS uid, u.name, u.username,
UNIX_TIMESTAMP(createdAt) * 1000 AS ts,
CONCAT(frm.shortId, ':', frm.extension) AS 'customFlagId',
CONCAT(a.shortId, ':', a.extension) AS avatarId FROM Users u
  LEFT JOIN Profiles p ON p.uid = u.id
  LEFT JOIN Media a ON a.id = p.avatar
  LEFT JOIN FactionRoles fr ON p.activeRole = fr.id
  LEFT JOIN Media frm ON fr.customFlag = frm.id
WHERE (u.flags & ?) = 0 AND (
  u.name LIKE ? OR u.username LIKE CONVERT(? USING ascii)
) LIMIT 50`,
      [0x01 << USER_FLAGS.PRIV, sqlTerm, sqlTerm.toLowerCase()],
    );
    if (model) {
      return model;
    }
  } catch (error) {
    console.error('SQL Error on searchUser:', error.message);
  }
  return [];
}

/* ================================ Blocks ====================================
 * Users blocking other Users
 */

/**
 * check if user blocks another
 * @param uid user to check
 * @param buid user to know whether he is blocks
 * @return boolean
 */
export async function isUserBlockedBy(uid, buid) {
  const models = await pool.query(
    'SELECT 1 FROM UserBlocks WHERE uid = ? AND buid = ?', [uid, buid],
  );
  return models.length > 0;
}

/**
 * block user
 * @param uid id of the user that is blocking someone else
 * @param buid id of user who gets blocked
 * @return boolean if successful
 */
export async function blockUser(uid, buid) {
  try {
    await pool.query(
      'INSERT IGNORE INTO UserBlocks (uid, buid) VALUES (?, ?)', [uid, buid],
    );
    return true;
  } catch (error) {
    console.error(`SQL Error on blockUser: ${error.message}`);
  }
  return false;
}

/**
 * unblock user
 * @param uid id of the user that is blocking someone else
 * @param buid id of user who is blocked
 * @return boolnea if successful
 */
export async function unblockUser(uid, buid) {
  try {
    await pool.query(
      'DELETE FROM UserBlocks WHERE uid = ? AND buid = ?', [uid, buid],
    );
    return true;
  } catch (error) {
    console.error(`SQL Error on blockUser: ${error.message}`);
  }
  return false;
}
