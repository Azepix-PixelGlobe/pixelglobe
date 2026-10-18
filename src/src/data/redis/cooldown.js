/*
 * redis script for cooldown calculation
 * this does not set any pixels itself, see lua/placePixel.lua
 */
import client from './client.js';
import {
  RANKED_KEY,
  DAILY_RANKED_KEY,
  FRANKED_KEY,
  DAILY_FRANKED_KEY,
  DAILY_CRANKED_KEY,
  PREV_DAY_TOP_KEY,
} from './ranks.js';

const PREFIX = 'cd';

/**
 * checks how many of the given pixels can be set,
 * sets user cooldown, increments pixelcount
 * and returns the number of pixels to set
 * @param ip ip of request
 * @param id userId
 * @param activeFactionId | null id of faction user places for
 * @param ranked boolean if increasing rank (should only be true if logged in)
 * @param clrIgnore, bcd, pcd, cds information about canvas
 * @param canvasId id of the canvas we are placing on
 * @param canvasCdId id of the canvas we take the cooldown from
 * @param i, j chunk coordinates
 * @param pxls Array with offsets of pixels
 * @return see lua/placePixel.lua
 */
export default function allowPlace(
  ipString,
  id,
  activeFactionId,
  country,
  ranked,
  canvasId,
  canvasCdId,
  i, j,
  clrIgnore,
  req,
  bcd,
  pcd,
  cds,
  cdIfNull,
  dontIncreaseCounters,
  pxls,
) {
  const ipCdKey = `${PREFIX}:${canvasCdId}:ip:${ipString}`;
  let idCdKey;
  if (id) {
    idCdKey = `${PREFIX}:${canvasCdId}:id:${id}`;
  } else {
    idCdKey = 'nope';
  }
  if (!req && req !== 0) {
    req = 'nope';
  }
  const chunkKey = `ch:${canvasId}:${i}:${j}`;
  const cc = country || 'xx';
  const dailyset = (ranked) ? DAILY_RANKED_KEY : 'nope';
  /* eslint-disable max-len */
  return client.placePixel(
    ipCdKey, idCdKey, chunkKey, RANKED_KEY, dailyset, FRANKED_KEY, DAILY_FRANKED_KEY, DAILY_CRANKED_KEY, PREV_DAY_TOP_KEY,
    clrIgnore, bcd, pcd, cds, cdIfNull, id, activeFactionId, cc, req, dontIncreaseCounters ? 1 : 0,
    ...pxls,
  );
  /* eslint-enable max-len */
}

/**
 * get cooldown of specific user
 * @param ip ip of request
 * @param id userId
 * @param canvasId
 * @return cooldown
 */
export async function getCoolDown(
  ip,
  id,
  canvasId,
) {
  let ttl = await client.pTTL(`${PREFIX}:${canvasId}:ip:${ip}`);
  if (id) {
    const ttlid = await client.pTTL(`${PREFIX}:${canvasId}:id:${id}`);
    ttl = Math.max(ttl, ttlid);
  /*
   * cooldown by subnet should be more restrictive
   *
  } else if (ip.includes('.')) {
    const ips = ip.slice(0, ip.lastIndexOf('.'));
    const ttlid = await client.pTTL(`${PREFIX}:${canvasId}:ips:${ips}`);
    ttl = Math.max(ttl, ttlid);
  */
  }
  const cooldown = ttl < 0 ? 0 : ttl;
  return cooldown;
}

/**
 * set cooldown of specific user
 * @param ip ip of request
 * @param id userId
 * @param canvasId
 * @param cooldown (in ms)
 * @return cooldown
 */
export async function setCoolDown(
  ip,
  id,
  canvasId,
  cooldown,
) {
  // PX is milliseconds expire
  await client.set(`${PREFIX}:${canvasId}:ip:${ip}`, '', {
    PX: cooldown,
  });
  if (id) {
    await client.set(`${PREFIX}:${canvasId}:id:${id}`, '', {
      PX: cooldown,
    });
  }
  return true;
}

/**
 * delete user from ranks
 * @param id user id
 */
export function deleteUserFromRanks(id) {
  return Promise.all([
    client.zRem(RANKED_KEY, String(id)),
    client.zRem(DAILY_CRANKED_KEY, String(id)),
  ]);
}
