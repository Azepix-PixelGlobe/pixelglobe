#!/usr/bin/env node
/*
 * Paste an image onto the PixelPlanet canvas at given coordinates.
 * Uses closest palette color matching (not exact).
 * Usage: node scripts/paste_image.mjs <imageUrl> <x> <y> [canvasId=0]
 *
 * Example:
 *   node scripts/paste_image.mjs https://example.com/img.png 8948 -9960
 */

import { createClient } from 'redis';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import { readFileSync } from 'fs';
import https from 'https';
import http from 'http';

const __dirname = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

// Load sharp from pixelplanet's node_modules
const sharp = (await import(
  resolve(__dirname, '../node_modules/sharp/lib/index.js')
)).default;

// ── Config ────────────────────────────────────────────────────────────────────
const REDIS_URL  = 'redis://localhost:6379';
const TILE_SIZE  = 256;
const CANVAS_ID  = process.argv[5] ?? '0';
const IMAGE_URL  = process.argv[2];
const TARGET_X   = parseInt(process.argv[3], 10);
const TARGET_Y   = parseInt(process.argv[4], 10);

if (!IMAGE_URL || isNaN(TARGET_X) || isNaN(TARGET_Y)) {
  console.error('Usage: node scripts/paste_image.mjs <imageUrl> <x> <y> [canvasId=0]');
  process.exit(1);
}

// Canvas 0 palette (from src/canvases.json)
const canvases = JSON.parse(
  readFileSync(new URL('../src/src/canvases.json', import.meta.url)),
);
const canvas   = canvases[CANVAS_ID];
if (!canvas) {
  console.error(`Canvas ${CANVAS_ID} not found`);
  process.exit(1);
}
const CANVAS_SIZE = canvas.size;            // 65536
const COLORS      = canvas.colors;         // [[r,g,b], ...]
const CLR_IGNORE  = canvas.clrIgnore ?? 0; // transparent/unset threshold

console.log(`Canvas ${CANVAS_ID}: size=${CANVAS_SIZE}, colors=${COLORS.length}, clrIgnore=${CLR_IGNORE}`);
console.log(`Pasting ${IMAGE_URL} at (${TARGET_X}, ${TARGET_Y})`);

// ── Helpers ───────────────────────────────────────────────────────────────────
function mod(n, m) { return ((n % m) + m) % m; }

function getChunk(x, y) {
  const cx = Math.floor((x + CANVAS_SIZE / 2) / TILE_SIZE);
  const cy = Math.floor((y + CANVAS_SIZE / 2) / TILE_SIZE);
  return [cx, cy];
}

function getOffset(x, y) {
  const modOffset = mod(CANVAS_SIZE / 2, TILE_SIZE);
  const cx = mod(x + modOffset, TILE_SIZE);
  const cy = mod(y + modOffset, TILE_SIZE);
  return cy * TILE_SIZE + cx;
}

function closestPaletteIndex(r, g, b) {
  let bestIdx = CLR_IGNORE; // start from clrIgnore to skip transparent slots
  let bestDist = Infinity;
  for (let i = CLR_IGNORE; i < COLORS.length; i++) {
    const [pr, pg, pb] = COLORS[i];
    const dist = (pr - r) ** 2 + (pg - g) ** 2 + (pb - b) ** 2;
    if (dist < bestDist) {
      bestDist = dist;
      bestIdx  = i;
      if (dist === 0) break; // exact match
    }
  }
  return bestIdx;
}

// ── Download image ─────────────────────────────────────────────────────────────
function fetchBuffer(url) {
  return new Promise((resolve, reject) => {
    const lib = url.startsWith('https') ? https : http;
    lib.get(url, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        fetchBuffer(res.headers.location).then(resolve).catch(reject);
        return;
      }
      if (res.statusCode !== 200) {
        reject(new Error(`HTTP ${res.statusCode} for ${url}`));
        return;
      }
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end',  () => resolve(Buffer.concat(chunks)));
      res.on('error', reject);
    }).on('error', reject);
  });
}

// ── Main ───────────────────────────────────────────────────────────────────────
(async () => {
  // 1. Download
  console.log('Downloading image...');
  const imgBuf = await fetchBuffer(IMAGE_URL);
  console.log(`Downloaded ${imgBuf.length} bytes`);

  // 2. Decode with sharp → raw RGBA
  const { data, info } = await sharp(imgBuf)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const { width, height } = info;
  console.log(`Image decoded: ${width}x${height}`);

  // 3. Connect to Redis
  const client = createClient({ url: REDIS_URL });
  client.on('error', (e) => console.error('Redis error:', e));
  await client.connect();
  console.log('Connected to Redis');

  // 4. Bucket pixels per chunk
  // Map: "i:j" -> [{offset, colorIndex}]
  const chunkMap = new Map();

  let placed = 0;
  let skipped = 0;
  for (let py = 0; py < height; py++) {
    for (let px = 0; px < width; px++) {
      const base = (py * width + px) * 4;
      const r = data[base];
      const g = data[base + 1];
      const b = data[base + 2];
      const a = data[base + 3];

      if (a < 128) { skipped++; continue; } // transparent pixel

      const canvasX = TARGET_X + px;
      const canvasY = TARGET_Y + py;

      // bounds check
      const half = CANVAS_SIZE / 2;
      if (canvasX < -half || canvasX >= half || canvasY < -half || canvasY >= half) {
        skipped++;
        continue;
      }

      const colorIdx = closestPaletteIndex(r, g, b);
      const [ci, cj] = getChunk(canvasX, canvasY);
      const offset   = getOffset(canvasX, canvasY);

      const key = `${ci}:${cj}`;
      if (!chunkMap.has(key)) chunkMap.set(key, []);
      chunkMap.get(key).push({ offset, colorIdx, ci, cj });
      placed++;
    }
  }

  console.log(`Pixels to place: ${placed}, skipped (transparent/oob): ${skipped}`);
  console.log(`Chunks to update: ${chunkMap.size}`);

  // 5. Read each chunk, apply pixels, write back
  let totalWritten = 0;
  let chunkCount   = 0;
  for (const [key, pixels] of chunkMap) {
    const { ci, cj } = pixels[0];
    const redisKey   = `ch:${CANVAS_ID}:${ci}:${cj}`;

    // Read existing chunk (may be null if never touched)
    const existing = await client.get(
      { returnBuffers: true },
      redisKey,
    ).catch(() => null);

    const chunk = existing && existing.length
      ? new Uint8Array(existing)
      : new Uint8Array(TILE_SIZE * TILE_SIZE);

    // Ensure full size
    const fullChunk = new Uint8Array(TILE_SIZE * TILE_SIZE);
    fullChunk.set(chunk.slice(0, TILE_SIZE * TILE_SIZE));

    // Apply pixels
    for (const { offset, colorIdx } of pixels) {
      fullChunk[offset] = colorIdx;
    }

    // Write back
    await client.set(redisKey, Buffer.from(fullChunk.buffer));
    totalWritten += pixels.length;
    chunkCount++;

    if (chunkCount % 10 === 0 || chunkCount === chunkMap.size) {
      process.stdout.write(`\rWritten ${chunkCount}/${chunkMap.size} chunks, ${totalWritten} pixels...`);
    }
  }

  console.log('\nBroadcasting chunk updates via Redis pub/sub...');
  // Notify PixelPlanet server to reload updated chunks
  for (const [key, pixels] of chunkMap) {
    const { ci, cj } = pixels[0];
    // PixelPlanet listens on 'chunk' channel for updates
    await client.publish('pxl', JSON.stringify({
      type: 'chunk',
      canvasId: parseInt(CANVAS_ID, 10),
      chunk: [ci, cj],
    }));
  }

  await client.quit();
  console.log(`\nDone! Placed ${totalWritten} pixels across ${chunkCount} chunks.`);
})().catch((e) => {
  console.error('Fatal:', e);
  process.exit(1);
});
