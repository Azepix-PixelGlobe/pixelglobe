/*
 * factions
 */

import pool from './mariadb.js';
import { nestQuery } from './utils.js';
import { getRandomShortId } from '../../core/utils.js';

import { generateUUID, bufferToUUID } from '../../utils/hash.js';
import {
  FACTION_FLAGS, USER_FACTION_FLAGS, FACTION_ROLE_FLAGS, FACTION_PERMISSIONS,
  INVITE_FLAGS,
} from '../../core/constants.js';


/**
 * get factions of a user
 * @param uid user id
 * @param isOwnProfile if the information is given to the user itself, if not,
 *   we have to hide hidden factions
 * @return {
 *   factions: [{
 *     name,
 *     title,
 *     description,
 *     memberCount,
 *     isPrivate,
 *     isPublic,
 *     isHidden,
 *     avatarId,
 *     roles: [{
 *       frid,
 *       name,
 *       customFlagId,
 *       factionlvl,
 *       isProtected,
 *       isDeault,
 *       isMember,
 *     }, ...],
 *   }, ...],
 *   activeFactionRole,
 *   }
 */
export async function getFactionsOfUser(uid, isOwnProfile) {
  let factions = [];
  let activeFactionRole = null;
  let conn;
  try {
    conn = await pool.getConnection();
    const [factionModels, [activeFactionModel]] = await Promise.all([
      /*
       * a user could be member of a faction without having a role, but we
       * disallow that case in routes to avoid confusion
       */
      conn.query(
        /* eslint-disable max-len */
        `SELECT f.name, f.title, f.description, f.memberCount, f.flags,
CONCAT(a.shortId, ':', a.extension) AS avatarId,
uf.flags AS userFactionFlags,
BIN_TO_UUID(fr.uuid) AS 'roles.frid',
CONCAT(frm.shortId, ':', frm.extension) AS 'roles.customFlagId',
EXISTS(SELECT 1 FROM UserFactionRoles ufr WHERE ufr.uid = uf.uid AND ufr.frid = fr.id) AS 'roles.isMember',
fr.name AS 'roles.name', fr.flags AS 'roles.flags',
fr.factionlvl AS 'roles.factionlvl' FROM Factions f
  INNER JOIN UserFactions uf ON uf.fid = f.id
  LEFT JOIN FactionRoles fr ON fr.fid = f.id
  LEFT JOIN Media a ON a.id = f.avatar
  LEFT JOIN Media frm ON frm.id = fr.customFlag
WHERE uf.uid = ?`,
        [uid],
      ),
      conn.query(
        `SELECT f.name, BIN_TO_UUID(fr.uuid) AS frid FROM Factions f
  INNER JOIN FactionRoles fr ON fr.fid = f.id
  INNER JOIN Profiles p ON fr.id = p.activeRole
WHERE p.uid = ?`,
        /* eslint-enable max-len */
        [uid],
      ),
    ]);
    if (factionModels.length) {
      let activeFactionName;
      if (activeFactionModel) {
        activeFactionName = activeFactionModel.name;
        activeFactionRole = activeFactionModel.frid;
      }
      factions = nestQuery(factionModels, 'name');

      for (let i = 0; i < factions.length; i += 1) {
        const model = factions[i];
        // whether or not searchable
        model.isPrivate = (model.flags & (0x01 << FACTION_FLAGS.PRIV)) !== 0;
        // whether or not joinable without invite
        model.isPublic = (model.flags & (0x01 << FACTION_FLAGS.PUBLIC)) !== 0;
        model.isHidden = false;
        if (model.userFactionFlags) {
          if (model.userFactionFlags & (0x01 << USER_FACTION_FLAGS.HIDDEN)) {
            if (model.name === activeFactionName && !isOwnProfile) {
              activeFactionRole = null;
            }
            model.isHidden = true;
          }
          delete model.userFactionFlags;
        }
        delete model.flags;

        for (let u = 0; u < model.roles.length; u += 1) {
          const role = model.roles[u];
          // eslint-disable-next-line max-len
          role.isProtected = (role.flags & (0x01 << FACTION_ROLE_FLAGS.PROTECTED)) !== 0;
          // eslint-disable-next-line max-len
          role.isDefault = (role.flags & (0x01 << FACTION_ROLE_FLAGS.DEFAULT)) !== 0;
          delete role.flags;
        }
      }

      /* filter for public */
      if (!isOwnProfile) {
        factions = factions.filter((m) => !m.isHidden);
      }
    }
  } catch (error) {
    console.error(`SQL Error on getFactionsOfUser: ${error.message}`);
  } finally {
    if (conn) conn.release();
  }
  return { factions, activeFactionRole };
}

/**
 * set one bit in flags of user faction
 * @param uid user id
 * @param factionName faction name
 * @param index index of flag
 * @param value 0 or 1, true or false
 * @return success boolean
 */
export async function setFlagOfUserFaction(uid, factionName, index, value) {
  try {
    const mask = 0x01 << index;
    /* eslint-disable max-len */
    if (value) {
      await pool.query(
        'UPDATE UserFactions SET flags = flags | ? WHERE uid = ? AND fid = (SELECT id FROM Factions WHERE name = ?)',
        [mask, uid, factionName],
      );
    } else {
      await pool.query(
        'UPDATE UserFactions SET flags = flags & ~(?) WHERE uid = ? AND fid = (SELECT id FROM Factions WHERE name = ?)',
        [mask, uid, factionName],
      );
    }
    /* eslint-enable max-len */
    return true;
  } catch (error) {
    console.error(`SQL Error on setFlagOfUserFaction: ${error.message}`);
  }
  return false;
}

/**
 * set one bit in flags of faction
 * @param name faction name
 * @param index index of flag
 * @param value 0 or 1, true or false
 * @return success boolean
 */
export async function setFlagOfFaction(name, index, value) {
  try {
    const mask = 0x01 << index;
    if (value) {
      await pool.query(
        'UPDATE Factions SET flags = flags | ? WHERE name = ?',
        [mask, name],
      );
    } else {
      await pool.query(
        'UPDATE Factions SET flags = flags & ~(?) WHERE name = ?',
        [mask, name],
      );
    }
    return true;
  } catch (error) {
    console.error(`SQL Error on setFlagOfFaction: ${error.message}`);
  }
  return false;
}

/**
 * get powerlevel and faction sql id of user in faction
 * @param uid user id
 * @param factionName faction name
 * @return {
 *   sqlFid: null if not member of the faction or it doesn't exist,
 *   powerlvl: 0 if member but no role, null if not member or faction not exist
 * }
 */
export async function getFactionLvlOfUser(uid, factionName) {
  let sqlFid = null;
  let powerlvl = null;
  try {
    const [model] = await pool.query(
      /* eslint-disable max-len */
      `SELECT f.id AS sqlFid, fr.factionlvl AS powerlvl FROM Factions f
  INNER JOIN UserFactions uf ON uf.fid = f.id
  LEFT JOIN UserFactionRoles ufr ON ufr.uid = uf.uid
  LEFT JOIN FactionRoles fr ON fr.id = ufr.frid AND fr.fid = f.id
WHERE uf.uid = ? AND f.name = CONVERT(? USING ascii) ORDER BY fr.factionlvl DESC LIMIT 1`,
      /* eslint-enable max-len */
      [uid, factionName],
    );
    if (model) {
      sqlFid = model.sqlFid;
      /* if user is in faction but has no role assigned to him */
      powerlvl = model.powerlvl || 0;
    }
  } catch (error) {
    console.error(`SQL Error on getFactionLvlOfUser: ${error.message}`);
  }
  return { sqlFid, powerlvl };
}

/**
 * get amount of sovereign of a faction
 * @param sqlFid sql id of faction
 * @return number
 */
export async function getAmountOfFactionOwners(sqlFid) {
  try {
    const [model] = await pool.query(
      `SELECT COUNT(DISTINCT ufr.uid) AS count FROM UserFactionRoles ufr
  INNER JOIN FactionRoles fr ON ufr.frid = fr.id
WHERE fr.fid = ? AND fr.factionlvl >= ?`,
      [sqlFid, FACTION_PERMISSIONS.SOVEREIGN],
    );
    if (model) {
      return model.count;
    }
  } catch (error) {
    console.error(`SQL Error on getAmountOfFactionOwners: ${error.message}`);
  }
  return 0;
}

/**
 * get all members of a faction
 * @param sqlFid sql id of faction
 * @return [ userId1, userId2, ...]
 */
export async function getAllMembersOfFaction(sqlFid) {
  try {
    const models = await pool.query(
      'SELECT uid FROM UserFactions WHERE fid = ?',
      [sqlFid],
    );
    if (models) {
      return models.map(({ uid }) => uid);
    }
  } catch (error) {
    console.error(`SQL Error on getAllMembersOfFaction: ${error.message}`);
  }
  return [];
}

/**
 * check if a faction with a given name exists
 * @param name
 * @return boolean
 */
export async function checkIfFactionExists(name) {
  try {
    const models = await pool.query(
      'SELECT 1 FROM Factions WHERE name = ?', [name],
    );
    return models.length > 0;
  } catch (error) {
    console.error(`SQL Error on checkIfFactionExists: ${error.message}`);
  }
  return true;
}

/**
 * take array of objects that include faction ids and add faction informations
 * if faction is not private
 * @param rawRanks array of {id: factionIds, ...} objects
 */
export async function populateFactionIdObj(rawRanks) {
  if (!rawRanks.length) {
    return rawRanks;
  }
  const fids = rawRanks.map((r) => r.id);
  const userData = await pool.query(
    `SELECT f.id, f.title, f.name,
CONCAT(a.shortId, ':', a.extension) AS avatarId
FROM Factions f
  LEFT JOIN Media a ON a.id = f.avatar
WHERE (f.flags & ?) = 0 AND f.id IN (?)`,
    [0x01 << FACTION_FLAGS.PRIV, fids],
  );
  for (const { id, name, title, avatarId } of userData) {
    const rank = rawRanks.find((r) => r.id === id);
    if (rank) {
      rank.name = name;
      rank.title = title;
      rank.avatarId = avatarId;
    }
  }
  return rawRanks;
}

/**
 * set avatar of faction
 * @param sqlFid sql id of faction
 * @param mediaId shortId:extension of media
 */
export async function setFactionAvatar(sqlFid, mediaId = null) {
  try {
    if (!mediaId) {
      await pool.query(
        'UPDATE Factions SET avatar = NULL WHERE id = ?',
        [sqlFid],
      );
    } else {
      const [shortId, extension] = mediaId.split(':');
      if (!shortId || !extension) {
        return false;
      }
      await pool.query(
        // eslint-disable-next-line max-len
        'UPDATE Factions SET avatar = (SELECT id FROM Media WHERE shortId = ? AND extension = ?) WHERE id = ?',
        [shortId, extension, sqlFid],
      );
    }
    return true;
  } catch (error) {
    console.error('SQL Error on setFactionAvatar:', error.message);
    return false;
  }
}

/**
 * create a new faction
 * @param uid user id of owner
 * @return number
 *   0 success
 *   1 max amount of factions reached
 *   2 max amount of owned factions reached
 *   3 user too young
 *   4 media doesnt exist
 *   5 faction name already taken
 *   -1 failure
 */
export async function createFaction(
  uid, name, title, description, isPrivate, isPublic, avatarId,
) {
  let flags = 0;
  if (isPrivate) {
    flags |= 0x01 << FACTION_FLAGS.PRIV;
  }
  if (isPublic) {
    flags |= 0x01 << FACTION_FLAGS.PUBLIC;
  }

  try {
    const sovereignFrid = bufferToUUID(generateUUID());
    const peasantFrid = bufferToUUID(generateUUID());

    const [[{ result }]] = await pool.query(
      'CALL CREATE_FACTION(?, ?, ?, ?, ?, ?, ?, ?)', [
        uid, name, title, description, flags, avatarId,
        sovereignFrid, peasantFrid,
      ],
    );
    if (result || result === 0) {
      return result;
    }
  } catch (error) {
    console.error('SQL Error on createFaction:', error.message);
  }
  return -1;
}

/**
 * delete a faction
 * @param initiatorUid user id of owner
 * @param factionName faction name
 * @return [number, factionChannelId, affectedUsers, affectedActiveRoleUsers]
 *   0 success
 *   1 faction doesn't exist
 *   2 user not in faction
 *   3 user not allowed
 *   -1 failure
 */
export async function deleteFaction(initiatorUid, factionName) {
  const affectedUsers = [];
  const affectedActiveRoleUsers = [];
  let factionChannelId = null;
  try {
    const models = await pool.query(
      'CALL DELETE_FACTION(?, ?)', [initiatorUid, factionName],
    );
    const [[{ result }]] = models;
    if (result || result === 0) {
      if (result === 0) {
        [[{ factionChannelId }]] = models;
        const affectedUserModels = models[1];
        for (let i = 0; i < affectedUserModels.length; i += 1) {
          const { uid: memberUid, hadFactionActive } = affectedUserModels[i];
          if (hadFactionActive) {
            affectedActiveRoleUsers.push(memberUid);
          }
          affectedUsers.push(memberUid);
        }
      }
      return [
        result, factionChannelId, affectedUsers, affectedActiveRoleUsers,
      ];
    }
  } catch (error) {
    console.error('SQL Error on deleteFaction:', error.message);
  }
  return [-1, factionChannelId, affectedUsers, affectedActiveRoleUsers];
}

/**
 * leave faction
 * @param uid user id
 * @param factionName name of faction
 * @return [number, hadRoleActive]
 *   0 success
 *   1 no such faction
 *   2 no other sovereign
 *   -1 failure
 */
export async function leaveFaction(uid, factionName) {
  try {
    const model = await pool.query(
      'CALL LEAVE_FACTION(?, ?)', [uid, factionName],
    );
    const [[{ result, hadRoleActive }]] = model;
    if (result || result === 0) {
      if (result === 0) {
        return [result, !!hadRoleActive];
      }
      return [result, false];
    }
  } catch (error) {
    console.error('SQL Error on leaveFaction:', error.message);
  }
  return [-1, false];
}

/**
 * join user to a faction
 * @param uid user id
 * @param factionName name of faction
 * @return number
 *   0 success
 *   1 no such faction
 *   2 max factions reached
 *   3 banned
 *   4 already joined
 *   5 faction full
 *   6 faction not public
 *   -1 failure
 */
export async function joinFactionPublic(uid, ipString, factionName) {
  try {
    const [[{ result }]] = await pool.query(
      'CALL JOIN_FACTION_PUBLIC(?, ?, ?)', [uid, ipString, factionName],
    );
    if (result || result === 0) {
      return result;
    }
  } catch (error) {
    console.error('SQL Error on joinFaction:', error.message);
  }
  return -1;
}

/**
 * get public info of faction
 * @param name name of faction
 * @return {
 *   sqlFid,
 *   name,
 *   title,
 *   description,
 *   memberCount,
 *   isPrivate,
 *   isPublic,
 *   avatarId,
 *   channelId,
 *   roles: [{
 *     frid,
 *     customFlagId,
 *     name,
 *     factionlvl,
 *     isProtected,
 *     isDefault,
 *   }, ...]
 * } | null
 */
export async function getFactionInfo(name) {
  try {
    let model = await pool.query(
      // eslint-disable-next-line max-len
      `SELECT f.id AS sqlFid, f.name, f.title, f.description, f.memberCount, f.flags, f.cid AS channelId,
CONCAT(a.shortId, ':', a.extension) AS avatarId,
BIN_TO_UUID(fr.uuid) AS 'roles.frid',
CONCAT(frm.shortId, ':', frm.extension) AS 'roles.customFlagId',
fr.name AS 'roles.name', fr.flags AS 'roles.flags',
fr.factionlvl AS 'roles.factionlvl' FROM Factions f
  LEFT JOIN Media a ON a.id = f.avatar
  LEFT JOIN FactionRoles fr ON fr.fid = f.id
  LEFT JOIN Media frm ON frm.id = fr.customFlag
WHERE f.name = CONVERT(? USING ascii)`,
      [name],
    );
    if (model.length) {
      model = nestQuery(model);
      // whether or not searchable
      model.isPrivate = (model.flags & (0x01 << FACTION_FLAGS.PRIV)) !== 0;
      // whether or not joinable without invite
      model.isPublic = (model.flags & (0x01 << FACTION_FLAGS.PUBLIC)) !== 0;
      delete model.flags;
      for (let i = 0; i < model.roles.length; i += 1) {
        const role = model.roles[i];
        // eslint-disable-next-line max-len
        role.isProtected = (role.flags & (0x01 << FACTION_ROLE_FLAGS.PROTECTED)) !== 0;
        // eslint-disable-next-line max-len
        role.isDefault = (role.flags & (0x01 << FACTION_ROLE_FLAGS.DEFAULT)) !== 0;
        delete role.flags;
      }
      return model;
    }
  } catch (error) {
    console.error('SQL Error on getFactionInfo:', error.message);
  }
  return null;
}

/**
 * get faction members
 * @param sqlFid sql id of faction
 * @return [{
 *   uid,
 *   name,
 *   username,
 *   avatarId,
 *   roles: [frid1, frid2,..]
 * }, ...]
 */
export async function getFactionMemberInfo(sqlFid, showHiddenUsers) {
  try {
    let model = await pool.query(
      `SELECT u.id AS uid, u.name, u.username,
CONCAT(a.shortId, ':', a.extension) AS avatarId,
(uf.flags & ?) != 0 AS isHidden,
BIN_TO_UUID(fr.uuid) AS 'roles.frid' FROM Users u
  INNER JOIN UserFactions uf ON uf.uid = u.id
  LEFT JOIN Profiles p ON p.uid = u.id
  LEFT JOIN Media a ON a.id = p.avatar
  LEFT JOIN UserFactionRoles ufr ON ufr.uid = u.id
  LEFT JOIN FactionRoles fr ON fr.id = ufr.frid AND fr.fid = uf.fid
WHERE uf.fid = ?`,
      [0x01 << USER_FACTION_FLAGS.HIDDEN, sqlFid],
    );
    if (model) {
      model = nestQuery(model, 'uid');
      if (!showHiddenUsers) {
        model = model.filter((m) => m.isHidden === 0);
      }
      for (let i = 0; i < model.length; i += 1) {
        const userInfo = model[i];
        userInfo.roles = userInfo.roles.map((r) => r.frid);
        delete userInfo.isHidden;
      }
      return model;
    }
  } catch (error) {
    console.error('SQL Error on getFactionMemberInfo:', error.message);
  }
  return null;
}

/**
 * get faction bans
 * @param sqlFid sql id of faction
 * @return [{
 *   fbid,
 *   affects: dstring describing user or iid if no user,
 *   reason,
 *   createdBy: username of mod,
 *   [expires],
 *   [createdAt],
 * },...] | null
 */
export async function getFactionBanInfo(sqlFid) {
  try {
    let model = await pool.query(
      `SELECT BIN_TO_UUID(fb.uuid) AS fbid, fb.reason, fb.expires, fb.createdAt,
u.id AS 'users.id', u.name AS 'users.name', u.username AS 'users.username',
mu.username AS createdBy,
BIN_TO_UUID(i.uuid) AS 'ips.iid' FROM FactionBans fb
  LEFT JOIN UserFactionBans ufb ON ufb.bid = fb.id
  LEFT JOIN Users u ON ufb.uid = u.id
  LEFT JOIN IPFactionBans ifb ON ifb.bid = fb.id
  LEFT JOIN IPs i ON ifb.ip = i.ip
  LEFT JOIN Users mu ON mu.id = fb.muid
WHERE fb.fid = ?`,
      [sqlFid],
    );
    if (model) {
      model = nestQuery(model, 'fbid');
      for (let i = 0; i < model.length; i += 1) {
        const banInfo = model[i];
        if (banInfo.users.length) {
          const user = banInfo.users[0];
          banInfo.affects = `${user.name} [${user.username}]`;
        } else if (banInfo.ips.length) {
          banInfo.affects = banInfo.ips[0].iid;
        } else {
          banInfo.affects = 'N/A';
        }
        delete banInfo.users;
        delete banInfo.ips;

        if (banInfo.expires) {
          banInfo.expires = banInfo.expires.toLocaleString();
        }
        if (banInfo.createdAt) {
          banInfo.createdAt = banInfo.createdAt.toLocaleString();
        }
      }
      return model;
    }
  } catch (error) {
    console.error('SQL Error on getFactionBanInfo:', error.message);
  }
  return null;
}

/**
 * get factions by search term
 * @param term search term
 * @return [{
 *   name,
 *   title,
 *   description,
 *   isPublic,
 *   memberCount,
 *   avatarId,
 * }, ...]
 */
export async function searchFaction(term) {
  try {
    const sqlTerm = `%${term}%`;
    const models = await pool.query(
      `SELECT f.name, f.title, f.description,
f.memberCount,
(f.flags & ?) != 0 AS isPublic,
CONCAT(a.shortId, ':', a.extension) AS avatarId FROM Factions f
  LEFT JOIN Media a ON a.id = f.avatar
WHERE (f.flags & ?) = 0 AND (
  f.name LIKE CONVERT(? USING ascii) OR f.title LIKE ? OR f.description LIKE ?
) LIMIT 50`, [
        0x01 << FACTION_FLAGS.PUBLIC, 0x01 << FACTION_FLAGS.PRIV,
        sqlTerm.toLowerCase(), sqlTerm, sqlTerm,
      ],
    );
    if (models.length) {
      for (let i = 0; i < models.length; i += 1) {
        const faction = models[i];
        faction.isPublic = faction.isPublic === 1;
      }
      return models;
    }
  } catch (error) {
    console.error('SQL Error on searchFaction:', error.message);
  }
  return [];
}

/**
 * change a property of a faction
 * @param sqlFid sql id of faction
 * @param property
 * @param value
 * @return success
 */
export async function setFactionProperty(sqlFid, property, value) {
  try {
    await pool.query(
      `UPDATE Factions SET ${property} = ? WHERE id = ?`, [value, sqlFid],
    );
    return true;
  } catch (error) {
    console.error(`SQL Error on setFactionProperty: ${error.message}`);
  }
  return false;
}

/* ============================== Faction Roles ================================
 * Factions have Roles with flags and stuff
 */

/**
 * get powerlevel and faction and role sql id of user in faction based on role
 * @param frid faction role uuid (NOT sql id)
 * @return { factionName | null, sqlFrid | null, factionlvl | null }
 */
export async function getFactionRole(frid) {
  let factionName = null;
  let sqlFrid = null;
  let factionlvl = 0;
  let isProtected = true;
  try {
    const [model] = await pool.query(
      // eslint-disable-next-line max-len
      `SELECT f.name AS factionName, fr.id AS sqlFrid, fr.flags, fr.factionlvl FROM FactionRoles fr
  INNER JOIN Factions f ON fr.fid = f.id
WHERE fr.uuid = UUID_TO_BIN(?)`,
      [frid],
    );
    if (model) {
      ({ factionName, sqlFrid, factionlvl } = model);
      // eslint-disable-next-line max-len
      isProtected = (model.flags & (0x01 << FACTION_ROLE_FLAGS.PROTECTED)) !== 0;
    }
  } catch (error) {
    console.error(`SQL Error on getFactionRole: ${error.message}`);
  }
  return { factionName, sqlFrid, factionlvl, isProtected };
}

/**
 * set custom flag for faction role
 * @param sqlFrid sql id of faction role
 * @param mediaId shortId:extension of media
 */
export async function setFactionRoleFlag(sqlFrid, mediaId = null) {
  let conn;
  try {
    conn = await pool.getConnection();

    if (!mediaId) {
      await conn.query(
        'UPDATE FactionRoles SET customFlag = NULL WHERE id = ?', [sqlFrid],
      );
      return true;
    }

    const [shortId, extension] = mediaId.split(':');
    if (!shortId || !extension) {
      return false;
    }
    await conn.query(
      // eslint-disable-next-line max-len
      'UPDATE FactionRoles SET customFlag = (SELECT id FROM Media WHERE shortId = ? AND extension = ?) WHERE id = ?',
      [shortId, extension, sqlFrid],
    );
    return true;
  } catch (err) {
    console.error('SQL Error on setFactionRoleFlag:', err.message);
    return false;
  } finally {
    if (conn) conn.release();
  }
}

/**
 * change a property of a faction role
 * @param sqlFrid sql id of faction role
 * @param property
 * @param value
 * @return success
 */
export async function setFactionRoleProperty(sqlFrid, property, value) {
  try {
    await pool.query(
      `UPDATE FactionRoles SET ${property} = ? WHERE id = ?`, [value, sqlFrid],
    );
    return true;
  } catch (error) {
    console.error(`SQL Error on setFactionRoleProperty: ${error.message}`);
  }
  return false;
}

/**
 * create a new faction role
 * @param factionName name of faction
 * @return [number, frid]
 *   0 success
 *   1 faction doesn't exist
 *   2 customFlagId invalid
 *   3 max role count reached
 *   -1 failure
 */
export async function createFactionRole(
  factionName, name, factionlvl, customFlagId, isDefault,
) {
  let flags = 0;
  if (isDefault) {
    flags |= 0x01 << FACTION_ROLE_FLAGS.DEFAULT;
  }

  try {
    const frid = bufferToUUID(generateUUID());

    const [[{ result }]] = await pool.query(
      'CALL CREATE_FACTION_ROLE(?, ?, ?, ?, ?, ?)', [
        factionName, frid, name, factionlvl, customFlagId, flags,
      ],
    );
    if (result || result === 0) {
      return [result, result === 0 ? frid : null];
    }
  } catch (error) {
    console.error('SQL Error on createFactionRole:', error.message);
  }
  return [-1, null];
}

/**
 * delete a faction role
 * @param uid user id
 * @param frid faction role uuid
 * @return [number, factionName, affectedUsers, affectedActiveRoleUsers]
 *   0 success
 *   1 faction or role doesn't exist
 *   2 role is sovereign
 *   3 role is protected
 *   4 user not member of this faction
 *   5 user powerlvl too low to create roles
 *   6 user powerlvl below role
 *   7 user powerlvl equal to role but not allowed
 *   -1 failure
 */
export async function deleteFactionRole(uid, frid) {
  const affectedUsers = [];
  const affectedActiveRoleUsers = [];
  let factionName = null;
  try {
    let models = await pool.query(
      'CALL DELETE_FACTION_ROLE(?, ?)', [uid, frid],
    );
    const [[{ result }]] = models;
    if (result || result === 0) {
      if (result === 0) {
        [[{ factionName }]] = models;
        models = Object.values(models[1]);
        for (let i = 0; i < models.length; i += 1) {
          const { uid: memberUid, hadRoleActive } = models[i];
          if (hadRoleActive) {
            affectedActiveRoleUsers.push(memberUid);
          }
          affectedUsers.push(memberUid);
        }
      }
      return [result, factionName, affectedUsers, affectedActiveRoleUsers];
    }
  } catch (error) {
    console.error('SQL Error on deleteFactionRole:', error.message);
  }
  return [-1, factionName, affectedUsers, affectedActiveRoleUsers];
}

/**
 * set one bit in flags of faction role
 * @param sqlFrid faction role sql id
 * @param index index of flag
 * @param value 0 or 1, true or false
 * @return success boolean
 */
export async function setFlagOfFactionRole(sqlFrid, index, value) {
  try {
    const mask = 0x01 << index;
    if (value) {
      await pool.query(
        'UPDATE FactionRoles SET flags = flags | ? WHERE id = ?',
        [mask, sqlFrid],
      );
    } else {
      await pool.query(
        'UPDATE FactionRoles SET flags = flags & ~(?) WHERE id = ?',
        [mask, sqlFrid],
      );
    }
    return true;
  } catch (error) {
    console.error(`SQL Error on setFlagOfFactionRole: ${error.message}`);
  }
  return false;
}

/**
 * add user to a faction role
 * @param sqlFrid sql id of faction role
 * @param uid user id
 * @return success
 */
export async function joinFactionRole(sqlFrid, uid) {
  let conn;
  try {
    conn = await pool.getConnection();

    const [{ affectedRows }] = await Promise.all([
      conn.query(
        `INSERT INTO UserFactionRoles (uid, frid)
    SELECT ?, ? WHERE EXISTS (
      SELECT 1 FROM UserFactions uf
        INNER JOIN Factions f ON uf.fid = f.id
        INNER JOIN FactionRoles fr ON fr.fid = f.id
      WHERE uf.uid = ? AND fr.id = ?
    )`,
        [uid, sqlFrid, uid, sqlFrid],
      ),
      conn.query(
        'UPDATE FactionRoles SET memberCount = memberCount + 1 WHERE id = ?',
        [sqlFrid],
      ),
    ]);
    return affectedRows > 0;
  } catch (error) {
    console.error(`SQL Error on joinFactionRole: ${error.message}`);
  } finally {
    if (conn) conn.release();
  }
  return false;
}

/**
 * remove user from a faction role
 * @param initiatorUid user id of initiator
 * @param subjectUid user id of user to join
 * @param frid faction role uuid
 * @return [number, hadRoleActive, fid]
 *   0 success
 *   1 faction doesn't exist
 *   2 initiator not in faction
 *   3 initiator not enough permissions
 *   4 subject not in faction or not in role
 *   5 subject has more power than initiator
 *   6 would orphan faction
 *   -1 failure
 */
export async function leaveFactionRole(initiatorUid, subjectUid, frid) {
  try {
    const [[{ result, hadRoleActive, factionName }]] = await pool.query(
      'CALL LEAVE_FACTION_ROLE(?, ?, ?)', [initiatorUid, subjectUid, frid],
    );
    if (result || result === 0) {
      if (result === 0) {
        return [result, hadRoleActive > 0, factionName];
      }
      return [result, false, null];
    }
  } catch (error) {
    console.error('SQL Error on leaveFactionRole:', error.message);
  }
  return [-1, false, null];
}

/* ================================== Invites ==================================
 * Faction Invites
 */

/**
 * create a new invite
 * @param initiatorUid user id of initiator
 * @param factionName name of faction
 * @param isOneTimeInvite boolean
 * @return [number, inviteId]
 *   0 success
 *   1 no such faction
 *   2 user not in faction
 *   3 user not allowed
 *   4 no more invites possible
 *   5 no free inviteId found
 *   -1 failure
 */
export async function createInvite(initiatorUid, factionName, isOneTimeInvite) {
  let flags = 0;
  if (isOneTimeInvite) {
    flags |= 0x01 << INVITE_FLAGS.ONE_TIME;
  }

  try {
    let midId;
    let result = 5;
    let retries = 5;
    while (result === 5 && retries > 0) {
      midId = getRandomShortId(10);
      retries -= 1;
      // eslint-disable-next-line no-await-in-loop
      [[{ result }]] = await pool.query(
        'CALL CREATE_FACTION_INVITE(?, ?, ?, ?, ?)',
        [initiatorUid, factionName, midId, flags, null],
      );
    }
    if (result || result === 0) {
      return [result, midId];
    }
  } catch (error) {
    console.error('SQL Error on createInvite:', error.message);
  }
  return [-1, null];
}

/**
 * delete a invite
 * @param initiatorUid user id of initiator
 * @param inviteId midId of invite
 * @return number
 *   0 success
 *   1 no such invite
 *   2 user not in faction
 *   3 user not allowed
 *   -1 failure
 */
export async function deleteInvite(initiatorUid, inviteId) {
  try {
    const [[{ result }]] = await pool.query(
      'CALL DELETE_FACTION_INVITE(?, ?)', [initiatorUid, inviteId],
    );
    if (result || result === 0) {
      return result;
    }
  } catch (error) {
    console.error('SQL Error on deleteInvite:', error.message);
  }
  return -1;
}

/**
 * use invite
 * @param uid user id of initiator
 * @param ipString ip of initiator
 * @param inviteId midId of invite
 * @return [number, factionName]
 *   0 success
 *   1 no such invite
 *   2 max factions reached
 *   3 banned
 *   4 already joined
 *   5 faction full
 *   6 faction not public
 *   -1 failure
 */
export async function consumeInvite(uid, ipString, inviteId) {
  try {
    const [[{ result, factionName }]] = await pool.query(
      'CALL JOIN_FACTION_WITH_INVITE(?, ?, ?)', [uid, ipString, inviteId],
    );
    if (result || result === 0) {
      return [result, factionName];
    }
  } catch (error) {
    console.error('SQL Error on consumeInvite:', error.message);
  }
  return [-1, null];
}

/**
 * get data of invite
 * @param inviteId invite id
 * @return {
 *   factionName,
 *   factionTitle,
 *   factionDescription,
 *   avatarId,
 *   memberCount,
 * } | null
 */
export async function getInviteData(inviteId) {
  try {
    const [model] = await pool.query(
      `SELECT f.name AS factionName, f.title AS factionTitle,
f.description AS factionDescription, f.memberCount,
CONCAT(a.shortId, ':', a.extension) AS avatarId FROM FactionInvites i
  INNER JOIN Factions f ON i.fid = f.id
  LEFT JOIN Media a ON a.id = f.avatar
WHERE i.midId = ? AND (i.expires IS NULL OR i.expires > NOW())`,
      [inviteId],
    );
    return model;
  } catch (error) {
    console.error('SQL Error on getInviteData:', error.message);
  }
  return null;
}

/**
 * get all invites of faction
 * @param sqlFid sql id of faction
 * @return [{
 *   id,
 *   isOneTime,
 *   createdAt,
 *   amountUsed,
 * }, ...]
 */
export async function getInviteInfo(sqlFid) {
  try {
    const models = await pool.query(
      // eslint-disable-next-line max-len
      `SELECT midId AS id, flags, used AS amountUsed, createdAt FROM FactionInvites
WHERE fid = ? AND (expires IS NULL OR expires > NOW())`,
      [sqlFid],
    );
    if (models) {
      for (let i = 0; i < models.length; i += 1) {
        const invite = models[i];
        // eslint-disable-next-line max-len
        invite.isOneTime = (invite.flags & (0x01 << INVITE_FLAGS.ONE_TIME)) !== 0;
        delete invite.flags;

        if (invite.createdAt) {
          invite.createdAt = invite.createdAt.toLocaleString();
        }
      }
      return models;
    }
  } catch (error) {
    console.error('SQL Error on getInvites:', error.message);
  }
  return [];
}

/* =============================== Bans =======================================
 * Bans from Factions
 */

/**
 * ban user
 * @param sqlFid id of faction
 * ...
 * @param duration duration in seconds
 * @return success
 */
export async function banUserFromFaction(
  sqlFid, uid, ipString, reason, duration, muid = null,
) {
  let conn;
  try {
    conn = await pool.getConnection();

    const fbid = bufferToUUID(generateUUID());

    await conn.query(
      // eslint-disable-next-line max-len
      'INSERT INTO FactionBans (uuid, fid, reason, expires, muid, createdAt) VALUES (UUID_TO_BIN(?), ?, ?, ?, ?, NOW())',
      [
        fbid, sqlFid, reason,
        (duration) ? new Date(Date.now() + duration * 1000) : null,
        muid,
      ],
    );
    const [model] = await conn.query(
      'SELECT id FROM FactionBans WHERE uuid = UUID_TO_BIN(?)', [fbid],
    );
    if (!model) {
      return false;
    }
    const bid = model.id;

    await Promise.all([
      conn.query(
        'INSERT INTO UserFactionBans (bid, uid) VALUES (?, ?)', [bid, uid],
      ),
      ipString && conn.query(
        'INSERT INTO IPFactionBans (bid, ip) VALUES (?, IP_TO_BIN(?))',
        [bid, ipString],
      ),
    ]);
    return true;
  } catch (error) {
    console.error('SQL Error on banUserFromFaction:', error.message);
  } finally {
    if (conn) conn.release();
  }
  return false;
}

/**
 * unban user
 * @param factionName name of faction
 * @param fbid uuid of faction ban
 * @return success
 */
export async function unbanFromFaction(factionName, fbid) {
  try {
    await pool.query(

      `DELETE FROM FactionBans WHERE uuid = UUID_TO_BIN(?) AND EXISTS(
  SELECT id FROM Factions f WHERE f.id = FactionBans.fid AND f.name = ?
)`,

      [fbid, factionName],
    );
    return true;
  } catch (error) {
    console.error('SQL Error on unbanFromFaction:', error.message);
  }
  return false;
}
