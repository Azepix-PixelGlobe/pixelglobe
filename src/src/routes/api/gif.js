/*
 * KLIPY GIF proxy — /api/gif?q=türk bayrağı&pos=0
 * =================================================================
 * Tarayıcıdan doğrudan istek atmak API anahtarını ortaya çıkarır ve CORS'a
 * takılır. Bu yüzden arama sunucu üzerinden yapılır:
 *
 *   GET /api/gif?q=<arama>&pos=<imleç>&limit=<1..24>&locale=tr_TR
 *
 * Yanıt:
 *   { results: [{ id, url, preview, width, height, title }],
 *     next: "<pos>", cached: true|false }
 *
 *   url     → gönderilecek asıl GIF (static.klipy.com)
 *   preview → listede gösterilecek küçük GIF (tinygif, hızlı yüklenir)
 *
 * KLIPY'nin v2 adres yapısı alışılmış GIF API'leriyle birebir aynıdır (drop-in):
 *   https://api.klipy.com/v2/search   · /v2/featured
 * Anahtar ortam değişkeniyle değiştirilebilir: KLIPY_API_KEY
 */

import express from 'express';
import logger from '../../core/logger.js';

const router = express.Router();

const KLIPY_BASE = 'https://api.klipy.com/v2';
/* PixelGlobe'un KLIPY anahtarı (sunucuda kalır, tarayıcıya gitmez).
 * İstersen ortam değişkeniyle değiştir: KLIPY_API_KEY */
const FALLBACK_KLIPY_KEY = '1xqfAF1njgOswmKDZVvmFqrdijrDvRpVz7Eu1CWXFwjfbhdiy8tGazQnyVOankNX';
const CACHE_TTL = 5 * 60 * 1000;
const CACHE_MAX = 80;

/* sonuç önbelleği — aynı arama tekrar tekrar upstream'e gitmesin */
const cache = new Map();

export function klipyKey(env = {}) {
  return env.KLIPY_API_KEY || env.KLIPY_KEY || FALLBACK_KLIPY_KEY;
}

/** Arayüz dili → KLIPY yerelleştirme kodu (Türkçe sonuçlar için tr_TR). */
export function localeFor(lang) {
  return (String(lang || '').toLowerCase().startsWith('tr')) ? 'tr_TR' : 'en_US';
}

export function cacheKey(q, pos, limit) {
  return `${q || '*'}::${pos || 0}::${limit}`;
}

/** Arama sözcüğünü temizle: boşlukları düzle, aşırı uzunluğu kes. */
export function cleanQuery(raw) {
  if (typeof raw !== 'string') return '';
  const q = raw.replace(/\s+/g, ' ').trim();
  return q.slice(0, 60);
}

/** KLIPY yanıtını bizim sade biçime çevir (media_formats yapısı). */
export function normalizeKlipyResults(json) {
  const raw = (json && Array.isArray(json.results)) ? json.results : [];
  return raw.map((item) => {
    const formats = item.media_formats || item.media || [];
    const full = formats.gif || formats.mediumgif || formats.tinygif || {};
    const small = formats.tinygif || formats.nanogif || formats.gif || {};
    const dims = full.dims || small.dims || [];
    const url = full.url || small.url || '';
    if (!url) return null;
    return {
      id: String(item.id || url),
      url,
      preview: small.url || url,
      width: dims[0] || 220,
      height: dims[1] || 160,
      title: String(item.content_description || item.title || '').slice(0, 120),
    };
  }).filter(Boolean);
}

function readCache(key, now = Date.now()) {
  const hit = cache.get(key);
  if (!hit) return null;
  if (now - hit.ts > CACHE_TTL) {
    cache.delete(key);
    return null;
  }
  return hit.data;
}

function writeCache(key, data, now = Date.now()) {
  cache.set(key, { ts: now, data });
  if (cache.size > CACHE_MAX) {
    const oldest = cache.keys().next().value;
    cache.delete(oldest);
  }
  return data;
}

export function clearGifCache() {
  cache.clear();
}

export function gifCacheSize() {
  return cache.size;
}

/**
 * GET /api/gif
 * q yoksa KLIPY'nin "featured" (öne çıkanlar) listesi döner.
 */
router.get('/', async (req, res) => {
  if (!req.user) {
    return res.status(401).json({ errors: ['Not logged in'] });
  }
  if (typeof req.tickRateLimiter === 'function') {
    req.tickRateLimiter(250);
  }

  const q = cleanQuery(req.query.q);
  const pos = String(req.query.pos || '').replace(/[^A-Za-z0-9_.=\-+]/g, '').slice(0, 60);
  const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 18, 1), 24);
  const locale = String(req.query.locale || '').replace(/[^A-Za-z_-]/g, '').slice(0, 10)
    || localeFor(req.lang);
  const key = cacheKey(`${q}|${locale}`, pos, limit);

  const hit = readCache(key);
  if (hit) {
    res.set('Cache-Control', 'private, max-age=120');
    return res.json({ ...hit, cached: true });
  }

  const params = new URLSearchParams({
    key: klipyKey(process.env),
    limit: String(limit),
    media_filter: 'gif,tinygif',
    contentfilter: 'high',
    locale,
  });
  if (q) params.set('q', q);
  if (pos) params.set('pos', pos);

  const endpoint = q ? 'search' : 'featured';
  const url = `${KLIPY_BASE}/${endpoint}?${params.toString()}`;

  try {
    const upstream = await fetch(url, {
      headers: { Accept: 'application/json' },
    });
    if (!upstream.ok) {
      logger.warn(`KLIPY ${endpoint} HTTP ${upstream.status}`);
      return res.status(502).json({ errors: ['GIF servisi şu an yanıt vermiyor'] });
    }
    const json = await upstream.json();
    const data = {
      query: q,
      locale,
      results: normalizeKlipyResults(json),
      next: String(json.next || ''),
      source: 'klipy',
    };
    writeCache(key, data);
    res.set('Cache-Control', 'private, max-age=120');
    return res.json({ ...data, cached: false });
  } catch (error) {
    logger.warn(`KLIPY isteği başarısız: ${error.message}`);
    return res.status(502).json({ errors: ['GIF servisine ulaşılamadı'] });
  }
});

/* test yardımcısı: onbelleği dışarıdan boşalt */
export function __clearGifCache() {
  cache.clear();
}

export default router;
