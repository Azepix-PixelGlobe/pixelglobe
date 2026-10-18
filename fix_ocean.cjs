'use strict';
/**
 * fix_ocean.cjs
 * Stored chunk'lardaki index-0 (beyaz/boş) pikselleri texture haritasına bakarak
 * okyanus alanında olanları index 24 (açık mavi) ile değiştirir.
 * Kara pikselleri (index 0 ama land) dokunulmaz.
 */

const sharp  = require('/home/runner/workspace/artifacts/pixelplanet/node_modules/sharp');
const redis  = require('/home/runner/workspace/artifacts/pixelplanet/node_modules/redis');

const CANVAS_SIZE     = 65536;
const CHUNK_SIZE      = 256;
const CHUNKS_PER_SIDE = CANVAS_SIZE / CHUNK_SIZE; // 256
const TEX_SIZE        = 4096;
// Her chunk = 16×16 texture bölgesi → her texture piksel = 16×16 chunk pikseli
const BLOCK           = CHUNK_SIZE / (TEX_SIZE / CHUNKS_PER_SIDE); // 16
const TEXTURE_PATH    = '/home/runner/workspace/artifacts/pixelplanet/map_texture.webp';
const OCEAN_IDX       = 24;
const CONCURRENCY     = 50;

function isOceanPixel(r, g, b) {
  return (b > 180) && (b > r + 15) && (g > r + 5);
}

async function main() {
  const t0 = Date.now();
  console.log('=== fix_ocean: Stored chunk ocean fill başlıyor ===');

  // Texture'ı yükle
  const texBuf = await sharp(TEXTURE_PATH)
    .resize(TEX_SIZE, TEX_SIZE)
    .removeAlpha()
    .raw()
    .toBuffer();
  console.log('Texture yüklendi.');

  // Her chunk için 16×16 texture bloğundan bir "ocean mask" oluştur (256×256 bool buffer)
  // Bu maskeyi (cx,cy) → Uint8Array(65536) olarak on-demand hesapla
  function buildOceanMask(cx, cy) {
    const mask = new Uint8Array(CHUNK_SIZE * CHUNK_SIZE);
    for (let ty_off = 0; ty_off < 16; ty_off++) {
      for (let tx_off = 0; tx_off < 16; tx_off++) {
        const tx = cx * 16 + tx_off;
        const ty = cy * 16 + ty_off;
        const ti = (ty * TEX_SIZE + tx) * 3;
        const ocean = isOceanPixel(texBuf[ti], texBuf[ti + 1], texBuf[ti + 2]) ? 1 : 0;
        const blockRow = ty_off * BLOCK;
        const blockCol = tx_off * BLOCK;
        for (let br = 0; br < BLOCK; br++) {
          const rowStart = (blockRow + br) * CHUNK_SIZE + blockCol;
          mask.fill(ocean, rowStart, rowStart + BLOCK);
        }
      }
    }
    return mask;
  }

  const client = redis.createClient({ url: 'redis://localhost:6379' });
  await client.connect();
  console.log('Redis bağlandı.');

  // Tüm ch:0:* key'lerini tara
  const allKeys = [];
  let cursor = '0';
  do {
    const [nextCursor, keys] = await client.sendCommand(['SCAN', cursor, 'MATCH', 'ch:0:*', 'COUNT', '2000']);
    cursor = nextCursor;
    allKeys.push(...keys);
  } while (cursor !== '0');

  const total = allKeys.length;
  console.log(`Toplam ${total} chunk işlenecek.`);

  let fixed = 0;
  let unchanged = 0;
  let processed = 0;

  async function processKey(key) {
    // key format: ch:0:cx:cy
    const parts = key.split(':');
    const cx = parseInt(parts[2], 10);
    const cy = parseInt(parts[3], 10);

    const { commandOptions } = require('/home/runner/workspace/artifacts/pixelplanet/node_modules/redis');
    const chunk = await client.get(
      commandOptions({ returnBuffers: true }),
      key,
    );
    if (!chunk || chunk.length === 0) return;

    // Chunk'ta index-0 piksel var mı?
    let hasWhite = false;
    for (let i = 0; i < chunk.length; i++) {
      if (chunk[i] === 0) { hasWhite = true; break; }
    }
    if (!hasWhite) { unchanged++; return; }

    const mask = buildOceanMask(cx, cy);
    const buf = Buffer.from(chunk); // mutable kopya
    let changed = false;
    for (let i = 0; i < buf.length; i++) {
      if (buf[i] === 0 && mask[i] === 1) {
        buf[i] = OCEAN_IDX;
        changed = true;
      }
    }

    if (changed) {
      await client.set(key, buf);
      fixed++;
    } else {
      unchanged++;
    }
  }

  // CONCURRENCY kontrolü
  let idx = 0;
  async function worker() {
    while (idx < allKeys.length) {
      const key = allKeys[idx++];
      await processKey(key);
      processed++;
      if (processed % 1000 === 0) {
        const pct = ((processed / total) * 100).toFixed(1);
        const elapsed = ((Date.now() - t0) / 1000).toFixed(0);
        console.log(`  ${pct}% (${processed}/${total}) — fixed:${fixed} unchanged:${unchanged} — ${elapsed}s`);
      }
    }
  }

  const workers = Array.from({ length: CONCURRENCY }, () => worker());
  await Promise.all(workers);

  await client.quit();

  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
  console.log('\n=== Tamamlandı ===');
  console.log(`  Fixed   : ${fixed}`);
  console.log(`  Unchanged: ${unchanged}`);
  console.log(`  Süre    : ${elapsed}s`);
}

main().catch(console.error);
