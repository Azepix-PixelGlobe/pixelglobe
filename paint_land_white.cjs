'use strict';
/**
 * paint_land_white.cjs
 *
 * Stored chunk'lar (pixeldays.xyz verisi):
 *   - piksel == 24 (okyanus mavi) → DOKUNmA
 *   - piksel != 24 → 0 (beyaz) yap
 *
 * Boş chunk'lar (Redis'te yok):
 *   - Texture'a göre kara alanıysa → tamamen beyaz (0) chunk oluştur
 *   - Okyanus alanıysa → bırak (sunucu zaten 24 döner)
 */

const sharp  = require('/home/runner/workspace/artifacts/pixelplanet/node_modules/sharp');
const redis  = require('/home/runner/workspace/artifacts/pixelplanet/node_modules/redis');

const CANVAS_SIZE     = 65536;
const CHUNK_SIZE      = 256;
const CHUNKS_PER_SIDE = CANVAS_SIZE / CHUNK_SIZE; // 256
const TEX_SIZE        = 4096;
const TEXTURE_PATH    = '/home/runner/workspace/artifacts/pixelplanet/map_texture.webp';
const OCEAN_IDX       = 24;
const CONCURRENCY     = 60;

function isOceanPixel(r, g, b) {
  return (b > 180) && (b > r + 15) && (g > r + 5);
}

// chunk'ın texture bölgesinde en az 1 kara pikseli var mı?
function chunkHasLand(texBuf, cx, cy) {
  for (let ty_off = 0; ty_off < 16; ty_off++) {
    for (let tx_off = 0; tx_off < 16; tx_off++) {
      const tx = cx * 16 + tx_off;
      const ty = cy * 16 + ty_off;
      const ti = (ty * TEX_SIZE + tx) * 3;
      if (!isOceanPixel(texBuf[ti], texBuf[ti + 1], texBuf[ti + 2])) return true;
    }
  }
  return false;
}

async function main() {
  const t0 = Date.now();
  console.log('=== paint_land_white: başlıyor ===');
  console.log('  Stored chunk: piksel!=24 → beyaz (0), piksel==24 → dokunma');
  console.log('  Boş kara chunk: beyaz oluştur');

  const texBuf = await sharp(TEXTURE_PATH)
    .resize(TEX_SIZE, TEX_SIZE)
    .removeAlpha()
    .raw()
    .toBuffer();
  console.log('Texture yüklendi.');

  const { commandOptions } = require('/home/runner/workspace/artifacts/pixelplanet/node_modules/redis');
  const client = redis.createClient({ url: 'redis://localhost:6379' });
  await client.connect();
  console.log('Redis bağlandı.');

  // Mevcut stored key'leri topla
  const storedKeys = new Set();
  let cursor = '0';
  do {
    const [nextCursor, keys] = await client.sendCommand(['SCAN', cursor, 'MATCH', 'ch:0:*', 'COUNT', '2000']);
    cursor = nextCursor;
    for (const k of keys) storedKeys.add(k);
  } while (cursor !== '0');
  console.log(`Mevcut stored chunk: ${storedKeys.size}`);

  let storedFixed  = 0;
  let emptyCreated = 0;
  let processed    = 0;
  const total = CHUNKS_PER_SIDE * CHUNKS_PER_SIDE; // 65536

  let chunkIdx = 0;

  async function worker() {
    while (true) {
      const myIdx = chunkIdx++;
      if (myIdx >= total) break;

      const cx = Math.floor(myIdx / CHUNKS_PER_SIDE);
      const cy = myIdx % CHUNKS_PER_SIDE;
      const key = `ch:0:${cx}:${cy}`;

      if (storedKeys.has(key)) {
        // ── Stored chunk ──────────────────────────────────────────
        // piksel == 24 → dokunma; piksel != 24 → 0 (beyaz)
        const chunk = await client.get(
          commandOptions({ returnBuffers: true }),
          key,
        );
        if (chunk && chunk.length === CHUNK_SIZE * CHUNK_SIZE) {
          let changed = false;
          for (let i = 0; i < chunk.length; i++) {
            if (chunk[i] !== OCEAN_IDX) {
              chunk[i] = 0;
              changed = true;
            }
          }
          if (changed) {
            await client.set(key, chunk);
            storedFixed++;
          }
        }
      } else {
        // ── Boş chunk ─────────────────────────────────────────────
        // Texture'a göre kara varsa beyaz chunk oluştur
        if (chunkHasLand(texBuf, cx, cy)) {
          const buf = Buffer.alloc(CHUNK_SIZE * CHUNK_SIZE, 0); // tamamen beyaz
          await client.set(key, buf);
          emptyCreated++;
        }
        // pure okyanus → dokunma (sunucu 24 döner)
      }

      processed++;
      if (processed % 2000 === 0) {
        const pct = ((processed / total) * 100).toFixed(1);
        const elapsed = ((Date.now() - t0) / 1000).toFixed(0);
        console.log(`  ${pct}% (${processed}/${total}) — storedFixed:${storedFixed} emptyLand:${emptyCreated} — ${elapsed}s`);
      }
    }
  }

  const workers = Array.from({ length: CONCURRENCY }, () => worker());
  await Promise.all(workers);

  await client.quit();

  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
  console.log('\n=== Tamamlandı ===');
  console.log(`  Stored chunk beyazlandı: ${storedFixed}`);
  console.log(`  Boş kara chunk oluşturuldu: ${emptyCreated}`);
  console.log(`  Süre: ${elapsed}s`);
}

main().catch(console.error);
