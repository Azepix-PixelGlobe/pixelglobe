'use strict';
const https = require('https');
const { createClient } = require('redis');

const SITE       = 'pixeldays.xyz';
const CANVAS     = '0';
const CHUNKS     = 256;
const CONCUR     = 40;
const CHUNK_BYTES = 256 * 256;

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
  'Referer': `https://${SITE}/`,
};

const redis = createClient({ url: 'redis://localhost:6379' });

function fetchChunk(cx, cy) {
  return new Promise((resolve, reject) => {
    const url = `https://${SITE}/chunks/${CANVAS}/${cx}/${cy}.bmp`;
    const req = https.get(url, { headers: HEADERS, timeout: 30000 }, (res) => {
      if (res.statusCode !== 200) { res.resume(); return resolve(null); }
      const bufs = [];
      res.on('data', b => bufs.push(b));
      res.on('end', () => resolve(Buffer.concat(bufs)));
      res.on('error', reject);
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
  });
}

function isEmpty(buf) {
  if (!buf || buf.length !== CHUNK_BYTES) return true;
  for (let i = 0; i < buf.length; i++) if (buf[i] !== 0) return false;
  return true;
}

async function main() {
  await redis.connect();
  console.log('Redis bağlandı.');

  console.log('Eski ch:0:* verileri siliniyor...');
  let cur = 0, deleted = 0;
  do {
    const res = await redis.scan(cur, { MATCH: 'ch:0:*', COUNT: 500 });
    cur = res.cursor;
    if (res.keys.length) { await redis.del(res.keys); deleted += res.keys.length; }
  } while (cur !== 0);
  console.log(`Silindi: ${deleted} anahtar.`);

  const tasks = [];
  for (let cy = 0; cy < CHUNKS; cy++)
    for (let cx = 0; cx < CHUNKS; cx++)
      tasks.push([cx, cy]);

  const total = tasks.length;
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
      if (isEmpty(buf)) { skipped++; }
      else { await redis.set(`ch:${CANVAS}:${cx}:${cy}`, buf); stored++; }
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
