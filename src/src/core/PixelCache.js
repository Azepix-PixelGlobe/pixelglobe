/*
 * Caching pixels for a few ms before sending them
 * in bursts per chunk
 */

import socketEvents from '../socket/socketEvents.js';

const PIXEL_RECORD_BYTES = 4;
const INITIAL_BUFFER_BYTES = 1024;

class PixelCache {
  PXL_CACHE;

  constructor() {
    this.PXL_CACHE = new Map();
    this.flushCache = this.flushCache.bind(this);
  }

  /*
   * append pixel to cache
   * @param canvasId canvas id
   * @param i Chunk coordinates
   * @param j Chunk coordinates
   * @param offset Offset of pixel within chunk
   * @param color color index of pixel
   */
  append(
    canvasId,
    color,
    i,
    j,
    offset,
  ) {
    const { PXL_CACHE } = this;
    const chunkCanvasId = (canvasId << 16) | (i << 8) | j;

    let batch = PXL_CACHE.get(chunkCanvasId);
    if (typeof batch === 'undefined') {
      batch = {
        buffer: Buffer.allocUnsafe(INITIAL_BUFFER_BYTES),
        length: 0,
      };
      PXL_CACHE.set(chunkCanvasId, batch);
    }

    if (batch.length + PIXEL_RECORD_BYTES > batch.buffer.length) {
      const nextLength = Math.max(
        batch.buffer.length * 2,
        batch.length + PIXEL_RECORD_BYTES,
      );
      const nextBuffer = Buffer.allocUnsafe(nextLength);
      batch.buffer.copy(nextBuffer, 0, 0, batch.length);
      batch.buffer = nextBuffer;
    }

    batch.buffer.writeUInt8(offset >>> 16, batch.length);
    batch.buffer.writeUInt16BE(offset & 0x00FFFF, batch.length + 1);
    batch.buffer.writeUInt8(color, batch.length + 3);
    batch.length += PIXEL_RECORD_BYTES;
  }

  async flushCache() {
    const { PXL_CACHE: cache } = this;
    this.PXL_CACHE = new Map();

    cache.forEach((batch, chunkCanvasId) => {
      const canvasId = (chunkCanvasId & 0xFF0000) >> 16;
      const chunkId = chunkCanvasId & 0x00FFFF;
      socketEvents.broadcastPixels(
        canvasId,
        chunkId,
        batch.buffer.subarray(0, batch.length),
      );
    });
  }
}

const pixelCache = new PixelCache();
// send pixels from cache to websockets every 50ms
setInterval(pixelCache.flushCache, 50);

export default pixelCache;
