/**
 * PixelGlobe Pulse — juice: sounds, combo feedback and micro animations.
 * =====================================================================
 * The site already plays a sound when you pick a colour or get a notification
 * (store/middleware/audio.js, controlled by gui.mute). This module adds the
 * missing feedback that makes placing pixels feel good:
 *
 *   place   – short blip that rises with your combo
 *   claim   – reward arpeggio when a mission is claimed
 *   streak  – celebration chord on a streak milestone
 *   ready   – gentle chime when your pixel stock refills
 *   warn    – soft double tone (guard / errors)
 *
 * Everything is synthesised with WebAudio: no audio files, no network, and the
 * volume/mute here is remembered per player. `gui.mute` (the site setting) is
 * respected as the master switch.
 *
 * Sounds are created lazily after the first user gesture, because browsers
 * block audio contexts that were not created from a user gesture.
 */

import { pgT } from './pgI18n.js';

const SETTINGS_KEY = 'pgx_feedback_v1';

let ctx = null;
let settings = { volume: 0.5, enabled: true };
let hydrated = false;
let masterMuted = false;

const listeners = new Set();
let combo = 0;
let comboUntil = 0;
let comboTimer = null;
let lastPlaceAt = 0;

/* ---------------------------------------------------------- persistence */

function hydrate() {
  if (hydrated) return;
  hydrated = true;
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object') {
        settings = {
          volume: typeof parsed.volume === 'number' ? Math.max(0, Math.min(1, parsed.volume)) : 0.5,
          enabled: parsed.enabled !== false,
        };
      }
    }
  } catch {
    /* storage disabled */
  }
}

function persist() {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    /* ignore */
  }
}

function emit() {
  listeners.forEach((fn) => {
    try { fn(getState()); } catch { /* ignore */ }
  });
}

/* --------------------------------------------------------------- public */

export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function getState() {
  hydrate();
  return {
    ...settings,
    muted: !settings.enabled || masterMuted,
    combo,
  };
}

export function setVolume(volume) {
  hydrate();
  settings.volume = Math.max(0, Math.min(1, Number(volume) || 0));
  persist();
  emit();
  return settings.volume;
}

export function setEnabled(enabled) {
  hydrate();
  settings.enabled = Boolean(enabled);
  persist();
  if (settings.enabled) sfx('paletteSelect');
  emit();
  return settings.enabled;
}

export function toggleEnabled() {
  return setEnabled(!getState().enabled);
}

/** The site wide mute flag lives in the store; feed it in from the theme. */
export function setMasterMuted(muted) {
  masterMuted = Boolean(muted);
  emit();
}

export function getCombo() {
  return combo;
}

/* ------------------------------------------------------------- WebAudio */

function context() {
  if (ctx) return ctx;
  if (typeof window === 'undefined') return null;
  const Ctor = window.AudioContext || window.webkitAudioContext;
  if (!Ctor) return null;
  try {
    ctx = new Ctor();
  } catch {
    ctx = null;
  }
  return ctx;
}

function audible() {
  hydrate();
  return settings.enabled && !masterMuted && settings.volume > 0.001;
}

function tone({
  freq, type = 'sine', start = 0, duration = 0.12, gain = 0.25, sweep = null, detune = 0,
}) {
  const audio = context();
  if (!audio) return;
  if (audio.state === 'suspended') audio.resume().catch(() => {});
  const now = audio.currentTime + start;
  const osc = audio.createOscillator();
  const amp = audio.createGain();
  osc.type = type;
  if (detune) osc.detune.value = detune;
  osc.frequency.setValueAtTime(freq, now);
  if (sweep) osc.frequency.exponentialRampToValueAtTime(Math.max(40, sweep), now + duration);
  const peak = Math.max(0.0001, gain * settings.volume);
  amp.gain.setValueAtTime(0.0001, now);
  amp.gain.exponentialRampToValueAtTime(peak, now + 0.012);
  amp.gain.exponentialRampToValueAtTime(0.0001, now + duration);
  osc.connect(amp);
  amp.connect(audio.destination);
  osc.start(now);
  osc.stop(now + duration + 0.02);
}

/* ---------------------------------------------------------------- sfx */

export function sfx(name, options = {}) {
  if (!audible()) return false;
  switch (name) {
    case 'place': {
      const step = Math.min(combo, 12);
      const base = 520 + step * 34;
      tone({
        freq: base, type: 'triangle', duration: 0.075, gain: 0.16, sweep: base * 1.35,
      });
      break;
    }
    case 'placeHeavy':
      tone({
        freq: 300, type: 'sawtooth', duration: 0.14, gain: 0.12, sweep: 180, detune: -600,
      });
      break;
    case 'paletteSelect':
      tone({
        freq: 700, type: 'sine', duration: 0.1, gain: 0.12, sweep: 900,
      });
      break;
    case 'claim':
      [523.25, 659.25, 783.99].forEach((freq, index) => tone({
        freq, type: 'triangle', start: index * 0.07, duration: 0.22, gain: 0.2,
      }));
      break;
    case 'streak':
      [523.25, 659.25, 783.99, 1046.5].forEach((freq, index) => tone({
        freq, type: 'sine', start: index * 0.09, duration: 0.34, gain: 0.22,
      }));
      break;
    case 'ready':
      tone({ freq: 880, type: 'sine', duration: 0.16, gain: 0.16 });
      tone({
        freq: 1174.7, type: 'sine', start: 0.12, duration: 0.2, gain: 0.14,
      });
      break;
    case 'warn':
      tone({ freq: 340, type: 'square', duration: 0.1, gain: 0.09 });
      tone({
        freq: 260, type: 'square', start: 0.11, duration: 0.14, gain: 0.09,
      });
      break;
    case 'level':
      [659.25, 830.61, 987.77, 1318.5].forEach((freq, index) => tone({
        freq, type: 'triangle', start: index * 0.08, duration: 0.3, gain: 0.2,
      }));
      break;
    /* --- cark sesleri --- */
    case 'wheelSpin':
      /* hızlanan çark: yükselen testere + tık tık */
      tone({
        freq: 220, type: 'sawtooth', duration: 0.6, gain: 0.1, sweep: 900,
      });
      tone({
        freq: 110, type: 'square', duration: 0.5, gain: 0.07, sweep: 300, start: 0.05,
      });
      break;
    case 'wheelTick':
      tone({
        freq: 1500, type: 'square', duration: 0.025, gain: 0.06, sweep: 900,
      });
      break;
    case 'wheelWin':
      [783.99, 987.77, 1174.66].forEach((freq, index) => tone({
        freq, type: 'triangle', start: index * 0.08, duration: 0.26, gain: 0.2,
      }));
      break;
    case 'wheelJackpot':
      /* jackpot: fanfar + bas vuruş, konfetinin sesi */
      [523.25, 659.25, 783.99, 1046.5, 1318.5].forEach((freq, index) => tone({
        freq, type: 'triangle', start: index * 0.09, duration: 0.42, gain: 0.24,
      }));
      [130.81, 196].forEach((freq, index) => tone({
        freq, type: 'sawtooth', start: index * 0.18, duration: 0.6, gain: 0.12, detune: -900,
      }));
      tone({
        freq: 2093, type: 'sine', start: 0.52, duration: 0.5, gain: 0.16, sweep: 3136,
      });
      break;
    case 'coin':
      tone({
        freq: 1046.5, type: 'square', duration: 0.08, gain: 0.12, sweep: 1568,
      });
      tone({
        freq: 1318.5, type: 'square', start: 0.06, duration: 0.12, gain: 0.1,
      });
      break;
    /* --- koruma kilidi --- */
    case 'locked':
      tone({
        freq: 196, type: 'square', duration: 0.32, gain: 0.14, detune: -600,
      });
      tone({
        freq: 155, type: 'square', start: 0.34, duration: 0.5, gain: 0.14, detune: -800,
      });
      tone({
        freq: 98, type: 'sawtooth', start: 0.7, duration: 0.8, gain: 0.1, detune: -1200,
      });
      break;
    default:
      return false;
  }
  return true;
}

/* --------------------------------------------------------------- combo */

export function registerPlacement(count = 1) {
  const now = Date.now();
  if (now - lastPlaceAt > 2500) combo = 0;
  lastPlaceAt = now;
  combo = Math.min(999, combo + count);
  comboUntil = now + 2500;
  if (comboTimer) window.clearTimeout(comboTimer);
  comboTimer = window.setTimeout(() => {
    combo = 0;
    emit();
  }, 2600);
  emit();
  return combo;
}

export function resetCombo() {
  combo = 0;
  if (comboTimer) window.clearTimeout(comboTimer);
  emit();
}

/* ------------------------------------------------------- visual feedback */

export function screenPulse(intensity = 'soft') {
  if (typeof document === 'undefined') return;
  if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const root = document.documentElement;
  root.classList.remove('pg-pulse-soft', 'pg-pulse-hard');
  root.classList.add(intensity === 'hard' ? 'pg-pulse-hard' : 'pg-pulse-soft');
  window.setTimeout(() => {
    root.classList.remove('pg-pulse-soft', 'pg-pulse-hard');
  }, 420);
}

export function haptic(pattern = 8) {
  if (typeof navigator === 'undefined' || !navigator.vibrate) return false;
  try {
    navigator.vibrate(pattern);
    return true;
  } catch {
    return false;
  }
}

/**
 * The whole "you placed a pixel" feel, in one call.
 *   const combo = placementFeedback({ count, chaos })
 */
export function placementFeedback({ count = 1, chaos = false } = {}) {
  const current = registerPlacement(count);
  sfx(chaos ? 'placeHeavy' : 'place');
  screenPulse('soft');
  haptic(6);
  return current;
}

export function comboLabel() {
  return pgT('toast.combo', { n: combo });
}

/* ------------------------------------------------------------- test hooks */

export function __resetForTests() {
  hydrated = true;
  settings = { volume: 0.5, enabled: true };
  masterMuted = false;
  combo = 0;
  listeners.clear();
}
