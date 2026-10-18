/**
 * pgPulse — PixelGlobe "Nabız" veri katmanı.
 * =========================================
 * Tek kaynak sunucudur:
 *   GET  /api/market          GCoin + günün görevleri (mevcut market altyapısı)
 *   POST /api/market/claim    görev ödülünü al (GCoin, sunucu doğrular)
 *   GET  /api/pulse           seviye (ömür boyu pixel) + seri + bugünkü özet
 *   POST /api/pulse/heartbeat günü işaretle (seri, kilometre taşı bonusu)
 *   GET  /api/pulse/activity  son 7 günün grafiği + "Bugünün Başarısı"
 *   GET  /api/pulse/board     günün ilk 5'i
 *
 * Giriş yapılmamışsa ya da sunucu yanıt vermiyorsa modül "yerel" moda düşer:
 * son bilinen sunucu değerleri (önbellek) gösterilir, oyuncuya "giriş yap"
 * notu çıkar, grafik yerel günlükten çizilir. Yani arayüz asla boş kalmaz ama
 * sahte ödül de vermez.
 *
 * Seviye/grafik/rekor hesapları utils/pulseMath.js'ten gelir; orası aynı
 * zamanda sunucu tarafından da kullanılır (tek kaynak).
 */

import { pgT, pgLang } from './pgI18n.js';
import {
  LEVEL_STEPS, summarizeActivity, computeRecord, dayKey, weekdayIndex,
  WEEKDAY_KEYS, ACTIVITY_DAYS, RECORD_MIN_DELTA, levelFromPixels as levelFromPixelsShared,
  lastDayKeys,
} from './pulseMath.js';

export { LEVEL_STEPS, ACTIVITY_DAYS, RECORD_MIN_DELTA };

const CACHE_KEY = 'pgx_pulse_v1';
const DAILY_KEY = 'pgx_pulse_daily_v1';
const DAILY_KEEP = 45;
const HEARTBEAT_MIN_MS = 5 * 60 * 1000;
const POLL_MS = 60 * 1000;
const MAX_LOCAL_MINUTES = 24 * 60;
const SANE = {
  pixels: 100000000, minutes: MAX_LOCAL_MINUTES, coins: 10000000,
};

function blankActivity() {
  return {
    days: [],
    week: {
      total: 0, average: 0, max: 0, best: null, activeDays: 0,
    },
    record: {
      today: 0,
      previousBest: 0,
      previousBestDay: null,
      delta: 0,
      isRecord: false,
      toGo: 0,
      isFirstDay: true,
      ratio: 0,
    },
    bonus: { awarded: false, coins: 0 },
    local: true,
    loadedAt: null,
  };
}

function blankState() {
  return {
    mode: 'local',
    ready: false,
    loading: false,
    error: null,
    savedAt: null,
    coins: 0,
    goals: [],
    level: {
      level: 1, ratio: 0, next: LEVEL_STEPS[1], totalPixels: 0, title: pgT('level.1'),
    },
    streak: {
      streak: 0, best: 0, freezeCount: 0, totalDays: 0, todayTouched: false,
    },
    today: { pixels: 0, rank: 0 },
    total: { pixels: 0, rank: 0 },
    board: null,
    boardLoading: false,
    activity: blankActivity(),
    activityLoading: false,
    stats: {
      todayPixels: 0, sessionMinutes: 0, chaosPixels: 0, combo: 0,
    },
  };
}

let state = blankState();
let hydrated = false;
let storeGetter = null;
let integritySink = null;
let heartbeatAt = 0;
let pollTimer = null;
let listeners = new Set();
let lastLevel = 1;
let lastCompleted = new Set();
let lastRecordKey = null;
let localDays = {}; // { 'YYYY-MM-DD': pixels }

/* ------------------------------------------------------------- plumbing */

function emit(event = { type: 'update' }) {
  listeners.forEach((fn) => {
    try { fn(event, state); } catch { /* dinleyici hatası oyunu bozmaz */ }
  });
}

export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function getState() {
  hydrate();
  return state;
}

export function hydrateState() {
  return hydrate();
}

export function setStoreGetter(fn) {
  storeGetter = typeof fn === 'function' ? fn : null;
}

export function setIntegritySink(fn) {
  integritySink = typeof fn === 'function' ? fn : null;
}

function flagIntegrity(reason) {
  if (integritySink) {
    try { integritySink({ type: 'localTamper', detail: reason }); } catch { /* ignore */ }
  }
}

/* -------------------------------------------------------------- storage */

function readLocalDays() {
  try {
    const raw = localStorage.getItem(DAILY_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    if (!parsed || typeof parsed !== 'object') return {};
    const out = {};
    Object.keys(parsed).forEach((key) => {
      const value = Number(parsed[key]);
      if (/^\d{4}-\d{2}-\d{2}$/.test(key) && Number.isFinite(value) && value >= 0) {
        out[key] = Math.min(value, SANE.pixels);
      }
    });
    return out;
  } catch {
    return {};
  }
}

function writeLocalDays() {
  try {
    const keys = Object.keys(localDays).sort();
    if (keys.length > DAILY_KEEP) {
      const trim = keys.slice(-DAILY_KEEP);
      const next = {};
      trim.forEach((key) => { next[key] = localDays[key]; });
      localDays = next;
    }
    localStorage.setItem(DAILY_KEY, JSON.stringify(localDays));
  } catch {
    /* ignore */
  }
}

function localActivity(today = dayKey()) {
  const summary = summarizeActivity(localDays, today, ACTIVITY_DAYS);
  const record = computeRecord(localDays, today);
  return {
    ...blankActivity(),
    days: summary.days,
    week: {
      total: summary.total,
      average: summary.average,
      max: summary.max,
      best: summary.best,
      activeDays: summary.activeDays,
    },
    record,
    local: true,
    loadedAt: Date.now(),
  };
}

function hydrate() {
  if (hydrated) return state;
  hydrated = true;
  localDays = readLocalDays();

  let stored = null;
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    stored = raw ? JSON.parse(raw) : null;
  } catch {
    stored = null;
  }

  if (stored && typeof stored === 'object') {
    const merged = { ...blankState(), ...stored };
    merged.mode = 'local';
    merged.loading = false;
    merged.board = null;
    merged.activity = localActivity();

    if (merged.coins > SANE.coins
      || merged.stats.sessionMinutes > SANE.minutes
      || merged.total.pixels > SANE.pixels) {
      flagIntegrity('absurd-values');
      Object.assign(merged, {
        coins: 0,
        stats: { ...merged.stats, sessionMinutes: 0 },
        total: { pixels: 0, rank: 0 },
      });
      merged.level = levelFromPixels(merged.total.pixels, merged.level?.level);
    } else {
      merged.level = levelFromPixels(merged.total.pixels, merged.level?.level);
    }
    state = merged;
    lastLevel = state.level.level;
  } else {
    state.activity = localActivity();
  }

  state.stats.sessionMinutes = 0;
  return state;
}

function persist() {
  try {
    const snapshot = {
      coins: state.coins,
      goals: state.goals,
      level: state.level,
      streak: state.streak,
      today: state.today,
      total: state.total,
      stats: { ...state.stats, sessionMinutes: 0 },
      savedAt: state.savedAt,
    };
    localStorage.setItem(CACHE_KEY, JSON.stringify(snapshot));
  } catch {
    /* ignore */
  }
}

/* ----------------------------------------------------------------- HTTP */

async function api(path, options = {}) {
  try {
    const res = await fetch(path, {
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      ...options,
    });
    if (res.status === 401 || res.status === 403) return { unauthorized: true };
    let data = null;
    try { data = await res.json(); } catch { data = null; }
    if (!res.ok) {
      return { error: (data && data.errors && data.errors[0]) || `HTTP ${res.status}` };
    }
    return { data };
  } catch (err) {
    return { error: err.message || 'network' };
  }
}

/* ----------------------------------------------------------- seviye XP */

export function levelFromPixels(totalPixels, fallbackLevel) {
  const pixels = Math.max(0, Number(totalPixels) || 0);
  const base = levelFromPixelsShared(pixels);
  if (!pixels && fallbackLevel) {
    /* yerel modda önbellekten gelen seviyeyi koru */
    const level = Math.max(1, Math.min(LEVEL_STEPS.length, Math.floor(fallbackLevel)));
    return {
      level,
      ratio: 0,
      next: LEVEL_STEPS[Math.min(level, LEVEL_STEPS.length - 1)],
      totalPixels: 0,
      title: pgT(`level.${level}`),
    };
  }
  return { ...base, title: pgT(`level.${base.level}`) };
}

/* ------------------------------------------------------------- görevler */

export function goalTitle(goal) {
  if (!goal) return pgT('goal.unknown');
  const key = `goal.${goal.id}`;
  const translated = pgT(key);
  if (translated && translated !== key) return translated;
  return goal.name || pgT('goal.unknown');
}

export function goalDescription(goal) {
  if (!goal) return '';
  const translated = pgT(`goal.${goal.id}.d`);
  if (translated && !translated.endsWith('.d')) return translated;
  return goal.description || '';
}

function applyGoals(goals) {
  if (!Array.isArray(goals)) return;
  const previous = new Map(state.goals.map((goal) => [goal.id, goal]));
  state.goals = goals.map((goal) => ({
    id: goal.id,
    name: goal.name,
    description: goal.description,
    target: Number(goal.target) || 1,
    reward: Number(goal.reward) || 0,
    progress: Number(goal.progress) || 0,
    completed: !!goal.completed,
    rewarded: !!goal.rewarded,
  }));

  state.goals.forEach((goal) => {
    const before = previous.get(goal.id);
    const wasDone = before ? before.completed : lastCompleted.has(goal.id);
    if (goal.completed && !wasDone && before) {
      emit({
        type: 'goalDone', goalId: goal.id, title: goalTitle(goal), reward: goal.reward,
      });
    }
    if (goal.completed) lastCompleted.add(goal.id);
    else lastCompleted.delete(goal.id);
  });
}

function applyLevel(level) {
  if (!level) return;
  const next = {
    level: Number(level.level) || 1,
    ratio: Number(level.ratio) || 0,
    next: level.next === null || level.next === undefined ? null : Number(level.next),
    totalPixels: Number(level.totalPixels) || 0,
    title: pgT(`level.${Number(level.level) || 1}`),
  };
  const grew = next.level > lastLevel;
  state.level = next;
  if (grew) {
    lastLevel = next.level;
    emit({
      type: 'levelUp', level: next.level, title: next.title,
    });
  }
}

function storeCoins() {
  if (!storeGetter) return null;
  try {
    const store = storeGetter();
    const coins = store && store.profile ? store.profile.coins : null;
    return typeof coins === 'number' ? coins : null;
  } catch {
    return null;
  }
}

/* ----------------------------------------------------------- yüklemeler */

/**
 * Sunucudan market (GCoin + görevler) ve nabız (seviye/seri) verisi çeker.
 */
export async function load({ silent = false } = {}) {
  hydrate();
  if (!silent) {
    state.loading = true;
    state.error = null;
    emit({ type: 'loading' });
  }

  const [market, pulse] = await Promise.all([
    api('/api/market'),
    api('/api/pulse'),
  ]);

  if (market.unauthorized || pulse.unauthorized) {
    state.mode = 'local';
    state.loading = false;
    state.ready = true;
    state.error = null;
    state.activity = localActivity();
    emit({ type: 'mode', mode: 'local' });
    return state;
  }

  const failed = market.error || pulse.error;
  if (!pulse.data && !market.data) {
    state.loading = false;
    state.ready = true;
    state.error = failed || 'network';
    if (!state.activity.days.length) state.activity = localActivity();
    emit({ type: 'error', error: state.error });
    return state;
  }

  state.mode = 'server';
  state.ready = true;
  state.loading = false;
  state.error = null;

  if (market.data) {
    if (typeof market.data.coins === 'number') state.coins = market.data.coins;
    applyGoals(market.data.goals);
  }
  const liveCoins = storeCoins();
  if (liveCoins !== null) state.coins = liveCoins;

  if (pulse.data) {
    applyLevel(pulse.data.level);
    if (pulse.data.streak) state.streak = { ...state.streak, ...pulse.data.streak };
    if (pulse.data.today) state.today = { ...state.today, ...pulse.data.today };
    if (pulse.data.total) state.total = { ...state.total, ...pulse.data.total };
  }

  state.savedAt = Date.now();
  persist();
  emit({ type: 'update' });
  return state;
}

export async function refresh() {
  return load({ silent: true });
}

/**
 * Günde bir kez etki eden seri işareti. Sekme görünürken periyodik çağrılır.
 */
export async function heartbeat({ force = false } = {}) {
  hydrate();
  const now = Date.now();
  if (!force && now - heartbeatAt < HEARTBEAT_MIN_MS) return null;
  if (typeof document !== 'undefined' && document.visibilityState === 'hidden' && !force) return null;
  heartbeatAt = now;

  const { data, error, unauthorized } = await api('/api/pulse/heartbeat', { method: 'POST' });
  if (unauthorized) {
    state.mode = 'local';
    emit({ type: 'mode', mode: 'local' });
    return null;
  }
  if (error || !data) return null;

  const before = state.streak.streak;
  const coinsBefore = state.coins;
  if (data.streak) state.streak = { ...state.streak, ...data.streak };
  if (typeof data.coins === 'number') state.coins = data.coins;
  const liveCoins = storeCoins();
  if (liveCoins !== null) state.coins = liveCoins;

  if (data.freezeUsed) emit({ type: 'freezeUsed' });
  if (data.milestone) {
    emit({
      type: 'streak',
      count: state.streak.streak,
      milestone: data.milestone,
      coins: data.coinsAwarded || 0,
    });
  } else if (!data.alreadyToday && state.streak.streak > before) {
    emit({ type: 'streak', count: state.streak.streak });
  }
  if (state.coins !== coinsBefore) emit({ type: 'coins', coins: state.coins });

  persist();
  emit({ type: 'update' });
  return data;
}

/* ------------------------------------------------- aktivite + rekor */

/**
 * Son 7 günün grafiğini ve günün rekorunu yükler.
 * Giriş yoksa yerel günlükten (localStorage) çizer.
 */
export async function loadActivity({ silent = false } = {}) {
  hydrate();
  if (!silent) {
    state.activityLoading = true;
    emit({ type: 'update' });
  }

  const { data, error, unauthorized } = await api('/api/pulse/activity');
  state.activityLoading = false;

  if (unauthorized || error || !data) {
    state.mode = unauthorized ? 'local' : state.mode;
    state.activity = localActivity();
    emit({ type: 'update' });
    return state.activity;
  }

  const today = dayKey();
  const summary = summarizeActivity(data.days || [], today, ACTIVITY_DAYS);
  const record = data.record || computeRecord(data.days || [], today);

  state.activity = {
    days: summary.days,
    week: {
      total: data.week ? data.week.total : summary.total,
      average: data.week ? data.week.average : summary.average,
      max: data.week ? data.week.max : summary.max,
      best: data.week ? data.week.best : summary.best,
      activeDays: data.week ? data.week.activeDays : summary.activeDays,
    },
    record: {
      today: Number(record.today) || 0,
      previousBest: Number(record.previousBest) || 0,
      previousBestDay: record.previousBestDay || null,
      delta: Number(record.delta) || 0,
      isRecord: !!record.isRecord,
      toGo: Number(record.toGo) || 0,
      isFirstDay: !!record.isFirstDay,
      ratio: Number(record.ratio) || 0,
    },
    bonus: data.bonus || { awarded: false, coins: 0 },
    local: false,
    loadedAt: Date.now(),
  };

  /* bugünün satırı önbellekte de güncel kalsın (yerel moda düşülürse) */
  if (state.activity.record.today > (localDays[today] || 0)) {
    localDays[today] = state.activity.record.today;
    writeLocalDays();
  }

  /* yeni rekor kutlaması: aynı gün iki kez bildirim çıkmasın */
  if (state.activity.record.isRecord && lastRecordKey !== today) {
    lastRecordKey = today;
    emit({
      type: 'record',
      today: state.activity.record.today,
      previousBest: state.activity.record.previousBest,
      delta: state.activity.record.delta,
      bonus: state.activity.bonus,
    });
  }

  emit({ type: 'update' });
  return state.activity;
}

/**
 * Günlük görev ödülünü alır.
 */
export async function claimGoal(goalId) {
  hydrate();
  const goal = state.goals.find((entry) => entry.id === goalId);
  const { data, error, unauthorized } = await api('/api/market/claim', {
    method: 'POST',
    body: JSON.stringify({ goalId }),
  });

  if (unauthorized) {
    state.mode = 'local';
    emit({ type: 'mode', mode: 'local' });
    return { success: false, error: pgT('pulse.localMode') };
  }
  if (error || !data) {
    emit({ type: 'error', error });
    return { success: false, error };
  }

  if (typeof data.newBalance === 'number') state.coins = data.newBalance;
  state.goals = state.goals.map((entry) => (
    entry.id === goalId ? { ...entry, rewarded: true } : entry
  ));

  persist();
  emit({
    type: 'claimed',
    goalId,
    title: goalTitle(goal),
    coins: data.coinsAwarded || 0,
  });
  emit({ type: 'update' });
  return { success: true, coinsAwarded: data.coinsAwarded || 0, newBalance: data.newBalance };
}

export async function loadBoard() {
  hydrate();
  if (state.boardLoading) return state.board;
  state.boardLoading = true;
  emit({ type: 'update' });
  const { data } = await api('/api/pulse/board');
  state.boardLoading = false;
  if (data) state.board = data;
  emit({ type: 'update' });
  return state.board;
}

/* --------------------------------------------------------- yerel sayılar */

/** Oyuncu pixel koyduğunda çağrılır (yerel istatistik + günlük geçmiş). */
export function notePlacement({ count = 1, chaos = false } = {}) {
  hydrate();
  const today = dayKey();
  state.stats.todayPixels += count;
  if (chaos) state.stats.chaosPixels += count;

  localDays[today] = Math.min(SANE.pixels, (localDays[today] || 0) + count);
  writeLocalDays();

  if (state.mode === 'local') {
    state.today.pixels += count;
    if (state.streak.streak === 0) state.streak.streak = 1;
    state.activity = localActivity(today);
    state.activityLoading = false;

    /* giriş yapmamış oyuncu da rekorunu kutlasın (günde bir kez) */
    const rec = state.activity.record;
    if (rec.isRecord && lastRecordKey !== today) {
      lastRecordKey = today;
      emit({
        type: 'record',
        today: rec.today,
        previousBest: rec.previousBest,
        delta: rec.delta,
        bonus: { awarded: false, coins: 0 },
        local: true,
      });
    }
  }
  emit({ type: 'update' });
}

/** Mini oturum sayacı (dakika). */
export function noteSessionMinute() {
  hydrate();
  state.stats.sessionMinutes = Math.min(MAX_LOCAL_MINUTES, state.stats.sessionMinutes + 1);
  emit({ type: 'update' });
}

/** Store'dan gelen toplam pixel bilgisi (yerel modda seviye tahmini için). */
export function noteTotals({ total, daily } = {}) {
  hydrate();
  const totalPixels = Number(total);
  const dailyPixels = Number(daily);
  const today = dayKey();

  if (Number.isFinite(dailyPixels) && dailyPixels >= 0 && dailyPixels > (localDays[today] || 0)) {
    localDays[today] = Math.min(SANE.pixels, dailyPixels);
    writeLocalDays();
  }

  if (state.mode === 'local') {
    if (Number.isFinite(totalPixels) && totalPixels >= 0) {
      state.total.pixels = totalPixels;
      state.level = levelFromPixels(totalPixels);
    }
    if (Number.isFinite(dailyPixels) && dailyPixels >= 0 && dailyPixels > state.today.pixels) {
      state.today.pixels = dailyPixels;
    }
    state.activity = localActivity(today);
  }
  emit({ type: 'update' });
}

/* ------------------------------------------------------------- döngüler */

/** Sekme görünürken dakikada bir hafif yenileme + 5 dakikada bir seri işareti. */
export function startPolling() {
  hydrate();
  if (pollTimer) return () => {};
  pollTimer = window.setInterval(() => {
    if (document.visibilityState !== 'visible') return;
    refresh();
    heartbeat();
  }, POLL_MS);
  return () => {
    window.clearInterval(pollTimer);
    pollTimer = null;
  };
}

export function stopPolling() {
  if (pollTimer) {
    window.clearInterval(pollTimer);
    pollTimer = null;
  }
}

/* ---------------------------------------------------------- biçimlendirme */

/**
 * 82678 -> "82.678" (TR) / "82,678" (EN)
 */
export function formatNumber(value) {
  const number = Math.round(Number(value) || 0);
  const locale = pgLang() === 'en' ? 'en-US' : 'tr-TR';
  try {
    if (typeof Intl !== 'undefined' && Intl.NumberFormat) {
      return new Intl.NumberFormat(locale).format(number);
    }
  } catch {
    /* Intl yok: elle gruplama */
  }
  const sign = number < 0 ? '-' : '';
  const digits = String(Math.abs(number));
  const grouped = digits.replace(/\B(?=(\d{3})+(?!\d))/g, pgLang() === 'en' ? ',' : '.');
  return sign + grouped;
}

/**
 * 12400 -> "12,4B" (TR) / "12.4K" (EN) — grafik etiketleri için kısa biçim.
 */
export function formatCompact(value) {
  const number = Math.max(0, Math.round(Number(value) || 0));
  const locale = pgLang() === 'en' ? 'en-US' : 'tr-TR';
  try {
    if (typeof Intl !== 'undefined' && Intl.NumberFormat) {
      return new Intl.NumberFormat(locale, {
        notation: 'compact',
        maximumFractionDigits: 1,
      }).format(number);
    }
  } catch {
    /* Intl compact desteklenmiyor: elle kısalt */
  }
  if (number < 1000) return String(number);
  if (number < 1000000) return `${Math.round(number / 100) / 10}B`;
  return `${Math.round(number / 100000) / 10}M`;
}

/**
 * '2026-09-21' -> 'Pzt' (dile göre)
 */
export function weekdayLabel(key) {
  const index = weekdayIndex(key);
  return pgT(WEEKDAY_KEYS[index] || 'day.mon');
}

/**
 * Grafik için son 7 günün listesi (yerel modda da aynı şekil).
 */
export function chartDays(days = ACTIVITY_DAYS) {
  const today = dayKey();
  const keys = lastDayKeys(today, days);
  const map = new Map((state.activity.days || []).map((day) => [day.key, day]));
  return keys.map((key) => {
    const found = map.get(key);
    return {
      key,
      pixels: found ? found.pixels : 0,
      isToday: key === today,
      isBest: found ? !!found.isBest : false,
    };
  });
}

/* ---------------------------------------------------------- test kancası */

export function __setStateForTests(patch = {}) {
  hydrated = true;
  state = { ...state, ...patch };
  return state;
}

export function __resetForTests() {
  hydrated = false; // sonraki çağrı önbelleği yeniden okur
  state = blankState();
  localDays = {};
  lastLevel = 1;
  lastCompleted = new Set();
  lastRecordKey = null;
  heartbeatAt = 0;
  storeGetter = null;
  integritySink = null;
  listeners = new Set();
  stopPolling();
  return state;
}

export function __getLocalDays() {
  return { ...localDays };
}

export function msUntilReset(now = new Date()) {
  const end = new Date(now.getTime());
  end.setHours(24, 0, 0, 0);
  return Math.max(0, end.getTime() - now.getTime());
}

export function resetCountdown(now = new Date()) {
  const total = Math.floor(msUntilReset(now) / 1000);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  if (hours > 0) return `${hours} sa ${minutes} dk`;
  return `${minutes} dk ${total % 60} sn`;
}

export default {
  subscribe,
  getState,
  hydrateState,
  load,
  refresh,
  heartbeat,
  loadActivity,
  claimGoal,
  loadBoard,
  notePlacement,
  noteSessionMinute,
  noteTotals,
  startPolling,
  stopPolling,
  setStoreGetter,
  setIntegritySink,
  goalTitle,
  goalDescription,
  levelFromPixels,
  resetCountdown,
  formatNumber,
  formatCompact,
  weekdayLabel,
  chartDays,
};
