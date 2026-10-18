'use strict';
/**
 * import_globalpixel.cjs
 *
 * globalpixel.fun canvas 0 ("Earth") → bizim Redis'e aktarır.
 *
 * Renk dönüşümü:
 *   globalpixel index 0  = RGB(202,227,255) okyanus → bizim index 24
 *   globalpixel index X (X≠0) = kara/çizim    → X (olduğu gibi)
 *
 * Chunk mantığı:
 *   0 byte   → boş, atla (sunucu varsayılan 24 döner)
 *   65536 byte → kaydet (renk dönüşümü ile)
 *   başka boyut → atla (bilinmeyen format)
 */

const https        = require('https');
const { createClient } = require('redis');

const SITE        = 'globalpixel.fun';
const CANVAS      = '0';
const CHUNKS      = 256;          // her yönde chunk sayısı
const CHUNK_BYTES = 256 * 256;    // 65536
const CONCUR      = 40;
const OUR_OCEAN   = 24;

const HEADERS = {
  'User-Agent':      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
  'Referer':         `https://${SITE}/`,
  'Accept':          '*/*',
  'Accept-Encoding': 'identity',
};

const redis = createClient({ url: 'redis://localhost:6379' });

function fetchChunk(cx, cy) {
  return new Promise((resolve, reject) => {
    const req = https.get(
      { hostname: SITE, path: `/chunks/${CANVAS}/${cx}/${cy}.bmp`, headers: HEADERS, timeout: 30000 },
      (res) => {
        if (res.statusCode !== 200) { res.resume(); return resolve(null); }
        const bufs = [];
        res.on('data', b => bufs.push(b));
        res.on('end', () => resolve(Buffer.concat(bufs)));
        res.on('error', reject);
      }
    );
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
  });
}

async function main() {
  await redis.connect();
  console.log('Redis bağlandı.');

  // Eski verileri sil
  console.log('Eski ch:0:* verileri siliniyor...');
  let cur = 0, deleted = 0;
  do {
    const res = await redis.scan(cur, { MATCH: 'ch:0:*', COUNT: 500 });
    cur = res.cursor;
    if (res.keys.length) { await redis.del(res.keys); deleted += res.keys.length; }
  } while (cur !== 0);
  console.log(`Silindi: ${deleted} anahtar.`);

  // Tüm chunk koordinatlarını oluştur
  const tasks = [];
  for (let cy = 0; cy < CHUNKS; cy++)
    for (let cx = 0; cx < CHUNKS; cx++)
      tasks.push([cx, cy]);

  const total = tasks.length; // 65536
  let done = 0, stored = 0, skipped = 0, errors = 0;
  const t0 = Date.now();

  async function worker(queue) {
    while (queue.length > 0) {
      const [cx, cy] = queue.shift();
      let buf = null;
      for (let attempt = 0; attempt < 3; attempt++) {
        try { buf = await fetchChunk(cx, cy); break; }
        catch { if (attempt === 2) errors++; await new Promise(r => setTimeout(r, 600 * (attempt + 1))); }
      }

      if (!buf || buf.length === 0) {
        // Boş chunk = pure okyanus, atla
        skipped++;
      } else if (buf.length === CHUNK_BYTES) {
        // Tam chunk: renk 0 → 24 dönüşümü
        for (let i = 0; i < buf.length; i++) {
          if (buf[i] === 0) buf[i] = OUR_OCEAN;
        }
        await redis.set(`ch:${CANVAS}:${cx}:${cy}`, buf);
        stored++;
      } else {
        // Bilinmeyen boyut (compressed ocean chunk gibi), atla
        skipped++;
      }

      done++;
      if (done % 500 === 0 || done === total) {
        const s = ((Date.now() - t0) / 1000).toFixed(0);
        console.log(`  ${((done/total)*100).toFixed(1)}% (${done}/${total}) — stored:${stored} skipped:${skipped} errors:${errors} — ${s}s`);
      }
    }
  }

  const queue = [...tasks];
  await Promise.all(Array.from({ length: CONCUR }, () => worker(queue)));

  console.log('\n=== Import tamamlandı ===');
  console.log(`  Stored : ${stored}`);
  console.log(`  Skipped: ${skipped}`);
  console.log(`  Errors : ${errors}`);
  console.log(`  Süre   : ${((Date.now()-t0)/1000).toFixed(1)}s`);
  await redis.disconnect();
}

main().catch(e => { console.error('HATA:', e); process.exit(1); });
