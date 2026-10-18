/*
 * Market API: shop items, coin balance, daily goals.
 */
import express from 'express';
import { USERLVL } from '../../core/constants.js';
import {
  SHOP_ITEMS,
  DAILY_GOALS,
  getCoins,
  getOwnedItems,
  getTodayGoalProgress,
  buyItem,
  activateItem,
  deactivateItem,
  claimGoalReward,
  addOnlineMinutes,
  getActiveStyles,
} from '../../data/sql/Coins.js';
import socketEvents from '../../socket/socketEvents.js';
import { invalidateUserEffects } from '../../core/UserEffectsCache.js';
import {
  prizeList, getWheelState, spinWheel, resetSpin,
} from '../../data/sql/Wheel.js';
import hub from '../../core/GuardHub.js';

const router = express.Router();

/**
 * GET /api/market
 * Returns shop catalog (with owned/active status), coin balance, daily goals.
 */
router.get('/', async (req, res) => {
  const { user } = req;
  if (!user) {
    return res.status(401).json({ errors: ['Not logged in'] });
  }

  const isAdmin = user.userlvl >= USERLVL.ADMIN;

  const [coins, ownedRows, goals] = await Promise.all([
    getCoins(user.id, user.userlvl),
    getOwnedItems(user.id),
    getTodayGoalProgress(user.id),
  ]);

  const ownedMap = {};
  for (const r of ownedRows) {
    ownedMap[r.itemId] = { owned: true, active: !!r.active };
  }

  const shopItems = SHOP_ITEMS.map((item) => ({
    ...item,
    owned: !!ownedMap[item.id],
    active: !!(ownedMap[item.id]?.active),
  }));

  return res.json({
    coins,       // null = unlimited (admin)
    isAdmin,
    shopItems,
    goals,
  });
});

/**
 * GET /api/market/styles?uids=1,2,3
 * Sohbette görünen oyuncuların aktif kozmetikleri:
 *   styles → isim efektleri, frames → hareketli avatar çerçeveleri
 * İstemci ikisini de canlı haritada tutar; böylece çerçeveyi herkes görür.
 */
router.get('/styles', async (req, res) => {
  const raw = String(req.query.uids || '');
  const uids = raw.split(',').slice(0, 80);
  const { styles, frames } = await getActiveStyles(uids);
  res.set('Cache-Control', 'no-store');
  return res.json({ styles, frames });
});

/**
 * POST /api/market/buy
 * Body: { itemId }
 */
router.post('/buy', async (req, res) => {
  const { user } = req;
  if (!user) return res.status(401).json({ errors: ['Not logged in'] });

  const { itemId } = req.body || {};
  if (!itemId) return res.status(400).json({ errors: ['Missing itemId'] });

  const result = await buyItem(user.id, itemId, user.userlvl);
  if (!result.success) {
    return res.status(400).json({ errors: result.errors });
  }

  return res.json({
    success: true,
    newBalance: result.newBalance,
    itemId,
  });
});

/**
 * POST /api/market/activate
 * Body: { itemId, active: boolean }
 */
router.post('/activate', async (req, res) => {
  const { user } = req;
  if (!user) return res.status(401).json({ errors: ['Not logged in'] });

  const { itemId, active } = req.body || {};
  if (!itemId) return res.status(400).json({ errors: ['Missing itemId'] });

  let result;
  if (active === false) {
    result = await deactivateItem(user.id, itemId);
  } else {
    result = await activateItem(user.id, itemId);
  }

  if (!result.success) {
    return res.status(400).json({ errors: ['Could not activate item'] });
  }

  // update effects cache and broadcast to user's websocket(s)
  const effects = {
    nameEffect: result.nameEffect || null,
    frameEffect: result.frameEffect || null,
  };
  invalidateUserEffects(user.id, effects);
  socketEvents.broadcastNameStyle(user.id, effects.nameEffect || 'none');
  /* çerçeve de aynı şekilde HERKESE yayınlanır (sohbet + profil anında güncellenir) */
  socketEvents.broadcastFrameStyle(user.id, effects.frameEffect || 'none');

  // broadcast profile patch so chat messages reflect new effects immediately
  socketEvents.patchUserState(user.id, 'profile', {
    op: 'set', path: 'activeItems', value: effects,
  });

  return res.json({ success: true, ...effects });
});

/**
 * POST /api/market/claim
 * Body: { goalId }
 */
router.post('/claim', async (req, res) => {
  const { user } = req;
  if (!user) return res.status(401).json({ errors: ['Not logged in'] });

  const { goalId } = req.body || {};
  if (!goalId) return res.status(400).json({ errors: ['Missing goalId'] });

  const result = await claimGoalReward(user.id, goalId);
  if (!result.success) {
    return res.status(400).json({ errors: result.errors });
  }

  // broadcast updated coin balance via websocket
  socketEvents.patchUserState(user.id, 'profile', {
    op: 'set', path: 'coins', value: result.newBalance,
  });

  return res.json({
    success: true,
    coinsAwarded: result.coinsAwarded,
    newBalance: result.newBalance,
  });
});

/**
 * GET /api/market/wheel
 * Günün çarkı: ödül listesi, günlük hak durumu, geçmiş, toplam kazanç.
 */
router.get('/wheel', async (req, res) => {
  const { user } = req;
  if (!user) return res.status(401).json({ errors: ['Not logged in'] });

  const state = await getWheelState(user.id);
  res.set('Cache-Control', 'no-store');
  return res.json({
    prizes: prizeList(),
    ...state,
    serverTime: Date.now(),
  });
});

/**
 * POST /api/market/wheel
 * Çarkı çevirir. Günlük hak sunucuda (WheelSpins birincil anahtarı) korunur;
 * ödül miktarı asla istemciden gelmez. Yüksek riskli oturumlar çevirebilir ama
 * ödül alt kademeye sabitlenir (jackpot avlamayı engeller).
 */
router.post('/wheel', async (req, res) => {
  const { user } = req;
  if (!user) return res.status(401).json({ errors: ['Not logged in'] });

  req.tickRateLimiter(1500);

  const risk = hub.riskOf({ uid: user.id, ip: req.ip?.ipString || null });
  const result = await spinWheel(user.id, { risk: risk.score });

  if (!result.success) {
    const state = await getWheelState(user.id);
    return res.status(result.alreadySpun ? 429 : 400).json({
      errors: result.errors,
      alreadySpun: !!result.alreadySpun,
      ...state,
      prizes: prizeList(),
      serverTime: Date.now(),
    });
  }

  const state = await getWheelState(user.id);

  /* bakiye websocket ile de güncellensin (diğer sekmeler senkron kalsın) */
  try {
    socketEvents.patchUserState(user.id, 'profile', {
      op: 'set', path: 'coins', value: result.newBalance,
    });
  } catch { /* socket yoksa sorun değil */ }

  console.warn(
    `[wheel] uid=${user.id} prize=${result.prize.id} coins=${result.prize.coins}`
    + `${result.guarded ? ' (guarded)' : ''} risk=${risk.score}`,
  );

  return res.json({
    success: true,
    prize: result.prize,
    guarded: !!result.guarded,
    newBalance: result.newBalance,
    prizes: prizeList(),
    ...state,
    serverTime: Date.now(),
  });
});

/**
 * POST /api/market/wheel/reset
 * Sadece MOD ve üstü: bir oyuncunun günlük çark hakkını geri verir.
 * Body: { uid }
 */
router.post('/wheel/reset', async (req, res) => {
  const { user } = req;
  if (!user || user.userlvl < USERLVL.MOD) {
    return res.status(403).json({ errors: ['Insufficient permissions'] });
  }
  const targetUid = Number(req.body?.uid);
  if (!targetUid) return res.status(400).json({ errors: ['Missing uid'] });
  const ok = await resetSpin(targetUid);
  return res.json({ success: ok });
});

router.post('/online', async (req, res) => {
  const { user } = req;
  if (!user) return res.status(401).json({ errors: ['Not logged in'] });
  const minutes = Math.min(2, Math.max(0, Number(req.body?.minutes) || 1));
  await addOnlineMinutes(user.id, minutes);
  return res.json({ success: true });
});

export default router;
