/**
 * PixelGlobe Guardian — client side anti-automation and integrity guard.
 * ======================================================================
 * The guardian watches how pixels, clicks and requests are produced and adds a
 * risk score when something looks machine made. It is deliberately written to
 * *fail open*: a normal player can never be blocked by it, it only produces
 * signals, a local log and (optionally) a report to the server.
 *
 * Signals
 *   wsTamper        WebSocket.prototype.send replaced  -> injection framework
 *                   (tek başına uyarı eşiğini geçmez, tekrarlanırsa ağırlaşır)
 *   nativeTamper    XHR prototipi değiştirilmiş (ağ katmanına enjeksiyon)
 *   automation      navigator.webdriver / CDP / headless artifacts
 *   rhythm          machine-regular placement intervals (coefficient of variation)
 *   untrusted       synthetic (script generated) pointer events
 *   teleport        impossible cursor jumps while painting
 *   cooldownSpam    many click attempts while the cooldown is active
 *   tabs            çok sayıda açık PixelGlobe sekmesi (BroadcastChannel sayacı)
 *   localTamper     the local mission/coin signature does not verify
 *   honeypot        a hidden link only a crawler would follow was clicked
 *
 * Modes
 *   'log'     (default) observe, show a warning toast, keep the player playing
 *   'enforce' only shadow-drop the placements from an already flagged session
 *             and expose `requestCaptcha()` so the server side can ask for one
 *   'off'     nothing at all
 *
 * False positive protection (v2)
 *   - Harita kaydirma / zoom (holdPaint kapali) tiklama olarak SAYILMAZ:
 *     hem ritim hem teleport olcumleri bu sirasiz durur.
 *   - Kaos etkinliginde ritim olcumu kapanir (kaos spam'i normaldir).
 *   - Uyari bildirimi en fazla 2 dakikada bir cikar ve oyuncuya "engellenmiyorsun"
 *     diye acikca soyler.
 *
 * Blocking screen (v2)
 *   VPN / proxy / Tor / datacenter IP ve bot karari sunucudan gelir
 *   (GET /api/security/verdict). Karar geldiginde `setVerdict()` cagirilir ve
 *   tema tam ekran, KAPATILAMAZ uyari ekranini gosterir; ekran yalnizca
 *   sayfa yenilenerek temizlenir.
 *
 * Everything stays in memory plus a bounded localStorage ring (max 40 entries),
 * no personal data, no page content, no keystrokes.
 */

const LOG_KEY = 'pgx_guard_log_v1';
const LOG_MAX = 40;
const SIGNAL_MAX = 32;
const REPORT_COOLDOWN = 30000;
/* ayni tur uyari bildirimi en fazla bu kadar sik cikar */
const WARN_COOLDOWN = 120000;
/* ritim olcumu icin gereken en az yerlesim sayisi (v1: 10 -> cok hassasti) */
const RHYTHM_MIN_SAMPLES = 14;
/* insan eli bundan daha duzenli olamaz; altindaki cv bot ritmi sayilir */
const RHYTHM_CV = 0.10;
const HONEYPOT_ID = 'pg-honeypot';

/* weights are tuned so a single false positive never crosses the warn line */
const WEIGHTS = {
  wsTamper: 30,
  nativeTamper: 40,
  automation: 45,
  rhythm: 35,
  untrusted: 10,
  teleport: 20,
  cooldownSpam: 15,
  tabs: 15,
  localTamper: 30,
  honeypot: 50,
  reportFlood: 20,
};

export const WARN_SCORE = 45;
export const BLOCK_SCORE = 90;

let hydrated = false;
let mode = 'log';
let reportUrl = '/api/security/report';
let enabled = true;
let score = 0;
let lastReportAt = 0;
let lastReportedScore = 0;
let tabCount = 1;
let storeGetter = null;
let channel = null;
let tabTimer = null;
let installed = false;
const tabId = Math.random().toString(36).slice(2);

const signals = new Map(); // type -> { count, first, last, detail }
const listeners = new Set();
const tabSeen = new Map();
let reportQueue = [];
let cooldownAttempts = [];
let placementTimes = [];
let teleportHits = [];
let reportInFlight = false;
/* yeni durum (v2): kaos / gezinme / karar (verdict) */
let chaosActive = false;
let navigating = false;
let verdict = null;
let verdictDetail = null;
let verdictAt = 0;
let lastWarnAt = 0;
let warnCount = 0;

/* ------------------------------------------------------------ utilities */

function nowIso() {
  return new Date().toISOString();
}

function log() {
  // eslint-disable-next-line no-console
  if (mode !== 'off') console.debug('[guardian]', ...arguments);
}

function emit(event) {
  listeners.forEach((fn) => {
    try { fn(event, getStatus()); } catch { /* ignore */ }
  });
}

export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function boundedPush(list, value, max) {
  list.push(value);
  if (list.length > max) list.splice(0, list.length - max);
  return list;
}

/* -------------------------------------------------------------- storage */

function hydrate() {
  if (hydrated) return;
  hydrated = true;
  try {
    const raw = localStorage.getItem(LOG_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    if (parsed && Array.isArray(parsed.entries)) {
      parsed.entries.slice(-LOG_MAX).forEach((entry) => {
        if (entry && entry.type) report(entry.type, entry.detail, { silent: true, ts: entry.ts });
      });
    }
  } catch {
    /* storage disabled */
  }
}

function persistEntry(entry) {
  try {
    const raw = localStorage.getItem(LOG_KEY);
    const parsed = raw ? JSON.parse(raw) : { entries: [] };
    const entries = Array.isArray(parsed.entries) ? parsed.entries : [];
    boundedPush(entries, entry, LOG_MAX);
    localStorage.setItem(LOG_KEY, JSON.stringify({ entries, updatedAt: Date.now() }));
  } catch {
    /* ignore */
  }
}

/* ---------------------------------------------------------------- config */

export function init(options = {}) {
  hydrate();
  if (typeof options.mode === 'string') mode = options.mode;
  if (typeof options.reportUrl === 'string') reportUrl = options.reportUrl;
  if (typeof options.enabled === 'boolean') enabled = options.enabled;
  if (typeof options.getStore === 'function') storeGetter = options.getStore;

  /* tekrar cagrilirsa ortam kontrolleri ikinci kez kurulmaz */
  if (!installed) {
    installed = true;
    installEnvironmentChecks();
    installHoneypot();
  }
  startTabHeartbeat();
  return getStatus();
}

export function setMode(next) {
  mode = ['off', 'log', 'enforce'].includes(next) ? next : 'log';
  emit({ type: 'mode', mode });
  return mode;
}

export function setEnabled(next) {
  enabled = Boolean(next);
  emit({ type: 'enabled', enabled });
  return enabled;
}

/* ------------------------------------------------------------- reporting */

export function report(type, detail, options = {}) {
  if (!enabled && !options.force) return null;
  const weight = options.weight !== undefined ? options.weight : (WEIGHTS[type] || 5);
  const existing = signals.get(type);
  if (existing) {
    existing.count += 1;
    existing.last = Date.now();
    if (detail) existing.detail = detail;
    // repeated hits count, but with diminishing weight so a noisy extension
    // cannot push a player over the line on its own
    if (existing.count <= 5) score += weight <= 10 ? 2 : 5;
  } else {
    signals.set(type, {
      count: 1, first: Date.now(), last: Date.now(), detail: detail || null,
    });
    score += weight;
  }

  const entry = { type, detail: detail || null, ts: nowIso() };
  if (!options.silent) {
    persistEntry(entry);
    log('signal', type, detail || '', 'score', score);
    emit({ type: 'signal', signal: type, detail, score });
    if (score >= WARN_SCORE) emitWarn();
  }
  maybeSendReport();
  return score;
}

function reportPayload() {
  const list = [];
  signals.forEach((value, key) => {
    list.push({
      type: key, count: value.count, first: value.first, last: value.last, detail: value.detail,
    });
  });
  return {
    score,
    mode,
    tabCount,
    signals: list.slice(0, SIGNAL_MAX),
    build: (typeof window !== 'undefined' && window.pixelglobe && window.pixelglobe.version) || 'unknown',
    ts: nowIso(),
  };
}

function maybeSendReport() {
  if (!reportUrl || mode === 'off' || score < WARN_SCORE) return;
  const now = Date.now();
  if (reportInFlight || now - lastReportAt < REPORT_COOLDOWN) return;
  if (Math.abs(score - lastReportedScore) < 10) return;
  lastReportAt = now;
  lastReportedScore = score;
  reportInFlight = true;
  const payload = reportPayload();
  try {
    fetch(reportUrl, {
      method: 'POST',
      credentials: 'include',
      keepalive: true,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }).catch(() => {}).finally(() => {
      reportInFlight = false;
    });
  } catch {
    reportInFlight = false;
  }
  emit({ type: 'reported', score });
}

export function reportNow() {
  lastReportAt = 0;
  lastReportedScore = -1;
  maybeSendReport();
  return getStatus();
}

/* ---------------------------------------------------- environment checks */

function isNative(fn) {
  if (typeof fn !== 'function') return true; // missing is not tampering
  try {
    return /\[native code\]/.test(Function.prototype.toString.call(fn));
  } catch {
    return false;
  }
}

/*
 * Bazı ortamlarda (polyfill, eski WebView, jsdom) WebSocket/XHR prototipleri
 * JS ile yazılmış olur ve "native" görünmez. O durumda yanlış pozitif üretmek
 * yerine kontrol kapatılabilir: window.pixelglobe.guardNativeCheck = () => true
 */
let nativeCheck = isNative;

export function setNativeCheck(fn) {
  nativeCheck = typeof fn === 'function' ? fn : isNative;
}

function installEnvironmentChecks() {
  if (typeof window === 'undefined') return;

  /*
   * Sadece oyunun kendi ağ katmanına bakılır. fetch/addEventListener gibi
   * fonksiyonları birçok reklam engelleyici ve eklenti kendisi de sarar;
   * onları suç saymak masum oyuncuyu yakalar. Bu yüzden kapsam dardır:
   * soket prototipleri (en yaygın bot/kanca imzası) ve XHR.
   */
  try {
    if (window.WebSocket && !nativeCheck(window.WebSocket.prototype.send)) {
      report('wsTamper', 'WebSocket.prototype.send');
    }
    if (window.WebSocket && !nativeCheck(window.WebSocket.prototype.close)) {
      report('wsTamper', 'WebSocket.prototype.close');
    }
  } catch { /* ignore */ }

  try {
    if (window.XMLHttpRequest && !nativeCheck(window.XMLHttpRequest.prototype.open)) {
      report('nativeTamper', 'XMLHttpRequest.prototype.open', { weight: 15 });
    }
  } catch { /* ignore */ }

  const flags = [];
  try {
    if (navigator.webdriver) flags.push('navigator.webdriver');
    if (/(HeadlessChrome|PhantomJS|SlimerJS|Electron\/)/i.test(navigator.userAgent || '')) flags.push('headless-ua');
    if (!navigator.languages || navigator.languages.length === 0) flags.push('no-languages');
    if (typeof window.__nightmare !== 'undefined') flags.push('__nightmare');
    if (typeof window.__puppeteer !== 'undefined') flags.push('__puppeteer');
    if (typeof window.callPhantom === 'function' || typeof window._phantom === 'function') flags.push('phantom');
    if (typeof window.__playwright !== 'undefined') flags.push('__playwright');
    if (typeof window.__selenium_unwrapped !== 'undefined') flags.push('selenium');
    if (typeof window.Buffer === 'function' && typeof window.process === 'object') flags.push('node-globals');
    const cdpKeys = Object.keys(document).filter((key) => key.startsWith('cdc_') || key.startsWith('$cdc_'));
    if (cdpKeys.length) flags.push('cdp-artifacts');
  } catch { /* ignore */ }

  if (flags.length) {
    report('automation', flags.join(','), { weight: 45 + flags.length * 5 });
    /* guclu otomasyon kaniti: oyunu kilitleyen bot ekrani gosterilir */
    if (flags.length >= 2 || flags.includes('navigator.webdriver')) {
      setVerdict('bot', {
        kindLabel: 'Bot',
        reason: flags.join(', '),
        source: 'client',
        confidence: 90,
        risk: 0,
        signals: flags,
      });
    }
  }
}

/* ------------------------------------------------------------- honeypot */

function installHoneypot() {
  if (typeof document === 'undefined') return;
  if (document.getElementById(HONEYPOT_ID)) return;
  try {
    const trap = document.createElement('a');
    trap.id = HONEYPOT_ID;
    trap.href = '#pg-human-check';
    trap.setAttribute('aria-hidden', 'true');
    trap.tabIndex = -1;
    trap.rel = 'nofollow';
    trap.textContent = 'human check';
    trap.style.cssText = 'position:fixed;left:-9999px;top:-9999px;width:1px;height:1px;'
      + 'opacity:0;pointer-events:auto;';
    trap.addEventListener('click', (evt) => {
      evt.preventDefault();
      report('honeypot', 'hidden-link-clicked');
    });
    document.body.appendChild(trap);
  } catch { /* ignore */ }
}

/* ------------------------------------------------------------ tab count */

/*
 * Sekme sayaci: mesajlasma tek yonlu ve sonludur.
 * 'hello' yayinlanir, alan sekmeler bir kez 'hi' ile karsilik verir;
 * 'hi' mesajina asla cevap verilmez -> mesaj firtinasi olmaz.
 */
function startTabHeartbeat() {
  if (typeof window === 'undefined' || typeof window.BroadcastChannel !== 'function') return;
  if (tabTimer) return;
  try {
    channel = channel || new window.BroadcastChannel('pgx_tabs');
    const hello = () => {
      try {
        channel.postMessage({ type: 'hello', id: tabId, at: Date.now() });
      } catch { /* ignore */ }
    };
    if (!channel.__pgBound) {
      channel.__pgBound = true;
      channel.addEventListener('message', (evt) => {
        const data = evt.data || {};
        if (!data.id || data.id === tabId) return;
        if (data.type === 'hello') {
          tabSeen.set(data.id, Date.now());
          try {
            channel.postMessage({ type: 'hi', id: tabId, at: Date.now() });
          } catch { /* ignore */ }
        } else if (data.type === 'hi') {
          tabSeen.set(data.id, Date.now());
        }
      });
    }
    hello();
    tabTimer = window.setInterval(() => {
      const now = Date.now();
      tabSeen.forEach((ts, key) => {
        if (now - ts > 15000) tabSeen.delete(key);
      });
      tabCount = tabSeen.size + 1;
      if (tabCount > 4) report('tabs', String(tabCount));
      else hello();
    }, 6000);
  } catch { /* ignore */ }
}

/** Zamanlayiciyi durdurur (test / tema kaldirma icin). */
export function stop() {
  if (tabTimer) {
    window.clearInterval(tabTimer);
    tabTimer = null;
  }
}

/* ------------------------------------------------- placement / pointer */

function activeCooldown() {
  if (!storeGetter) return false;
  try {
    const state = storeGetter();
    const coolDown = state && state.user ? state.user.coolDown : null;
    return Boolean(coolDown && coolDown > 0);
  } catch {
    return false;
  }
}

/**
 * Pointer events on the canvas. Used for trust, teleport and rhythm checks.
 */
export function onPointer(evt, context = {}) {
  if (!enabled || mode === 'off' || !evt) return;

  /*
   * Harita kaydirirken (holdPaint kapali) pointer hareketi "tiklama" degildir;
   * untrusted / teleport olcumleri burada tamamen atlanir. Bildirilen hata
   * buydu: oyuncu sadece kamerayi kaydirirken uyari aliyordu.
   */
  if (navigating || context.navigating) {
    teleportHits = [];
    return;
  }
  if (chaosActive && context.chaos !== false) {
    teleportHits = [];
    return;
  }

  if (evt.isTrusted === false) report('untrusted', evt.type);

  const stamp = Date.now();
  const position = { x: evt.clientX || 0, y: evt.clientY || 0 };

  if (context.previous && context.previous.at) {
    const dx = position.x - context.previous.x;
    const dy = position.y - context.previous.y;
    const distance = Math.sqrt(dx * dx + dy * dy);
    const dt = stamp - context.previous.at;
    if (dt > 0 && dt < 30 && distance > 900) {
      // a human hand cannot move a pointer ~1000px in under 30ms repeatedly
      boundedPush(teleportHits, stamp, 8);
      if (teleportHits.length >= 3) report('teleport', `${Math.round(distance)}px`);
    }
  }
}

export function onPlacement({ count = 1, trusted = true, chaos = false } = {}) {
  if (!enabled || mode === 'off') return;

  /*
   * Kaos etkinliginde (ya da harita kaydirilirken) tiklamalar normal ve hizli
   * olur; bu sure boyunca hicbir desen olcumu yapilmaz. Boylece "kaos da cok
   * pixel attim, hile sandilar" sikayeti tekrar etmez.
   */
  if (chaos || chaosActive || navigating) {
    placementTimes = [];
    cooldownAttempts = [];
    return;
  }

  const stamp = Date.now();
  boundedPush(placementTimes, stamp, 24);

  if (!trusted) report('untrusted', 'placement');

  if (activeCooldown()) {
    boundedPush(cooldownAttempts, stamp, 60);
    const recent = cooldownAttempts.filter((ts) => stamp - ts < 60000);
    if (recent.length > 40) report('cooldownSpam', String(recent.length));
  }

  if (placementTimes.length >= RHYTHM_MIN_SAMPLES) {
    const gaps = [];
    for (let i = 1; i < placementTimes.length; i += 1) {
      gaps.push(placementTimes[i] - placementTimes[i - 1]);
    }
    const mean = gaps.reduce((sum, gap) => sum + gap, 0) / gaps.length;
    if (mean > 40) {
      const variance = gaps.reduce((sum, gap) => sum + ((gap - mean) ** 2), 0) / gaps.length;
      const cv = Math.sqrt(variance) / mean;
      // humans are messy: cv below ~0.12 over 10+ placements is machine like
      if (cv < RHYTHM_CV) report('rhythm', `cv=${cv.toFixed(3)}`);
      else if (signals.has('rhythm') && cv > 0.35 && signals.get('rhythm').count > 0) {
        signals.get('rhythm').count = Math.max(0, signals.get('rhythm').count - 1);
      }
    }
  }
  if (count > 0) maybeSendReport();
}

/**
 * Called by the theme before a pixel batch is handed to the controller.
 * Returns false only in 'enforce' mode for an already flagged session.
 */
export function shouldAllowPlacement() {
  if (!enabled || mode !== 'enforce') return true;
  return score < BLOCK_SCORE;
}

/** Server side can ask for a captcha; the theme wires this to the UI. */
export function requestCaptcha() {
  report('captchaRequested', null, { weight: 5 });
  emit({ type: 'captcha' });
}

/* ------------------------------------------------- uyari / karar (v2) */

/**
 * Uyari olayini kisitli sekilde yayinlar: oyuncu ust uste bildirim gormez.
 * @return true yayinlandiysa
 */
function emitWarn() {
  const now = Date.now();
  if (now - lastWarnAt < WARN_COOLDOWN) return false;
  lastWarnAt = now;
  warnCount += 1;
  emit({
    type: 'warn', score, warnCount, signals: [...signals.keys()],
  });
  return true;
}

/** Kaos etkinligi: ritim/teleport olcumleri bu sure boyunca durur. */
export function setChaos(value) {
  chaosActive = Boolean(value);
  if (chaosActive) {
    placementTimes = [];
    teleportHits = [];
  }
  return chaosActive;
}

export function isChaos() {
  return chaosActive;
}

/**
 * Harita kaydirma / zoom gibi "pixel atmayan" hareketler.
 * true iken tiklama deseni olcumleri tamamen durur — kullanici sadece haritayi
 * hareket ettirdigi icin asla uyari almaz.
 */
export function noteNavigation(active) {
  navigating = Boolean(active);
  if (navigating) {
    placementTimes = [];
    teleportHits = [];
    cooldownAttempts = [];
  }
  return navigating;
}

export function isNavigating() {
  return navigating;
}

/**
 * Sunucudan (ya da guclu istemci sinyalinden) gelen kilit karari.
 * @param kind 'vpn' | 'proxy' | 'tor' | 'hosting' | 'bot' | null
 * @param detail ekranda gosterilecek ayrinti
 * @return karar nesnesi
 */
export function setVerdict(kind, detail = null) {
  if (!kind) {
    verdict = null;
    verdictDetail = null;
    verdictAt = 0;
    emit({ type: 'verdict', verdict: null });
    return null;
  }
  const same = verdict === kind;
  verdict = kind;
  if (detail) verdictDetail = detail;
  verdictAt = Date.now();
  emit({ type: 'verdict', verdict: getVerdict() });
  if (!same) emit({ type: 'block', kind, detail: verdictDetail });
  return getVerdict();
}

/** Sayfa yenilenene kadar gecerli kilit karari. */
export function getVerdict() {
  if (!verdict) return null;
  return {
    kind: verdict,
    label: (verdictDetail && verdictDetail.kindLabel) || verdict.toUpperCase(),
    detail: verdictDetail,
    at: verdictAt,
  };
}

export function isLocked() {
  return Boolean(verdict);
}

/* --------------------------------------------------------------- status */

export function getStatus() {
  const list = [];
  signals.forEach((value, key) => {
    list.push({ type: key, ...value });
  });
  return {
    enabled,
    mode,
    score,
    tabCount,
    warned: score >= WARN_SCORE,
    blocked: score >= BLOCK_SCORE,
    chaos: chaosActive,
    navigating,
    verdict: getVerdict(),
    locked: Boolean(verdict),
    warnCount,
    signals: list,
  };
}

export function resetScore() {
  score = 0;
  signals.clear();
  emit({ type: 'reset' });
  return getStatus();
}

export function getLog() {
  try {
    const raw = localStorage.getItem(LOG_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    return parsed && Array.isArray(parsed.entries) ? parsed.entries : [];
  } catch {
    return [];
  }
}

/* ------------------------------------------------------------ test hooks */

export function __resetForTests() {
  hydrated = true;
  installed = false;
  nativeCheck = isNative;
  if (tabTimer) {
    clearInterval(tabTimer);
    tabTimer = null;
  }
  tabSeen.clear();
  mode = 'log';
  enabled = true;
  score = 0;
  lastReportAt = 0;
  lastReportedScore = 0;
  tabCount = 1;
  storeGetter = null;
  signals.clear();
  listeners.clear();
  placementTimes = [];
  cooldownAttempts = [];
  teleportHits = [];
  chaosActive = false;
  navigating = false;
  verdict = null;
  verdictDetail = null;
  verdictAt = 0;
  lastWarnAt = 0;
  warnCount = 0;
}
