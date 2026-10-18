/**
 * Stores and reads the last known placer for a pixel.
 *
 * Pixel history is intentionally best-effort and expires after 90 days.
 * Existing canvas pixels have no entry until they are placed again.
 */
import client from '../data/redis/client.js';
import { getBasicUserInfo } from '../data/sql/User.js';

const TTL_SECONDS = 90 * 24 * 60 * 60;
const MAX_CONCURRENT_RECORDS = 16;
const MAX_PENDING_RECORDS = 8192;
const recordQueue = [];
let activeRecords = 0;

function getKey(canvasId, x, y) {
  return `pxinfo:${canvasId}:${Math.floor(x)}:${Math.floor(y)}`;
}

function drainRecordQueue() {
  while (activeRecords < MAX_CONCURRENT_RECORDS && recordQueue.length) {
    const record = recordQueue.shift();
    activeRecords += 1;
    client.set(
      getKey(record.canvasId, record.x, record.y),
      record.value,
      { EX: TTL_SECONDS },
    ).catch(() => {
      // Pixel metadata must never make a successful pixel placement fail.
    }).finally(() => {
      activeRecords -= 1;
      record.resolve();
      drainRecordQueue();
    });
  }
}

export function recordPixel(canvasId, x, y, uid, name, ipString = null, deviceHash = null) {
  if ((uid === null || uid === undefined) || !name) {
    return Promise.resolve();
  }
  if (recordQueue.length >= MAX_PENDING_RECORDS) {
    // Pixel history is best-effort; never let it become an unbounded heap or
    // Redis backlog during a high-volume event.
    return Promise.resolve();
  }

  return new Promise((resolve) => {
    recordQueue.push({
      canvasId,
      x,
      y,
      value: JSON.stringify({
        uid: Number(uid),
        name: String(name).slice(0, 64),
        ip: ipString ? String(ipString).slice(0, 45) : null,
        dh: deviceHash ? String(deviceHash).slice(0, 24) : null,
        ts: Date.now(),
      }),
      resolve,
    });
    drainRecordQueue();
  });
}

export async function getPixelInfo(canvasId, x, y) {
  try {
    const value = await client.get(getKey(canvasId, x, y));
    if (!value) return null;

    let stored;
    try {
      stored = JSON.parse(value);
    } catch {
      return null;
    }

    const uid = Number(stored.uid);
    if (!Number.isInteger(uid) || uid <= 0) return null;

    const user = await getBasicUserInfo(uid);
    let ipMeta = null;
    let proxy = null;
    if (stored.ip) {
      try {
        const ipMod = await import('../data/sql/IP.js');
        const infos = await ipMod.getIPInfos(stored.ip, null);
        if (infos && infos.size) {
          const v = infos.values().next().value;
          if (v) ipMeta = { country: v.country, cidr: v.cidr, org: v.org, asn: v.asn, isProxy: v.isProxy, isWhitelisted: v.isWhitelisted };
        }
      } catch {}
      try {
        const proxyMod = await import('../data/sql/ProxyIntel.js');
        proxy = await proxyMod.getProxyProfile(stored.ip);
      } catch {}
    }
    return {
      uid,
      name: user?.name || stored.name || null,
      username: user?.username || null,
      ip: stored.ip || null,
      deviceHash: stored.dh || null,
      ipMeta,
      proxy,
      ts: Number.isFinite(Number(stored.ts)) ? Number(stored.ts) : null,
      x: Math.floor(x),
      y: Math.floor(y),
      canvasId: Number(canvasId),
    };
  } catch {
    return null;
  }
}

export default { recordPixel, getPixelInfo };
