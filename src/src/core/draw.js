/*
 * draw pixel on canvas by user
 */

import {
  getPixelFromChunkOffset, isIntervalActive,
} from './utils.js';
import logger, { PixelLogger } from './logger.js';
import allowPlace from '../data/redis/cooldown.js';
import { updatePixelGoals } from '../data/sql/Coins.js';
import { recordDailyPixels } from '../data/sql/Pulse.js';
import { recordPixel } from './PixelInfo.js';
import socketEvents from '../socket/socketEvents.js';
import { getCooldownFactor } from './CooldownModifiers.js';
import { setPixelByOffset } from './setPixel.js';
import { getState } from './SharedState.js';
import canvases from './canvases.js';

import {
  THREE_CANVAS_HEIGHT, THREE_TILE_SIZE, TILE_SIZE, USERLVL,
} from './constants.js';

let coolDownFactor = 1;
socketEvents.on('setCoolDownFactor', (newFac) => {
  coolDownFactor = newFac;
});

// Per-event bcd/pcd overrides (null = use canvas default)
let eventBcd = null;
let eventPcd = null;
socketEvents.on('setEventCooldowns', ({ bcd, pcd }) => {
  eventBcd = bcd;
  eventPcd = pcd;
});

// Chaos cooldown override.
// null = off; when set with mode 'absolute', bcd/pcd REPLACE canvas defaults
// (frenzy: near-zero cooldown so you can place a huge number of pixels).
let chaosBcd = null;
let chaosPcd = null;
let chaosAbsolute = false;
socketEvents.on('setChaosCooldowns', ({ bcd, pcd, mode }) => {
  chaosBcd = bcd;
  chaosPcd = pcd;
  chaosAbsolute = Boolean(
    mode === 'absolute' && bcd !== null && bcd !== undefined,
  );
});

/*
 * IPs who are currently requesting pixels
 * (have to log in order to avoid race conditions)
 */
const curReqIPs = new Map();
setInterval(() => {
  // clean stuck locks quickly so a hung request cannot brick the IP
  const ts = Date.now() - 3 * 1000;
  const ips = [...curReqIPs.keys()];
  for (let i = 0; i < ips.length; i += 1) {
    const ip = ips[i];
    const limiter = curReqIPs.get(ip);
    if (limiter && ts > limiter) {
      curReqIPs.delete(ip);
      logger.warn(
        `Pixel requests from ${ip} got stuck (auto-cleared)`,
      );
    }
  }
}, 5 * 1000);


/**
 *
 * By Offset is preferred on server side
 * This gets used by websocket pixel placing requests
 * @param user user object or null
 * @param ip ip object
 * @param canvasId
 * @param i Chunk coordinates
 * @param j
 * @param pixels Array of individual pixels within the chunk, with:
 *        [[offset, color], [offset2, color2],...]
 *        Offset is the offset of the pixel within the chunk
 * @param connectedTs Timestamp when connection got established.
 *        if the connection is younger than the cooldown of the canvas,
 *        we fill up the cd on first pixel to nerf one-connection
 *        ip-changing cheaters
 * @return Promise<Object>
 */
export default async function drawByOffsets(
  user,
  ip,
  canvasId,
  i,
  j,
  pixels,
  connectedTs,
) {
  let wait = 0;
  let coolDown = 0;
  let retCode = 0;
  let pxlCnt = 0;
  let rankedPxlCnt = 0;
  const { ipString } = ip;
  const requestLockKey = user?.id ? `user:${user.id}` : `ip:${ipString}`;

  /*
   * GÜVENLİK: boş veya bozuk pixel listesi erken reddedilir. Aksi halde
   * pixels[0][1] erişimi istisna fırlatıp log/CPU israfına yol açıyordu.
   */
  if (!Array.isArray(pixels) || pixels.length === 0
    || !Array.isArray(pixels[0])) {
    return {
      wait: 0, coolDown: 0, pxlCnt: 0, rankedPxlCnt: 0, retCode: 9,
    };
  }

  try {
    const startTime = Date.now();

    // Wait for previous place to finish (faster poll) so 5x5 multi-packet
    // strokes rarely hit hard retCode 13
    if (curReqIPs.has(requestLockKey)) {
      let waited = 0;
      while (curReqIPs.has(requestLockKey) && waited < 1200) {
        // eslint-disable-next-line no-await-in-loop
        await new Promise((resolve) => setTimeout(resolve, 4));
        waited += 4;
      }
      if (curReqIPs.has(requestLockKey)) {
        // The client will retry this soft busy response.
        throw new Error(13);
      }
    }
    curReqIPs.set(requestLockKey, startTime);

    const canvas = canvases[canvasId];
    if (!canvas || canvas.ed) {
      // canvas doesn't exist or is expired
      throw new Error(1);
    }

    const canvasSize = canvas.size;
    const is3d = !!canvas.v;

    const tileSize = (is3d) ? THREE_TILE_SIZE : TILE_SIZE;
    /*
     * canvas/chunk validation
     */
    if (i >= canvasSize / tileSize) {
      // x out of bounds
      // (we don't have to check for <0 because it is received as uint)
      throw new Error(2);
    }
    if (j >= canvasSize / tileSize) {
      // y out of bounds
      // (we don't have to check for <0 because it is received as uint)
      throw new Error(3);
    }

    const isAdmin = (user?.userlvl >= USERLVL.ADMIN);
    const req = (isAdmin) ? null : canvas.req;
    const clrIgnore = canvas.cli || 0;
    // Admins keep their moderation privileges, but use the same pixel
    // cooldown as regular users.
    let factor = (
      user?.userlvl >= USERLVL.CLEANER && pixels[0][1] < clrIgnore
    )
      ? 0.0 : coolDownFactor;

    factor *= getCooldownFactor(ip.country, ipString);

    // Base cooldown (event override if any, otherwise canvas default)
    const baseBcd = eventBcd !== null ? eventBcd : canvas.bcd;
    const basePcd = eventPcd !== null ? eventPcd : (canvas.pcd || canvas.bcd);
    let bcd;
    let pcd;
    if (chaosAbsolute && chaosBcd !== null) {
      // Chaos frenzy: absolute near-zero cooldown (ignore canvas bcd/pcd)
      bcd = Math.floor(Math.max(0, chaosBcd) * factor);
      const chaosCooldown = chaosPcd !== null ? chaosPcd : chaosBcd;
      pcd = Math.floor(Math.max(0, chaosCooldown) * factor);
    } else {
      // Additive extra (legacy)
      bcd = Math.floor((baseBcd + (chaosBcd !== null ? chaosBcd : 0)) * factor);
      pcd = Math.floor((basePcd + (chaosPcd !== null ? chaosPcd : 0)) * factor);
    }
    const userId = user?.id || 0;
    const pxlOffsets = [];

    /*
     * validate pixels
     */
    let ranked = canvas.ranked && pcd;
    for (let u = 0; u < pixels.length; u += 1) {
      const [offset, color] = pixels[u];
      pxlOffsets.push(offset);

      const maxSize = (is3d) ? tileSize * tileSize * THREE_CANVAS_HEIGHT
        : tileSize * tileSize;
      if (offset >= maxSize) {
        // z out of bounds or weird stuff
        throw new Error(4);
      }

      if (color >= canvas.colors.length) {
        // color out of bounds
        throw new Error(5);
      }
      if (color < clrIgnore) {
        // admins, jannies, cleaners and mods can place unset pixels
        if ((!user || user.userlvl < USERLVL.CLEANER)
          && !(canvas.v && color === 0)
        ) {
          // color out of bounds
          throw new Error(5);
        }
      } else if (factor === 0.0 && !isAdmin) {
        /*
         * e.g.: mod sends ordianry pixels together with a started 0 cd pixel,
         * an impossible occurance, unless malicious
         * NOTE: in case of future additions of 0cd possibilities, this needs
         * a refactor
         */
        throw new Error(5);
      }

      /* 3D Canvas Minecraft Avatars */
      // && x >= 96 && x <= 128 && z >= 35 && z <= 100
      // 96 - 128 on x
      // 32 - 128 on z
      if (canvas.v && i === 19 && j >= 17 && j < 20 && !isAdmin) {
        // protected pixel
        throw new Error(8);
      }

      /* dont rank antarctica */
      if (canvasId === 0) {
        const cy = Math.floor(offset / TILE_SIZE);
        const y = ((j - (canvasSize / 2 / TILE_SIZE)) * TILE_SIZE) + cy;
        if (y > 14450) {
          ranked = false;
        }
      }
    }

    const { cds } = canvas;
    /*
     * KAOS: 15 ms/piksel ile 640.000 ms'lik yığın ~42.666 piksele yetiyor;
     * ama 100 kişilik fırtınada 10x10 fırçayla aralıksız tıklayan bir oyuncu
     * bunu tüketip "pixel stack used up" (retCode 9) ile beklemeye düşebilir.
     * Kaos sırasında yığın tavanı 4 katına çıkarılır → kesintisiz boyama.
     * (cdIfNull hesabı bilerek ESKİ cds ile kalır; yeni bağlantı cezası
     *  değişmesin.)
     */
    const stackCap = chaosAbsolute ? cds * 4 : cds;
    // start with almost filled cd on new connections
    let cdIfNull = cds - pcd + 1000 - startTime + connectedTs;
    if (cdIfNull < 0 || userId || bcd === 0) {
      cdIfNull = 0;
    }

    /*
     * Errors that we want to be logged later on
     * In example: The user should not know that he is detected as a proxy,
     * unless he already solved a captcha.
     * Also useful for letting pixels be logged before throwing.
     */
    let errorLater;

    if ((await getState('needVerification')) && (
      !user || user.userlvl < USERLVL.VERIFIED
    )) {
      errorLater = 17;
    }

    if (!errorLater) {
      const { captchaNeeded, challengeNeeded } = await ip.getVerification();
      if (captchaNeeded || challengeNeeded) {
        errorLater = 10;
      }
    }

    if (!errorLater) {
      let { isBanned, isProxy } = await ip.getAllowance();
      if (!isProxy && !isBanned && user) {
        ({ isBanned } = await user.getAllowance());
      }
      if (isBanned) {
        throw new Error(14);
      }
      if (isProxy) {
        errorLater = 11;
      }
    }

    /* temporary blocks */
    if (user?.blockedInterval && isIntervalActive(user.blockedInterval, 1)) {
      throw new Error(18);
    }
    if (ip.blockedInterval && isIntervalActive(ip.blockedInterval, 1)) {
      throw new Error(18);
    }

    [
      retCode,
      pxlCnt,
      wait,
      coolDown,
    ] = await allowPlace(
      ipString,
      userId,
      user?.activeFactionId || 0,
      ip.country,
      ranked,
      canvasId,
      canvas.linkcd ?? canvasId,
      i, j,
      clrIgnore,
      req,
      bcd, pcd,
      stackCap,
      cdIfNull,
      /*
       * don't increase counter if we are will error
       */
      errorLater,
      pxlOffsets,
    );


    for (let u = 0; u < pixels.length; u += 1) {
      const [offset, color] = pixels[u];
      const coords = getPixelFromChunkOffset(i, j, offset, canvasSize, is3d)
        .join(' ');

      let logRetCode;
      if (errorLater) {
        logRetCode = errorLater;
      } else if (u < pxlCnt) {
        logRetCode = 0;
      } else {
        logRetCode = retCode;
      }

      PixelLogger.log(
        // eslint-disable-next-line max-len
        `${startTime} ${ipString} ${userId} ${canvasId} ${coords} ${color} ${logRetCode}`,
      );
    }

    /*
     * pxlCnt is only larger than 0 if all requirements are met for placing on
     * that canvas
     */
    if (pxlCnt > 0 && errorLater) {
      pxlCnt = 0;
      throw new Error(errorLater);
    }

    for (let u = 0; u < pxlCnt; u += 1) {
      const [offset, color] = pixels[u];
      setPixelByOffset(canvasId, color, i, j, offset);
    }

    if (ranked && userId) {
      rankedPxlCnt = pxlCnt;
    }

    if (pxlCnt > 0 && userId) {
      updatePixelGoals(userId, pxlCnt).catch(() => {});
      /* Nabız: günlük grafik ve günün rekoru için geçmiş kaydı */
      recordDailyPixels(userId, pxlCnt).catch(() => {});
      try {
        const placerName = user?.name || user?.username || String(userId);
        for (let u = 0; u < pxlCnt; u += 1) {
          const [offset] = pixels[u];
          const [px, py] = getPixelFromChunkOffset(
            i,
            j,
            offset,
            canvasSize,
            is3d,
          );
          recordPixel(
            canvasId,
            px,
            py,
            userId,
            placerName,
            ip?.ipString || null,
            null,
          ).catch(() => {});
        }
      } catch {
        // Metadata is best-effort and must not block pixel placement.
      }
    }

    const duration = Date.now() - startTime;
    if (duration > 5000) {
      logger.warn(
        // eslint-disable-next-line max-len
        `Long response time of ${duration}ms for placing ${pxlCnt} pixels for user ${user?.id || ipString}`,
      );
    }
  } catch (e) {
    retCode = parseInt(e.message, 10);
    if (Number.isNaN(retCode)) {
      throw e;
    }
  }

  // Always release the lock so a failed placement never bricks painting.
  curReqIPs.delete(requestLockKey);

  return {
    wait,
    coolDown,
    pxlCnt,
    rankedPxlCnt,
    retCode,
  };
}
