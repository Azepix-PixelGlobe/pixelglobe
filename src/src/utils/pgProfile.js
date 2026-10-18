/**
 * PixelGlobe profiles — self profile (status / bio) + presence.
 * ============================================================
 * The upstream database has no "status" or "bio" column, so this module keeps
 * the data client side and syncs it between players with the invisible chat
 * frames from pgChat.js. That means:
 *
 *   * your own status / bio / emoji survive reloads (localStorage), and
 *   * other players running this UI see them on your profile card, and
 *   * they are NOT sent to the server or stored in the database.
 *
 * If you later add `status` / `bio` columns to the users table, only
 * `setSelf()` and `ingest()` need to be pointed at that endpoint — the UI is
 * already reading everything from here.
 */

import { PG_KIND, PG_PRESENCE_TTL } from './pgChat.js';

const SELF_KEY = 'pgx_profile_self';
const CACHE_KEY = 'pgx_profile_cache';
const PRESENCE_KEY = 'pgx_profile_presence';

const listeners = new Set();
let state = {
  self: { emoji: '', status: '', bio: '', clearAt: 0, ts: 0 },
  cache: {},      // { [nameLower]: { emoji, status, bio, ts, uid } }
  presence: {},   // { [nameLower]: lastSeenMs }
  version: 0,
};

/* --------------------------------------------------------------- storage */

function readJson(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : fallback;
  } catch {
    return fallback;
  }
}

function writeJson(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* storage disabled — keep it in memory only */
  }
}

function emit() {
  state = { ...state, version: state.version + 1 };
  listeners.forEach((fn) => {
    try {
      fn(state);
    } catch {
      /* a broken subscriber must not break the others */
    }
  });
}

export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function getState() {
  return state;
}

/* ------------------------------------------------------------- bootstrap */

let hydrated = false;

export function hydrate() {
  if (hydrated) return state;
  hydrated = true;
  const self = readJson(SELF_KEY, null);
  const cache = readJson(CACHE_KEY, {});
  const presence = readJson(PRESENCE_KEY, {});
  state = {
    ...state,
    self: { ...state.self, ...(self || {}) },
    cache: cache || {},
    presence: presence || {},
  };
  expireStale();
  return state;
}

/* ------------------------------------------------------------------ self */

export function getSelf() {
  hydrate();
  return state.self;
}

export function setSelf(patch) {
  hydrate();
  const { status, bio, emoji } = { ...state.self, ...patch };
  const clearAt = state.self.clearAt || 0;
  state.self = {
    status: String(status || '').slice(0, 128),
    bio: String(bio || '').slice(0, 280),
    emoji: String(emoji || '').slice(0, 8),
    clearAt,
    ts: Date.now(),
  };
  writeJson(SELF_KEY, state.self);
  emit();
  return state.self;
}

export function clearSelf() {
  hydrate();
  state.self = { emoji: '', status: '', bio: '', clearAt: 0, ts: Date.now() };
  writeJson(SELF_KEY, state.self);
  emit();
  return state.self;
}

/* -------------------------------------------------------------- presence */

export function markActive(name, ts) {
  if (!name) return;
  hydrate();
  const key = String(name).toLowerCase();
  const when = Number(ts) || Date.now();
  if (when < (state.presence[key] || 0)) return; // keep the newest beacon
  state.presence[key] = when;
  writeJson(PRESENCE_KEY, state.presence);
  emit();
}

export function expireStale(now = Date.now()) {
  let changed = false;
  const next = {};
  Object.keys(state.presence).forEach((key) => {
    if (now - state.presence[key] < PG_PRESENCE_TTL) {
      next[key] = state.presence[key];
    } else {
      changed = true;
    }
  });
  if (changed) {
    state.presence = next;
    writeJson(PRESENCE_KEY, state.presence);
  }
}

export function isActive(name, now = Date.now()) {
  hydrate();
  if (!name) return false;
  return (now - (state.presence[String(name).toLowerCase()] || 0)) < PG_PRESENCE_TTL;
}

export function lastSeen(name) {
  hydrate();
  return state.presence[String(name).toLowerCase()] || 0;
}

/* --------------------------------------------------------------- profile */

export function getProfile(name) {
  hydrate();
  if (!name) return { emoji: '', status: '', bio: '', ts: 0 };
  const entry = state.cache[String(name).toLowerCase()];
  return entry || { emoji: '', status: '', bio: '', ts: 0 };
}

export function ingestProfile(fromName, data) {
  if (!fromName || !data) return;
  hydrate();
  const key = String(fromName).toLowerCase();
  state.cache = {
    ...state.cache,
    [key]: {
      emoji: String(data.e || '').slice(0, 8),
      status: String(data.s || '').slice(0, 128),
      bio: String(data.b || '').slice(0, 280),
      uid: data.u || 0,
      ts: Date.now(),
    },
  };
  writeJson(CACHE_KEY, state.cache);
  markActive(fromName);
  emit();
}

/**
 * Feed one chat message into profile/presence state.
 * `messageArray` follows the upstream layout:
 *   [name, text, flag, userId, ts, msgId, flagLegit, avatarId, attachments]
 */
export function ingestMessage(name, text, tsSeconds) {
  if (!name || name === 'info' || name === 'event') return null;
  hydrate();

  // plain chat message -> presence
  const frame = text && text.charCodeAt(0) === 0x2063 ? text.slice(0, 2) : null;
  if (!frame) {
    markActive(name, (Number(tsSeconds) || 0) * 1000 || Date.now());
    return null;
  }

  let decoded = null;
  try {
    decoded = { kind: text.charAt(1), data: JSON.parse(text.slice(2)) };
  } catch {
    return null;
  }

  if (decoded.kind === PG_KIND.TYPING) {
    markActive(name);
    return { kind: PG_KIND.TYPING, name };
  }
  if (decoded.kind === PG_KIND.PRESENCE) {
    markActive(name);
    return { kind: PG_KIND.PRESENCE, name };
  }
  if (decoded.kind === PG_KIND.PROFILE) {
    ingestProfile(name, decoded.data);
    return { kind: PG_KIND.PROFILE, name };
  }
  return null;
}

/* ------------------------------------------------------------ test hooks */

export function __resetForTests() {
  hydrated = true;
  state = {
    self: { emoji: '', status: '', bio: '', clearAt: 0, ts: 0 },
    cache: {},
    presence: {},
    version: 0,
  };
  listeners.clear();
}
