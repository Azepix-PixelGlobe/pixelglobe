/*
 * GuardHub — istemci koruma raporlarını toplayan küçük bellek deposu.
 * -------------------------------------------------------------------
 * Amaç: hiçbir veri tabanı tablosu eklemeden, bot/otomasyon şüphesi olan
 * oturumları moderasyona görünür kılmak. Tüm kayıtlar RAM'de tutulur ve
 * sınırlıdır; sunucu yeniden başlarsa temizlenir (kalıcı kayıt istenirse
 * ModtoolsLogger'a yazılabilir).
 *
 * Ayrıca IP başına saatlik rapor sayısını sınırlar: bir istemci akışı
 * boğamaz.
 */
import { HOUR } from './constants.js';

const MAX_ENTRIES = 500;
const MAX_REPORTS_PER_IP = 20;
const IP_WINDOW = HOUR;

const entries = [];
const ipCounters = new Map();
const subscribers = new Set();

function pruneCounters(now) {
  ipCounters.forEach((value, key) => {
    if (now - value.start > IP_WINDOW || value.count > MAX_REPORTS_PER_IP * 4) {
      ipCounters.delete(key);
    }
  });
}

/**
 * @return { accepted, reason }
 */
export function accept(ipString, payload) {
  const now = Date.now();
  if (ipCounters.size > 5000) pruneCounters(now);

  const key = ipString || 'unknown';
  let counter = ipCounters.get(key);
  if (!counter || now - counter.start > IP_WINDOW) {
    counter = { start: now, count: 0 };
    ipCounters.set(key, counter);
  }
  counter.count += 1;
  if (counter.count > MAX_REPORTS_PER_IP) {
    return { accepted: false, reason: 'rate-limited' };
  }

  const entry = {
    ...payload,
    ip: key,
    at: now,
  };
  entries.push(entry);
  if (entries.length > MAX_ENTRIES) entries.splice(0, entries.length - MAX_ENTRIES);

  subscribers.forEach((fn) => {
    try { fn(entry); } catch { /* ignore */ }
  });

  return { accepted: true };
}

export function onReport(fn) {
  subscribers.add(fn);
  return () => subscribers.delete(fn);
}

/**
 * @param limit kaç kayıt dönecek
 * @param minScore sadece bu skorun üstündekiler
 */
export function getRecent(limit = 50, minScore = 0) {
  const list = entries.filter((entry) => (entry.score || 0) >= minScore);
  return list.slice(-Math.max(1, Math.min(limit, 200))).reverse();
}

/**
 * Aynı IP'den gelen raporları skora göre birleştirir: en şüpheli ilk N.
 */
export function getTopSuspects(limit = 20, minScore = 45) {
  const byIp = new Map();
  entries.forEach((entry) => {
    if ((entry.score || 0) < minScore) return;
    const current = byIp.get(entry.ip);
    if (!current) {
      byIp.set(entry.ip, {
        ip: entry.ip,
        uid: entry.uid || null,
        score: entry.score || 0,
        hits: 1,
        signals: new Set(entry.signals || []),
        last: entry.at,
      });
      return;
    }
    current.hits += 1;
    current.score = Math.max(current.score, entry.score || 0);
    current.uid = current.uid || entry.uid || null;
    (entry.signals || []).forEach((signal) => current.signals.add(signal));
    current.last = Math.max(current.last, entry.at);
  });

  return [...byIp.values()]
    .map((suspect) => ({ ...suspect, signals: [...suspect.signals] }))
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

/**
 * Belirli bir oturumun (uid ya da IP) son pencerede topladığı risk.
 * Çark ödülü kısma kararı ve güvenlik ekranı bu puanı kullanır.
 * @param uid kullanıcı id (opsiyonel)
 * @param ip IP adresi (opsiyonel)
 * @param windowMs ne kadar geriye bakılacak
 * @return { score, signals, hits, last }
 */
export function riskOf({ uid = null, ip = null, windowMs = 30 * 60 * 1000 } = {}) {
  const now = Date.now();
  let score = 0;
  let hits = 0;
  let last = 0;
  const signals = new Set();
  entries.forEach((entry) => {
    if (now - entry.at > windowMs) return;
    const matches = (uid !== null && entry.uid === uid)
      || (ip !== null && entry.ip === ip);
    if (!matches) return;
    hits += 1;
    score = Math.max(score, entry.score || 0);
    last = Math.max(last, entry.at);
    (entry.signals || []).forEach((signal) => signals.add(signal));
  });
  return { score, signals: [...signals], hits, last };
}

export function stats() {
  return {
    entries: entries.length,
    ips: ipCounters.size,
    top: getTopSuspects(3).map((suspect) => ({ ip: suspect.ip, score: suspect.score })),
  };
}

export function clearAll() {
  entries.length = 0;
  ipCounters.clear();
}

export default {
  accept, onReport, getRecent, getTopSuspects, riskOf, stats, clearAll,
};
