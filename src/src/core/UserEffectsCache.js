/*
 * In-memory cache for user active item effects (nameEffect, frameEffect).
 * Used by ChatProvider to include effects in chat messages without a DB hit on
 * every message.
 */
import { getActiveItemEffects } from '../data/sql/Coins.js';

/*
 * Map<uid, { nameEffect: string|null, frameEffect: string|null, ts: number }>
 */
const cache = new Map();

const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

/**
 * Get active effects for a user, using the cache.
 * @param uid
 * @return { nameEffect, frameEffect }
 */
export async function getUserEffects(uid) {
  if (!uid) return { nameEffect: null, frameEffect: null };
  const cached = cache.get(uid);
  if (cached && cached.ts > Date.now() - CACHE_TTL) {
    return { nameEffect: cached.nameEffect, frameEffect: cached.frameEffect };
  }
  const effects = await getActiveItemEffects(uid);
  cache.set(uid, { ...effects, ts: Date.now() });
  return effects;
}

/**
 * Invalidate cached effects for a user (call after buying/activating items).
 * @param uid
 * @param effects optional new effects to set immediately
 */
export function invalidateUserEffects(uid, effects = null) {
  if (effects) {
    cache.set(uid, { ...effects, ts: Date.now() });
  } else {
    cache.delete(uid);
  }
}
