/*
 * pgGif — sohbette GIF desteği (KLIPY üzerinden).
 * ==============================================================
 * • Sunucudaki /api/gif uç noktasını kullanır (anahtar tarayıcıya gitmez).
 * • Arama sonuçları kısa süre belleğe alınır: "kedi" yazıp başka bir şeye
 *   bakıp geri dönersen sonuç anında gelir.
 * • KLIPY GIF bağlantıları sohbette doğrudan (tıklamadan) görünür:
 *   components/markdown/MdParagraph.jsx bunun için isKlipyGif() kullanır.
 */

import { api } from './utag.js';

export const GIF_LIMIT = 18;
export const GIF_PROVIDER = 'KLIPY';
export const GIF_CACHE_TTL = 120000;

/* hazır etiketler — arama kutusunun altında çip olarak durur */
export const GIF_QUICK_TAGS = [
  { key: 'gif.tag.flag', q: 'türk bayrağı' },
  { key: 'gif.tag.laugh', q: 'komik' },
  { key: 'gif.tag.clap', q: 'alkış' },
  { key: 'gif.tag.hello', q: 'selam' },
  { key: 'gif.tag.cat', q: 'kedi' },
  { key: 'gif.tag.love', q: 'kalp' },
  { key: 'gif.tag.sad', q: 'ağlama' },
  { key: 'gif.tag.win', q: 'kutlama' },
];

/* KLIPY medya alan adları — markdown bağlantısı buraya düşüyorsa
 * sohbette otomatik açılır (embed anahtarları için bkz. components/embeds) */
export const KLIPY_GIF_HOSTS = [
  'static.klipy.com',
  'media.klipy.com',
  'klipy.com',
];

const cache = new Map();

export function gifHostOf(url) {
  if (typeof url !== 'string') return '';
  const match = /^https?:\/\/([^/?#]+)/i.exec(url.trim());
  return match ? match[1].toLowerCase() : '';
}

/** Bu bağlantı KLIPY GIF'i mi? (.gif ile bitiyor ya da KLIPY medya alanı) */
export function isKlipyGif(url) {
  if (typeof url !== 'string') return false;
  const trimmed = url.trim();
  if (!/^https?:\/\//i.test(trimmed)) return false;
  const host = gifHostOf(trimmed);
  if (!KLIPY_GIF_HOSTS.includes(host)) return false;
  return /\.(gif|webp)(\?|$)/i.test(trimmed) || /^static\.klipy\.com$/i.test(host);
}

/**
 * Sohbet embed tablosundaki anahtar (components/embeds/index.js).
 * getLinkDesc() alan adından ".com"u atar: static.klipy.com → static.klipy
 */
export function gifEmbedKey(url) {
  const host = gifHostOf(url);
  if (!host) return 'static.klipy';
  return host.endsWith('.com') ? host.slice(0, -4) : host;
}

/** GIF mesaj metni: sohbette kart olarak görünmesi için markdown resmi. */
export function gifMarkdown(url) {
  if (!isKlipyGif(url)) return url;
  return `![](${url})`;
}

export function gifCacheSize() {
  return cache.size;
}

export function clearGifCache() {
  cache.clear();
}

/**
 * KLIPY'de GIF ara (q boşsa öne çıkanlar).
 * @returns {Promise<{results: Array, next: string, error: string|null}>}
 */
export async function fetchGifs({
  q = '', pos = '', limit = GIF_LIMIT, locale = '', signal,
} = {}) {
  const key = `${q}::${pos}::${limit}::${locale}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.ts < GIF_CACHE_TTL) {
    return { ...hit.data, cached: true };
  }
  try {
    const query = new URLSearchParams({ limit: String(limit) });
    if (q) query.set('q', q);
    if (pos) query.set('pos', pos);
    if (locale) query.set('locale', locale);
    const response = await fetch(api`/api/gif?${query.toString()}`, {
      credentials: 'include',
      signal,
    });
    if (!response.ok) {
      return { results: [], next: '', error: `http-${response.status}` };
    }
    const data = await response.json();
    const out = {
      results: Array.isArray(data.results) ? data.results : [],
      next: data.next || '',
      error: null,
    };
    cache.set(key, { ts: Date.now(), data: out });
    return { ...out, cached: false };
  } catch (error) {
    if (error && error.name === 'AbortError') {
      return { results: [], next: '', error: 'aborted' };
    }
    return { results: [], next: '', error: 'network' };
  }
}

export default {
  GIF_LIMIT,
  GIF_PROVIDER,
  GIF_QUICK_TAGS,
  KLIPY_GIF_HOSTS,
  fetchGifs,
  gifEmbedKey,
  isKlipyGif,
  gifMarkdown,
};
