/**
 * Minimap taban haritası
 * ======================
 * Canlı minimap'in altındaki "boş harita" bize ait: Natural Earth **10m**
 * verisinden Web Mercator olarak üretilmiş iki maske (bkz. tools/mklandmask.py).
 * Maskeler 8-bit gri+alfa ve KENARLARI ANTI-ALIASED: kıyılar testere gibi
 * değil, gerçek harita gibi görünür. Göller karayı deler, sınır çizgileri ince.
 *
 *   /minimap/landmask.png    → kara kapsamı (alfa), deniz şeffaf
 *   /minimap/borders.png     → ülke sınırları + kıyı hattı (ince çizgi)
 *   /minimap/manifest.json    → sürüm + ölçüler (istemci önbelleği kırmak için)
 *
 * Oyunun tuvali OSM tile'larından üretildiği için Web Mercator; bu maskeler de
 * tam olarak aynı projeksiyonda üretilir, böylece canlı pixel'ler taban
 * haritayla birebir hizalanır.
 */
import fs from 'fs';
import path from 'path';
import express from 'express';

import { ensureLive } from '../core/MiniMapLive.js';

const router = express.Router();

const DIR = path.join(__dirname, '../data/minimap');

/* maske sürümü: dosya değişirse istemci ?v=... ile taze kopyayı çeker */
const FILES = {
  'landmask.png': { file: 'landmask.png', type: 'image/png' },
  'borders.png': { file: 'borders.png', type: 'image/png' },
};

function fileVersion(name) {
  try {
    const stat = fs.statSync(path.join(DIR, name));
    return `${stat.size.toString(36)}-${Math.round(stat.mtimeMs).toString(36)}`;
  } catch {
    return 'missing';
  }
}

/* ==========================================================================
 * CANLI TILE PİRAMİDİ  (PixelPlanet tarzı)
 * --------------------------------------------------------------------------
 *   GET /minimap/live/meta.json          → motor durumu (sürüm, zoom, hazır?)
 *   GET /minimap/live/state?since=N      → N'den beri değişen tile listesi
 *   GET /minimap/live/:z/:x/:y.png       → 256x256 şeffaf PNG tile (z=0..4)
 *
 * Taban harita (kara/deniz/sınır) İSTEMCİDE çizilir; tile'lar yalnızca
 * oyuncuların koyduğu gerçek pixelleri taşır. Böylece harita "canlı" olur:
 * kim nereye pixel koyarsa ~1 saniye içinde minimap'te görünür.
 * ========================================================================== */

/**
 * İstemci hangi dünyayı gösteriyorsa onu söyler:  ?c=<canvasId>
 * Parametre yoksa 0 (ana dünya). Motor ilk istekte kurulur ve o dünyanın
 * mevcut chunk'ları arka planda taranır → "kendi dünyamı açtım, minimap orada
 * kendiliğinden çalıştı" deneyimi.
 */
function liveOf(req) {
  const raw = req.query ? req.query.c : undefined;
  const id = (raw === undefined || raw === null || raw === '')
    ? 0 : Number.parseInt(raw, 10);
  return ensureLive(Number.isFinite(id) ? id : 0);
}

router.get('/live/meta.json', (req, res) => {
  res.set({
    'Access-Control-allow-origin': '*',
    'Cache-Control': 'no-store, max-age=0',
  });
  const live = liveOf(req);
  if (!live) {
    /* bu dünyada minimap yok (tanımsız ya da 3D küre) */
    res.status(404).json({ ok: false, reason: 'no-live-canvas' });
    return;
  }
  res.json(live.meta());
});

router.get('/live/state', (req, res) => {
  res.set({
    'Access-Control-allow-origin': '*',
    'Cache-Control': 'no-store, max-age=0',
  });
  const live = liveOf(req);
  if (!live) {
    res.status(404).json({ ok: false, reason: 'no-live-canvas' });
    return;
  }
  res.json(live.state(req.query.since));
});

router.get('/live/:z/:x/:y.png', (req, res) => {
  const z = Number.parseInt(req.params.z, 10);
  const x = Number.parseInt(req.params.x, 10);
  const y = Number.parseInt(req.params.y, 10);
  const live = liveOf(req);
  if (!live) {
    res.status(404).type('text/plain').end('no live minimap for this canvas');
    return;
  }
  if (!live.validTile(z, x, y)) {
    res.status(404).type('text/plain').end('no such tile');
    return;
  }
  let buf = null;
  try {
    buf = live.renderTile(z, x, y);
  } catch (err) {
    res.status(500).type('text/plain').end('tile render failed');
    return;
  }
  if (!buf) {
    res.status(404).type('text/plain').end('no such tile');
    return;
  }
  const ver = live.tileVersion(z, x, y);
  res.set({
    'Access-Control-allow-origin': '*',
    /* sürüm değişene kadar tarayıcı önbelleği serbest; değişince URL değişir */
    'Cache-Control': 'public, max-age=120',
    'X-Minimap-Version': String(ver),
  });
  res.type('image/png');
  res.send(buf);
});

router.get('/manifest.json', (req, res) => {
  const version = fileVersion('landmask.png') + '.' + fileVersion('borders.png');
  res.set({
    'Access-Control-allow-origin': '*',
    'Cache-Control': 'public, max-age=300',
  });
  res.json({
    version,
    resolution: 2048,
    projection: 'web-mercator',
    land: { url: `/minimap/landmask.png?v=${version}`, ocean: 'transparent' },
    borders: { url: `/minimap/borders.png?v=${version}` },
    source: 'natural-earth-110m',
    /* canlı katman: oyuncu pixelleri anlık tile'lardan gelir; ?c=<dünya> */
    live: {
      res: 4096,
      cell: 16,
      tileSize: 256,
      maxZoom: 4,
      meta: '/minimap/live/meta.json',
      state: '/minimap/live/state',
      tileUrl: '/minimap/live/{z}/{x}/{y}.png',
    },
  });
});

router.get('/:name', (req, res, next) => {
  const entry = FILES[req.params.name];
  if (!entry) {
    next();
    return;
  }
  res.set({
    'Access-Control-allow-origin': '*',
    /* maskeler değişmediği sürece agresif cache: URL sürümle kırılır */
    'Cache-Control': `public, s-maxage=${30 * 24 * 3600}, max-age=${7 * 24 * 3600}`,
  });
  res.type(entry.type);
  res.sendFile(path.join(DIR, entry.file), (err) => {
    if (err && !res.headersSent) {
      res.status(404).type('text/plain').end('minimap base not generated');
    }
  });
});

export default router;
