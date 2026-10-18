/*
 * bans of mdia
 */
import pool from './mariadb.js';
import { generateUUID } from '../../utils/hash.js';


/**
 * check if media is banned
 * @param [hashes] sha256 hash
 * @param [pHash] perceptive hash
 * @return [{ uuid, hash, pHash, reason }, ...]
 */
export async function hasMediaBan(hashes, pHashes) {
  const where = [];
  let replacements = [];

  if (hashes) {
    if (Array.isArray(hashes)) {
      if (hashes.length) {
        where.push(`hash IN (SELECT h.hash FROM (${
          hashes.map(() => 'SELECT UNHEX(?) AS \'hash\'').join(' UNION ALL ')
        }) AS h)`);
        replacements = replacements.concat(hashes);
      }
    } else {
      where.push('hash = UNHEX(?)');
      replacements.push(hashes);
    }
  }

  let conn;
  try {
    conn = await pool.getConnection();

    if (where.length) {
      const models = await conn.query(
        // eslint-disable-next-line max-len
        `SELECT BIN_TO_UUID(uuid) AS mbid, LOWER(HEX(hash)) AS hash, reason FROM MediaBans WHERE ${
          where.join(' OR ')
        }`,
        replacements,
      );
      if (models?.length) {
        return models;
      }
    }

    if (pHashes) {
      if (Array.isArray(pHashes)) {
        if (pHashes.length) {
          for (let i = 0; i < pHashes.length; i += 1) {
            const pHash = pHashes[i];
            // eslint-disable-next-line no-await-in-loop
            const [models] = await conn.query(
              'CALL GET_CLOSE_BANNED_IMAGE(?)', [pHash],
            );
            if (models.length) {
              return models;
            }
          }
        }
      } else {
        const [models] = await conn.query(
          'CALL GET_CLOSE_BANNED_IMAGE(?)', [pHashes],
        );
        if (models.length) {
          return models;
        }
      }
    }
  } catch (error) {
    console.error(`SQL Error on hasMediaBan: ${error.message}`);
  } finally {
    if (conn) conn.release();
  }
  return [];
}

/**
 * ban media by id
 * @param mediaId shortId:extension
 * @param reason MEDIA_BAN_REASON
 * @param muid id of the mod that bans
 * @return mediaSqlIdif success, null otherwise
 */
export async function banMedia(mediaId, reason, muid = null) {
  let conn;
  try {
    conn = await pool.getConnection();

    if (!mediaId || !reason) {
      return null;
    }
    const [shortId, extension] = mediaId.split(':');
    if (!shortId || !extension) {
      return null;
    }
    const [model] = await conn.query(
      'SELECT id FROM Media WHERE shortId = ? AND extension = ?',
      [shortId, extension],
    );
    if (!model) {
      return null;
    }
    const mediaSqlId = model.id;
    await conn.query(
      // eslint-disable-next-line max-len
      `INSERT IGNORE INTO MediaBans (uuid, muid, reason, hash, pHash, createdAt) SELECT ?, ?, ?, m.hash, i.pHash, NOW() FROM Media m
  LEFT JOIN ImageHashes i ON i.mid = m.id
WHERE m.id = ?`,
      [generateUUID(), muid, reason, mediaSqlId],
    );
    return mediaSqlId;
  } catch (error) {
    console.error('SQL Error on banMedia:', error.message);
    return null;
  } finally {
    if (conn) conn.release();
  }
}

/**
 * unban media by uuid
 * @param mediaBanUuid
 * @return sucess boolean
 */
export async function unbanMedia(mediaBanUuid) {
  try {
    if (!mediaBanUuid) {
      return false;
    }
    await pool.query(
      'DELETE FROM MediaBans WHERE uuid = UUID_TO_BIN(?)', [mediaBanUuid],
    );
    return true;
  } catch (error) {
    console.error('SQL Error on unbanMedia:', error.message);
    return false;
  }
}
