/**
 * MiniMap — canlı, tile tabanlı dünya minimap'i.
 * ==============================================
 * Kullanıcı isteği: "PixelPlanet'teki gibi böyle binlerce tile", "gerçekten
 * canlı harita olsun", "kendin harita yap (kara sınırlar beyaz, deniz açık
 * mavi)", "ne çok büyük ne çok küçük", "herkesin kendine ait minimap'i var".
 *
 * Katman katman nasıl çalışır:
 *   1) ZEMİN — bize ait taban harita: data/minimap/landmask.png (kara beyaz,
 *      deniz açık mavi) + borders.png (ülke sınırları). Natural Earth verisi
 *      Web Mercator olarak üretildi; oyunun tuvali de OSM/Web Mercator olduğu
 *      için canlı pixel'ler birebir hizalanır.
 *   2) UYDU KATMANI — sunucudaki tile piramidinden (zoom 3, 8x8 = 64 dosya)
 *      haritanın şu anki hâli çekilip zeminin üstüne bindirilir. Tile'lar
 *      gelmezse minimap zeminle çalışmaya devam eder, hiçbir şey bozulmaz.
 *   3) CANLI PIXEL — socket'ten gelen her yerleştirme (registerPixelUpdates)
 *      minimap pikseline işlenir; ayrıca tek tek parlamalar (blip) ve
 *      canlılık ısısı çizilir. Panel kapalıyken de birikmeye devam eder.
 *   4) IZGARA — harita 64x64 = 4096 tile. Açılışta merkezden dışa doğru tile
 *      tile açılır (radar taraması), canlı güncellemede SADECE değişen
 *      tile'lar yeniden birleştirilir (PixelPlanet minimap mantığı).
 *
 * Etkileşim: haritaya tıkla → oraya git · basılı tutup sürükle → gezdir ·
 * ok tuşları → kaydır · başlıktan sürükle → paneli taşı · tekerlek → zoom.
 * Panel kapsüle tıklanarak açılır (klavye kısayolu YOK — kullanıcı isteği).
 *
 * Konsoldan: window.pixelglobe.minimap { open, close, toggle, stats, ... }
 */
import { useCallback, useEffect, useRef, useState } from 'preact/hooks';

import { useStore, useSelector } from '../store/react-redux/index.js';
import { setViewCoordinates } from '../store/actions/index.js';
import { pgT } from '../utils/pgI18n.js';
import {
  BASE_URL, BLIP_MS, HEAT_RES, LIVE_RES, MM_RES, MM_VERSION, NET_TILE_PX,
  SNAP_RES, TILE_COUNT, TILES_PER_AXIS, ZOOM_LEVELS, MinimapModel, chunkOffsetToPixel,
  clamp, clampLevel, formatNumber, isMinimapCanvas, liveFromPanel, liveMetaUrl,
  liveStateUrl, liveTileUrl, liveToMm, liveTransform, liveViewport,
  liveVisibleTiles, mmToView, nextZoomLevel, pickColor, revealOrder, snapshotTiles,
  tileRect, viewLiveCenter, viewToRect, zoomLabel,
} from '../utils/pgMinimap.js';
import '../styles/pixelglobe-minimap.css';

/* --------------------------------------------------------------- görsel */

const COLORS = {
  sea: '#7cc7e9',
  seaDeep: '#63b4dd',
  land: '#ffffff',
  border: '#2f6f95',
  frame: 'rgba(255,212,121,0.9)',
  heatWarm: 'rgba(255,150,52,0.9)',
};

const REVEAL_PER_FRAME = 96;    // kare başına açılan tile (4096 tile ≈ 0.7 sn)
const SIZES = [264, 352, 464];  // S / M / L — varsayılan M (orta boy)
const SIZE_KEYS = ['s', 'm', 'l'];
const MAX_BACKING = 1200;       // görünür canvas üst sınırı
const DRAG_SEND_MS = 70;        // sürüklerken kameraya gönderim aralığı
const SNAPSHOT_CONCURRENCY = 6;
const LIVE_POLL_MS = 1000;      // sunucu 200 ms'de sürüm yayınlar; biz sn'de bir sorarız
const TILE_CACHE_MAX = 192;     // aynı anda tutulan tile görüntüsü tavanı (bellek)
const FULL_REFRESH_MIN_MS = 1500;   // "tam tazeleme" en fazla bu sıklıkta (trafik koruması)

/* ------------------------------------------------------------- depolama */

const LS_OPEN = 'pgx_minimap_open_v1';
const LS_POS = 'pgx_minimap_pos_v1';
const LS_SIZE = 'pgx_minimap_size_v1';

function lsGet(key, fallback) {
  try {
    const raw = window.localStorage.getItem(key);
    return raw === null ? fallback : raw;
  } catch {
    return fallback;
  }
}

function lsSet(key, value) {
  try {
    window.localStorage.setItem(key, String(value));
  } catch {
    /* gizli sekme / kota: sessizce yoksay */
  }
}

function lsGetJson(key) {
  try {
    const raw = lsGet(key, null);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

/* ---------------------------------------------------------------- dock */

/**
 * Panelin başlangıç konumu: sol üstteki bilgi kutusunun (#info) altı, yoksa
 * sol üst köşe. Böylece oyun arayüzünün hiçbir öğesinin üstüne binmeyiz.
 */
export function dockAnchor(doc, viewport) {
  const anchor = { left: 16, top: 16 };
  if (!doc || !doc.querySelector) return anchor;
  let node = null;
  try {
    node = doc.querySelector('#info, #loading');
  } catch {
    node = null;
  }
  if (!node || typeof node.getBoundingClientRect !== 'function') return anchor;
  const rect = node.getBoundingClientRect();
  const vh = (viewport && viewport.height) || 900;
  if (rect && rect.height > 4 && rect.bottom > 0 && rect.bottom < vh * 0.5) {
    anchor.top = Math.round(rect.bottom + 10);
  }
  return anchor;
}

export function clampPosition(pos, size, viewport) {
  const vw = (viewport && viewport.width) || 1280;
  const vh = (viewport && viewport.height) || 900;
  const maxLeft = Math.max(8, vw - (size.width || 352) - 8);
  const maxTop = Math.max(8, vh - (size.height || 440) - 8);
  return {
    left: clamp(Math.round(pos.left), 8, maxLeft),
    top: clamp(Math.round(pos.top), 8, maxTop),
  };
}

/* --------------------------------------------------------------- yardımcı */

export function loadImage(url) {
  return new Promise((resolve, reject) => {
    if (typeof Image === 'undefined') {
      reject(new Error('no-image'));
      return;
    }
    const img = new Image();
    img.decoding = 'async';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`image failed: ${url}`));
    img.src = url;
  });
}

/** Sınırlı eşzamanlılıkla liste işler (uydu tile taraması için). */
export async function pool(items, limit, worker) {
  const queue = items.slice();
  const runners = [];
  const count = Math.max(1, Math.min(limit, queue.length));
  for (let i = 0; i < count; i += 1) {
    runners.push((async () => {
      while (queue.length) {
        const item = queue.shift();
        /* eslint-disable no-await-in-loop */
        await worker(item);
        /* eslint-enable no-await-in-loop */
      }
    })());
  }
  await Promise.all(runners);
}

/** Belirli bir zoom için sunucu tile adresleri (2^z x 2^z). */
export function snapshotTilesAt(canvasId, zoom) {
  const per = 2 ** zoom;
  const list = [];
  for (let y = 0; y < per; y += 1) {
    for (let x = 0; x < per; x += 1) {
      list.push({ x, y, url: `/tiles/${canvasId}/${zoom}/${x}/${y}.webp` });
    }
  }
  return list;
}

/* --------------------------------------------------------------- motor */

/**
 * MinimapEngine — canvas işlerini yapan sınıf (React'ten bağımsız).
 * 2D bağlam yoksa (jsdom / eski tarayıcı) sessizce çizim yapmaz.
 */
export class MinimapEngine {
  constructor(model) {
    this.model = model;
    this.content = null;      // görünür canvas: harita (taban + canlı tile'lar)
    this.overlay = null;      // görünür canvas: çerçeve + ısı + izler
    this.ground = null;       // MM_RES² deniz + kara
    this.borders = null;      // MM_RES² sınır çizgileri (şeffaf zemin)
    this.live = null;         // MM_RES² anlık tahmin (kendi pixellerin + socket)
    this.heat = null;         // HEAT_RES² ısı görüntüsü
    this.palette = null;
    this.masksLoaded = false;

    /* ---- canlı tile katmanı (sunucu: /minimap/live) ---- */
    this.tiles = new Map();   // key 'z:x:y' -> { img, at }
    this.wanted = new Map();  // şu an görünürde olan tile'lar
    this.pending = new Set(); // yükleme kuyruğu (key)
    this.inflight = 0;
    this.maxInflight = 6;
    this.loadSeq = 0;
    this.canvasId = 0;        // hangi dünya (kendi dünyan da olabilir)
    this.liveOk = false;      // canlı katman kullanılabilir mi
    this.liveMode = 'idle';   // idle | loading | ready | off
    this.liveVer = 0;         // sunucudan görülen sürüm
    this.liveMeta = null;
    this.tileLoads = 0;
    this.tileErrors = 0;
    this.tileRefreshes = 0;
    this.pollCount = 0;
    this.lastPollAt = 0;
    this.lastFullAt = 0;

    /* ---- zoom / pencere ---- */
    this.level = 1;                        // 1x = tüm dünya
    this.center = { x: LIVE_RES / 2, y: LIVE_RES / 2 };   // canlı px merkezi
    this.tf = { k: 1, ox: 0, oy: 0 };      // MM → ekran dönüşümü

    /* ---- yedek katman: oyunun kendi tile sunucusu (canlı katman yoksa) ---- */
    this.snapshot = null;
    this.snapshotReady = false;
    this.snapshotZoom = null;
    this.snapshotTiles = 0;
    this.snapshotTotal = 0;

    this.revealOrder = revealOrder();
    this.view = [0, 0, 0.02];
    this.canvasSize = 65536;
    this.screen = { width: 1280, height: 900 };
    this.S = 1;               // ekran px / minimap px (zoom ile değişir)
    this.heatStamp = 0;
    this.ping = null;
    this.needsFull = true;
  }

  static makeCanvas(w, h = w) {
    if (typeof document === 'undefined') return null;
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    return canvas;
  }

  static ctxOf(canvas) {
    if (!canvas || typeof canvas.getContext !== 'function') return null;
    try {
      return canvas.getContext('2d');
    } catch {
      return null;
    }
  }

  attach(content, overlay) {
    this.content = content || null;
    this.overlay = overlay || null;
    this.needsFull = true;
  }

  get active() {
    return !!(this.content && MinimapEngine.ctxOf(this.content));
  }

  resize(cssWidth, cssHeight, dpr) {
    const ratio = clamp(dpr || 1, 1, 2);
    const width = clamp(Math.round(cssWidth * ratio), 64, MAX_BACKING);
    const height = clamp(Math.round((cssHeight || cssWidth) * ratio), 64, MAX_BACKING);
    this.width = cssWidth;                 // CSS px: dönüşüm bu ölçekte hesaplanır
    this.height = cssHeight || cssWidth;
    this.ensureLayers();
    [this.content, this.overlay].forEach((canvas) => {
      if (!canvas) return;
      if (canvas.width !== width) canvas.width = width;
      if (canvas.height !== height) canvas.height = height;
    });
    this.needsFull = true;
  }

  ensureLayers() {
    if (!this.live) this.live = MinimapEngine.makeCanvas(MM_RES);
  }

  /** Canlı katman hazır mı? Sunucu meta'sı geldiyse: evet. */
  markLiveReady(meta) {
    this.liveMeta = meta || null;
    this.liveOk = true;
    this.liveMode = 'loading';
    this.needsFull = true;
  }

  markLiveOff() {
    this.liveOk = false;
    this.liveMode = 'off';
    this.tiles.clear();
    this.wanted.clear();
    this.pending.clear();
    this.needsFull = true;
  }

  /* ------------------------------------------------------------ taban */

  buildGround(img) {
    if (!img) return;
    if (!this.ground) this.ground = MinimapEngine.makeCanvas(MM_RES);
    const ctx = MinimapEngine.ctxOf(this.ground);
    if (!ctx) return;
    const gradient = ctx.createLinearGradient(0, 0, 0, MM_RES);
    gradient.addColorStop(0, COLORS.seaDeep);
    gradient.addColorStop(0.5, COLORS.sea);
    gradient.addColorStop(1, COLORS.seaDeep);
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, MM_RES, MM_RES);
    /* kara maskesi beyazdır: onu kendi paletimizle boyayalım */
    const stamp = MinimapEngine.makeCanvas(MM_RES);
    const sctx = MinimapEngine.ctxOf(stamp);
    if (sctx) {
      sctx.drawImage(img, 0, 0, img.width || MM_RES, img.height || MM_RES, 0, 0, MM_RES, MM_RES);
      sctx.globalCompositeOperation = 'source-in';
      sctx.fillStyle = COLORS.land;
      sctx.fillRect(0, 0, MM_RES, MM_RES);
      ctx.drawImage(stamp, 0, 0);
    }
    this.masksLoaded = true;
    this.needsFull = true;
  }

  buildBorders(img) {
    if (!img) return;
    if (!this.borders) this.borders = MinimapEngine.makeCanvas(MM_RES);
    const ctx = MinimapEngine.ctxOf(this.borders);
    if (!ctx) return;
    const stamp = MinimapEngine.makeCanvas(MM_RES);
    const sctx = MinimapEngine.ctxOf(stamp);
    if (sctx) {
      sctx.drawImage(img, 0, 0, img.width || MM_RES, img.height || MM_RES, 0, 0, MM_RES, MM_RES);
      sctx.globalCompositeOperation = 'source-in';
      sctx.fillStyle = COLORS.border;
      sctx.fillRect(0, 0, MM_RES, MM_RES);
      ctx.clearRect(0, 0, MM_RES, MM_RES);
      ctx.drawImage(stamp, 0, 0);
    }
    this.needsFull = true;
  }

  /* -------------------------------------------------- anlık tahmin katmanı */

  paintLive(mmX, mmY, colorIndex) {
    if (!this.live) this.live = MinimapEngine.makeCanvas(MM_RES);
    const ctx = MinimapEngine.ctxOf(this.live);
    if (!ctx) return false;
    const color = pickColor(this.palette, colorIndex);
    if (!color) return false;
    ctx.fillStyle = color;
    ctx.fillRect(Math.floor(mmX), Math.floor(mmY), 1, 1);
    this.model.markDirty(mmX, mmY);
    return true;
  }

  /* ---------------------------------------- yedek: oyunun tile katmanı */

  drawSnapshotTile(img, zoom, tx, ty) {
    this.ensureLayers();
    const ctx = MinimapEngine.ctxOf(this.snapshot);
    if (!ctx || !img) return;
    const perTile = MM_RES / (2 ** zoom);           // tile başına mm pikseli
    const k = SNAP_RES / MM_RES;
    const dx = clamp(tx * perTile * k, 0, SNAP_RES - 1);
    const dy = clamp(ty * perTile * k, 0, SNAP_RES - 1);
    const dw = clamp(perTile * k, 1, SNAP_RES - dx);
    const dh = clamp(perTile * k, 1, SNAP_RES - dy);
    ctx.drawImage(img, 0, 0, img.width || NET_TILE_PX, img.height || NET_TILE_PX,
      dx, dy, dw, dh);
    this.snapshotTiles += 1;
    const span = perTile / (MM_RES / TILES_PER_AXIS);
    const gx0 = Math.round(tx * span);
    const gy0 = Math.round(ty * span);
    for (let gx = gx0; gx < gx0 + span; gx += 1) {
      for (let gy = gy0; gy < gy0 + span; gy += 1) {
        if (gx < 0 || gy < 0 || gx >= TILES_PER_AXIS || gy >= TILES_PER_AXIS) continue;
        this.model.dirty.add((gy * TILES_PER_AXIS) + gx);
      }
    }
    this.needsFull = true;
  }

  markSnapshotReady(zoom, total) {
    this.snapshotReady = true;
    this.snapshotZoom = zoom;
    this.snapshotTotal = total || 0;
    this.needsFull = true;
  }

  /* uydu tamamlandıysa zemini bırak (bellek) */
  maybeDropGround() {
    if (!this.snapshotReady || !this.snapshotTotal) return;
    if (this.snapshotTiles < this.snapshotTotal) return;
    this.ground = null;
  }

  /* ------------------------------------------------------- zoom / pencere */

  setLevel(level) {
    const next = clampLevel(level);
    if (next === this.level) return false;
    this.level = next;
    this.model.dirty.clear();
    this.needsFull = true;
    return true;
  }

  zoomBy(dir) {
    return this.setLevel(nextZoomLevel(this.level, dir));
  }

  setCenter(x, y) {
    const nx = clamp(Number(x) || 0, 0, LIVE_RES);
    const ny = clamp(Number(y) || 0, 0, LIVE_RES);
    if (Math.abs(nx - this.center.x) < 0.5 && Math.abs(ny - this.center.y) < 0.5) return;
    this.center = { x: nx, y: ny };
    this.needsFull = true;
  }

  viewport() {
    return liveViewport(this.level, this.center.x, this.center.y);
  }

  visibleTiles(margin = 1) {
    return liveVisibleTiles(this.level, this.center.x, this.center.y, margin, this.canvasId);
  }

  /** Sürüm değişince tile adresini tazeleyen yardımcı (canlılığın sırrı). */
  tileStamp() {
    this.loadSeq += 1;
    return this.loadSeq;
  }

  /**
   * Kamera merkezini ve panel ölçüsünü içeri alıp dönüşümü tazeler.
   * Dönen: pencereyi tarif eden viewport (canlı px).
   */
  updateTransform(panelWidth) {
    const vp = this.viewport();
    const t = liveTransform(vp, panelWidth || this.width || 1);
    this.tf = t;
    this.S = t.k;
    return vp;
  }

  /** MM uzayındaki bir katmanı (zemin/sınır/ısı) ekrana çizer. */
  drawMmLayer(ctx, layer, srcX, srcY, srcW, srcH) {
    if (!layer || !ctx) return;
    const { k, ox, oy } = this.tf;
    ctx.drawImage(
      layer, srcX, srcY, srcW, srcH,
      (srcX - ox) * k, (srcY - oy) * k, srcW * k, srcH * k,
    );
  }

  /* -------------------------------------------------- canlı tile yükleme */

  tileWidth(z) {
    return LIVE_RES / (2 ** z);
  }

  wantTile(tile, options = {}) {
    const key = tile.key || `${tile.z}:${tile.x}:${tile.y}`;
    const existing = this.wanted.get(key);
    this.wanted.set(key, {
      z: tile.z, x: tile.x, y: tile.y, key, url: tile.url,
    });
    const has = this.tiles.has(key);
    if (options.reload) this.tileRefreshes += 1;    // sürüm değişti → taze indirme
    if (options.reload || !has) {
      if (this.inflight < this.maxInflight) {
        this.startTile(key, tile);
      } else {
        this.pending.add(key);
        this.wanted.set(key, {
          z: tile.z, x: tile.x, y: tile.y, key, url: tile.url,
        });
      }
    }
    void existing;
  }

  startTile(key, tile) {
    if (typeof Image !== 'function') return;
    const seq = this.tileStamp();
    this.inflight += 1;
    const img = new Image();
    const done = () => {
      this.inflight = Math.max(0, this.inflight - 1);
      this.pump();
    };
    img.onload = () => {
      this.tiles.set(key, { img, at: Date.now() });
      this.tileLoads += 1;
      if (this.liveMode !== 'ready') this.liveMode = 'ready';
      this.markTileDirty(tile);
      done();
    };
    img.onerror = () => {
      this.tileErrors += 1;
      if (this.tileErrors <= 3) this.tiles.delete(key);
      done();
    };
    /* t= parametresi tarayıcı önbelleğini kırar → harita gerçekten canlı */
    const url = tile.url.includes('?') ? `${tile.url}&t=${seq}` : `${tile.url}?t=${seq}`;
    img.src = url;
  }

  pump() {
    if (!this.liveOk) return;
    while (this.inflight < this.maxInflight && this.pending.size) {
      const key = this.pending.values().next().value;
      this.pending.delete(key);
      const tile = this.wanted.get(key);
      if (tile) this.startTile(key, tile);
    }
  }

  /** Görünürdeki tile'ların hepsini (gerekiyorsa) yükler. */
  ensureTiles() {
    const list = this.visibleTiles(1);
    const fresh = new Map();
    for (let i = 0; i < list.length; i += 1) {
      const tile = list[i];
      fresh.set(tile.key, tile);
      if (!this.tiles.has(tile.key)) this.wantTile(tile);
    }
    this.wanted = fresh;
    this.pump();
    this.pruneTiles();
  }

  /**
   * Bellek tavanı: saatlerce gezip zoom yapan oyuncunun indirdiği tile'lar
   * birikmesin. Görünürde OLMAYAN en eski tile'lar önce atılır.
   */
  pruneTiles(max = TILE_CACHE_MAX) {
    if (this.tiles.size <= max) return 0;
    const stale = [];
    this.tiles.forEach((entry, key) => {
      if (!this.wanted.has(key)) stale.push([key, entry.at || 0]);
    });
    stale.sort((a, b) => a[1] - b[1]);
    let dropped = 0;
    for (let i = 0; i < stale.length && this.tiles.size > max; i += 1) {
      this.tiles.delete(stale[i][0]);
      dropped += 1;
    }
    return dropped;
  }

  markTileDirty(tile) {
    /* tile'ın kapladığı 32px alt-tile'ları kirli işaretle → sadece o bölge çizilir */
    const livePx = this.tileWidth(tile.z);
    const mmPx = liveToMm(livePx);
    const span = Math.max(1, Math.round(mmPx / (MM_RES / TILES_PER_AXIS)));
    const gx0 = Math.round(liveToMm(tile.x * livePx) / (MM_RES / TILES_PER_AXIS));
    const gy0 = Math.round(liveToMm(tile.y * livePx) / (MM_RES / TILES_PER_AXIS));
    for (let gx = gx0; gx < gx0 + span; gx += 1) {
      for (let gy = gy0; gy < gy0 + span; gy += 1) {
        if (gx < 0 || gy < 0 || gx >= TILES_PER_AXIS || gy >= TILES_PER_AXIS) continue;
        this.model.dirty.add((gy * TILES_PER_AXIS) + gx);
      }
    }
  }

  /** sunucuya "neler değişti?" sorusu (gerçek canlılık buradan gelir) */
  async pollState() {
    if (!this.liveOk || typeof fetch !== 'function') return null;
    this.pollCount += 1;
    this.lastPollAt = Date.now();
    let data = null;
    try {
      const res = await fetch(liveStateUrl(this.canvasId, this.liveVer), {
        credentials: 'same-origin',
      });
      if (!res || !res.ok) return null;
      data = await res.json();
    } catch {
      return null;
    }
    if (!data || typeof data.v !== 'number') return null;
    this.liveVer = data.v;
    let refreshed = 0;
    if (data.full) {
      /* tam tazeleme: görünür tile'ların hepsi, ama en fazla ~1.5 sn'de bir
       * (yoksa saniyede 64 tile indirip boşa trafik yapardık) */
      const now = Date.now();
      if (now - this.lastFullAt < FULL_REFRESH_MIN_MS) {
        return { v: data.v, full: true, refreshed: 0, throttled: true };
      }
      this.lastFullAt = now;
      const list = this.visibleTiles(0);
      for (let i = 0; i < list.length; i += 1) {
        this.wantTile(list[i], { reload: true });
        refreshed += 1;
      }
    } else {
      const changed = Array.isArray(data.tiles) ? data.tiles : [];
      for (let i = 0; i < changed.length && refreshed < 96; i += 1) {
        const entry = changed[i];
        const key = `${entry.z}:${entry.x}:${entry.y}`;
        const tile = this.wanted.get(key);
        if (tile) {
          this.wantTile(tile, { reload: true });
          refreshed += 1;
        } else if (this.tiles.has(key)) {
          /* önbellekte duran eski bir tile: tazele */
          this.wantTile({
            z: entry.z, x: entry.x, y: entry.y, key,
            url: liveTileUrl(this.canvasId, entry.z, entry.x, entry.y),
          }, { reload: true });
          refreshed += 1;
        }
      }
    }
    this.pump();
    return { v: data.v, full: !!data.full, refreshed };
  }

  /* ------------------------------------------------------------ çizim */

  /** Tek 32px alt-tile'ı katmanlardan birleştirir. */
  drawTile(index) {
    const ctx = MinimapEngine.ctxOf(this.content);
    if (!ctx) return;
    const { x, y, size } = tileRect(index);
    const { k, ox, oy } = this.tf;
    const dx = Math.round((x - ox) * k);
    const dy = Math.round((y - oy) * k);
    const dw = Math.max(1, Math.round((x + size - ox) * k) - dx);
    const dh = Math.max(1, Math.round((y + size - oy) * k) - dy);
    if (dw <= 0 || dh <= 0) return;

    ctx.save();
    ctx.beginPath();
    ctx.rect(dx, dy, dw, dh);
    ctx.clip();
    ctx.clearRect(dx, dy, dw, dh);
    this.drawMmLayer(ctx, this.ground, x, y, size, size);
    if (this.liveOk) {
      this.drawLiveTiles(ctx, x, y, size, size);
    } else if (this.snapshot && this.snapshotReady) {
      const sk = SNAP_RES / MM_RES;
      this.drawMmLayer(ctx, this.snapshot, x * sk, y * sk, size * sk, size * sk);
    }
    if (this.borders) {
      ctx.save();
      ctx.globalAlpha = 0.55;
      this.drawMmLayer(ctx, this.borders, x, y, size, size);
      ctx.restore();
    }
    if (this.live) this.drawMmLayer(ctx, this.live, x, y, size, size);
    ctx.restore();
    this.model.markRevealed(index);
    this.model.recomposed += 1;
  }

  /** Penceredeki canlı tile'ları verilen MM dikdörtgenine çizer. */
  drawLiveTiles(ctx, mmX, mmY, mmW, mmH) {
    const vp = liveViewport(this.level, this.center.x, this.center.y, LIVE_RES);
    const list = this.visibleTiles(1);
    ctx.save();
    ctx.imageSmoothingEnabled = this.tf.k <= 1.25;
    for (let i = 0; i < list.length; i += 1) {
      const tile = list[i];
      const cached = this.tiles.get(tile.key);
      if (!cached || !cached.img) continue;
      const livePx = this.tileWidth(tile.z);
      const tx = liveToMm(tile.x * livePx);
      const ty = liveToMm(tile.y * livePx);
      const tw = liveToMm(livePx);
      /* pencere dışındaki tile'ları çizmeye gerek yok */
      if (tx + tw <= vp.x0 * (MM_RES / LIVE_RES) - 1
        || ty + tw <= vp.y0 * (MM_RES / LIVE_RES) - 1
        || tx >= liveToMm(vp.x1) + 1 || ty >= liveToMm(vp.y1) + 1) continue;
      if (mmW > 0 && (tx + tw <= mmX || ty + tw <= mmY
        || tx >= mmX + mmW || ty >= mmY + mmH)) continue;
      this.drawMmLayer(ctx, cached.img, tx, ty, tw, tw);
    }
    ctx.restore();
  }

  drawFull() {
    const ctx = MinimapEngine.ctxOf(this.content);
    if (!ctx) return;
    const { width, height } = this.content;
    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = COLORS.sea;
    ctx.fillRect(0, 0, width, height);
    this.drawMmLayer(ctx, this.ground, 0, 0, MM_RES, MM_RES);
    if (this.liveOk) {
      this.drawLiveTiles(ctx, 0, 0, 0, 0);
    } else if (this.snapshot && this.snapshotReady) {
      this.drawMmLayer(ctx, this.snapshot, 0, 0, SNAP_RES, SNAP_RES);
    }
    if (this.borders) {
      ctx.save();
      ctx.globalAlpha = 0.55;
      this.drawMmLayer(ctx, this.borders, 0, 0, MM_RES, MM_RES);
      ctx.restore();
    }
    if (this.live) this.drawMmLayer(ctx, this.live, 0, 0, MM_RES, MM_RES);
    const before = this.model.revealed.size;
    const mark = this.model.markRevealed.bind(this.model);
    for (let i = 0; i < TILE_COUNT; i += 1) mark(i);
    this.model.recomposed += Math.max(0, TILE_COUNT - before);
    this.needsFull = false;
  }

  /** Üst katman: canlılık ısısı, parlamalar, kamera çerçevesi, tıklama. */
  drawOverlay(now) {
    const ctx = MinimapEngine.ctxOf(this.overlay);
    if (!ctx) return;
    const { width, height } = this.overlay;
    ctx.clearRect(0, 0, width, height);
    const { k, ox, oy } = this.tf;

    /* --- canlılık ısısı --- */
    if (!this.heat) this.heat = MinimapEngine.makeCanvas(HEAT_RES);
    const heatCtx = MinimapEngine.ctxOf(this.heat);
    if (heatCtx && now - this.heatStamp > 140) {
      this.heatStamp = now;
      heatCtx.clearRect(0, 0, HEAT_RES, HEAT_RES);
      const grid = this.model.heat;
      const max = Math.max(1, this.model.heatMax);
      let painted = 0;
      for (let i = 0; i < grid.length && painted < 4000; i += 1) {
        const value = grid[i];
        if (!value) continue;
        painted += 1;
        const alpha = clamp((value / max) * 0.95, 0.06, 0.95);
        heatCtx.fillStyle = `rgba(255,${Math.round(196 - alpha * 130)},58,${alpha.toFixed(3)})`;
        heatCtx.fillRect(i % HEAT_RES, Math.floor(i / HEAT_RES), 1, 1);
      }
    }
    if (this.heat) {
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      try {
        ctx.filter = 'blur(6px)';
      } catch {
        /* filter yok: bulanıklık olmadan devam */
      }
      ctx.globalAlpha = 0.5;
      ctx.drawImage(this.heat, 0, 0, HEAT_RES, HEAT_RES,
        (0 - ox) * k, (0 - oy) * k, MM_RES * k, MM_RES * k);
      ctx.restore();
    }

    /* --- taze yerleştirme parlamaları --- */
    const blips = this.model.blips;
    const dot = clamp(this.S * 3.2, 1.6, 5);
    for (let i = 0; i < blips.length; i += 1) {
      const blip = blips[i];
      const life = clamp(1 - ((now - blip.at) / BLIP_MS), 0, 1);
      if (life <= 0) continue;
      ctx.globalAlpha = life * 0.85;
      ctx.fillStyle = pickColor(this.palette, blip.color) || '#ffffff';
      ctx.beginPath();
      ctx.arc((blip.x - ox) * k, (blip.y - oy) * k,
        Math.max(1, dot * (0.6 + life)), 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;

    /* --- kamera çerçevesi --- */
    const rect = viewToRect(this.view, this.canvasSize, this.screen);
    const rx = (rect.x - ox) * k;
    const ry = (rect.y - oy) * k;
    const rw = Math.max(rect.w * k, 7);
    const rh = Math.max(rect.h * k, 7);
    ctx.save();
    ctx.strokeStyle = COLORS.frame;
    ctx.lineWidth = Math.max(1.2, width / 620);
    ctx.shadowColor = 'rgba(255,196,60,0.6)';
    ctx.shadowBlur = 8;
    if (rect.coversAll) ctx.setLineDash([6, 5]);
    ctx.strokeRect(rx, ry, rw, rh);
    ctx.restore();

    /* çok yakınsa artı işareti */
    if (rw < 18 || rh < 18) {
      const mx = rx + (rw / 2);
      const my = ry + (rh / 2);
      ctx.save();
      ctx.strokeStyle = 'rgba(255,255,255,0.9)';
      ctx.lineWidth = Math.max(1, width / 900);
      ctx.beginPath();
      ctx.moveTo(mx, my - 9);
      ctx.lineTo(mx, my + 9);
      ctx.moveTo(mx - 9, my);
      ctx.lineTo(mx + 9, my);
      ctx.stroke();
      ctx.restore();
    }

    /* --- tıklama halkası --- */
    if (this.ping) {
      const life = clamp(1 - ((now - this.ping.at) / 640), 0, 1);
      if (life <= 0) {
        this.ping = null;
      } else {
        ctx.save();
        ctx.strokeStyle = `rgba(255,212,121,${(life * 0.9).toFixed(3)})`;
        ctx.lineWidth = Math.max(1.2, width / 500);
        ctx.beginPath();
        ctx.arc((this.ping.x - ox) * k, (this.ping.y - oy) * k,
          ((1 - life) * Math.max(26, width * 0.08)) + 3, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
      }
    }
  }

  /** Kare: pencere → tile'lar → kirli bölgeler → üst katman. */
  frame(now) {
    if (!this.active) return;
    this.model.decayHeat(now);
    this.model.pruneBlips(now);
    this.updateTransform(this.width);
    if (this.liveOk) this.ensureTiles();
    if (this.needsFull) {
      this.drawFull();
      this.model.dirty.clear();
    } else {
      const dirty = this.model.takeDirty();
      if (dirty.length > 1400) {
        this.drawFull();
      } else {
        for (let i = 0; i < dirty.length; i += 1) this.drawTile(dirty[i]);
      }
    }
    this.drawOverlay(now);
  }

  pingAt(mmX, mmY, now) {
    this.ping = { x: mmX, y: mmY, at: now };
  }

  liveStats() {
    return {
      ok: this.liveOk,
      mode: this.liveMode,
      level: this.level,
      zoomLabel: zoomLabel(this.level),
      version: this.liveVer,
      tiles: this.tiles.size,
      visible: this.wanted.size,
      loads: this.tileLoads,
      errors: this.tileErrors,
      refreshes: this.tileRefreshes,
      polls: this.pollCount,
      inflight: this.inflight,
      queued: this.pending.size,
      meta: this.liveMeta,
    };
  }
}

/* ------------------------------------------------------------ bileşen */

export default function MiniMap() {
  const store = useStore();
  const view = useSelector((state) => state.canvas.view);
  const canvasId = useSelector((state) => state.canvas.canvasId);
  const canvasSize = useSelector((state) => state.canvas.canvasSize);
  const canvases = useSelector((state) => state.canvas.canvases);
  const palette = useSelector((state) => state.canvas.palette);

  const [open, setOpen] = useState(() => lsGet(LS_OPEN, '0') === '1');
  const [sizeIndex, setSizeIndex] = useState(() => {
    const raw = Number(lsGet(LS_SIZE, '1'));
    return raw >= 0 && raw < SIZES.length ? raw : 1;
  });
  const [pos, setPos] = useState(() => lsGetJson(LS_POS) || null);
  const [dragging, setDragging] = useState(false);
  const [zoomLevel, setZoomLevel] = useState(1);
  const [status, setStatus] = useState({
    live: 0,
    revealed: 0,
    snapshot: 'idle',
    liveMode: 'idle',
    liveTiles: 0,
    version: 0,
  });

  const wrapRef = useRef(null);
  const contentRef = useRef(null);
  const overlayRef = useRef(null);
  const readoutRef = useRef(null);
  const engineRef = useRef(null);
  const modelRef = useRef(null);
  const dragRef = useRef(null);
  const lastSendRef = useRef(0);
  const statusRef = useRef(status);
  const zoomLevelRef = useRef(1);
  const stateRef = useRef({ view, canvasSize, palette });

  statusRef.current = status;
  stateRef.current = { view, canvasSize, palette };

  const size = SIZES[sizeIndex];
  const catalogCanvas = canvases && canvases[canvasId];
  /*
   * Minimap yalnızca düz 2D tuvallerde çalışır (3D kürede anlamsız).
   * Katalog kaydında `size` yoksa (kendi dünyan) store'daki canvasSize
   * kullanılır → minimap yine de açılır.
   */
  const catalogWithSize = catalogCanvas && catalogCanvas.size
    ? catalogCanvas
    : { ...(catalogCanvas || {}), size: Number(canvasSize) || 0 };
  const usable = isMinimapCanvas(catalogWithSize);
  const liveCanvasId = Number.isFinite(Number(canvasId)) ? Number(canvasId) : 0;

  /* ----------------------------------------------------- taban + canlı */

  useEffect(() => {
    if (!open || !usable) return undefined;
    const model = new MinimapModel(Number(canvasSize) || 65536);
    const engine = new MinimapEngine(model);
    engine.canvasId = liveCanvasId;        // hangi dünya? (kendi dünyan da olur)
    modelRef.current = model;
    engineRef.current = engine;
    engine.palette = palette;
    engine.setLevel(1);
    let cancelled = false;

    const load = async () => {
      /* 1) taban harita: kara/deniz + sınırlar (bize ait, statik) */
      const manifest = await fetch(`${BASE_URL}/manifest.json?v=${MM_VERSION}`)
        .then((res) => (res && res.ok ? res.json() : null))
        .catch(() => null);
      if (cancelled) return;
      if (manifest) {
        model.manifest = manifest;
        const version = manifest.version || MM_VERSION;
        const land = await loadImage(`${BASE_URL}/landmask.png?v=${version}`).catch(() => null);
        if (cancelled) return;
        if (land) {
          engine.buildGround(land);
          setStatus((prev) => ({ ...prev, masks: 'partial' }));
        }
        const borders = await loadImage(`${BASE_URL}/borders.png?v=${version}`).catch(() => null);
        if (cancelled) return;
        if (borders) engine.buildBorders(borders);
      }

      /* 2) canlı katman: sunucudaki gerçek pixeller (tile servisi) */
      const meta = await fetch(liveMetaUrl(liveCanvasId)).then((res) => (res && res.ok
        ? res.json() : null)).catch(() => null);
      if (cancelled) return;
      if (meta && Number(meta.res) > 0) {
        engine.markLiveReady(meta);
        setStatus((prev) => ({ ...prev, liveMode: 'loading' }));
        engine.pollState().then((info) => {
          if (!info || cancelled || !engineRef.current) return;
          setStatus((prev) => ({ ...prev, version: info.v }));
        }).catch(() => {});
      } else {
        engine.markLiveOff();
        setStatus((prev) => ({ ...prev, liveMode: 'off' }));
      }
      engine.revealCursor = 0;
      engine.needsFull = true;
    };
    load();

    return () => {
      cancelled = true;
      if (engineRef.current === engine) engineRef.current = null;
      if (modelRef.current === model) modelRef.current = null;
    };
  }, [canvasId, canvasSize, usable, open, liveCanvasId]);

  /* ------------------------------------------------- canlı pixel köprüsü */

  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    const handler = (i, j, pixels) => {
      const model = modelRef.current;
      const engine = engineRef.current;
      if (!model || !Array.isArray(pixels) || !pixels.length) return;
      const now = Date.now();
      model.noteBatch(i, j, pixels, now);
      if (engine && engine.active) {
        for (let p = 0; p < pixels.length; p += 1) {
          const entry = pixels[p];
          if (!entry) continue;
          const { px, py } = chunkOffsetToPixel(i, j, entry[0]);
          const scale = Number(model.canvasSize) / MM_RES;
          engine.paintLive(px / scale, py / scale, entry[1]);
        }
      }
    };
    const hook = window.registerPixelUpdates;
    if (typeof hook === 'function') hook(handler);
    window.__pgMinimapHandler = handler;
    return () => {
      if (window.__pgMinimapHandler === handler) {
        delete window.__pgMinimapHandler;
        if (typeof window.registerPixelUpdates === 'function') {
          window.registerPixelUpdates(null);
        }
      }
    };
  }, []);

  /* ------------------------------------------------ canlı sunucu yoklaması */

  useEffect(() => {
    if (!open || !usable) return undefined;
    let alive = true;
    const tick = () => {
      const engine = engineRef.current;
      if (!engine || !engine.liveOk || !alive) return;
      engine.pollState().then((info) => {
        if (!info || !alive || !engineRef.current) return;
        setStatus((prev) => {
          const next = {
            ...prev,
            version: info.v,
            liveMode: engineRef.current.liveMode === 'off' ? 'off' : 'ready',
          };
          if (next.version === prev.version && next.liveMode === prev.liveMode) return prev;
          return next;
        });
      }).catch(() => {});
    };
    /* sunucu tazeleme penceresi 200 ms; biz 1 sn'de bir soruyoruz → gerçekten canlı */
    const timer = window.setInterval(tick, LIVE_POLL_MS);
    tick();
    return () => {
      alive = false;
      window.clearInterval(timer);
    };
  }, [open, usable]);

  /* ------------------------------------------------------ durum sayacı */

  useEffect(() => {
    const timer = window.setInterval(() => {
      const model = modelRef.current;
      const engine = engineRef.current;
      if (!model) return;
      const liveStats = engine ? engine.liveStats() : null;
      setStatus((prev) => {
        const merged = {
          ...prev,
          live: model.livePixels,
          revealed: model.revealed.size,
          snapshot: engine && engine.snapshotReady ? 'ready' : prev.snapshot,
          liveMode: liveStats ? liveStats.mode : prev.liveMode,
          liveTiles: liveStats ? liveStats.visible : prev.liveTiles,
          level: liveStats ? liveStats.level : prev.level,
          zoom: liveStats ? liveStats.level : prev.zoom,
        };
        if (merged.live === prev.live && merged.revealed === prev.revealed
          && merged.snapshot === prev.snapshot && merged.liveMode === prev.liveMode
          && merged.liveTiles === prev.liveTiles && merged.zoom === prev.zoom) {
          return prev;
        }
        return merged;
      });
      /* React durumu motorla aynı hizada kalsın (dışarıdan gelen zoom dahil) */
      if (engine && engine.level !== zoomLevelRef.current) {
        zoomLevelRef.current = engine.level;
        setZoomLevel(engine.level);
      }
    }, 700);
    return () => window.clearInterval(timer);
  }, []);

  /* ------------------------- yedek: canlı katman yoksa uydu taraması */

  useEffect(() => {
    if (!open || !usable) return undefined;
    if (status.liveMode !== 'off') return undefined;
    const engine = engineRef.current;
    if (!engine || engine.snapshotReady) return undefined;
    const plan = snapshotTiles(canvasId, Number(canvasSize));
    if (!plan) return undefined;
    let cancelled = false;

    const run = async () => {
      setStatus((prev) => ({ ...prev, snapshot: 'loading' }));
      const candidates = [plan.zoom, plan.zoom - 1, plan.zoom - 2].filter((z) => z >= 0);
      for (let c = 0; c < candidates.length; c += 1) {
        if (cancelled) return;
        const zoom = candidates[c];
        const tiles = snapshotTilesAt(canvasId, zoom);
        const probe = await loadImage(tiles[0].url).catch(() => null);
        if (cancelled) return;
        if (!probe) continue;
        engine.markSnapshotReady(zoom, tiles.length);
        engine.drawSnapshotTile(probe, zoom, 0, 0);
        setStatus((prev) => ({ ...prev, snapshot: 'ready' }));
        await pool(tiles.slice(1), SNAPSHOT_CONCURRENCY, async (tile) => {
          if (cancelled) return;
          const img = await loadImage(tile.url).catch(() => null);
          if (!img || cancelled) return;
          engine.drawSnapshotTile(img, zoom, tile.x, tile.y);
        });
        engine.maybeDropGround();
        return;
      }
      if (!cancelled) setStatus((prev) => ({ ...prev, snapshot: 'off' }));
    };
    run();

    return () => {
      cancelled = true;
    };
  }, [open, usable, canvasId, canvasSize, status.liveMode]);

  /* ------------------------------------------------------- çizim döngüsü */

  useEffect(() => {
    if (!open || !usable) return undefined;
    const engine = engineRef.current;
    if (!engine) return undefined;

    const attach = () => {
      const current = engineRef.current;
      if (!current) return;
      current.attach(contentRef.current, overlayRef.current);
    };
    const measure = () => {
      const wrap = wrapRef.current;
      const current = engineRef.current;
      if (!wrap || !current || typeof wrap.getBoundingClientRect !== 'function') return;
      const rect = wrap.getBoundingClientRect();
      if (rect && rect.width > 8) {
        current.resize(rect.width, rect.height || rect.width, window.devicePixelRatio);
      }
    };
    attach();
    measure();

    let raf = null;
    let ticks = 0;
    const loop = () => {
      const current = engineRef.current;
      ticks += 1;
      if (current) {
        const live = stateRef.current;
        current.view = live.view || [0, 0, 0.02];
        current.canvasSize = live.canvasSize || 65536;
        current.palette = live.palette;
        current.screen = {
          width: window.innerWidth || 1280,
          height: window.innerHeight || 900,
        };
        /* pencere kamerayı takip eder: minimap hep oyuncunun bölgesini gösterir */
        const center = viewLiveCenter(current.view, current.canvasSize);
        current.setCenter(center.x, center.y);
        if (!current.content) attach();
        if (ticks % 20 === 0) measure();
        try {
          current.frame(Date.now());
        } catch {
          /* çizim hatası döngüyü öldürmesin */
        }
      }
      raf = typeof window.requestAnimationFrame === 'function'
        ? window.requestAnimationFrame(loop)
        : window.setTimeout(loop, 33);
    };
    loop();

    let observer = null;
    if (typeof window.ResizeObserver === 'function' && wrapRef.current) {
      try {
        observer = new window.ResizeObserver(() => measure());
        observer.observe(wrapRef.current);
      } catch {
        observer = null;
      }
    }
    const onResize = () => measure();
    window.addEventListener('resize', onResize);
    window.addEventListener('orientationchange', onResize);
    return () => {
      if (raf && typeof window.cancelAnimationFrame === 'function') {
        window.cancelAnimationFrame(raf);
      } else if (raf) {
        window.clearTimeout(raf);
      }
      if (observer) observer.disconnect();
      window.removeEventListener('resize', onResize);
      window.removeEventListener('orientationchange', onResize);
    };
  }, [open, usable]);

  /* ------------------------------------------------------- konum / boyut */

  useEffect(() => {
    if (!open || pos) return;
    const viewport = {
      width: window.innerWidth || 1280,
      height: window.innerHeight || 900,
    };
    setPos(clampPosition(dockAnchor(document, viewport),
      { width: size, height: size + 140 }, viewport));
  }, [open, pos, size]);

  useEffect(() => {
    if (pos) lsSet(LS_POS, JSON.stringify(pos));
  }, [pos]);

  useEffect(() => {
    lsSet(LS_OPEN, open ? '1' : '0');
  }, [open]);

  useEffect(() => {
    lsSet(LS_SIZE, String(sizeIndex));
  }, [sizeIndex]);

  const onHeaderDown = useCallback((evt) => {
    if (evt.target && evt.target.closest && evt.target.closest('button')) return;
    const start = { x: evt.clientX, y: evt.clientY };
    const base = pos || { left: 16, top: 16 };
    let moved = false;
    const onMove = (move) => {
      const dx = move.clientX - start.x;
      const dy = move.clientY - start.y;
      if (!moved && Math.abs(dx) + Math.abs(dy) < 4) return;
      moved = true;
      setDragging(true);
      setPos(clampPosition({ left: base.left + dx, top: base.top + dy },
        { width: size, height: size + 150 },
        { width: window.innerWidth || 1280, height: window.innerHeight || 900 }));
    };
    const onUp = () => {
      setDragging(false);
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', onUp);
    };
    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onUp);
  }, [pos, size]);

  /* ------------------------------------------------------ zoom kontrolü */

  const applyZoom = useCallback((level) => {
    const engine = engineRef.current;
    const next = clampLevel(level);
    zoomLevelRef.current = next;
    setZoomLevel(next);
    if (engine) engine.setLevel(next);
    return next;
  }, []);

  /* motor gerçek durumun sahibi: art arda zoom çağrıları birbirini ezmesin */
  const zoomStep = useCallback((dir) => {
    const engine = engineRef.current;
    const base = engine ? engine.level : zoomLevel;
    return applyZoom(nextZoomLevel(base, dir));
  }, [applyZoom, zoomLevel]);

  /* --------------------------------------------------- harita etkileşimi */

  const navigate = useCallback((mmX, mmY, now) => {
    const scale = Number(view && view[2]) || 0.02;
    store.dispatch(setViewCoordinates(mmToView(mmX, mmY, Number(canvasSize) || 65536, scale)));
    const engine = engineRef.current;
    if (engine) engine.pingAt(mmX, mmY, now || Date.now());
  }, [store, view, canvasSize]);

  /** tıklanan nokta → minimap koordinatı (pencereye göre) */
  const mmFromEvent = useCallback((evt) => {
    const wrap = wrapRef.current;
    const engine = engineRef.current;
    if (!wrap || typeof wrap.getBoundingClientRect !== 'function') return null;
    const rect = wrap.getBoundingClientRect();
    if (!rect || !rect.width) return null;
    const height = rect.height || rect.width;
    const relX = clamp((evt.clientX - rect.left) / rect.width, 0, 1);
    const relY = clamp((evt.clientY - rect.top) / height, 0, 1);
    const vp = engine ? engine.viewport() : liveViewport(1, LIVE_RES / 2, LIVE_RES / 2);
    const live = liveFromPanel(relX, relY, vp);
    return { x: liveToMm(live.x), y: liveToMm(live.y), relX, relY };
  }, []);

  const onPointerDown = useCallback((evt) => {
    const point = mmFromEvent(evt);
    if (!point) return;
    dragRef.current = { startX: evt.clientX, startY: evt.clientY };
    if (evt.currentTarget && evt.currentTarget.setPointerCapture) {
      try {
        evt.currentTarget.setPointerCapture(evt.pointerId);
      } catch {
        /* pointer capture yok: sorun değil */
      }
    }
    navigate(point.x, point.y, Date.now());
  }, [mmFromEvent, navigate]);

  const onPointerMove = useCallback((evt) => {
    const point = mmFromEvent(evt);
    if (point && readoutRef.current) {
      const k = (Number(canvasSize) || 65536) / MM_RES;
      readoutRef.current.textContent = `${formatNumber(point.x * k)} · ${formatNumber(point.y * k)}`;
    }
    const drag = dragRef.current;
    if (!drag || !point) return;
    const moved = Math.abs(evt.clientX - drag.startX) + Math.abs(evt.clientY - drag.startY);
    if (moved < 6) return;
    const now = Date.now();
    if (now - lastSendRef.current < DRAG_SEND_MS) return;
    lastSendRef.current = now;
    navigate(point.x, point.y, now);
  }, [mmFromEvent, navigate, canvasSize]);

  const onPointerUp = useCallback(() => {
    dragRef.current = null;
  }, []);

  /* tekerlek → zoom (haritanın üzerindeyken) */
  const onWheel = useCallback((evt) => {
    if (typeof evt.preventDefault === 'function') evt.preventDefault();
    const dir = (evt.deltaY || 0) < 0 ? 1 : -1;
    zoomStep(dir);
  }, [zoomStep]);

  /* çift tık → o noktaya yakınlaş */
  const onDoubleClick = useCallback((evt) => {
    const point = mmFromEvent(evt);
    if (point) navigate(point.x, point.y, Date.now());
    zoomStep(1);
  }, [mmFromEvent, navigate, zoomStep]);

  const onKeyDown = useCallback((evt) => {
    const scale = Number(view && view[2]) || 0.02;
    const step = ((Number(canvasSize) || 65536) / scale)
      * (evt.shiftKey ? 0.35 : 0.12);
    const vx = Number(view && view[0]) || 0;
    const vy = Number(view && view[1]) || 0;
    let next = null;
    if (evt.key === 'ArrowLeft') next = [vx - step, vy, scale];
    else if (evt.key === 'ArrowRight') next = [vx + step, vy, scale];
    else if (evt.key === 'ArrowUp') next = [vx, vy - step, scale];
    else if (evt.key === 'ArrowDown') next = [vx, vy + step, scale];
    else if (evt.key === '+' || evt.key === '=') zoomStep(1);
    else if (evt.key === '-' || evt.key === '_') zoomStep(-1);
    if (!next) {
      if (evt.key === '+' || evt.key === '=' || evt.key === '-' || evt.key === '_') {
        evt.preventDefault();
      }
      return;
    }
    evt.preventDefault();
    store.dispatch(setViewCoordinates(next));
  }, [store, view, canvasSize, zoomStep]);

  /* --------------------------------------------------------- eylemler */

  const goWorld = useCallback(() => {
    const screen = Math.min(window.innerWidth || 1280, window.innerHeight || 900);
    const fit = clamp(screen / (Number(canvasSize) || 65536), 0.001, 40);
    store.dispatch(setViewCoordinates([0, 0, fit]));
    applyZoom(1);
    const engine = engineRef.current;
    if (engine) engine.pingAt(MM_RES / 2, MM_RES / 2, Date.now());
  }, [store, canvasSize, applyZoom]);

  const goCenter = useCallback(() => {
    store.dispatch(setViewCoordinates([0, 0, Number(view && view[2]) || 0.02]));
    const engine = engineRef.current;
    if (engine) engine.pingAt(MM_RES / 2, MM_RES / 2, Date.now());
  }, [store, view]);

  const cycleSize = useCallback(() => {
    setSizeIndex((value) => (value + 1) % SIZES.length);
  }, []);

  const resetPos = useCallback(() => setPos(null), []);

  /* --------------------------------------------------- dışa açık API */

  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.pixelglobe = window.pixelglobe || {};
    window.pixelglobe.minimap = {
      open: () => setOpen(true),
      close: () => setOpen(false),
      toggle: () => setOpen((value) => !value),
      isOpen: () => open,
      size: () => SIZES[sizeIndex],
      navigate,
      zoom: (dir) => zoomStep(dir),
      setZoom: (level) => applyZoom(level),
      stats: () => {
        const model = modelRef.current;
        const engine = engineRef.current;
        if (!model) return null;
        const live = engine ? engine.liveStats() : null;
        return {
          ...model.stats(),
          snapshotReady: !!(engine && engine.snapshotReady),
          snapshotZoom: engine ? engine.snapshotZoom : null,
          masks: !!(engine && engine.masksLoaded),
          liveActive: !!(engine && engine.liveOk),
          liveMode: live ? live.mode : 'idle',
          liveLevel: live ? live.level : 1,
          liveZoomLabel: live ? live.zoomLabel : '1x',
          liveVersion: live ? live.version : 0,
          liveTiles: live ? live.tiles : 0,
          liveVisible: live ? live.visible : 0,
          liveLoads: live ? live.loads : 0,
          liveErrors: live ? live.errors : 0,
          liveRefreshes: live ? live.refreshes : 0,
          livePolls: live ? live.polls : 0,
          liveCache: live ? live.tiles : 0,
          liveQueued: live ? live.queued : 0,
        };
      },
      model: () => modelRef.current,
      engine: () => engineRef.current,
    };
  }, [navigate, open, sizeIndex, zoomStep, applyZoom]);

  /*
   * NOT: Minimap'in klavye kısayolu YOKTUR (kullanıcı isteği: "M tuşuna basınca
   * hiçbir şey açılmasın"). Panel yalnızca kendi düğmesinden açılır:
   * sol üstteki "Minimap" kapsülü, ya da konsoldan pixelglobe.minimap.open().
   */

  /* ---------------------------------------------------------- görünüm */

  if (!usable) return null;

  const title = (catalogCanvas && (catalogCanvas.title || catalogCanvas.name))
    || pgT('minimap.canvasFallback');
  const desc = (catalogCanvas && (catalogCanvas.desc || catalogCanvas.description)) || '';
  const anchor = pos || { left: 16, top: 16 };

  /* canlı mod etiketi: hazır / yükleniyor / yedek uydu */
  let liveLabel = pgT('minimap.live.loading');
  let liveClass = 'live--loading';
  if (status.liveMode === 'off') {
    liveLabel = status.snapshot === 'ready'
      ? pgT('minimap.snapshot.ready')
      : (status.snapshot === 'loading' ? pgT('minimap.snapshot.loading') : pgT('minimap.live.off'));
    liveClass = 'live--off';
  } else if (status.liveMode === 'ready') {
    liveLabel = pgT('minimap.live.ready');
    liveClass = 'live--ready';
  }

  if (!open) {
    return (
      <button
        type="button"
        className="pg-mm-pill"
        style={{ left: `${anchor.left}px`, top: `${anchor.top}px`, width: `${size}px` }}
        onClick={() => setOpen(true)}
        aria-expanded="false"
        title={pgT('minimap.open')}
      >
        <span className="pg-mm-pill-globe" aria-hidden="true">🗺️</span>
        <span className="pg-mm-pill-label">{pgT('minimap.title')}</span>
        <span className="pg-mm-pill-live" data-live={status.live ? 'on' : 'off'}>
          <i aria-hidden="true" />
          {pgT('minimap.live')}
        </span>
        <span className="pg-mm-pill-chevron" aria-hidden="true">⌄</span>
      </button>
    );
  }

  return (
    <section
      className={`pg-mm-panel${dragging ? ' dragging' : ''}`}
      style={{ left: `${anchor.left}px`, top: `${anchor.top}px`, width: `${size}px` }}
      aria-label={pgT('minimap.title')}
    >
      <header className="pg-mm-head" onPointerDown={onHeaderDown} title={pgT('minimap.drag')}>
        <span className="pg-mm-head-icon" aria-hidden="true">🛰️</span>
        <span className="pg-mm-titles">
          <span className="pg-mm-kicker">{pgT('minimap.kicker')}</span>
          <strong>{title}</strong>
          {desc ? <em>{desc}</em> : null}
        </span>
        <span className="pg-mm-head-actions">
          <button
            type="button"
            className="pg-mm-icon"
            onClick={cycleSize}
            title={pgT('minimap.sizeHint', { size: pgT(`minimap.size.${SIZE_KEYS[(sizeIndex + 1) % SIZES.length]}`) })}
            aria-label={pgT('minimap.sizeHint', { size: pgT(`minimap.size.${SIZE_KEYS[(sizeIndex + 1) % SIZES.length]}`) })}
          >
            {SIZE_KEYS[sizeIndex].toUpperCase()}
          </button>
          <button
            type="button"
            className="pg-mm-icon pg-mm-icon--zoom"
            onClick={() => zoomStep(1)}
            title={pgT('minimap.zoomIn')}
            aria-label={pgT('minimap.zoomIn')}
          >
            +
          </button>
          <button
            type="button"
            className="pg-mm-icon pg-mm-icon--zoom"
            onClick={() => zoomStep(-1)}
            title={pgT('minimap.zoomOut')}
            aria-label={pgT('minimap.zoomOut')}
          >
            −
          </button>
          <button
            type="button"
            className="pg-mm-icon"
            onClick={resetPos}
            title={pgT('minimap.resetPos')}
            aria-label={pgT('minimap.resetPos')}
          >
            ⌖
          </button>
          <button
            type="button"
            className="pg-mm-icon pg-mm-icon--close"
            onClick={() => setOpen(false)}
            title={pgT('minimap.close')}
            aria-label={pgT('minimap.close')}
          >
            ✕
          </button>
        </span>
      </header>

      <div
        className="pg-mm-map"
        ref={wrapRef}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerLeave={onPointerUp}
        onKeyDown={onKeyDown}
        onWheel={onWheel}
        onDblClick={onDoubleClick}
        role="application"
        tabIndex={0}
        aria-label={pgT('minimap.mapLabel')}
      >
        <canvas className="pg-mm-canvas" ref={contentRef} aria-hidden="true" />
        <canvas className="pg-mm-canvas pg-mm-overlaycanvas" ref={overlayRef} aria-hidden="true" />
        <span className="pg-mm-scan" aria-hidden="true" />
        <span className="pg-mm-badges">
          <span className="pg-mm-badge pg-mm-badge--live" data-on={status.live ? 'on' : 'off'}>
            <i aria-hidden="true" />
            {pgT('minimap.live')}
          </span>
          <span className={`pg-mm-badge pg-mm-badge--snap ${liveClass}`}>{liveLabel}</span>
          <span className="pg-mm-badge pg-mm-badge--zoom">{zoomLabel(zoomLevel)}</span>
        </span>
      </div>

      <footer className="pg-mm-foot">
        <span className="pg-mm-coords" title={pgT('minimap.cursor')}>
          <span aria-hidden="true">📍</span>
          <b ref={readoutRef}>—</b>
        </span>
        <span className="pg-mm-stat">{pgT('minimap.liveTiles', { n: formatNumber(status.liveTiles || 0) })}</span>
        <span className="pg-mm-stat pg-mm-stat--live">
          {pgT('minimap.pixels', { n: formatNumber(status.live) })}
        </span>
      </footer>

      <div className="pg-mm-tools">
        <span className="pg-mm-zoom">
          <button
            type="button"
            onClick={() => zoomStep(-1)}
            disabled={zoomLevel <= ZOOM_LEVELS[0]}
            title={pgT('minimap.zoomOut')}
            aria-label={pgT('minimap.zoomOut')}
          >
            −
          </button>
          <button
            type="button"
            className="pg-mm-zoom-chip"
            onClick={() => applyZoom(1)}
            title={pgT('minimap.zoomWorld')}
            aria-label={pgT('minimap.zoomWorld')}
          >
            {zoomLabel(zoomLevel)}
          </button>
          <button
            type="button"
            onClick={() => zoomStep(1)}
            disabled={zoomLevel >= ZOOM_LEVELS[ZOOM_LEVELS.length - 1]}
            title={pgT('minimap.zoomIn')}
            aria-label={pgT('minimap.zoomIn')}
          >
            +
          </button>
        </span>
        <button type="button" onClick={goWorld}>{pgT('minimap.world')}</button>
        <button type="button" onClick={goCenter}>{pgT('minimap.center')}</button>
      </div>

      <p className="pg-mm-hintline">{pgT('minimap.liveHint')}</p>
    </section>
  );
}
