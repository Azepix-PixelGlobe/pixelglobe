/*
 * canvas data on redis
 */
import { commandOptions } from 'redis';

import { getChunkOfPixel, getOffsetOfPixel } from '../../core/utils.js';
import socketEvents from '../../socket/socketEvents.js';
import client from './client.js';
import logger from '../../core/logger.js';
import { notifyChunk, notifyClearChunk } from '../../core/MiniMapLive.js';


const UINT_SIZE = 'u8';

class RedisCanvas {
  /*
   * Get chunk from redis
   * canvasId integer id of canvas
   * i, j chunk coordinates
   * [padding] required length of chunk  (will be padded with zeros if smaller)
   * @return chunk as Buffer
   */
  static async getChunk(
    canvasId,
    i,
    j,
    padding = null,
  ) {
    // this key is also hardcoded into
    // core/tilesBackup.js
    const key = `ch:${canvasId}:${i}:${j}`;
    let chunk = await client.get(
      commandOptions({ returnBuffers: true }),
      key,
    );
    if (padding > 0 && chunk && chunk.length < padding) {
      /*
       * this padding is slow and should be avoided,
       * better deal with non-full-size chunks yourself
       */
      const pad = Buffer.alloc(padding - chunk.length);
      chunk = Buffer.concat([chunk, pad]);
    }
    return chunk;
  }

  static async setChunk(i, j, chunk, canvasId) {
    const key = `ch:${canvasId}:${i}:${j}`;
    const payload = Buffer.from(chunk.buffer || chunk);
    await client.set(key, payload);
    /* CANLI MİNİMAP: toplu değişim (dosya yükleme, rollback) özete işlenir */
    notifyChunk(canvasId, i, j, payload);
    socketEvents.broadcastChunkUpdate(canvasId, [i, j]);
    return true;
  }

  static async delChunk(i, j, canvasId) {
    const key = `ch:${canvasId}:${i}:${j}`;
    await client.del(key);
    /* CANLI MİNİMAP: silinen chunk özetten de temizlenir */
    notifyClearChunk(canvasId, i, j);
    socketEvents.broadcastChunkUpdate(canvasId, [i, j]);
    return true;
  }

  multi = null;

  static enqueuePixel(
    canvasId,
    color,
    i,
    j,
    offset,
  ) {
    if (!RedisCanvas.multi) {
      RedisCanvas.multi = client.multi();
      setTimeout(RedisCanvas.flushPixels, 100);
    }

    RedisCanvas.multi.addCommand(
      /*
       * NOTE:
       * If chunk doesn't exist or is smaller than the offset,
       * redis will pad with zeros
       * https://redis.io/commands/bitfield/
       */
      [
        'BITFIELD',
        `ch:${canvasId}:${i}:${j}`,
        'SET',
        UINT_SIZE,
        `#${offset}`,
        String(color),
      ],
    );
  }

  static flushPixels() {
    if (RedisCanvas.multi) {
      const { multi } = RedisCanvas;
      RedisCanvas.multi = null;
      // true for execAsPipeline
      return multi.exec(true).catch((err) => {
        // A rejected timer promise otherwise becomes an unhandled rejection
        // and can terminate the Node process during a Redis hiccup.
        logger.error(`Redis pixel batch flush failed: ${err.message}`);
        return null;
      });
    }
    return null;
  }

  static async getPixelIfExists(
    canvasId,
    i,
    j,
    offset,
  ) {
    // 1st bit -> protected or not
    // 2nd bit -> unused
    // rest (6 bits) -> index of color
    const args = [
      'BITFIELD',
      `ch:${canvasId}:${i}:${j}`,
      'GET',
      UINT_SIZE,
      `#${offset}`,
    ];
    const result = await client.sendCommand(args);
    if (!result) return null;
    const color = result[0];
    return color;
  }

  static async getPixelByOffset(
    canvasId,
    i,
    j,
    offset,
  ) {
    const clr = RedisCanvas.getPixelIfExists(canvasId, i, j, offset);
    // eslint-disable-next-line eqeqeq
    return (clr == null) ? 0 : clr;
  }

  static async getPixel(
    canvasId,
    canvasSize,
    x,
    y,
    z = null,
  ) {
    const [i, j] = getChunkOfPixel(canvasSize, x, y, z);
    const offset = getOffsetOfPixel(canvasSize, x, y, z);

    const clr = RedisCanvas.getPixelIfExists(canvasId, i, j, offset);
    // eslint-disable-next-line eqeqeq
    return (clr == null) ? 0 : clr;
  }
}


export default RedisCanvas;
