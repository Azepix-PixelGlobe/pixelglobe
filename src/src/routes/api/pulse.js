/*
 * PixelGlobe Pulse API — günlük ritim, seri, seviye, aktivite grafiği ve
 * "Bugünün Başarısı".
 * ---------------------------------------------------------------------
 * GET  /api/pulse             seviye (ömür boyu pixel) + seri + bugünkü özet
 * POST /api/pulse/heartbeat   bugünün girişini işaretler (günde 1 etki)
 * GET  /api/pulse/activity    son 7 günün grafiği + günün rekoru
 * GET  /api/pulse/board       günün ilk 5'i + senin sıran
 *
 * Not: coin bakiyesi ve market görevleri /api/market üzerinden yürür; burada
 * onlar tekrar edilmez, sadece seri/seviye/grafik/rekor katmanı eklenir.
 */
import express from 'express';

import { getUserRanks, getTopUserRanks } from '../../data/redis/ranks.js';
import { populateUserIdObj } from '../../data/sql/User.js';
import { getCoins } from '../../data/sql/Coins.js';
import {
  getStreak, touchStreak, getDailyRows, getBestDayBefore, claimRecordBonus,
  syncTodayPixels, levelFromPixels,
} from '../../data/sql/Pulse.js';
import {
  computeRecord, summarizeActivity, dayKey, ACTIVITY_DAYS, RECORD_BONUS_COINS,
} from '../../utils/pulseMath.js';

const router = express.Router();

async function safeRanks(uid) {
  try {
    const ranks = await getUserRanks(uid);
    return {
      totalPixels: Number(ranks[0]) || 0,
      dailyPixels: Number(ranks[1]) || 0,
      totalRank: Number(ranks[2]) || 0,
      dailyRank: Number(ranks[3]) || 0,
    };
  } catch (err) {
    console.error('Pulse rank error:', err.message);
    return {
      totalPixels: 0, dailyPixels: 0, totalRank: 0, dailyRank: 0,
    };
  }
}

/**
 * GET /api/pulse
 */
router.get('/', async (req, res) => {
  req.tickRateLimiter(500);
  const { user } = req;
  if (!user) return res.status(401).json({ errors: ['Not logged in'] });

  const [ranks, streak, coins] = await Promise.all([
    safeRanks(user.id),
    getStreak(user.id),
    getCoins(user.id, user.userlvl),
  ]);

  return res.json({
    serverTime: Date.now(),
    level: levelFromPixels(ranks.totalPixels),
    streak: streak || {
      streak: 0, best: 0, freezeCount: 0, totalDays: 0, lastDay: null, todayTouched: false,
    },
    today: {
      pixels: ranks.dailyPixels,
      rank: ranks.dailyRank,
    },
    total: {
      pixels: ranks.totalPixels,
      rank: ranks.totalRank,
    },
    coins,
  });
});

/**
 * POST /api/pulse/heartbeat
 * Oyuncu sekmede göründüğünde / periyodik olarak çağrılır.
 */
router.post('/heartbeat', async (req, res) => {
  req.tickRateLimiter(1000);
  const { user } = req;
  if (!user) return res.status(401).json({ errors: ['Not logged in'] });

  const result = await touchStreak(user.id);
  if (!result.success) {
    return res.status(500).json({ errors: result.errors || ['Server error'] });
  }

  const coins = await getCoins(user.id, user.userlvl);

  return res.json({
    serverTime: Date.now(),
    alreadyToday: !!result.alreadyToday,
    streak: {
      streak: result.streak,
      best: result.best,
      freezeCount: result.freezeCount,
      totalDays: result.totalDays,
      todayTouched: true,
    },
    freezeUsed: !!result.freezeUsed,
    milestone: result.milestone,
    coinsAwarded: result.coinsAwarded,
    coins,
  });
});

/**
 * GET /api/pulse/activity
 * Son 7 günün pixel grafiği + "Bugünün Başarısı" (günün rekoru).
 *
 * Redis'teki günlük sayaç, bizim tablomuzdan büyükse tabloyu yükseltiyoruz:
 * böylece sistem yeni kurulduğunda bugünün verisi de grafikte doğru görünür.
 */
router.get('/activity', async (req, res) => {
  req.tickRateLimiter(500);
  const { user } = req;
  if (!user) return res.status(401).json({ errors: ['Not logged in'] });

  const today = dayKey();
  const ranks = await safeRanks(user.id);

  if (ranks.dailyPixels > 0) {
    await syncTodayPixels(user.id, ranks.dailyPixels);
  }

  const [rows, bestBefore] = await Promise.all([
    getDailyRows(user.id, Math.max(ACTIVITY_DAYS, 8)),
    getBestDayBefore(user.id, today),
  ]);

  /* rekor kıyası için önceki en iyi günü de listeye kat */
  const recordRows = rows.slice();
  if (bestBefore && bestBefore.pixels > 0) recordRows.push(bestBefore);

  const week = summarizeActivity(rows, today, ACTIVITY_DAYS);
  const record = computeRecord(recordRows, today);

  /* rekor kırıldıysa günde bir kez GCoin bonusu */
  let bonusAwarded = 0;
  if (record.isRecord) {
    const bonus = await claimRecordBonus(user.id, today, record.delta);
    if (bonus.awarded) bonusAwarded = bonus.coins;
  }

  return res.json({
    serverTime: Date.now(),
    days: week.days,
    week: {
      total: week.total,
      average: week.average,
      max: week.max,
      best: week.best,
      activeDays: week.activeDays,
    },
    record: {
      today: record.today,
      previousBest: record.previousBest,
      previousBestDay: record.previousBestDay,
      delta: record.delta,
      isRecord: record.isRecord,
      toGo: record.toGo,
      isFirstDay: record.isFirstDay,
      ratio: record.ratio,
    },
    bonus: {
      awarded: bonusAwarded > 0,
      coins: bonusAwarded,
      maxCoins: RECORD_BONUS_COINS,
    },
  });
});

/**
 * GET /api/pulse/board
 * Günün ilk 5'i ve oyuncunun kendi sırası.
 */
router.get('/board', async (req, res) => {
  req.tickRateLimiter(500);
  const { user } = req;

  let top = [];
  let me = null;
  try {
    top = await populateUserIdObj(await getTopUserRanks(1, 1, 5));
  } catch (err) {
    console.error('Pulse board error:', err.message);
  }

  if (user) {
    const ranks = await safeRanks(user.id);
    me = {
      id: user.id,
      name: user.name,
      pixels: ranks.dailyPixels,
      rank: ranks.dailyRank,
    };
  }

  return res.json({
    serverTime: Date.now(),
    leaderboard: top.map((row) => ({
      id: row.id,
      name: row.name || '???',
      username: row.username || null,
      avatarId: row.avatarId || null,
      pixels: Number(row.dt) || 0,
      rank: Number(row.dr) || 0,
    })),
    me,
  });
});

export default router;
