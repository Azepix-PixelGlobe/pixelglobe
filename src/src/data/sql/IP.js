import pool from './mariadb.js';
import { nestQuery } from './utils.js';

import { USE_PROXYCHECK } from '../../core/config.js';
import { generateUUID } from '../../utils/hash.js';
import { sanitizeIPString, ipToHex } from '../../utils/intel/ip.js';

/**
 * Get basic values to check if an ip is allowed, may throw Error
 * @param ipString ip as string
 * @return {
 *   lastSeen,
 *   isWhitelisted,
 *   isProxy,
 *   bans: [ { expires, flags } ],
 *   country: two letter country code,
 *   whoisExpiresTs: timestamp for when whois expires,
 *   proxyCheckExpiresTs: timestamp for when proxycheck expires,
 * }
 */
export async function getIPAllowance(ipString) {
  let ipAllowance;
  try {
    ipAllowance = await pool.query(
      `SELECT COALESCE(i.lastSeen, CAST('1970-01-01' AS DATETIME)) as lastSeen,
p.isProxy > 0 AS isProxy, w.ip IS NOT NULL AS isWhitelisted,
COALESCE(r.country, 'xx') AS country,
COALESCE(UNIX_TIMESTAMP(r.expires) * 1000, 0) AS whoisExpiresTs,
COALESCE(UNIX_TIMESTAMP(p.expires) * 1000, 0) AS proxyCheckExpiresTs,
b.expires AS 'bans.expires', b.flags AS 'bans.flags' FROM IPs i
  LEFT JOIN ProxyWhitelists w ON w.ip = i.ip
  LEFT JOIN Proxies p ON p.ip = i.ip AND p.expires > NOW()
  LEFT JOIN Ranges r ON r.id = i.rid AND r.expires > NOW()
  LEFT JOIN IPBans ib ON ib.ip = i.ip
  LEFT JOIN Bans b ON b.id = ib.bid AND (b.expires > NOW() OR b.expires IS NULL)
WHERE i.ip = IP_TO_BIN(?)`,
      [ipString],
    );
    ipAllowance = nestQuery(ipAllowance);

    if (ipAllowance) {
      ipAllowance.isProxy = ipAllowance.isProxy === 1;
      ipAllowance.isWhitelisted = ipAllowance.isWhitelisted === 1;
    }
  } catch (error) {
    console.error(`SQL Error on getIPAllowance: ${error.message}`);
  }

  if (!ipAllowance) {
    const expiredTs = Date.now() - 10 * 3600 * 1000;

    ipAllowance = {
      isWhitelisted: false,
      bans: [],
      country: 'xx',
      isProxy: false,
      lastSeen: new Date(),
      whoisExpiresTs: expiredTs,
      proxyCheckExpiresTs: expiredTs,
      captchaExpiresTs: expiredTs,
      challengeExpiresTs: expiredTs,
    };
  }

  if (!USE_PROXYCHECK) {
    ipAllowance.proxyCheckExpiresTs = Infinity;
  }

  return ipAllowance;
}

/**
 * Save ip information. If woisData or pcData aren't available, don't save
 * the specific one. Data objects need to have an expiration date.
 * If whoisData has an rid, don't write new whois data, but use that rid
 * @param ipString ip as string
 * @param whoisData null | {
 *   [rid]: id of range,
 *   expiresTs: timestamp when data expires,
 *   range as [start: hex, end: hex, mask: number],
 *   org as string,
 *   descr as string,
 *   asn as unsigned 32bit integer,
 *   country as two letter lowercase code,
 *   referralHost as string,
 *   referralRange as [start: hex, end: hex, mask: number],
 * }
 * @param pcData null | {
 *   expiresTs: timestamp when data expires,
 *   isProxy: type of proxy and 0 if none,
 *   type: Residential, Wireless, VPN, SOCKS,...,
 *   operator: name of proxy operator if available,
 *   city: name of city,
 *   repetition: number of how many times we encountered the same result,
 *   devices: amount of devices using this ip,
 *   risk: score of risk,
 *   confidence: percentage of confidence,
 *   subnetDevices: amount of devices in this subnet,
 * }
 * @return success boolean
 */
export async function saveIPIntel(ipString, whoisData, pcData) {
  let conn;
  try {
    conn = await pool.getConnection();
    await conn.beginTransaction();

    if (whoisData) {
      let rid = null;
      const promises = [];

      if (whoisData.rid) {
        rid = whoisData.rid;
      } else {
        const {
          range, country = 'xx', asn = null,
          referralHost, referralRange,
          expiresTs: whoisExpiresTs,
        } = whoisData;
        let { org = null, descr = null } = whoisData;

        if (org) {
          org = org.slice(0, 60);
        }
        if (descr) {
          descr = descr.slice(0, 60);
        }

        if (referralRange && referralHost) {
          promises.push(conn.query(
            /* eslint-disable max-len */
            `INSERT INTO WhoisReferrals (min, max, mask, host, expires) VALUES (UNHEX(?), UNHEX(?), ?, ?, ?)
ON DUPLICATE KEY UPDATE min = VALUES(min), max = VALUES(max), mask = VALUES(mask), host = VALUES(host), expires = VALUES(expires)`, [
              referralRange[0], referralRange[1], referralRange[2], referralHost, new Date(whoisExpiresTs),
            ],
          ));
        }

        /*
          * if we would be always on MariaDB, we could use append RETURNING id and
          * get the id during the insert
          */
        promises.push(conn.query(
          `INSERT INTO Ranges (min, max, mask, country, org, descr, asn, expires) VALUES (UNHEX(?), UNHEX(?), ?, ?, ?, ?, ?, ?)
ON DUPLICATE KEY UPDATE min = VALUES(min), max = VALUES(max), mask = VALUES(mask), country = VALUES(country), org = VALUES(org), descr = VALUES(descr), asn = VALUES(asn), expires = VALUES(expires)`, [
            range[0], range[1], range[2], country, org, descr, asn, new Date(whoisExpiresTs),
          ],
        ));

        try {
          await Promise.all(promises);
        } catch (error) {
          /*
            * ignore unique violations, that can happen when a row with min and
            * a different row with max matches
            */
          if (error.code !== 'ER_DUP_ENTRY') {
            throw error;
          }
        }

        const whoisResult = await conn.query(
          'SELECT id FROM Ranges WHERE min = UNHEX(?) AND max = UNHEX(?)',
          [range[0], range[1]],
        );

        if (whoisResult[0]) {
          rid = whoisResult[0].id;
        }
      }

      if (rid) {
        await conn.query(
          'INSERT INTO IPs (ip, uuid, rid, lastSeen) VALUES (IP_TO_BIN(?), ?, ?, NOW()) ON DUPLICATE KEY UPDATE rid = VALUES(rid), lastSeen = VALUES(lastSeen)',
          [ipString, generateUUID(), rid],
        );
      }
    } else {
      await conn.query(
        'INSERT INTO IPs (ip, uuid, lastSeen) VALUES (IP_TO_BIN(?), ?, NOW()) ON DUPLICATE KEY UPDATE lastSeen = VALUES(lastSeen)',
        [ipString, generateUUID()],
      );
    }

    if (pcData) {
      const {
        isProxy, type = null,
        devices = 1, subnetDevices = 1,
        repetition = 0,
        risk = null, confidence = null,
      } = pcData;
      let { operator = null, city = null } = pcData;
      if (operator?.length > 60) {
        operator = operator.substring(0, 60);
      }
      if (city?.length > 60) {
        city = city.substring(0, 60);
      }
      await conn.query(
        `INSERT INTO Proxies (ip, isProxy, type, operator, city, devices, subnetDevices, risk, confidence, repetition, expires) VALUES (IP_TO_BIN(?), ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
ON DUPLICATE KEY UPDATE isProxy = VALUES(isProxy), type = VALUES(type), operator = VALUES(operator), city = VALUES(city), devices = VALUES(devices), subnetDevices = VALUES(subnetDevices), confidence = VALUES(confidence), risk = VALUES(risk), repetition = VALUES(repetition), ip = VALUES(ip), expires = VALUES(expires)`, [
          ipString,
          isProxy, type, operator, city, devices, subnetDevices,
          risk, confidence, repetition,
          new Date(pcData.expiresTs),
        ],
      );
    }
    /* eslint-enable max-len */

    await conn.commit();
    return true;
  } catch (error) {
    // eslint-disable-next-line max-len
    console.error(`SQL Error on saveIPIntel for ${ipString}, ${JSON.stringify(whoisData)}, ${JSON.stringify(pcData)}: ${error.message}`);
    error.errors?.forEach((s) => console.error(s.message));
  } finally {
    if (conn) conn.release();
  }
  return false;
}

/**
 * get basic informations of ip
 * @param ipStrings Array of multiple or single ipStrings
 * @param ipUuids Array of multiple or single ip uuids (IID)
 * @return [{
 *   iid,
 *   country,
 *   cidr,
 *   org,
 *   descr,
 *   asn,
 *   type,
 *   isProxy,
 *   isWhitelisted,
 * }, ...]
 */
export async function getIPInfos(ipStrings, ipUuids) {
  const ipInfos = new Map();
  try {
    const where = [];
    let replacements = [];
    let requestAmount = 0;

    if (ipStrings) {
      if (Array.isArray(ipStrings)) {
        if (ipStrings.length) {
          /* eslint-disable max-len */
          where.push(`ip.ip IN (SELECT m.ip FROM (${
            ipStrings.map(() => 'SELECT IP_TO_BIN(?) AS \'ip\'').join(' UNION ALL ')
          }) AS m)`);
          replacements = replacements.concat(ipStrings);
          requestAmount += ipStrings.length;
        }
      } else {
        where.push('ip.ip = IP_TO_BIN(?)');
        replacements.push(ipStrings);
        requestAmount += 1;
      }
    }

    if (ipUuids) {
      if (Array.isArray(ipUuids)) {
        if (ipUuids.length) {
          where.push(`ip.uuid IN (SELECT l.ip FROM (${
            ipUuids.map(() => 'SELECT UUID_TO_BIN(?) AS \'ip\'').join(' UNION ALL ')
          }) AS l)`);
          replacements = replacements.concat(ipUuids);
          requestAmount += ipUuids.length;
        }
      } else {
        where.push('ip.uuid = UUID_TO_BIN(?)');
        replacements.push(ipUuids);
        requestAmount += 1;
      }
    }

    if (requestAmount === 0 || requestAmount > 300) {
      return ipInfos;
    }

    const startTime = Date.now();
    const ipInfoModels = await pool.query(
      `SELECT BIN_TO_UUID(ip.uuid) AS 'iid', BIN_TO_IP(ip.ip) AS 'ipString',
COALESCE(r.country, 'xx') AS 'country', r.org, r.descr, r.asn, CONCAT(BIN_TO_IP(r.min), '/', r.mask) AS 'cidr',
p.type, COALESCE(p.isProxy, 0) AS isProxy, w.ip IS NOT NULL AS isWhitelisted
FROM IPs ip
  LEFT JOIN Ranges r ON r.id = ip.rid
  LEFT JOIN Proxies p ON p.ip = ip.ip
  LEFT JOIN ProxyWhitelists w ON w.ip = ip.ip
WHERE ${(where.length === 1) ? where[0] : `(${where.join(' OR ')})`}`,
      /* eslint-enable max-len */
      replacements,
    );
    /* sanitize ips */
    for (let i = 0; i < ipInfoModels.length; i += 1) {
      const ipInfo = ipInfoModels[i];
      const ipString = sanitizeIPString(ipInfo.ipString);
      delete ipInfo.ipString;
      ipInfos.set(ipString, ipInfo);
    }
    console.log(
      `SQL Resolving IPInfos took ${(Date.now() - startTime) / 1000}s`,
    );

    return ipInfos;
  } catch (error) {
    console.error(`SQL Error on getInfoToIp: ${error.message}`);
  }
  return ipInfos;
}

/**
 * get provider info to ip, if we have it stored
 * @param ipString
 * @return { asn, org } | null
 */
export async function getProviderOfIP(ipString) {
  try {
    const [result] = await pool.query(
      // eslint-disable-next-line max-len
      'SELECT r.asn, r.org FROM IPs ip INNER JOIN Ranges r ON r.id = ip.rid WHERE ip.ip = IP_TO_BIN(?)',
      [ipString],
    );
    return result;
  } catch (error) {
    console.error(`SQL Error on getASN: ${error.message}`);
  }
  return null;
}

/**
 * update lastSeen timestamps of IP
 * @param ipString ip as string
 * @return sucess boolean
 */
export async function touchIP(ipString) {
  try {
    await pool.query(
      'UPDATE IPs SET lastSeen = NOW() WHERE ip = IP_TO_BIN(?)', [ipString],
    );
    return true;
  } catch (error) {
    console.error(`SQL Error on touchIP: ${error.message}`);
  }
  return false;
}

/**
 * get IP of IID (which is just the uuid in this table)
 * @param uuid IID as String
 * @return null | uuid as String
 */
export async function getIPofIID(uuid) {
  if (!uuid) {
    return null;
  }
  try {
    const [result] = await pool.query(
      // eslint-disable-next-line max-len
      'SELECT BIN_TO_IP(i.ip) AS \'ip\' FROM IPs i WHERE i.uuid = UUID_TO_BIN(?)',
      [uuid],
    );
    if (result) {
      return sanitizeIPString(result.ip);
    }
  } catch (error) {
    console.error(`SQL Error on getIPofIID: ${error.message}`);
  }
  return null;
}

/**
 * find other users and ips connected to one
 * @param uid userId
 * @param ipString ipString
 * @param [daysLookBack] how many days to look back
 * @return [ ipStrings, userIds ]
 */
export async function findAlts(userId, ipString, daysLookBack) {
  const userIds = new Set();
  const iids = new Set();
  let conn;
  try {
    conn = await pool.getConnection();

    if (userId) {
      let userIps;
      if (daysLookBack) {
        userIps = await conn.query(

          `SELECT BIN_TO_UUID(i.uuid) AS iid, l.uid FROM UserIPs l
  INNER JOIN IPs i ON l.ip = i.ip
  INNER JOIN UserIPs m ON m.ip = l.ip
WHERE m.uid = ?
  AND l.lastSeen > NOW() - INTERVAL ? DAY
  AND m.lastSeen > NOW() - INTERVAL ? DAY`,
          [userId, daysLookBack, daysLookBack],
        );
      } else {
        userIps = await conn.query(

          `SELECT BIN_TO_UUID(i.uuid) AS iid, l.uid FROM UserIPs l
  INNER JOIN IPs i ON l.ip = i.ip
  INNER JOIN UserIPs m ON m.ip = l.ip
WHERE m.uid = ?`,
          [userId],
        );
      }
      userIps.forEach(({ iid, uid }) => {
        iids.add(iid);
        userIds.add(uid);
      });
    }
    if (ipString) {
      let userIps;
      if (daysLookBack) {
        userIps = await conn.query(

          `SELECT BIN_TO_UUID(i.uuid) AS iid, l.uid FROM UserIPs l
  INNER JOIN IPs i ON l.ip = i.ip
  INNER JOIN UserIPs m ON m.uid = l.uid
WHERE m.ip = IP_TO_BIN(?)
  AND l.lastSeen > NOW() - INTERVAL ? DAY
  AND m.lastSeen > NOW() - INTERVAL ? DAY`,
          [ipString, daysLookBack, daysLookBack],
        );
      } else {
        userIps = await conn.query(

          `SELECT BIN_TO_UUID(i.uuid) AS iid, l.uid FROM UserIPs l
  INNER JOIN IPs i ON l.ip = i.ip
  INNER JOIN UserIPs m ON m.uid = l.uid
WHERE m.ip = IP_TO_BIN(?)`,
          [ipString],
        );
      }
      userIps.forEach(({ iid, uid }) => {
        iids.add(iid);
        userIds.add(uid);
      });
    }
  } catch (error) {
    console.error(`SQL Error on findAlts: ${error.message}`);
  } finally {
    if (conn) conn.release();
  }
  return [[...iids], [...userIds]];
}

/**
 * get IID of IP (which is just the uuid in this table)
 * @param ipString ip as String
 * @return null | uuid as String
 */
export async function getIIDofIP(ipString) {
  try {
    const [result] = await pool.query(
      // eslint-disable-next-line max-len
      'SELECT BIN_TO_UUID(i.uuid) AS \'iid\' FROM IPs i WHERE i.ip = IP_TO_BIN(?)',
      [ipString],
    );
    if (result) {
      return result.iid;
    }
  } catch (error) {
    console.error(`SQL Error on getIIDofIP: ${error.message}`);
  }
  return null;
}

/**
 * get IPs of IIDs (which is just the uuid in this table)
 * @param uuid Array of IID strings
 * @return Map<{ uuid: ipString }>
 */
export async function getIPsOfIIDs(uuids) {
  const idToIPMap = new Map();

  let where = '';
  let replacements;
  if (uuids) {
    if (Array.isArray(uuids)) {
      if (uuids.length && uuids.length <= 300) {
        const placeholder = uuids
          .map(() => 'SELECT UUID_TO_BIN(?) AS \'uuid\'').join(' UNION ALL ');
        where += `i.uuid IN (SELECT l.uuid FROM (${placeholder}) AS l)`;
        replacements = uuids;
      }
    } else {
      where += 'i.uuid = UUID_TO_BIN(?)';
      replacements = [uuids];
    }
  }

  if (!replacements) {
    return idToIPMap;
  }

  try {
    const result = await pool.query(
      `SELECT BIN_TO_IP(i.ip) AS 'ip', BIN_TO_UUID(i.uuid) AS 'iid' FROM IPs i
WHERE ${where}`,
      replacements,
    );
    result.forEach((obj) => {
      idToIPMap.set(obj.iid, obj.ip);
    });
  } catch (error) {
    console.error(`SQL Error on getIPsOfIIDs: ${error.message}`);
  }
  return idToIPMap;
}

/**
 * get IIDs of IPs (which is just the uuid in this table)
 * @param ipStrings Array of or a single ip string
 * @return Map<{ ipString: uuid, ... }>
 */
export async function getIIDsOfIPs(ipStrings) {
  const ipToIdMap = new Map();

  let where = '';
  let replacements;
  if (ipStrings) {
    if (Array.isArray(ipStrings)) {
      if (ipStrings.length) {
        if (ipStrings.length > 1000) {
          ipStrings.length = 1000;
        }
        const placeholder = ipStrings
          .map(() => 'SELECT IP_TO_BIN(?) AS \'ip\'').join(' UNION ALL ');
        where += `i.ip IN (SELECT l.ip FROM (${placeholder}) AS l)`;
        replacements = ipStrings;
      }
    } else {
      where += 'i.ip = IP_TO_BIN(?)';
      replacements = [ipStrings];
    }
  }

  if (!replacements) {
    return ipToIdMap;
  }

  try {
    const result = await pool.query(
      `SELECT BIN_TO_IP(i.ip) AS 'ip', BIN_TO_UUID(i.uuid) AS 'iid' FROM IPs i
      WHERE ${where}`,
      replacements,
    );
    result.forEach((obj) => {
      ipToIdMap.set(sanitizeIPString(obj.ip), obj.iid);
    });
  } catch (error) {
    console.error(`SQL Error on getIIDsOfIPs: ${error.message}`);
  }
  return ipToIdMap;
}

/* ================================ Whois =====================================
 */

/**
 * Get whois server for ip
 * @param ipString ip as string
 * @return null | host
 */
export async function getWhoisHostOfIP(ipString) {
  try {
    const range = await pool.query(
      /* eslint-disable max-len */
      `SELECT host FROM WhoisReferrals, (SELECT IP_TO_BIN(?) AS ip) AS b
WHERE \`min\` <= b.ip AND \`max\` >= b.ip AND LENGTH(b.ip) = LENGTH(\`min\`) AND expires > NOW()`,
      /* eslint-enable max-len */
      [ipString, ipString, ipString],
    );
    if (range.length) {
      return range[0].host;
    }
  } catch (error) {
    console.error(`SQL Error on getWhoisHostOfIP: ${error.message}`);
  }
  return null;
}

/* ================================ Range =====================================
*/

/**
 * look up range of IP, return is euqal to whoisData,
 * but with additional range id and expires date
 * @param ipString ip as string
 * @return null | {
 *   rid: id of range,
 *   expires: Date object when data expires,
 *   range as [start: hex, end: hex, mask: number],
 *   org as string,
 *   descr as string,
 *   asn as unsigned 32bit integer,
 *   country as two letter lowercase code,
 *   referralHost as string,
 *   referralRange as [start: hex, end: hex, mask: number],
 * }
 */
export async function getRangeOfIP(ipString) {
  try {
    const range = await pool.query(
      /* eslint-disable max-len */
      `SELECT id AS 'rid', BIN_TO_IP(min) AS 'min', BIN_TO_IP(max) AS 'max', mask, country, org, descr, asn, expires FROM Ranges, (SELECT IP_TO_BIN(?) AS ip) AS b
WHERE min <= b.ip AND max >= b.ip AND LENGTH(b.ip) = LENGTH(min) AND expires > NOW()`,
      /* eslint-enable max-len */
      [ipString, ipString, ipString],
    );
    if (range.length) {
      const {
        rid, expires, min, max, mask, org, descr, asn, country,
      } = range[0];
      /*
       * makses <= 6 are unreasonable, but can happen if whois return is screwed
       */
      if (mask > 6) {
        return {
          rid, expires, org, descr, asn, country,
          range: [
            ipToHex(sanitizeIPString(min)),
            ipToHex(sanitizeIPString(max)),
            mask,
          ],
        };
      }
    }
  } catch (error) {
    console.error(`SQL Error on getRangeOfIP: ${ipString} - ${error.message}`);
  }
  return null;
}

/* ================================ Proxy =====================================
 */

/*
 * get recent detection history
 */
export async function getProxCheckHistory(ipString) {
  try {
    const [result] = await pool.query(

      'SELECT isProxy, repetition FROM Proxies WHERE ip = IP_TO_BIN(?)',
      [ipString],
    );
    return result;
  } catch (error) {
    console.error(`SQL Error on getProxCheckHistory: ${error.message}`);
  }
  return null;
}

/**
 * check if ip is whitelisted
 * @param ipString ip as string
 * @return boolean
 */
export async function isWhitelisted(ipString) {
  const models = await pool.query(
    'SELECT 1 FROM ProxyWhitelists WHERE ip = IP_TO_BIN(?)', [ipString],
  );
  return models.length > 0;
}

/**
 * whitelist ip
 * @param ipString ip as string
 * @return true if whitelisted,
 *         false if it was already whitelisted
 */
export async function whitelist(ipString) {
  const { affectedRows } = await pool.query(
    'INSERT IGNORE INTO ProxyWhitelists (ip) VALUES (IP_TO_BIN(?))', [ipString],
  );
  return affectedRows === 1;
}

/**
 * remove ip from whitelist
 * @param ipString ip as string
 * @return true if unwhitelisted,
 *         false if ip wasn't whitelisted anyway
 */
export async function unwhitelist(ipString) {
  const { affectedRows } = await pool.query(
    'DELETE FROM ProxyWhitelists WHERE ip = IP_TO_BIN(?)', [ipString],
  );
  return affectedRows !== 0;
}

