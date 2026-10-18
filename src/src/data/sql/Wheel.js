/*
 * Günün Çarkı — sunucu tarafı.
 * ----------------------------
 * Kural: her oyuncu günde EN FAZLA 1 kez çevirebilir. Bu kural tamamen
 * sunucuda tutulur: `WheelSpins` tablosunda (uid, spinDate) birincil anahtardır,
 * yani aynı gün ikinci kez INSERT edilemez. İstemci ne gönderirse göndersin
 * (localStorage temizlemek, saati değiştirmek, isteği tekrarlamak) günlük hak
 * aşılamaz. Gün, SUNUCU saatine göre (CURDATE()) belirlenir.
 *
 * Ödül dağılımı ağırlıklıdır: küçük ödüller sık, 1000 GCoin jackpot çok nadir.
 * Ağırlık toplamı 100 olacak şekilde ayarlandı; istemciye de gönderilir ki
 * çarkta "şans" yüzdesi dürüstçe görünsün.
 *
 * Hile koruması: GuardHub'da yüksek risk puanı olan oturumlar çevirebilir ama
 * ödül en düşük kademeye sabitlenir (shadow-cap). Böylece bot yazılımıyla
 * jackpot avlamak işe yaramaz ve masum oyuncu asla engellenmez.
 */
import pool from './mariadb.js';

let tableReady = false;

/** Ödül tablosu — sunucu ve istemci aynı listeyi kullanır (GET /wheel). */
export const WHEEL_PRIZES = [
  {
    id: 'c20', coins: 20, weight: 24, tier: 'common', color: '#5aa9e6', icon: '🪙',
  },
  {
    id: 'c50', coins: 50, weight: 20, tier: 'common', color: '#56d98a', icon: '🪙',
  },
  {
    id: 'c75', coins: 75, weight: 16, tier: 'uncommon', color: '#7dd3a0', icon: '💰',
  },
  {
    id: 'c100', coins: 100, weight: 14, tier: 'uncommon', color: '#ffd479', icon: '💰',
  },
  {
    id: 'c150', coins: 150, weight: 10, tier: 'rare', color: '#f0ad2c', icon: '💎',
  },
  {
    id: 'c250', coins: 250, weight: 7, tier: 'rare', color: '#ef6b6b', icon: '💎',
  },
  {
    id: 'c500', coins: 500, weight: 6, tier: 'epic', color: '#b06cc9', icon: '🏆',
  },
  {
    id: 'c1000', coins: 1000, weight: 3, tier: 'legendary', color: '#ff4d6d', icon: '👑',
  },
];

const PRIZE_BY_ID = new Map(WHEEL_PRIZES.map((prize) => [prize.id, prize]));
const TOTAL_WEIGHT = WHEEL_PRIZES.reduce((sum, prize) => sum + prize.weight, 0);

/** En düşük kademe — risk durumunda ödül buraya sabitlenir. */
const CAP_PRIZE = WHEEL_PRIZES[0];

async function ensureWheelTable() {
  if (tableReady) return;
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS WheelSpins (
        uid INT UNSIGNED NOT NULL,
        spinDate DATE NOT NULL,
        prizeId VARCHAR(16) NOT NULL,
        coins INT UNSIGNED NOT NULL DEFAULT 0,
        guarded TINYINT(1) NOT NULL DEFAULT 0,
        createdAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (uid, spinDate),
        KEY WheelSpins_date_idx (spinDate),
        CONSTRAINT WheelSpins_ibfk_1 FOREIGN KEY (uid) REFERENCES Users (id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
    tableReady = true;
  } catch (error) {
    console.error(`SQL Error on ensureWheelTable: ${error.message}`);
  }
}

/** Gece yarısına kadar kalan süre (ms) — istemci geri sayım için kullanır. */
export function msUntilTomorrow(now = Date.now()) {
  const date = new Date(now);
  date.setHours(24, 0, 0, 0);
  return date.getTime() - now;
}

/**
 * Ağırlıklı ödül seçimi.
 * @param random 0..1 arası sayı (test edilebilirlik için dışarıdan verilebilir)
 */
export function pickPrize(random = Math.random()) {
  const roll = Math.min(0.999999, Math.max(0, Number(random) || 0)) * TOTAL_WEIGHT;
  let walked = 0;
  for (let i = 0; i < WHEEL_PRIZES.length; i += 1) {
    walked += WHEEL_PRIZES[i].weight;
    if (roll < walked) return WHEEL_PRIZES[i];
  }
  return WHEEL_PRIZES[WHEEL_PRIZES.length - 1];
}

/** Çarkta çizilecek liste: şans yüzdesi dahil. */
export function prizeList() {
  return WHEEL_PRIZES.map((prize) => ({
    ...prize,
    chance: Math.round((prize.weight / TOTAL_WEIGHT) * 1000) / 10,
  }));
}

/**
 * Oyuncunun çark durumu.
 * @return {
 *   canSpin, nextSpinAt, lastSpin, history: [...], totalSpins, totalCoins,
 * }
 */
export async function getWheelState(uid) {
  await ensureWheelTable();
  const state = {
    canSpin: false,
    nextSpinAt: Date.now() + msUntilTomorrow(),
    lastSpin: null,
    history: [],
    totalSpins: 0,
    totalCoins: 0,
  };
  try {
    const rows = await pool.query(
      `SELECT prizeId, coins, guarded, spinDate,
COALESCE(UNIX_TIMESTAMP(spinDate) * 1000, 0) AS dayTs,
COALESCE(UNIX_TIMESTAMP(createdAt) * 1000, 0) AS at
FROM WheelSpins WHERE uid = ? ORDER BY spinDate DESC LIMIT 14`,
      [uid],
    );
    const list = Array.isArray(rows) ? rows : [];
    state.history = list.map((row) => ({
      prizeId: row.prizeId,
      coins: row.coins,
      guarded: !!row.guarded,
      day: Number(row.dayTs) || 0,
      at: Number(row.at) || 0,
    }));
    state.totalSpins = state.history.length;
    const totals = await pool.query(
      'SELECT COUNT(*) AS spins, COALESCE(SUM(coins), 0) AS coins FROM WheelSpins WHERE uid = ?',
      [uid],
    );
    const total = Array.isArray(totals) ? totals[0] : null;
    if (total) {
      state.totalSpins = Number(total.spins) || 0;
      state.totalCoins = Number(total.coins) || 0;
    }
    const [today] = list.filter((row) => Number(row.dayTs) > Date.now() - 26 * 3600 * 1000
      && isSameServerDay(row.dayTs));
    state.canSpin = !today;
    state.lastSpin = state.history[0] || null;
  } catch (error) {
    console.error(`SQL Error on getWheelState: ${error.message}`);
    /* hata halinde çarkı kapatmak yerine açık bırakma: sunucu hak sahibidir */
    state.canSpin = false;
  }
  return state;
}

function isSameServerDay(ts) {
  const then = new Date(ts);
  const now = new Date();
  return then.getFullYear() === now.getFullYear()
    && then.getMonth() === now.getMonth()
    && then.getDate() === now.getDate();
}

/**
 * Çarkı çevirir. Günlük hak `WheelSpins` birincil anahtarı ile korunur.
 * @param uid
 * @param options.risk GuardHub risk puanı (yüksekse ödül alt kademeye sabitlenir)
 * @param options.random test için sabit rastgelelik
 * @return { success, errors, prize, newBalance, guarded, alreadySpun, nextSpinAt }
 */
export async function spinWheel(uid, options = {}) {
  await ensureWheelTable();
  const risk = Number(options.risk) || 0;
  const guarded = risk >= (Number(options.riskLimit) || 45);
  const prize = guarded ? CAP_PRIZE : pickPrize(options.random);

  let conn;
  try {
    conn = await pool.getConnection();
    await conn.query('START TRANSACTION');

    /* günlük hakkı atomik olarak tüket: aynı gün ikinci INSERT çalışmaz */
    const result = await conn.query(
      `INSERT IGNORE INTO WheelSpins (uid, spinDate, prizeId, coins, guarded)
VALUES (?, CURDATE(), ?, ?, ?)`,
      [uid, prize.id, prize.coins, guarded ? 1 : 0],
    );
    const affected = result?.affectedRows ?? (Array.isArray(result) ? result[0]?.affectedRows : 0);
    if (!affected) {
      await conn.query('ROLLBACK');
      return {
        success: false,
        alreadySpun: true,
        errors: ['You already spun the wheel today'],
        nextSpinAt: Date.now() + msUntilTomorrow(),
      };
    }

    await conn.query(
      `INSERT INTO UserCoins (uid, coins) VALUES (?, ?)
       ON DUPLICATE KEY UPDATE coins = coins + VALUES(coins)`,
      [uid, prize.coins],
    );
    const [balanceRow] = await conn.query('SELECT coins FROM UserCoins WHERE uid = ?', [uid]);
    await conn.query('COMMIT');

    return {
      success: true,
      prize: { ...prize, chance: Math.round((prize.weight / TOTAL_WEIGHT) * 1000) / 10 },
      guarded,
      newBalance: balanceRow ? Number(balanceRow.coins) : null,
      nextSpinAt: Date.now() + msUntilTomorrow(),
    };
  } catch (error) {
    if (conn) {
      try { await conn.query('ROLLBACK'); } catch { /* ignore */ }
    }
    console.error(`SQL Error on spinWheel: ${error.message}`);
    return { success: false, errors: ['Wheel failed, try again later'] };
  } finally {
    if (conn) conn.release();
  }
}

/** Admin/test: bir günün hakkını siler. */
export async function resetSpin(uid, day = null) {
  await ensureWheelTable();
  try {
    if (day) {
      await pool.query('DELETE FROM WheelSpins WHERE uid = ? AND spinDate = ?', [uid, day]);
    } else {
      await pool.query('DELETE FROM WheelSpins WHERE uid = ? AND spinDate = CURDATE()', [uid]);
    }
    return true;
  } catch (error) {
    console.error(`SQL Error on resetSpin: ${error.message}`);
    return false;
  }
}

export default {
  WHEEL_PRIZES, prizeList, pickPrize, getWheelState, spinWheel, resetSpin, msUntilTomorrow,
};
