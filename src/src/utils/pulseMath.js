/**
 * pulseMath — Nabız sisteminin saf (yan etkisiz) hesapları.
 * ==========================================================
 * Hem istemci (utils/pgPulse.js, PulsePanel) hem sunucu
 * (data/sql/Pulse.js, routes/api/pulse.js) bu dosyayı kullanır.
 * Böylece seviye eşikleri, seri kilometre taşları ve "günün rekoru"
 * mantığı TEK yerde durur; iki tarafta ayrı ayrı güncellenmez.
 *
 * DB/redis/ağ bağımlılığı yoktur; saf fonksiyonlar içerir.
 */

/* seviye eşikleri: ömür boyu yerleştirilen pixel sayısı */
export const LEVEL_STEPS = [0, 500, 2500, 10000, 25000, 60000];

/* seri kilometre taşları: her birinde ekstra GCoin */
export const STREAK_MILESTONES = [3, 7, 14, 30, 60, 100];

/* en fazla kaç seri dondurucu biriktirilebilir */
export const FREEZE_CAP = 2;

/* grafikte gösterilen gün sayısı */
export const ACTIVITY_DAYS = 7;

/*
 * "Bugünün Başarısı" eşikleri.
 * RECORD_MIN_DELTA: yeni rekor sayılması için önceki rekordan en az bu kadar
 * fazla pixel gerekir (2 pixel ile "rekor" kutlamayalım).
 * RECORD_BONUS_COINS: günde bir kez, rekor kırıldığında verilen GCoin.
 */
export const RECORD_MIN_DELTA = 250;
export const RECORD_BONUS_COINS = 60;

/* getDay() sırası: 0 = Pazar */
export const WEEKDAY_KEYS = [
  'day.sun', 'day.mon', 'day.tue', 'day.wed', 'day.thu', 'day.fri', 'day.sat',
];

/* ------------------------------------------------------------- tarihler */

/**
 * Yerel güne göre YYYY-MM-DD anahtarı (UTC kaydırması yapmaz).
 */
export function dayKey(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * Bir gün anahtarını ileri/geri kaydırır.
 */
export function shiftDayKey(key, deltaDays) {
  const [year, month, day] = String(key || '').split('-').map(Number);
  const date = new Date(Date.UTC(year || 1970, (month || 1) - 1, day || 1));
  date.setUTCDate(date.getUTCDate() + Number(deltaDays || 0));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`;
}

/**
 * 0 = Pazar ... 6 = Cumartesi (getDay ile aynı sıra).
 */
export function weekdayIndex(key) {
  const [year, month, day] = String(key || '').split('-').map(Number);
  const date = new Date(Date.UTC(year || 1970, (month || 1) - 1, day || 1));
  return date.getUTCDay();
}

/**
 * Bitiş günü dahil olmak üzere son N günün anahtarlarını eskiden yeniye verir.
 */
export function lastDayKeys(endKey, days = ACTIVITY_DAYS) {
  const out = [];
  const count = Math.max(1, Math.floor(days));
  for (let i = count - 1; i >= 0; i -= 1) {
    out.push(shiftDayKey(endKey, -i));
  }
  return out;
}

/* --------------------------------------------------------------- seviye */

/**
 * Ömür boyu pixel sayısından seviye hesabı.
 * @return { level, totalPixels, current, next, ratio }
 */
export function levelFromPixels(totalPixels) {
  const pixels = Math.max(0, Number(totalPixels) || 0);
  let index = 0;
  for (let i = 0; i < LEVEL_STEPS.length; i += 1) {
    if (pixels >= LEVEL_STEPS[i]) index = i;
  }
  const current = LEVEL_STEPS[index];
  const next = LEVEL_STEPS[index + 1] === undefined ? null : LEVEL_STEPS[index + 1];
  const ratio = next === null
    ? 1
    : Math.max(0, Math.min(1, (pixels - current) / (next - current)));
  return {
    level: index + 1, totalPixels: pixels, current, next, ratio,
  };
}

/* -------------------------------------------------------------- grafik */

function normalizeRows(rows) {
  const map = new Map();
  if (!rows) return map;
  if (Array.isArray(rows)) {
    rows.forEach((row) => {
      if (!row) return;
      const key = row.day || row.date || row.key;
      if (!key) return;
      map.set(String(key).slice(0, 10), Math.max(0, Number(row.pixels ?? row.value ?? 0) || 0));
    });
    return map;
  }
  if (typeof rows === 'object') {
    Object.keys(rows).forEach((key) => {
      map.set(String(key).slice(0, 10), Math.max(0, Number(rows[key]) || 0));
    });
  }
  return map;
}

/**
 * Son N günün aktivitesini grafik için hazırlar.
 * @param rows [{day, pixels}] | { 'YYYY-MM-DD': pixels }
 * @param endKey bitiş günü (varsayılan: bugün)
 * @return {
 *   days: [{ key, pixels, isToday, isBest }],
 *   total, average, max, best: { key, pixels } | null, activeDays
 * }
 */
export function summarizeActivity(rows, endKey = dayKey(), days = ACTIVITY_DAYS) {
  const map = normalizeRows(rows);
  const keys = lastDayKeys(endKey, days);
  let total = 0;
  let max = 0;
  let best = null;

  const list = keys.map((key) => {
    const pixels = map.get(key) || 0;
    total += pixels;
    if (pixels > max) {
      max = pixels;
      best = { key, pixels };
    }
    return {
      key,
      pixels,
      isToday: key === endKey,
      isBest: false,
    };
  });

  /* en iyi günü işaretle: birden fazla eşitlikte en yenisi seçilir */
  if (best && best.pixels > 0) {
    for (let i = list.length - 1; i >= 0; i -= 1) {
      if (list[i].pixels === best.pixels) {
        list[i].isBest = true;
        break;
      }
    }
  }

  const activeDays = list.filter((day) => day.pixels > 0).length;
  return {
    days: list,
    total,
    average: list.length ? Math.round(total / list.length) : 0,
    max,
    best: best && best.pixels > 0 ? best : null,
    activeDays,
  };
}

/* ------------------------------------------------------- günün rekoru */

/**
 * "Bugünün Başarısı": bugünün pixel sayısını önceki en iyi günle karşılaştırır.
 * Kıyaslama yalnızca BUGÜNDEN ÖNCEKİ günlerle yapılır (bugün kendisiyle
 * yarışmasın).
 *
 * @param rows [{day, pixels}] | { 'YYYY-MM-DD': pixels } (bugün dahil olabilir)
 * @param todayKey bugünün anahtarı
 * @param options { minDelta }
 * @return {
 *   today, previousBest, previousBestDay, delta, isRecord, toGo,
 *   isFirstDay, ratio, bonusEligible
 * }
 */
export function computeRecord(rows, todayKey = dayKey(), options = {}) {
  const minDelta = Number.isFinite(options.minDelta) ? options.minDelta : RECORD_MIN_DELTA;
  const map = normalizeRows(rows);
  const today = map.get(todayKey) || 0;

  let previousBest = 0;
  let previousBestDay = null;
  map.forEach((pixels, key) => {
    if (key >= todayKey) return; // bugün ve gelecek günler hariç
    if (pixels > previousBest) {
      previousBest = pixels;
      previousBestDay = key;
    }
  });

  const isFirstDay = previousBest <= 0;
  const delta = today - previousBest;
  const isRecord = !isFirstDay && delta >= minDelta;
  const ratio = isFirstDay
    ? (today > 0 ? 1 : 0)
    : Math.max(0, Math.min(1, previousBest > 0 ? today / previousBest : 0));

  return {
    today,
    previousBest,
    previousBestDay,
    delta,
    isRecord,
    /* rekora ne kadar kaldı */
    toGo: Math.max(0, previousBest - today),
    isFirstDay,
    ratio,
    bonusEligible: isRecord,
  };
}

export default {
  LEVEL_STEPS,
  STREAK_MILESTONES,
  FREEZE_CAP,
  ACTIVITY_DAYS,
  RECORD_MIN_DELTA,
  RECORD_BONUS_COINS,
  WEEKDAY_KEYS,
  dayKey,
  shiftDayKey,
  weekdayIndex,
  lastDayKeys,
  levelFromPixels,
  summarizeActivity,
  computeRecord,
};
