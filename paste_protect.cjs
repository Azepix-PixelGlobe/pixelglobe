'use strict';
const sharp = require('/home/runner/workspace/artifacts/pixelplanet/dist/node_modules/sharp');
const redis = require('/home/runner/workspace/artifacts/pixelplanet/dist/node_modules/redis');

const CANVAS_ID = 0;
const CANVAS_SIZE = 65536;
const CHUNK_SIZE = 256;
const CANVAS_MIN_XY = -(CANVAS_SIZE / 2); // -32768

const PALETTE = [
  [255,255,255],[255,255,255],[228,228,228],[196,196,196],[136,136,136],
  [78,78,78],[0,0,0],[244,179,174],[255,167,209],[255,84,178],
  [255,101,101],[229,0,0],[154,0,0],[254,164,96],[229,149,0],
  [160,106,66],[96,64,40],[245,223,176],[255,248,137],[229,217,0],
  [148,224,68],[2,190,1],[104,131,56],[0,101,19],[202,227,255],
  [0,211,221],[0,131,199],[0,0,234],[25,25,115],[207,110,228],[130,0,128],
];

// Background color of the image (sampled from corners)
const BG_R = 202, BG_G = 228, BG_B = 255;
const BG_TOLERANCE = 18; // pixels within this distance are background → skip

function isBackground(r, g, b) {
  return Math.abs(r - BG_R) <= BG_TOLERANCE &&
         Math.abs(g - BG_G) <= BG_TOLERANCE &&
         Math.abs(b - BG_B) <= BG_TOLERANCE;
}

function nearestColor(r, g, b) {
  let minDist = Infinity;
  let bestIdx = 0;
  for (let i = 0; i < PALETTE.length; i++) {
    const [pr, pg, pb] = PALETTE[i];
    const d = (r - pr) ** 2 + (g - pg) ** 2 + (b - pb) ** 2;
    if (d < minDist) { minDist = d; bestIdx = i; }
  }
  return bestIdx;
}

async function main() {
  const START_X = -2154;
  const START_Y = 3022;
  const IMAGE_PATH = '/home/runner/workspace/attached_assets/ss8ogj_1783841563630.png';

  console.log('Loading image:', IMAGE_PATH);
  const { data, info } = await sharp(IMAGE_PATH)
    .raw()
    .toBuffer({ resolveWithObject: true });
  const { width, height, channels } = info;
  console.log(`Image: ${width}x${height} channels=${channels}`);
  console.log(`Background color skipped: rgb(${BG_R},${BG_G},${BG_B}) ±${BG_TOLERANCE}`);

  console.log('Connecting to Redis...');
  const client = redis.createClient({ url: 'redis://localhost:6379' });
  await client.connect();

  const absX = START_X - CANVAS_MIN_XY;
  const absY = START_Y - CANVAS_MIN_XY;
  const ucx = Math.floor(absX / CHUNK_SIZE);
  const ucy = Math.floor(absY / CHUNK_SIZE);
  const lcx = Math.floor((absX + width  - 1) / CHUNK_SIZE);
  const lcy = Math.floor((absY + height - 1) / CHUNK_SIZE);
  console.log(`Chunks: (${ucx},${ucy}) → (${lcx},${lcy})`);

  let totalWritten = 0, totalSkipped = 0;

  for (let cx = ucx; cx <= lcx; cx++) {
    for (let cy = ucy; cy <= lcy; cy++) {
      const key = `ch:${CANVAS_ID}:${cx}:${cy}`;
      const existing = await client.sendCommand(['GET', key]);
      const chunk = (existing && existing.length === CHUNK_SIZE * CHUNK_SIZE)
        ? new Uint8Array(existing)
        : new Uint8Array(CHUNK_SIZE * CHUNK_SIZE);

      const cOffX = cx * CHUNK_SIZE + CANVAS_MIN_XY - START_X;
      const cOffY = cy * CHUNK_SIZE + CANVAS_MIN_XY - START_Y;

      let written = 0, skipped = 0;
      let cOff = 0;
      for (let py = 0; py < CHUNK_SIZE; py++) {
        for (let px = 0; px < CHUNK_SIZE; px++) {
          const clrX = cOffX + px;
          const clrY = cOffY + py;
          if (clrX >= 0 && clrY >= 0 && clrX < width && clrY < height) {
            const off = (clrY * width + clrX) * channels;
            const r = data[off], g = data[off+1], b = data[off+2];
            const a = channels >= 4 ? data[off+3] : 255;

            if (a < 128 || isBackground(r, g, b)) {
              // Background / transparent → restore to ocean (index 24, unprotected)
              chunk[cOff] = 24;
              skipped++;
            } else {
              // Logo pixel → nearest palette color, protected
              const idx = nearestColor(r, g, b);
              chunk[cOff] = idx | 0x80;
              written++;
            }
          }
          cOff++;
        }
      }

      if (written + skipped > 0) {
        await client.sendCommand(['SET', key, Buffer.from(chunk.buffer)]);
        console.log(`  ch(${cx},${cy}): ${written} logo px | ${skipped} bg restored`);
        totalWritten += written;
        totalSkipped += skipped;
      }
    }
  }

  console.log(`\nDone! Logo pixels: ${totalWritten} | Background restored: ${totalSkipped}`);
  await client.quit();
}

main().catch(err => { console.error(err); process.exit(1); });
