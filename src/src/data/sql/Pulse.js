/*
 * PixelGlobe Pulse — seri (streak), günlük pixel geçmişi ve rekor bonusu.
 * ----------------------------------------------------------------------
 * Kalıcı iki tablo:
 *
 *   UserStreaks     streak / best / freezeCount / totalDays / lastDay
 *   UserPulseDaily  uid + gün + o gün atılan pixel (+ rekor bonusu verildi mi)
 *
 * Seviye/XP ayrı tablo gerektirmez: ömür boyu atılan pixel sayısı zaten
 * redis ranklarında tutulur (data/redis/ranks.js), o yüzden XP = toplam pixel.
 * Böylece seviyeyi istemci tarafında uydurmak imkânsız olur.
 *
 * Seviye eşikleri, seri kilometre taşları ve "günün rekoru" mantığı
 * utils/pulseMath.js içinde; orası hem istemci hem sunucu tarafından
 * kullanılan tek kaynak.
 */
import pool from './mariadb.js';
import { addCoins } from './Coins.js';
import {
  levelFromPixels as levelFromPixelsShared,
  STREAK_MILESTONES,
  FREEZE_CAP,
  RECORD_MIN_DELTA,
  RECORD_BONUS_COINS,
  ACTIVITY_DAYS,
} from '../../utils/pulseMath.js';

export { LEVEL_STEPS, STREAK_MILESTONES, FREEZE_CAP } from '../../utils/pulseMath.js';

export { RECORD_MIN_DELTA, RECORD_BONUS_COINS, ACTIVITY_DAYS };

let tablesReady = false;

async function ensurePulseTables() {
  if (tablesReady) return;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS UserStreaks (
      uid INT UNSIGNED NOT NULL PRIMARY KEY,
      streak INT UNSIGNED NOT NULL DEFAULT 0,
      best INT UNSIGNED NOT NULL DEFAULT 0,
      freezeCount TINYINT UNSIGNED NOT NULL DEFAULT 1,
      totalDays INT UNSIGNED NOT NULL DEFAULT 0,
      lastDay DATE NULL,
      updatedAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
        ON UPDATE CURRENT_TIMESTAMP,
      CONSTRAINT UserStreaks_ibfk_1 FOREIGN KEY (uid) REFERENCES Users (id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

  /*
   * Günlük pixel geçmişi: Nabız grafiği ve "Bugünün Başarısı" buradan beslenir.
   * Satır başına bir gün; pixel yerleştirildikçe artar (core/draw.js).
   */
  await pool.query(`
    CREATE TABLE IF NOT EXISTS UserPulseDaily (
      uid INT UNSIGNED NOT NULL,
      day DATE NOT NULL,
      pixels INT UNSIGNED NOT NULL DEFAULT 0,
      recordAwarded TINYINT(1) NOT NULL DEFAULT 0,
      updatedAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
        ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (uid, day),
      KEY UserPulseDaily_day_idx (day),
      CONSTRAINT UserPulseDaily_ibfk_1 FOREIGN KEY (uid) REFERENCES Users (id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
  tablesReady = true;
}

/**
 * Ömür boyu pixel sayısından seviye (utils/pulseMath.js).
 */
export function levelFromPixels(totalPixels) {
  return levelFromPixelsShared(totalPixels);
}

/* ------------------------------------------------------------ günlükler */

/**
 * Bugünün pixel sayısını artırır. core/draw.js'ten çağrılır (fire & forget).
 * @param uid
 * @param count yerleştirilen pixel sayısı
 */
export async function recordDailyPixels(uid, count) {
  const amount = Math.floor(Number(count) || 0);
  if (!uid || amount <= 0) return;
  try {
    await ensurePulseTables();
    await pool.query(
      `INSERT INTO UserPulseDaily (uid, day, pixels, recordAwarded)
       VALUES (?, CURDATE(), ?, 0)
       ON DUPLICATE KEY UPDATE pixels = pixels + VALUES(pixels)`,
      [uid, Math.min(amount, 100000)],
    );
  } catch (err) {
    console.error('SQL Error on recordDailyPixels:', err.message);
  }
}

/**
 * Bugünün satırını redis'teki günlük sayaca göre yükseltir.
 * Nabız sistemi kurulmadan önce atılmış piksellerin grafikte görünmesini
 * sağlar; değeri asla küçültmez (GREATEST).
 */
export async function syncTodayPixels(uid, pixels) {
  const amount = Math.floor(Number(pixels) || 0);
  if (!uid || amount <= 0) return;
  try {
    await ensurePulseTables();
    await pool.query(
      `INSERT INTO UserPulseDaily (uid, day, pixels, recordAwarded)
       VALUES (?, CURDATE(), ?, 0)
       ON DUPLICATE KEY UPDATE pixels = GREATEST(pixels, VALUES(pixels))`,
      [uid, Math.min(amount, 100000000)],
    );
  } catch (err) {
    console.error('SQL Error on syncTodayPixels:', err.message);
  }
}

/**
 * Son N günün satırları: [{ day: 'YYYY-MM-DD', pixels }]
 */
export async function getDailyRows(uid, days = ACTIVITY_DAYS) {
  if (!uid) return [];
  const window = Math.max(1, Math.min(90, Math.floor(days)));
  try {
    await ensurePulseTables();
    const rows = await pool.query(
      `SELECT DATE_FORMAT(day, '%Y-%m-%d') AS day, pixels
       FROM UserPulseDaily
       WHERE uid = ? AND day >= DATE_SUB(CURDATE(), INTERVAL ? DAY)
       ORDER BY day ASC`,
      [uid, window - 1],
    );
    return rows.map((row) => ({ day: row.day, pixels: Number(row.pixels) || 0 }));
  } catch (err) {
    console.error('SQL Error on getDailyRows:', err.message);
    return [];
  }
}

/**
 * Bugünden önceki en iyi gün (rekor kıyası için, tüm geçmiş).
 * @return { day, pixels } | null
 */
export async function getBestDayBefore(uid, todayKey) {
  if (!uid) return null;
  try {
    await ensurePulseTables();
    const rows = await pool.query(
      `SELECT DATE_FORMAT(day, '%Y-%m-%d') AS day, pixels
       FROM UserPulseDaily
       WHERE uid = ? AND day < ?
       ORDER BY pixels DESC, day DESC
       LIMIT 1`,
      [uid, todayKey],
    );
    if (!rows.length) return null;
    return { day: rows[0].day, pixels: Number(rows[0].pixels) || 0 };
  } catch (err) {
    console.error('SQL Error on getBestDayBefore:', err.message);
    return null;
  }
}

/**
 * "Bugünün Başarısı": bugünün rekorunu kutlarken GCoin verir.
 * Günde yalnızca bir kez, transaction içinde ve yalnızca rekor gerçekten
 * kırıldıysa (delta >= RECORD_MIN_DELTA) verilir.
 *
 * @return { awarded, coins, reason? }
 */
export async function claimRecordBonus(uid, todayKey, delta) {
  if (!uid) return { awarded: false, coins: 0, reason: 'no-user' };
  if (!Number.isFinite(delta) || delta < RECORD_MIN_DELTA) {
    return { awarded: false, coins: 0, reason: 'below-threshold' };
  }

  let conn;
  try {
    await ensurePulseTables();
    conn = await pool.getConnection();
    await conn.query('START TRANSACTION');

    const rows = await conn.query(
      `SELECT pixels, recordAwarded FROM UserPulseDaily
       WHERE uid = ? AND day = ? FOR UPDATE`,
      [uid, todayKey],
    );
    if (!rows.length) {
      await conn.query('ROLLBACK');
      return { awarded: false, coins: 0, reason: 'no-row' };
    }
    if (rows[0].recordAwarded) {
      await conn.query('ROLLBACK');
      return { awarded: false, coins: 0, reason: 'already-awarded' };
    }

    await conn.query(
      'UPDATE UserPulseDaily SET recordAwarded = 1 WHERE uid = ? AND day = ?',
      [uid, todayKey],
    );
    await conn.query(
      `INSERT INTO UserCoins (uid, coins) VALUES (?, ?)
       ON DUPLICATE KEY UPDATE coins = coins + VALUES(coins)`,
      [uid, RECORD_BONUS_COINS],
    );
    await conn.query('COMMIT');

    return { awarded: true, coins: RECORD_BONUS_COINS };
  } catch (err) {
    if (conn) await conn.query('ROLLBACK').catch(() => {});
    console.error('SQL Error on claimRecordBonus:', err.message);
    return { awarded: false, coins: 0, reason: 'error' };
  } finally {
    if (conn) conn.release();
  }
}

/* ---------------------------------------------------------------- seri */

/**
 * Seri durumu.
 * @return { streak, best, freezeCount, totalDays, lastDay, todayTouched }
 */
export async function getStreak(uid) {
  if (!uid) return null;
  try {
    await ensurePulseTables();
    const rows = await pool.query(
      `SELECT streak, best, freezeCount, totalDays,
         IF(lastDay = CURDATE(), 1, 0) AS todayTouched,
         DATE_FORMAT(lastDay, '%Y-%m-%d') AS lastDay
       FROM UserStreaks WHERE uid = ?`,
      [uid],
    );
    const row = rows[0];
    if (!row) {
      return {
        streak: 0, best: 0, freezeCount: 1, totalDays: 0, lastDay: null, todayTouched: false,
      };
    }
    return {
      streak: row.streak,
      best: row.best,
      freezeCount: row.freezeCount,
      totalDays: row.totalDays,
      lastDay: row.lastDay,
      todayTouched: !!row.todayTouched,
    };
  } catch (err) {
    console.error('SQL Error on getStreak:', err.message);
    return null;
  }
}

/**
 * Bugünün girişini işaretler. Günde en fazla bir kez etki eder.
 * Arka arkaya gelmezsen seri sıfırlanır; dondurma hakkın varsa ve sadece
 * bir gün kaçırdıysan seri korunur (hak harcanır).
 */
export async function touchStreak(uid) {
  if (!uid) return { success: false, errors: ['No user'] };
  let conn;
  try {
    await ensurePulseTables();
    conn = await pool.getConnection();
    await conn.query('START TRANSACTION');

    const rows = await conn.query(
      `SELECT streak, best, freezeCount, totalDays,
         IF(lastDay = CURDATE(), 1, 0) AS todayTouched,
         IFNULL(DATEDIFF(CURDATE(), lastDay), 999) AS gapDays
       FROM UserStreaks WHERE uid = ? FOR UPDATE`,
      [uid],
    );
    const row = rows[0];

    if (row && row.todayTouched) {
      await conn.query('COMMIT');
      return {
        success: true,
        alreadyToday: true,
        streak: row.streak,
        best: row.best,
        freezeCount: row.freezeCount,
        totalDays: row.totalDays,
        freezeUsed: false,
        milestone: null,
        coinsAwarded: 0,
      };
    }

    let streak = 1;
    let best = 1;
    let freezeCount = 1;
    let totalDays = 1;
    let freezeUsed = false;

    if (row) {
      best = row.best;
      freezeCount = row.freezeCount;
      totalDays = row.totalDays + 1;
      const gap = Number(row.gapDays);
      if (gap === 1) {
        streak = row.streak + 1;
      } else if (gap === 2 && freezeCount > 0) {
        /* tek bir gün kaçtı: dondurma seriyi kurtarır */
        freezeCount -= 1;
        freezeUsed = true;
        streak = row.streak + 1;
      } else {
        streak = 1;
      }
      if (streak > best) best = streak;
    }

    let milestone = null;
    let coinsAwarded = 0;
    if (STREAK_MILESTONES.includes(streak)) {
      milestone = streak;
      coinsAwarded = 40 + streak * 2;
      if (streak % 7 === 0 && freezeCount < FREEZE_CAP) freezeCount += 1;
    }

    if (row) {
      await conn.query(
        `UPDATE UserStreaks
         SET streak = ?, best = ?, freezeCount = ?, totalDays = ?, lastDay = CURDATE()
         WHERE uid = ?`,
        [streak, best, freezeCount, totalDays, uid],
      );
    } else {
      await conn.query(
        `INSERT INTO UserStreaks
           (uid, streak, best, freezeCount, totalDays, lastDay)
         VALUES (?, 1, 1, 1, 1, CURDATE())`,
        [uid],
      );
    }

    await conn.query('COMMIT');

    if (coinsAwarded > 0) await addCoins(uid, coinsAwarded);

    return {
      success: true,
      alreadyToday: false,
      streak,
      best,
      freezeCount,
      totalDays,
      freezeUsed,
      milestone,
      coinsAwarded,
    };
  } catch (err) {
    if (conn) await conn.query('ROLLBACK').catch(() => {});
    console.error('SQL Error on touchStreak:', err.message);
    return { success: false, errors: ['Server error'] };
  } finally {
    if (conn) conn.release();
  }
}
