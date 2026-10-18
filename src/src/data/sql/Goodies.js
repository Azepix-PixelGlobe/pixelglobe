import pool from './mariadb.js';
import { USER_FLAGS } from '../../core/constants.js';

export async function storeFish(uid, type, size) {
  try {
    const [[{ id }]] = await pool.query(
      'CALL STORE_FISH(?, ?, ?)', [uid, type, size],
    );
    return id;
  } catch (error) {
    console.error(`SQL Error on storeFish: ${error.message}`);
  }
  return null;
}

/**
 * get information of single fish
 * @param id id of fish
 * @return fish { type, size, ts, caughtByUid, caughtByName } | null
 */
export async function getFishById(id) {
  try {
    const [fish] = await pool.query(
      `SELECT f.type, f.size, f.createdAt,
f.uid AS caughtByUid, u.name AS caughtByName, u.username AS caughtByUsername,
(u.flags & ?) != 0 AS isPrivate FROM Fishes f
  LEFT JOIN Users u ON u.id = f.uid
WHERE f.id = ?`,
      [0x01 << USER_FLAGS.PRIV, id],
    );
    if (fish) {
      fish.ts = fish.createdAt.getTime();
      delete fish.createdAt;
      return fish;
    }
  } catch (error) {
    console.error(`SQL Error on getFish: ${error.message}`);
  }
  return null;
}

export async function getFishesOfUser(uid) {
  const fishes = [];
  try {
    const fishModels = await pool.query(
      // eslint-disable-next-line max-len
      'SELECT id, type, size, createdAt FROM Fishes WHERE uid = ? ORDER BY createdAt DESC',
      [uid],
    );
    let i = fishModels.length;
    while (i > 0) {
      i -= 1;
      const { id, type, size, createdAt } = fishModels[i];
      fishes.push({ id, type, size, ts: createdAt.getTime() });
    }
  } catch (error) {
    console.error(`SQL Error on getFishesOfUser: ${error.message}`);
  }
  return fishes;
}

/**
 * get information of a speciic badge
 * @param id id of badge from UserBadges table
 */
export async function getBadgeById(id) {
  try {
    const [badge] = await pool.query(

      `SELECT b.name, b.description, ub.note,
ub.createdAt, u.id AS userId, u.name AS userDisplayName, u.username AS userName,
(u.flags & ?) != 0 AS isPrivate FROM Badges b
  INNER JOIN UserBadges ub ON ub.bid = b.id
  INNER JOIN Users u ON u.id = ub.uid
WHERE ub.id = ?`,
      [0x01 << USER_FLAGS.PRIV, id],
    );
    if (badge) {
      badge.ts = badge.createdAt.getTime();
      delete badge.createdAt;
      return badge;
    }
  } catch (error) {
    console.error(`SQL Error on getFish: ${error.message}`);
  }
  return null;
}

/**
 * get all badges of a user
 * @param uid user id
 * @return [{
 *   id: id of badge from UserBadges table
 *   name: name of badge, which is also used in the filename
 *   description: descriptive text
 * }, ...]
 */
export async function getBadgesOfUser(uid) {
  const badges = [];
  try {
    const results = await pool.query(
      `SELECT ub.id, b.name, b.description, ub.createdAt FROM Badges b
  INNER JOIN UserBadges ub ON ub.bid = b.id
  INNER JOIN Users u ON u.id = ub.uid
WHERE u.id = ?`,
      [uid],
    );
    let i = results.length;
    while (i > 0) {
      i -= 1;
      const { id, name, description, createdAt } = results[i];
      badges.push({ id, name, description, ts: createdAt.getTime() });
    }
  } catch (error) {
    console.error(`SQL Error on getBadgesOfUser: ${error.message}`);
  }
  return badges;
}

/**
 * ensure that a badge exists
 */
export async function ensureBadgeExistence(name, description) {
  let conn;
  try {
    conn = await pool.getConnection();

    const [found] = await conn.query(
      'SELECT description FROM Badges WHERE name = ?', [name],
    );
    if (found) {
      if (found.description !== description) {
        await conn.query(
          'UPDATE Badges SET description = ? WHERE name = ?',
          [description, name],
        );
      }
      return true;
    }
    await conn.query(
      'INSERT INTO Badges (name, description) VALUES (?, ?)',
      [name, description],
    );
    return true;
  } catch (error) {
    console.error(`SQL Error on ensureBadgeExistence: ${error.message}`);
  } finally {
    if (conn) conn.release();
  }
  return false;
}

/**
 * give badge to user if not exists
 * @param name of badge
 * @param note note for users badge
 * @param uid user id
 */
export async function giveBadgeToUserNX(name, note, uid) {
  try {
    await pool.query(
      `INSERT INTO UserBadges (bid, uid, note)
  SELECT b.id, ?, ? FROM Badges b WHERE b.name = ?
    AND NOT EXISTS (
      SELECT 1 FROM UserBadges ub WHERE ub.bid = b.id AND ub.uid = ?
    )`,
      [uid, note, name, uid],
    );
  } catch (error) {
    console.error(`SQL Error on giveBadgeToUserNX: ${error.message}`);
  }
}
