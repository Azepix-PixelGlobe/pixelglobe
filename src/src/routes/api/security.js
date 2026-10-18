/*
 * PixelGlobe Guardian API
 * -----------------------
 * POST /api/security/report   istemci koruma raporu (giriş gerekmez)
 * GET  /api/security/summary  moderasyon özeti (MOD ve üstü)
 * GET  /api/security/health   servis durumu
 *
 * İstemci raporu asla doğrudan ceza sebebi değildir; sadece sinyal toplar.
 * Gövde katı biçimde doğrulanır: bilinmeyen sinyal tipleri atılır, sayılar
 * sınırlandırılır, metinler kısaltılır. Böylece bu ucun kendisi bir saldırı
 * yüzeyi olmaz.
 */
import express from 'express';

import hub from '../../core/GuardHub.js';
import { getProxyProfile } from '../../data/sql/ProxyIntel.js';
import { USERLVL } from '../../core/constants.js';

const router = express.Router();

/* istemcinin gönderebileceği sinyal tipleri */
const KNOWN_SIGNALS = new Set([
  'wsTamper', 'nativeTamper', 'automation', 'rhythm', 'untrusted', 'teleport',
  'cooldownSpam', 'tabs', 'localTamper', 'honeypot', 'reportFlood',
  'captchaRequested',
]);

const MAX_SIGNALS = 32;
const MAX_DETAIL = 120;
const MAX_BODY_BYTES = 4096;

function clampNumber(value, min, max, fallback = 0) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(min, Math.min(max, number));
}

function sanitize(payload) {
  if (!payload || typeof payload !== 'object') return null;
  const signals = Array.isArray(payload.signals) ? payload.signals.slice(0, MAX_SIGNALS) : [];

  const cleanSignals = [];
  const typeSet = new Set();
  signals.forEach((signal) => {
    if (!signal || typeof signal !== 'object') return;
    const type = String(signal.type || '');
    if (!KNOWN_SIGNALS.has(type)) return;
    typeSet.add(type);
    cleanSignals.push({
      type,
      count: clampNumber(signal.count, 1, 100000, 1),
      first: clampNumber(signal.first, 0, Number.MAX_SAFE_INTEGER, 0),
      last: clampNumber(signal.last, 0, Number.MAX_SAFE_INTEGER, 0),
      detail: typeof signal.detail === 'string' ? signal.detail.slice(0, MAX_DETAIL) : null,
    });
  });

  return {
    score: clampNumber(payload.score, 0, 1000, 0),
    mode: ['off', 'log', 'enforce'].includes(payload.mode) ? payload.mode : 'log',
    tabCount: clampNumber(payload.tabCount, 1, 200, 1),
    build: typeof payload.build === 'string' ? payload.build.slice(0, 40) : 'unknown',
    ts: typeof payload.ts === 'string' ? payload.ts.slice(0, 40) : new Date().toISOString(),
    signals: cleanSignals,
    signalTypes: [...typeSet],
  };
}

/**
 * POST /api/security/report
 * {@link verifySession} öncesinde bağlanır: giriş yapmamış ziyaretçi de
 * bot şüphesini bildirebilsin (ör. giriş formuna saldıran otomasyon).
 */
router.post('/report', async (req, res) => {
  req.tickRateLimiter(2000);

  const raw = req.body;
  const size = raw ? JSON.stringify(raw).length : 0;
  if (size > MAX_BODY_BYTES) {
    return res.status(413).json({ errors: ['Report too large'] });
  }

  const clean = sanitize(raw);
  if (!clean) return res.status(400).json({ errors: ['Invalid report'] });

  const isMod = (req.user?.userlvl || 0) >= USERLVL.MOD;
  if (clean.score < 20 && !isMod) {
    /* düşük skorlu gürültüyü hiç saklamayalım */
    return res.json({ accepted: false, reason: 'low-score' });
  }

  const result = hub.accept(req.ip?.ipString, {
    uid: req.user?.id || null,
    name: isMod ? req.user?.name : null,
    score: clean.score,
    mode: clean.mode,
    tabCount: clean.tabCount,
    build: clean.build,
    clientTs: clean.ts,
    signals: clean.signalTypes,
    detail: clean.signals,
  });

  if (!result.accepted) {
    return res.status(429).json({ accepted: false, reason: result.reason });
  }

  console.warn(
    `[guardian] score=${clean.score} ip=${req.ip?.ipString} `
    + `uid=${req.user?.id || '-'} signals=${clean.signalTypes.join('|') || '-'}`,
  );

  return res.json({ accepted: true });
});

/**
 * GET /api/security/summary
 * Moderasyon panelinden okunur.
 */
router.get('/summary', async (req, res) => {
  req.tickRateLimiter(500);
  if ((req.user?.userlvl || 0) < USERLVL.MOD) {
    return res.status(403).json({ errors: ['Insufficient permissions'] });
  }

  res.set('Cache-Control', 'private, max-age=5');
  return res.json({
    serverTime: Date.now(),
    stats: hub.stats(),
    suspects: hub.getTopSuspects(20, 45),
  });
});

/* Güvenlik ekranı için insan okur etiketler. */
const KIND_LABELS = {
  vpn: 'VPN',
  proxy: 'Proxy',
  tor: 'Tor',
  hosting: 'Datacenter IP',
  bot: 'Bot',
};

/** IP'yi ekranda gösterilebilir hale getirir (son bloklar gizlenir). */
function maskIp(ipString) {
  const ip = String(ipString || '');
  if (!ip) return 'unknown';
  if (ip.includes(':')) {
    const parts = ip.split(':').filter(Boolean);
    return `${parts.slice(0, 2).join(':')}:••••`;
  }
  const parts = ip.split('.');
  if (parts.length !== 4) return '•••';
  return `${parts[0]}.${parts[1]}.•••.•••`;
}

/**
 * GET /api/security/verdict
 * -------------------------
 * Oyuncunun bağlantısı ve istemci sinyalleri için "geçti / geçmedi" kararı.
 * İstemci bu cevaba göre tam ekran, KAPATILAMAZ uyarı ekranını gösterir:
 * VPN, proxy, Tor, sunucu IP'si ya da bot tespit edildiyse oyun kilitlenir ve
 * oyuncu bağlantısını kapatıp sayfayı yenileyene kadar ekran gitmez.
 *
 * Giriş zorunlu değil: giriş yapmamış ziyaretçi de VPN/proxy kontrolünden
 * geçmek zorunda (önizleme ve ilk giriş formu için de geçerli).
 *
 * Yanlış pozitif koruması: ProxyWhitelists'te olan IP'ler (yayıncılar, mobil
 * operatör NAT'ları, yönetim) hiç engellenmez ve karar `whitelisted: true`
 * olarak döner.
 */
router.get('/verdict', async (req, res) => {
  req.tickRateLimiter(600);
  res.set('Cache-Control', 'no-store');

  const ipString = req.ip?.ipString || null;
  const uid = req.user?.id || null;

  let allowance = null;
  let profile = null;
  try {
    allowance = await req.ip.getAllowance();
  } catch (error) {
    console.error(`verdict: ip allowance error ${error.message}`);
  }

  let kind = null;
  let reason = null;

  if (allowance && allowance.isProxy && !allowance.isWhitelisted) {
    try {
      profile = await getProxyProfile(ipString);
    } catch (error) {
      profile = null;
    }
    kind = (profile && profile.kind) || 'proxy';
    reason = (profile && profile.kindLabel) || 'Proxy or VPN detection';
  }

  const risk = hub.riskOf({ uid, ip: ipString, windowMs: 20 * 60 * 1000 });

  /* Bot kararı yalnızca hem güçlü bir otomasyon sinyali hem de yüksek risk
     varsa verilir: tek bir şüpheli sinyal masum oyuncuyu kilitlemesin. */
  if (!kind && risk.signals.includes('automation') && risk.score >= 45) {
    kind = 'bot';
    reason = 'Automation markers reported by the client';
  }

  const blocked = Boolean(kind) && !(allowance && allowance.isWhitelisted);

  return res.json({
    ok: true,
    blocked,
    kind,
    kindLabel: kind ? KIND_LABELS[kind] || kind : null,
    reason,
    whitelisted: Boolean(allowance && allowance.isWhitelisted),
    banned: Boolean(allowance && allowance.isBanned),
    muted: Boolean(allowance && allowance.isMuted),
    country: (req.ip && req.ip.country) || 'xx',
    profile: profile ? {
      type: profile.type,
      operator: profile.operator,
      city: profile.city,
      risk: profile.risk,
      confidence: profile.confidence,
      devices: profile.devices,
      expiresTs: profile.expiresTs,
    } : null,
    risk: { score: risk.score, hits: risk.hits, signals: risk.signals },
    ip: maskIp(ipString),
    serverTime: Date.now(),
  });
});

/** GET /api/security/health — koruma katmanı çalışıyor mu */
router.get('/health', async (req, res) => {
  req.tickRateLimiter(200);
  res.set('Cache-Control', 'no-store');
  return res.json({ ok: true, stats: hub.stats() });
});

export default router;
