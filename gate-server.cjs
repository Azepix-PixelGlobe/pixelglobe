'use strict';

/**
 * PixelPlanet IP Gate  —  DDoS Shield Edition
 *
 * Savunma katmanları (iç içe, dıştan içe):
 *   🔌  TCP bağlantı limiti          — IP başına max 40 eşzamanlı soket
 *   ⏱️  Slowloris koruması           — header/request timeout (10 s / 30 s)
 *   💣  Burst limiter                — 60 req / 10 s per IP (ani flood)
 *   🚫  Rate limiter (dakika)        — 6000 req / 60 s per IP
 *   🌐  Subnet throttle              — /24 subnet başına 3000 req / 60 s
 *   🔨  Auto-ban                     — 3 ihlal → 10 dk geçici yasak
 *   🛡️  VPN / Proxy / Bot tespiti   — ip-api.com (10 dk cache)
 *   📦  Body size limiti             — max 512 KB istek gövdesi
 *   🔎  Kötü istek filtresi          — boş Host / aşırı uzun URL
 *   ⚡  LRU response cache           — max 128 MB RAM
 *   🧵  Concurrency queue            — max 200 eşzamanlı proxy isteği
 */

const http        = require('http');
const net         = require('net');
const zlib        = require('zlib');
const EventEmitter = require('events');

// Keep-alive agent — reuses TCP connections to PixelPlanet instead of
// opening a new socket per HTTP request (huge throughput boost under load)
const keepAliveAgent = new http.Agent({
  keepAlive       : true,
  maxSockets      : 512,
  maxFreeSockets  : 64,
  timeout         : 60_000,
  freeSocketTimeout: 30_000,
});

const DEFAULT_HASH  = '#0,-1292,3956,-6';
const REDIRECT_JS   = `if(!location.hash||location.hash==='#')location.replace(location.href.split('#')[0]+'${DEFAULT_HASH}');`;
const REDIRECT_SNIP = `<script>${REDIRECT_JS}</script>`;

// Mobile performance CSS injected once into every HTML page
const MOBILE_CSS = `<style>
*{-webkit-tap-highlight-color:transparent}
body{overscroll-behavior:none;-webkit-overflow-scrolling:touch}
canvas{will-change:transform;touch-action:none}
/* Fixed UI must stay relative to the viewport, not the app canvas container. */
#app,#main{contain:none !important}
#app:has(.window.show) #canvas-controls,#main:has(.window.show) #canvas-controls,
#app:has(.window.show) #topbtnbar,#main:has(.window.show) #topbtnbar,
#app:has(.window.show) #chatbutton,#main:has(.window.show) #chatbutton,
#app:has(.window.show) #palselbutton,#main:has(.window.show) #palselbutton,
#app:has(.window.show) #brushsizebutton,#main:has(.window.show) #brushsizebutton,
#app:has(.window.show) #palettebox,#main:has(.window.show) #palettebox,
#app:has(.window.show) #mvmctrls,#main:has(.window.show) #mvmctrls,
#app:has(.window.show) #pencilbutton,#main:has(.window.show) #pencilbutton,
#app:has(.window.show) .coorbox,#main:has(.window.show) .coorbox,
#app:has(.window.show) .onlinebox,#main:has(.window.show) .onlinebox,
#app:has(.window.show) .cooldownbox,#main:has(.window.show) .cooldownbox{
display:none !important;visibility:hidden !important;pointer-events:none !important}
html.pixel-window-open #canvas-controls,html.pixel-window-open #topbtnbar,
html.pixel-window-open #chatbutton,html.pixel-window-open #palselbutton,
html.pixel-window-open #brushsizebutton,html.pixel-window-open #palettebox,
html.pixel-window-open #mvmctrls,html.pixel-window-open #pencilbutton,
html.pixel-window-open .coorbox,html.pixel-window-open .onlinebox,
html.pixel-window-open .cooldownbox{
display:none !important;visibility:hidden !important;pointer-events:none !important}
#chatbutton,#palselbutton,#brushsizebutton{position:fixed !important;z-index:5 !important}
.window:not(.show){visibility:hidden !important;pointer-events:none !important}
.window.show{position:fixed !important;z-index:5 !important;opacity:1 !important;visibility:visible !important;pointer-events:auto !important}
</style>`;

function injectRedirect(body, headers) {
  const ct  = (headers['content-type'] || '');
  const enc = (headers['content-encoding'] || '');
  // Skip non-HTML or gzip-encoded bodies (gzip HTML is not cached, only plain)
  if (!ct.includes('text/html') || enc.includes('gzip') || enc.includes('br')) {
    return { body, headers };
  }
  const html = body.toString('utf8');
  if (!html.includes('</head>')) return { body, headers };
  const inject = MOBILE_CSS + REDIRECT_SNIP;
  const newBody = Buffer.from(html.replace('</head>', inject + '</head>'), 'utf8');
  const newHeaders = Object.assign({}, headers);
  // Remove CSP so our injected redirect script is not blocked
  delete newHeaders['content-security-policy'];
  if (newBody.length !== body.length) {
    delete newHeaders['content-length']; // let Node recalculate
  }
  return { body: newBody, headers: newHeaders };
}

const PPPORT        = parseInt(process.env.PORT          || '5000', 10);
const INTERNAL_PORT = parseInt(process.env.INTERNAL_PORT || String(PPPORT + 1), 10);

console.log(`[Gate] External port  : ${PPPORT}`);
console.log(`[Gate] Internal port  : ${INTERNAL_PORT}`);

// ═══════════════════════════════════════════════════════════════════
//  🧠  EVENT BUS  (event-driven stats / monitoring)
// ═══════════════════════════════════════════════════════════════════
const bus = new EventEmitter();
bus.setMaxListeners(0);

const stats = {
  requests   : 0,
  blocked    : 0,
  rateLimited: 0,
  burst      : 0,
  autoBanned : 0,
  badRequest : 0,
  cacheHits  : 0,
  cacheMisses: 0,
  cacheBytes : 0,
  queued     : 0,
  wsUpgrades : 0,
  startTime  : Date.now(),
};

bus.on('request',    ()      => stats.requests++);
bus.on('blocked',    ()      => stats.blocked++);
bus.on('rateLimit',  ()      => stats.rateLimited++);
bus.on('burst',      ()      => stats.burst++);
bus.on('autoBan',    ()      => stats.autoBanned++);
bus.on('badRequest', ()      => stats.badRequest++);
bus.on('cacheHit',   ()      => stats.cacheHits++);
bus.on('cacheMiss',  ()      => stats.cacheMisses++);
bus.on('queued',     ()      => stats.queued++);
bus.on('wsUpgrade',  ()      => stats.wsUpgrades++);
bus.on('cacheBytes', (delta) => { stats.cacheBytes += delta; });

// Print stats every 60 seconds
setInterval(() => {
  const upMin  = Math.round((Date.now() - stats.startTime) / 60000);
  const hitPct = stats.cacheHits + stats.cacheMisses > 0
    ? ((stats.cacheHits / (stats.cacheHits + stats.cacheMisses)) * 100).toFixed(1)
    : '0.0';
  console.log(
    `[Gate][Stats] up=${upMin}m | req=${stats.requests} | ` +
    `blocked=${stats.blocked} | rl=${stats.rateLimited} | burst=${stats.burst} | ` +
    `banned=${stats.autoBanned} | bad=${stats.badRequest} | ` +
    `cache=${hitPct}% hit (${(stats.cacheBytes / 1024 / 1024).toFixed(1)} MB) | ` +
    `ws=${stats.wsUpgrades} | queued=${stats.queued}`
  );
}, 60_000).unref();


// ═══════════════════════════════════════════════════════════════════
//  🛡️  IP GUARD  (VPN / Proxy / Bot detection)
// ═══════════════════════════════════════════════════════════════════
const ipCache   = new Map();   // ip → { blocked, reason, ts }
const IP_CACHE_TTL = 10 * 60_000;  // 10 minutes

function getClientIP(req) {
  const xri = req.headers['x-real-ip'];
  if (xri) return xri.split(',')[0].trim();
  const xff = req.headers['x-forwarded-for'];
  if (xff) return xff.split(',')[0].trim();
  return req.socket.remoteAddress || '0.0.0.0';
}

function isPrivateIP(ip) {
  return /^(127\.|10\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.|::1$|fd|fc)/i.test(ip)
      || ip === '0.0.0.0' || ip === '::ffff:127.0.0.1';
}

function fetchIPInfo(ip) {
  return new Promise((resolve, reject) => {
    const clean = ip.replace(/^::ffff:/, '');
    const req   = http.get(
      `http://ip-api.com/json/${clean}?fields=status,proxy,hosting,isp,org,query`,
      { timeout: 6000 },
      (res) => {
        let body = '';
        res.on('data', (d) => { body += d; });
        res.on('end', () => {
          try { resolve(JSON.parse(body)); }
          catch (e) { reject(e); }
        });
      }
    );
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('ip-api timeout')); });
  });
}

async function checkIP(ip) {
  if (isPrivateIP(ip)) return { blocked: false, reason: null };

  const now    = Date.now();
  const cached = ipCache.get(ip);
  if (cached && (now - cached.ts) < IP_CACHE_TTL) {
    return { blocked: cached.blocked, reason: cached.reason };
  }

  try {
    const data    = await fetchIPInfo(ip);
    const blocked = data.proxy === true || data.hosting === true;
    const reason  = blocked
      ? (data.isp || data.org || (data.proxy ? 'VPN/Proxy' : 'Datacenter'))
      : null;
    ipCache.set(ip, { blocked, reason, ts: now });
    if (blocked) {
      console.log(`[Gate] BLOCKED  ${ip.replace(/^::ffff:/, '')} — ${reason}`);
      bus.emit('blocked');
    }
    return { blocked, reason };
  } catch (e) {
    console.error(`[Gate] IP check failed for ${ip}: ${e.message} — allowing`);
    return { blocked: false, reason: null };  // fail open
  }
}

// Periodic cleanup of stale IP cache entries
setInterval(() => {
  const cutoff = Date.now() - IP_CACHE_TTL * 2;
  for (const [ip, entry] of ipCache) {
    if (entry.ts < cutoff) ipCache.delete(ip);
  }
}, 15 * 60_000).unref();


// ═══════════════════════════════════════════════════════════════════
//  🔌  TCP BAĞLANTI LİMİTİ  (soket başına IP sayacı)
// ═══════════════════════════════════════════════════════════════════
const connPerIP   = new Map();   // ip → açık bağlantı sayısı
const CONN_MAX_IP = 40;          // IP başına max eşzamanlı TCP soket

function connAdd(ip) {
  connPerIP.set(ip, (connPerIP.get(ip) || 0) + 1);
}
function connDel(ip) {
  const n = (connPerIP.get(ip) || 1) - 1;
  if (n <= 0) connPerIP.delete(ip);
  else connPerIP.set(ip, n);
}
function connCheck(ip) {
  return isPrivateIP(ip) || (connPerIP.get(ip) || 0) < CONN_MAX_IP;
}


// ═══════════════════════════════════════════════════════════════════
//  🔨  AUTO-BAN  (tekrarlayan ihlalcileri geçici olarak yasakla)
// ═══════════════════════════════════════════════════════════════════
const banList     = new Map();   // ip → unbanAt (ms timestamp)
const violCount   = new Map();   // ip → { count, firstAt }
const BAN_THRESH  = 5;           // kaç ihlal sonrası ban
const BAN_WINDOW  = 5 * 60_000; // ihlal sayacı bu sürede sıfırlanır (5 dk)
const BAN_DURATION = 10 * 60_000; // ban süresi (10 dk)

function isBanned(ip) {
  if (isPrivateIP(ip)) return false;
  const until = banList.get(ip);
  if (!until) return false;
  if (Date.now() >= until) { banList.delete(ip); violCount.delete(ip); return false; }
  return true;
}

function recordViolation(ip) {
  if (isPrivateIP(ip)) return;
  const now  = Date.now();
  const rec  = violCount.get(ip) || { count: 0, firstAt: now };
  if (now - rec.firstAt > BAN_WINDOW) { rec.count = 0; rec.firstAt = now; }
  rec.count++;
  violCount.set(ip, rec);
  if (rec.count >= BAN_THRESH) {
    banList.set(ip, now + BAN_DURATION);
    violCount.delete(ip);
    bus.emit('autoBan');
    console.log(`[Gate] AUTO-BAN  ${ip.replace(/^::ffff:/, '')} — ${BAN_DURATION / 60000} dk`);
  }
}

// Temizlik her 15 dakikada
setInterval(() => {
  const now = Date.now();
  for (const [ip, until] of banList)   if (now >= until)      banList.delete(ip);
  for (const [ip, rec]  of violCount)  if (now - rec.firstAt > BAN_WINDOW) violCount.delete(ip);
}, 15 * 60_000).unref();


// ═══════════════════════════════════════════════════════════════════
//  💣  BURST LİMİTER  (kısa pencere, ani flood tespiti)
// ═══════════════════════════════════════════════════════════════════
const BURST_WINDOW = 10_000;   // 10 saniyelik pencere
const BURST_MAX    = 500;      // pencere başına max istek (50 req/s)
const burstWindows = new Map();

function burstCheck(ip) {
  if (isPrivateIP(ip)) return true;
  const now    = Date.now();
  const cutoff = now - BURST_WINDOW;
  let   reqs   = burstWindows.get(ip) || [];
  reqs = reqs.filter(t => t > cutoff);
  if (reqs.length >= BURST_MAX) {
    burstWindows.set(ip, reqs);
    bus.emit('burst');
    recordViolation(ip);
    return false;
  }
  reqs.push(now);
  burstWindows.set(ip, reqs);
  return true;
}

setInterval(() => {
  const cutoff = Date.now() - BURST_WINDOW;
  for (const [ip, reqs] of burstWindows)
    if (!reqs.some(t => t > cutoff)) burstWindows.delete(ip);
}, 30_000).unref();


// ═══════════════════════════════════════════════════════════════════
//  🚫  RATE LIMITER  (dakika penceresi, per IP)
// ═══════════════════════════════════════════════════════════════════
const RL_WINDOW_MS  = 60_000;
const RL_MAX_REQS   = 6000;      // 100 req/s ortalaması
const rlWindows     = new Map();

function rateLimitCheck(ip) {
  if (isPrivateIP(ip)) return true;
  const now    = Date.now();
  const cutoff = now - RL_WINDOW_MS;
  let   reqs   = rlWindows.get(ip) || [];
  reqs = reqs.filter(t => t > cutoff);
  if (reqs.length >= RL_MAX_REQS) {
    rlWindows.set(ip, reqs);
    bus.emit('rateLimit');
    recordViolation(ip);
    return false;
  }
  reqs.push(now);
  rlWindows.set(ip, reqs);
  return true;
}

setInterval(() => {
  const cutoff = Date.now() - RL_WINDOW_MS;
  for (const [ip, reqs] of rlWindows)
    if (!reqs.some(t => t > cutoff)) rlWindows.delete(ip);
}, 2 * 60_000).unref();


// ═══════════════════════════════════════════════════════════════════
//  🌐  SUBNET THROTTLE  (/24 — dağıtık saldırılara karşı)
// ═══════════════════════════════════════════════════════════════════
const SUBNET_MAX   = 3000;       // /24 subnet başına max req/dk
const subnetWindows = new Map();

function getSubnet(ip) {
  const c = ip.replace(/^::ffff:/, '');
  const p = c.split('.');
  return p.length === 4 ? `${p[0]}.${p[1]}.${p[2]}` : null;
}

function subnetCheck(ip) {
  if (isPrivateIP(ip)) return true;
  const subnet = getSubnet(ip);
  if (!subnet) return true;                      // IPv6 — skip
  const now    = Date.now();
  const cutoff = now - RL_WINDOW_MS;
  let   reqs   = subnetWindows.get(subnet) || [];
  reqs = reqs.filter(t => t > cutoff);
  if (reqs.length >= SUBNET_MAX) {
    subnetWindows.set(subnet, reqs);
    return false;
  }
  reqs.push(now);
  subnetWindows.set(subnet, reqs);
  return true;
}

setInterval(() => {
  const cutoff = Date.now() - RL_WINDOW_MS;
  for (const [s, reqs] of subnetWindows)
    if (!reqs.some(t => t > cutoff)) subnetWindows.delete(s);
}, 2 * 60_000).unref();


// ═══════════════════════════════════════════════════════════════════
//  🔎  KÖTÜ İSTEK FİLTRESİ
// ═══════════════════════════════════════════════════════════════════
function isBadRequest(req) {
  // Host header zorunlu
  if (!req.headers['host']) return 'no-host';
  // Aşırı uzun URL (2 KB üzeri)
  if ((req.url || '').length > 2048) return 'url-too-long';
  // HTTP metod kontrolü
  const method = req.method || '';
  if (!['GET','POST','HEAD','OPTIONS','PUT','PATCH','DELETE'].includes(method)) return 'bad-method';
  return null;
}


// ═══════════════════════════════════════════════════════════════════
//  📦  BODY SIZE LİMİTİ
// ═══════════════════════════════════════════════════════════════════
// PixelPlanet accepts files up to MAX_FILE_SIZE_MB (50 MB in config.ini).
// Leave room for multipart boundaries and request metadata.
const MAX_BODY_BYTES = 60 * 1024 * 1024;

function enforceBodyLimit(req, res) {
  const cl = parseInt(req.headers['content-length'] || '0', 10);
  if (cl > MAX_BODY_BYTES) {
    res.writeHead(413, { 'Content-Type': 'text/plain', 'Cache-Control': 'no-store' });
    res.end('413 Request Too Large');
    return false;
  }
  // Runtime sayacı (Content-Length olmasa bile)
  let received = 0;
  req.on('data', (chunk) => {
    received += chunk.length;
    if (received > MAX_BODY_BYTES) {
      req.destroy();
    }
  });
  return true;
}


// ═══════════════════════════════════════════════════════════════════
//  ⚡  RESPONSE CACHE  (LRU, max 128 MB, URL-keyed)
// ═══════════════════════════════════════════════════════════════════
const CACHE_MAX_BYTES = 128 * 1024 * 1024;  // 128 MB
const CACHE_MAX_ENTRY =  2 * 1024 * 1024;   // skip entries > 2 MB (large tiles etc.)

// TTLs by content type
const CACHE_TTL_STATIC = 30 * 60_000;   // JS, CSS, fonts → 30 min
const CACHE_TTL_TILE   =  5 * 60_000;   // tile PNGs → 5 min  (pixels change)
const CACHE_TTL_IMG    = 10 * 60_000;   // other images → 10 min

// LRU via insertion-order Map: delete + re-insert to promote to end
const lru   = new Map();   // cacheKey → { body: Buffer, headers, ts, size, ttl }
let   lruBytes = 0;

function lruTTL(url) {
  if (/\/tiles\//.test(url))                  return CACHE_TTL_TILE;
  if (/\.(js|css|woff2?|ttf|otf)(\?|$)/i.test(url)) return CACHE_TTL_STATIC;
  return CACHE_TTL_IMG;
}

// Cache key includes encoding variant so gzip clients get gzip responses
function lruKey(req) {
  const enc = req.headers['accept-encoding'] || '';
  const gz  = /gzip/i.test(enc) ? '|gz' : '';
  return req.url + gz;
}

function lruGet(req) {
  const key   = lruKey(req);
  const entry = lru.get(key);
  if (!entry) return null;
  if (Date.now() - entry.ts > entry.ttl) {
    lruBytes -= entry.size;
    lru.delete(key);
    bus.emit('cacheBytes', -entry.size);
    return null;
  }
  // Promote to MRU position
  lru.delete(key);
  lru.set(key, entry);
  bus.emit('cacheHit');
  return entry;
}

function lruSet(req, body, headers) {
  const key  = lruKey(req);
  const url  = req.url;
  const size = body.length;
  if (size > CACHE_MAX_ENTRY) return;          // skip oversized

  // Evict LRU entries until we have room
  while (lruBytes + size > CACHE_MAX_BYTES && lru.size > 0) {
    const [oldUrl, oldEntry] = lru.entries().next().value;
    lru.delete(oldUrl);
    lruBytes -= oldEntry.size;
    bus.emit('cacheBytes', -oldEntry.size);
  }

  // Strip headers that must not be replayed from cache
  const safeHeaders = {};
  for (const [k, v] of Object.entries(headers)) {
    const lk = k.toLowerCase();
    if (lk === 'set-cookie' || lk === 'transfer-encoding') continue;
    safeHeaders[k] = v;
  }
  safeHeaders['X-Gate-Cache'] = 'HIT';

  lru.set(key, { body, headers: safeHeaders, ts: Date.now(), size, ttl: lruTTL(url) });
  lruBytes += size;
  bus.emit('cacheBytes', size);
  bus.emit('cacheMiss');
}

// Dynamic per-user paths — must NEVER be cached regardless of extension
const NEVER_CACHE = new Set(['/captcha.svg', '/challenge.js']);

function isCacheable(req, statusCode) {
  if (req.method !== 'GET') return false;
  if (statusCode !== 200)   return false;
  if (req.headers['authorization']) return false;
  if (req.headers['cookie'])        return false;  // never cache cookie-bearing requests
  if (req.headers['range'])         return false;  // never cache partial requests
  const url = req.url.split('?')[0];
  if (NEVER_CACHE.has(url))         return false;  // per-user dynamic routes
  // Cache static assets, map tiles, and JS bundles (fingerprinted names are safe)
  // challenge.js and captcha.svg are excluded via NEVER_CACHE above
  return /\.(css|png|ico|webp|woff2?|ttf|otf)$/i.test(url)
      || /\/tiles\//.test(url)
      || /\.[a-f0-9]{8}\.js$/i.test(url);  // only cache fingerprinted JS bundles
}


// ═══════════════════════════════════════════════════════════════════
//  🧵  CONCURRENCY QUEUE  (cap simultaneous proxy requests)
// ═══════════════════════════════════════════════════════════════════
const QUEUE_MAX_CONCURRENT = 200;
const QUEUE_MAX_WAITING    = 500;   // drop requests beyond this
let   qActive  = 0;
const qWaiting = [];

function queueAcquire() {
  return new Promise((resolve, reject) => {
    if (qActive < QUEUE_MAX_CONCURRENT) {
      qActive++;
      resolve();
    } else if (qWaiting.length >= QUEUE_MAX_WAITING) {
      reject(new Error('queue full'));
    } else {
      qWaiting.push(resolve);
      bus.emit('queued');
    }
  });
}

function queueRelease() {
  if (qWaiting.length > 0) {
    qWaiting.shift()();
  } else {
    qActive--;
  }
}


// ═══════════════════════════════════════════════════════════════════
//  🌐  PROXY HELPERS
// ═══════════════════════════════════════════════════════════════════
function proxyHTTP(req, res, clientIP) {
  const headers = Object.assign({}, req.headers, { 'x-real-ip': clientIP });

  const proxyReq = http.request(
    { hostname: '127.0.0.1', port: INTERNAL_PORT, path: req.url, method: req.method, headers, agent: keepAliveAgent },
    (proxyRes) => {
      if (isCacheable(req, proxyRes.statusCode)) {
        // Buffer with hard byte cap — abort cache capture if response is too large
        const chunks = [];
        let buffered = 0;
        let overflow = false;

        proxyRes.on('data', (c) => {
          if (overflow) return;
          buffered += c.length;
          if (buffered > CACHE_MAX_ENTRY) {
            // Too large to cache — switch to pass-through
            overflow = true;
            if (!res.headersSent) {
              res.writeHead(proxyRes.statusCode, proxyRes.headers);
            }
            // Flush already-buffered chunks
            for (const ch of chunks) res.write(ch);
            chunks.length = 0;
            res.write(c);
            proxyRes.pipe(res, { end: true });
          } else {
            chunks.push(c);
          }
        });

        proxyRes.on('end', () => {
          if (overflow) return;
          const rawBody = Buffer.concat(chunks);
          const { body, headers: hdrs } = injectRedirect(rawBody, proxyRes.headers);
          lruSet(req, body, hdrs);
          if (!res.writableEnded) {
            res.writeHead(proxyRes.statusCode, hdrs);
            res.end(body);
          }
        });
      } else {
        // For non-cacheable HTML (e.g. main page with private, no-cache),
        // buffer and inject redirect script; pipe everything else directly.
        const ct = proxyRes.headers['content-type'] || '';
        if (ct.includes('text/html')) {
          const chunks2 = [];
          proxyRes.on('data', (c) => chunks2.push(c));
          proxyRes.on('end', () => {
            const rawBody = Buffer.concat(chunks2);
            const { body, headers: hdrs } = injectRedirect(rawBody, proxyRes.headers);
            if (!res.writableEnded) {
              res.writeHead(proxyRes.statusCode, hdrs);
              res.end(body);
            }
          });
        } else {
          res.writeHead(proxyRes.statusCode, proxyRes.headers);
          proxyRes.pipe(res, { end: true });
        }
      }
    }
  );

  proxyReq.on('error', (e) => {
    console.error(`[Gate] HTTP proxy error: ${e.message}`);
    if (!res.headersSent) {
      res.writeHead(502, { 'Content-Type': 'text/plain' });
      res.end('Bad Gateway');
    }
  });

  req.pipe(proxyReq, { end: true });
}

function proxyWS(req, clientSocket, head, clientIP) {
  const serverSocket = net.connect(INTERNAL_PORT, '127.0.0.1', () => {
    serverSocket.setNoDelay(true);
    clientSocket.setNoDelay(true);
    const headerMap = {};
    for (let i = 0; i < req.rawHeaders.length; i += 2) {
      headerMap[req.rawHeaders[i].toLowerCase()] = req.rawHeaders[i + 1];
    }
    headerMap['x-real-ip'] = clientIP;

    let raw = `${req.method} ${req.url} HTTP/${req.httpVersion}\r\n`;
    for (const [k, v] of Object.entries(headerMap)) raw += `${k}: ${v}\r\n`;
    raw += '\r\n';

    serverSocket.write(raw);
    if (head && head.length) serverSocket.write(head);
    serverSocket.pipe(clientSocket, { end: true });
    clientSocket.pipe(serverSocket, { end: true });
  });

  const cleanup = () => {
    try { clientSocket.destroy(); } catch (_) {}
    try { serverSocket.destroy(); } catch (_) {}
  };
  serverSocket.on('error', cleanup);
  clientSocket.on('error', cleanup);
  serverSocket.on('close', () => { try { clientSocket.destroy(); } catch (_) {} });
  clientSocket.on('close', () => { try { serverSocket.destroy(); } catch (_) {} });
}


// ═══════════════════════════════════════════════════════════════════
//  🚧  BLOCK PAGE
// ═══════════════════════════════════════════════════════════════════
function serveBlockPage(res, ip, reason) {
  const displayIP = ip.replace(/^::ffff:/, '');
  const html = `<!DOCTYPE html>
<html lang="tr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Erişim Engellendi — PixelPlanet</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:'Segoe UI',system-ui,sans-serif;background:#09090f;color:#e2e2ff;min-height:100vh;display:flex;align-items:center;justify-content:center}
.wrap{text-align:center;padding:48px 28px;max-width:480px}
.icon{font-size:80px;margin-bottom:28px;display:inline-block;animation:throb 2.4s ease-in-out infinite}
@keyframes throb{0%,100%{transform:scale(1);filter:drop-shadow(0 0 0px #ff4d6d)}50%{transform:scale(1.07);filter:drop-shadow(0 0 18px #ff4d6d88)}}
h1{font-size:1.75rem;font-weight:800;color:#ff4d6d;margin-bottom:10px;letter-spacing:-.5px}
.sub{font-size:1rem;color:#9090b0;line-height:1.65;margin-bottom:6px}
.card{margin:28px 0;background:rgba(255,77,109,.07);border:1px solid rgba(255,77,109,.22);border-radius:14px;padding:18px 22px}
.lbl{font-size:.7rem;color:#666;text-transform:uppercase;letter-spacing:1.2px;margin-bottom:5px}
.val{font-size:1.05rem;font-family:monospace;color:#ff9ab2;word-break:break-all}
.rsn{font-size:.82rem;color:#ff6b6b;margin-top:7px;display:flex;align-items:center;justify-content:center;gap:6px}
.dot{width:7px;height:7px;border-radius:50%;background:#ff4d6d;flex-shrink:0}
.hint{font-size:.92rem;color:#7070a0;margin-top:4px}
.footer{margin-top:36px;font-size:.75rem;color:#3a3a55;letter-spacing:.5px}
</style>
</head>
<body>
<div class="wrap">
  <span class="icon">🛡️</span>
  <h1>Erişim Engellendi</h1>
  <p class="sub">IP adresiniz <strong>VPN, proxy veya veri merkezi</strong> olarak tespit edildi.</p>
  <p class="sub">PixelPlanet'e erişmek için lütfen gerçek internet bağlantınızı kullanın.</p>
  <div class="card">
    <div class="lbl">Tespit Edilen IP Adresi</div>
    <div class="val">${displayIP}</div>
    ${reason ? `<div class="rsn"><span class="dot"></span>${reason}</div>` : ''}
  </div>
  <p class="hint">VPN ya da proxy'nizi kapatıp sayfayı yenileyin.</p>
  <div class="footer">PixelPlanet Güvenlik Sistemi</div>
</div>
</body>
</html>`;
  res.writeHead(403, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(html);
}

function serveRateLimitPage(res) {
  res.writeHead(429, {
    'Content-Type'  : 'text/plain; charset=utf-8',
    'Retry-After'   : '60',
    'Cache-Control' : 'no-store',
  });
  res.end('429 Too Many Requests — Lütfen 1 dakika bekleyin.');
}


// ═══════════════════════════════════════════════════════════════════
//  🚀  MAIN SERVER
// ═══════════════════════════════════════════════════════════════════
const server = http.createServer(async (req, res) => {
  bus.emit('request');
  const ip = getClientIP(req);

  // ① Auto-ban kontrolü (en hızlı — Map lookup)
  if (isBanned(ip)) {
    res.writeHead(429, { 'Content-Type': 'text/plain', 'Retry-After': '600', 'Cache-Control': 'no-store' });
    res.end('429 Temporarily Banned — Lütfen 10 dakika bekleyin.');
    return;
  }

  // ② Kötü istek filtresi
  const badReason = isBadRequest(req);
  if (badReason) {
    bus.emit('badRequest');
    res.writeHead(400, { 'Content-Type': 'text/plain', 'Cache-Control': 'no-store' });
    res.end('400 Bad Request');
    return;
  }

  // ③ Body size limiti (pixel gönderimi vs. aşırı büyük POST'lar)
  if (!enforceBodyLimit(req, res)) return;

  // ④ Burst limiti (ani flood tespiti — 10 sn pencere)
  if (!burstCheck(ip)) {
    res.writeHead(429, { 'Content-Type': 'text/plain', 'Retry-After': '10', 'Cache-Control': 'no-store' });
    res.end('429 Burst Limit — Çok hızlı istek gönderiyorsunuz.');
    return;
  }

  // ⑤ Dakika rate limit
  if (!rateLimitCheck(ip)) {
    serveRateLimitPage(res);
    return;
  }

  // ⑥ Subnet throttle (dağıtık saldırı tespiti)
  if (!subnetCheck(ip)) {
    res.writeHead(429, { 'Content-Type': 'text/plain', 'Retry-After': '60', 'Cache-Control': 'no-store' });
    res.end('429 Subnet Rate Limit');
    return;
  }

  // ⑦ VPN / Proxy / Bot check (async, cached)
  const { blocked, reason } = await checkIP(ip);
  if (blocked) {
    serveBlockPage(res, ip, reason);
    return;
  }

  // ⑧ Cache kontrolü (static assets — queue gerekmez)
  const cached = lruGet(req);
  if (cached) {
    const { body: cb, headers: ch } = injectRedirect(cached.body, cached.headers);
    res.writeHead(200, ch);
    res.end(cb);
    return;
  }

  // ⑨ Concurrency queue (PixelPlanet'e geçmeden önce)
  try {
    await queueAcquire();
  } catch {
    res.writeHead(503, { 'Content-Type': 'text/plain', 'Retry-After': '5' });
    res.end('503 Server Busy — try again shortly');
    return;
  }

  let released = false;
  const release = () => { if (!released) { released = true; queueRelease(); } };
  res.on('finish', release);
  res.on('close',  release);
  req.on('close',  release);

  proxyHTTP(req, res, ip);
});

// ═══════════════════════════════════════════════════════════════════
//  🔌  TCP BAĞLANTI SAYACI  (Slowloris + flood tespiti)
// ═══════════════════════════════════════════════════════════════════
server.on('connection', (socket) => {
  const ip = socket.remoteAddress || '0.0.0.0';

  // Bağlantı limiti kontrolü
  if (!isPrivateIP(ip) && !connCheck(ip)) {
    socket.destroy();
    return;
  }

  connAdd(ip);

  // Not: socket-level timeout kullanmıyoruz — keep-alive bağlantıları öldürür.
  // Slowloris koruması server.headersTimeout ile HTTP katmanında yapılıyor.
  socket.on('close', () => connDel(ip));
  socket.on('error', () => {});   // hataları sessizce yut
});

server.on('upgrade', async (req, socket, head) => {
  bus.emit('wsUpgrade');
  const ip = getClientIP(req);

  // Auto-ban + burst + rate limit kontrolleri
  if (isBanned(ip)) {
    socket.write('HTTP/1.1 429 Too Many Requests\r\nContent-Length: 0\r\nRetry-After: 600\r\nConnection: close\r\n\r\n');
    socket.destroy();
    return;
  }
  if (!burstCheck(ip) || !rateLimitCheck(ip)) {
    socket.write('HTTP/1.1 429 Too Many Requests\r\nContent-Length: 0\r\nRetry-After: 60\r\nConnection: close\r\n\r\n');
    socket.destroy();
    return;
  }

  // VPN / Proxy kontrolü
  const { blocked } = await checkIP(ip);
  if (blocked) {
    socket.write('HTTP/1.1 403 Forbidden\r\nContent-Length: 0\r\nConnection: close\r\n\r\n');
    socket.destroy();
    return;
  }

  // WS kurulduktan sonra socket timeout'ı kaldır (uzun süre açık kalacak)
  socket.setTimeout(0);
  proxyWS(req, socket, head, ip);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('[Gate] SIGTERM received — shutting down');
  server.close(() => process.exit(0));
});

// ═══════════════════════════════════════════════════════════════════
//  ⏱️  SLOWLORIS KORUMASI  (sunucu seviyesi timeout'lar)
// ═══════════════════════════════════════════════════════════════════
server.headersTimeout  = 10_000;   // header'lar 10 sn içinde gelmeli
// Large mobile uploads can take longer than the normal page-request budget.
server.requestTimeout  = 120_000;
server.keepAliveTimeout = 65_000;  // keep-alive bağlantı max 65 sn

server.listen(PPPORT, '0.0.0.0', () => {
  console.log(`[Gate] Listening on :${PPPORT}  →  PixelPlanet :${INTERNAL_PORT}`);
  console.log(`[Gate] DDoS Shield  : burst=${BURST_MAX}/${BURST_WINDOW/1000}s | rl=${RL_MAX_REQS}/${RL_WINDOW_MS/1000}s | subnet=${SUBNET_MAX}/${RL_WINDOW_MS/1000}s`);
  console.log(`[Gate] Auto-ban     : ${BAN_THRESH} ihlal → ${BAN_DURATION/60000} dk ban | max-conn/IP=${CONN_MAX_IP}`);
  console.log(`[Gate] Timeouts     : headers=${server.headersTimeout}ms | request=${server.requestTimeout}ms`);
  console.log(`[Gate] Cache        : max ${CACHE_MAX_BYTES / 1024 / 1024} MB RAM (tiles 5min, static 30min)`);
  console.log(`[Gate] Queue        : max ${QUEUE_MAX_CONCURRENT} concurrent / ${QUEUE_MAX_WAITING} waiting`);
});
