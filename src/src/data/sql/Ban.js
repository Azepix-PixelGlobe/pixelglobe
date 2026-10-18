import pool from './mariadb.js';

import { nestQuery } from './utils.js';
import { generateUUID, bufferToUUID } from '../../utils/hash.js';
import { sanitizeIPString } from '../../utils/intel/ip.js';


/**
 * Given a list of bans, determine if we are banned or muted or both,
 * and what is the best time to re-check
 * @param bans [ { expires, flags,... },... ]
 * isBanned and isMuted are false or true if perma banned and timestamp
 * otherwise
 * @return [ isBanned, isMuted, banRecheckTs ]
 */
export function parseListOfBans(bans) {
  let isBanned = false;
  let isMuted = false;
  let banRecheckTs = null;

  if (bans.length) {
    let i = bans.length;
    while (i > 0) {
      i -= 1;
      const { expires, flags } = bans[i];
      if (flags & 0x01) {
        if (isBanned !== true) {
          if (expires === null) {
            isBanned = true;
          } else {
            const expiresTs = expires.getTime();
            if (isBanned === false || expiresTs > isBanned) {
              isBanned = expiresTs;
            }
          }
        }
      }
      if (flags & 0x02) {
        if (isMuted !== true) {
          if (expires === null) {
            isMuted = true;
          } else {
            const expiresTs = expires.getTime();
            if (isMuted === false || expiresTs > isMuted) {
              isMuted = expiresTs;
            }
          }
        }
      }
    }

    /* in case we have expired bans lingering */
    const currentTs = Date.now();
    if (isMuted && isMuted !== true && isMuted < currentTs) {
      isMuted = false;
    }
    if (isBanned && isBanned !== true && isBanned < currentTs) {
      isBanned = false;
    }

    const isBannedIsInteger = Number.isInteger(isBanned);
    const isMutedIsInteger = Number.isInteger(isMuted);
    if (isBannedIsInteger || isMutedIsInteger) {
      if (isBannedIsInteger && isMutedIsInteger) {
        banRecheckTs = Math.min(isBanned, isMuted);
      } else if (isBannedIsInteger) {
        banRecheckTs = isBanned;
      } else {
        banRecheckTs = isMuted;
      }
    }
  }
  return [isBanned, isMuted, banRecheckTs];
}

/**
 * Lift multiple Bans
 * @param bans Array of Ban model instances
 * @param [modUid] user id of mod that lifted the bans
 */
async function removeBans(bans, modUid) {
  if (!Array.isArray(bans)) bans = [bans];
  const banIds = bans.map((b) => b.id);
  if (!banIds.length) {
    return;
  }

  for (const bid of banIds) {
    // eslint-disable-next-line no-await-in-loop
    await pool.query('CALL REMOVE_BAN(?, ?)', [bid, modUid]);
  }
}

/**
 * unban
 * @param buuid uuid of ban
 * @param [modUid] user id of mod that lifted the bans
 * @return boolean success
 */
export async function unbanByUuid(uuid, modUid) {
  try {
    const models = await pool.query(
      'SELECT id FROM Bans WHERE uuid = UUID_TO_BIN(?)', [uuid],
    );
    if (!models.length) {
      return false;
    }
    await removeBans(models, modUid);
    return true;
  } catch (error) {
    console.error(`SQL Error on unban: ${error.message}`);
  }
  return false;
}

/**
 * get all bans for ips or user ids
 * @param ipStrings Array of multiple or single ipStrings
 * @param userIds Array of multiple or single user ids
 * @param ipUuids Array of multiple or single ip uuids (IID)
 * @param banUuids Array of multiple or single ban uuids (UID)
 * @param mute boolean if muting
 * @param bans boolean if banning
 * @return [{
 *   id, uuid, buuid, reason, flags, expires, createdAt, muid, mname
 *   users: [{ id }, ...]
 *   ips: [{ ipString }, ...]
 * }, ...]
 */
export async function getBanInfos(
  // eslint-disable-next-line no-shadow
  ipStrings, userIds, ipUuids, banUuids, mute = true, ban = true,
) {
  if (!ban && !mute) {
    return [];
  }

  let conn;
  try {
    conn = await pool.getConnection();
    const unions = [];
    let replacements = [];

    /* eslint-disable max-len */
    if (userIds) {
      if (Array.isArray(userIds)) {
        if (userIds.length) {
          const placeholder = userIds.map(() => '?').join(', ');
          unions.push(
            `SELECT ub.bid AS id FROM UserBans ub WHERE ub.uid IN (${
              placeholder
            })`,
          );
          unions.push(
            `SELECT tb.bid AS id FROM ThreePIDBans tb INNER JOIN ThreePIDs t ON tb.tid = t.id WHERE t.uid IN (${
              placeholder
            })`,
          );
          replacements = replacements.concat(userIds, userIds);
        }
      } else {
        unions.push(
          'SELECT ub.bid AS id FROM UserBans ub WHERE ub.uid = ?',
        );
        unions.push(
          'SELECT tb.bid AS id FROM ThreePIDBans tb INNER JOIN ThreePIDs t ON tb.tid = t.id WHERE t.uid = ?',
        );
        replacements.push(userIds, userIds);
      }
    }

    if (ipUuids) {
      if (Array.isArray(ipUuids)) {
        if (ipUuids.length) {
          unions.push(
            `SELECT ib2.bid AS id FROM IPBans ib2 INNER JOIN IPs i ON ib2.ip = i.ip WHERE i.uuid IN (SELECT n.uuid FROM (${
              ipUuids.map(() => 'SELECT UUID_TO_BIN(?) AS \'uuid\'').join(' UNION ALL ')
            }) AS n)`,
          );
          replacements = replacements.concat(ipUuids);
        }
      } else {
        unions.push(
          'SELECT ib2.bid AS id FROM IPBans ib2 INNER JOIN IPs i ON ib2.ip = i.ip WHERE i.uuid = UUID_TO_BIN(?)',
        );
        replacements.push(ipUuids);
      }
    }

    if (ipStrings) {
      if (Array.isArray(ipStrings)) {
        if (ipStrings.length) {
          unions.push(
            `SELECT ib.bid AS id FROM IPBans ib WHERE ib.ip IN (SELECT m.ip FROM (${
              ipStrings.map(() => 'SELECT IP_TO_BIN(?) AS \'ip\'').join(' UNION ALL ')
            }) AS m)`,
          );
          replacements = replacements.concat(ipStrings);
        }
      } else {
        unions.push(
          'SELECT ib.bid AS id FROM IPBans ib WHERE ib.ip = IP_TO_BIN(?)',
        );
        replacements.push(ipStrings);
      }
    }

    if (banUuids) {
      if (Array.isArray(banUuids)) {
        if (banUuids.length) {
          unions.push(
            `SELECT bb.id FROM Bans bb WHERE bb.uuid IN (SELECT l.uuid FROM (${
              banUuids.map(() => 'SELECT UUID_TO_BIN(?) AS \'uuid\'').join(' UNION ALL ')
            }) AS l)`,
          );
          replacements = replacements.concat(banUuids);
        }
      } else {
        unions.push(
          'SELECT bb.id FROM Bans bb WHERE bb.uuid = UUID_TO_BIN(?)',
        );
        replacements.push(banUuids);
      }
    }

    if (!unions.length) {
      return [];
    }

    let query;
    if (unions.length > 1) {
      query = `SELECT DISTINCT b.id FROM (\n  ${unions.join('\n  UNION ALL\n  ')}\n) AS b`;
    } else {
      [query] = unions;
    }

    let affectedBanIds = await conn.query(query, replacements);
    affectedBanIds = affectedBanIds.map((b) => b.id);

    if (!affectedBanIds.length) {
      return [];
    }

    let flagMask = 0;
    if (ban) {
      flagMask |= 0x01;
    }
    if (mute) {
      flagMask |= 0x02;
    }

    const promises = [];
    const bidFilterMask = (affectedBanIds.length === 1) ? '= ?' : 'IN (?)';
    replacements = [(affectedBanIds.length === 1)
      ? affectedBanIds[0] : affectedBanIds];
    promises.push(conn.query(
      `SELECT b.*, md.name as mname, BIN_TO_UUID(b.uuid) AS buuid, BIN_TO_IP(ib.ip) AS 'ips.ipString' FROM Bans b
  LEFT JOIN Users md ON md.id = b.muid
  LEFT JOIN IPBans ib ON ib.bid = b.id
WHERE (b.flags & ?) != 0 AND (b.expires > NOW() OR b.expires IS NULL) AND b.id ${bidFilterMask}`,
      [flagMask].concat(replacements),
    ));

    promises.push(conn.query(
      `SELECT DISTINCT u.id, u.uid AS 'users.id' FROM (
  SELECT ub.bid AS id, ub.uid FROM UserBans ub WHERE ub.bid ${bidFilterMask}
  UNION ALL
  SELECT tb.bid AS id, t.uid FROM ThreePIDBans tb INNER JOIN ThreePIDs t ON tb.tid = t.id WHERE t.uid IS NOT NULL AND tb.bid ${bidFilterMask}
) AS u;`,
      replacements.concat(replacements),
    ));

    /*
     * bans is populated with ips already
     * bannedUserIds is [{ id, users: [ { id }, ... ] , ...}]
     */
    let [bans, bannedUserIds] = await Promise.all(promises);

    bans = nestQuery(bans, 'id');

    bannedUserIds = nestQuery(bannedUserIds, 'id');
    bans.forEach((b) => {
      const usersOfBan = bannedUserIds.find((u) => b.id === u.id);
      b.users = (usersOfBan) ? usersOfBan.users : [];
    });

    return bans;
  } catch (error) {
    console.error(`SQL Error on getBanInfos: ${error.message}`);
  } finally {
    if (conn) conn.release();
  }
  return [];
}

/**
 * prolong existing ban of ipString / userId combo if exists
 * @param ipString
 * @param userId
 * @param duration duration in seconds to add to existing ban
 * @param reason reason to match
 * @return boolean if prolonged
 */
export async function prolongExistingBan(ipString, userId, duration, reason) {
  const bans = await getBanInfos(ipString, userId, null, null);
  if (!bans.length) {
    return false;
  }
  let banData;
  if (reason) {
    banData = bans.find((b) => b.reason === reason);
  } else {
    /* prefer ban over mute */
    banData = bans.find((b) => b.flags & 0x01);
    if (!banData) {
      [banData] = bans;
    }
  }
  if (!banData) {
    return false;
  }
  if (!banData.expires) {
    return true;
  }
  let newDuration = null;
  if (duration) {
    newDuration = new Date(banData.expires.getTime() + duration * 1000);
  }

  let conn;
  try {
    conn = await pool.getConnection();
    await conn.query(
      'UPDATE Bans SET expires = ? WHERE id = ?', [newDuration, banData.id],
    );

    if (!banData.ips.some(({ ipString: i }) => i === ipString)) {
      console.log(`BAN add ip ${ipString} to ban that doesn't have it yet`);
      await conn.query(
        'INSERT INTO IPBans (bid, ip) VALUES (?, IP_TO_BIN(?))',
        [banData.id, ipString],
      );
    }

    if (userId && !banData.users.some(({ id: u }) => u === userId)) {
      console.log(`BAN add user ${userId} to ban that doesn't have it yet`);
      await conn.query(
        'INSERT INTO UserBans (bid, uid) VALUES (?, ?)',
        [banData.id, userId],
      );
    }
    return true;
  } catch (error) {
    console.error(`SQL Error on prolongExistingBan: ${error.message}`);
  } finally {
    if (conn) conn.release();
  }
  return false;
}

/**
 * ban
 * @param ipStrings Array of multiple or single ipStrings
 * @param userIds Array of multiple or single user ids
 * @param ipUuids Array of multiple or single ip uuids (IID)
 * @param mute boolean if muting
 * @param ban boolean if banning
 * @param reason reasoning as string
 * @param duration duration in seconds
 * @param muid id of the mod that bans
 * @return [ipStrings, userIds] that got banned
 */
export async function ban(
  // eslint-disable-next-line no-shadow
  ipStrings, userIds, ipUuids, mute, ban, reason, duration, muid = null,
) {
  let flags = 0;
  if (ban) {
    flags |= 0x01;
  }
  if (mute) {
    flags |= 0x02;
  }

  if (Array.isArray(ipStrings)) {
    if (!ipStrings.length) {
      ipStrings = null;
    }
  } else if (ipStrings) {
    ipStrings = [ipStrings];
  }
  if (Array.isArray(userIds)) {
    if (!userIds.length) {
      userIds = null;
    }
  } else if (userIds) {
    userIds = [userIds];
  }
  if (Array.isArray(ipUuids)) {
    if (!ipUuids.length) {
      ipUuids = null;
    }
  } else if (ipUuids) {
    ipUuids = [ipUuids];
  }
  if (!ipStrings && !userIds && !ipUuids) {
    return [[], []];
  }

  const bid = bufferToUUID(generateUUID());

  try {
    const [[{ result }], outIpStrings, outUids] = await pool.query(
      'CALL BAN(?, ?, ?, ?, ?, ?, ?, ?)',
      [
        bid,
        JSON.stringify(ipStrings),
        JSON.stringify(userIds),
        JSON.stringify(ipUuids),
        flags,
        reason,
        (duration) ? new Date(Date.now() + duration * 1000) : null,
        muid,
      ],
    );
    if (result === 0) {
      return [
        outIpStrings.map(({ ip }) => ip),
        outUids.map(({ uid }) => uid),
      ];
    }
  } catch (error) {
    console.error(`SQL Error on ban: ${error.message}`);
  }
  return [[], []];
}

/**
 * unban by user and/or ip
 * @param ipStrings Array of multiple or single ipStrings
 * @param userIds Array of multiple or single user ids
 * @param ipUuids Array of multiple or single ip uuids (IID)
 * @param banUuids Array of multiple or single ban uuids (UID)
 * @param mute boolean if unmuting
 * @param ban boolean if unbanning
 * @param muid id of the mod that bans
 * @return [ ipStrings, userIds ] affected users / ips
 */
export async function unban(
  // eslint-disable-next-line no-shadow
  ipStrings, userIds, ipUuids, banUuids, mute, ban, muid = null,
) {
  const unbannedUserIds = [];
  const unbannedIpStrings = [];

  try {
    const bans = await getBanInfos(
      ipStrings, userIds, ipUuids, banUuids, mute, ban,
    );
    if (!bans.length) {
      return [unbannedIpStrings, unbannedUserIds];
    }
    await removeBans(bans, muid);
    bans.forEach((b) => {
      b.users.forEach(({ id: uid }) => {
        if (!unbannedUserIds.includes(uid)) {
          unbannedUserIds.push(uid);
        }
      });
      b.ips.forEach(({ ipString }) => {
        const sanitizedIPString = sanitizeIPString(ipString);
        if (!unbannedIpStrings.includes(sanitizedIPString)) {
          unbannedIpStrings.push(sanitizedIPString);
        }
      });
    });
    return [unbannedIpStrings, unbannedUserIds];
  } catch (error) {
    console.error(`SQL Error on unban: ${error.message}`);
  }
  return [unbannedIpStrings, unbannedUserIds];
}

/* ================================== range ban ===============================
 */

/**
 * Lift multiple IP Range Bans
 * @param bans Array of Ban model instances
 * @param [modUid] user id of mod that lifted the bans
 */
export async function removeRangeBans(bans, modUid) {
  if (!Array.isArray(bans)) bans = [bans];
  const banIds = bans.map((b) => b.id);
  if (!banIds.length) {
    return;
  }

  for (const bid of bans) {
    // eslint-disable-next-line no-await-in-loop
    await pool.query('CALL REMOVE_RANGE_BAN(?, ?)', [bid, modUid]);
  }
}
