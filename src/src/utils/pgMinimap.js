/**
 * pgMinimap — canlı minimap'in saf çekirdeği (canvas'a hiç dokunmaz).
 * ==================================================================
 * Neden ayrı modül: minimap'in bütün matematiği (projeksiyon, tile ızgarası,
 * kamera dikdörtgeni, canlı pixel akışı, ısı haritası) React'ten ve DOM'dan
 * bağımsız olmalı ki jsdom altında tek tek test edilebilsin.
 *
 * Tasarım kararları (kullanıcı istekleri):
 *   • "gerçekten canlı harita olsun" → PixelPlanet'teki gibi tile tabanlı:
 *     harita 64x64 = 4096 tile'a bölünür, her tile bağımsız işlenir ve
 *     sadece değişen tile yeniden birleştirilir.
 *   • "kara sınırlar beyaz deniz açık mavi" → taban harita kendi ürettiğimiz
 *     Natural Earth maskelerinden gelir (data/minimap/landmask.png + borders.png).
 *   • "ne çok büyük ne çok küçük" → taban harita 2048x2048; oyun canvas'ı
 *     65536 piksel olduğu için 1 minimap pikseli = 32 oyun pikseli.
 *
 * Projeksiyon: oyunun Earth canvas'ı OSM tile'larından üretildiği için
 * Web Mercator. Maskeler de tam olarak Web Mercator üretilir; böylece canlı
 * pixel'ler taban haritayla 1:1 hizalanır.
 */

/* ------------------------------------------------------------- sabitler */

export const MM_RES = 2048;            // taban harita çözünürlüğü (kare, Mercator)
export const WORLD_PER_MM = 32;        // 65536 / 2048 → 1 mm pikseli = 32 oyun pikseli

export const TILE_MM = 32;             // alt-tile kenarı (minimap pikseli)
export const TILES_PER_AXIS = MM_RES / TILE_MM;   // 64
export const TILE_COUNT = TILES_PER_AXIS * TILES_PER_AXIS; // 4096 tile

export const NET_TILE_PX = 256;        // sunucudaki tile dosyası 256x256
export const SNAP_RES = 1024;         // uydu (sunucu tile) katmanı çözünürlüğü
export const NET_TILES_PER_AXIS = MM_RES / NET_TILE_PX;   // 8x8 = 64 tile

export const HEAT_RES = 256;           // canlılık (ısı) ızgarası
export const HEAT_HALF_LIFE_MS = 4200; // ısı bu sürede yarıya iner
export const HEAT_MAX = 12;            // hücre parlaklığı için normalizasyon

export const BLIP_MS = 950;            // tek pixel "parlama" ömrü
export const MAX_BLIPS = 420;          // aynı anda tutulan iz sayısı

export const BASE_URL = '/minimap';    // sunucu rotası (routes/minimap.js)
export const MM_VERSION = 'mm1';       // manifest yoksa kullanılan önbellek sürümü
export const MIN_SNAP_ZOOM = 0;

/* ==========================================================================
 * CANLI TILE KATMANI (sunucudaki gerçek pixel'ler)
 * --------------------------------------------------------------------------
 * Sunucu, oyuncuların koyduğu pixelleri 4096x4096'lık bir özete işler
 * (core/MiniMapLive.js) ve /minimap/live/:z/:x/:y.png olarak servis eder.
 * Buradaki matematik: hangi zoom seviyesinde hangi tile'lar görünür, panel
 * koordinatı hangi canlı piksele denk gelir, kamera merkezi nerede?
 * Hepsi saf fonksiyon → jsdom altında tek tek test edilebilir.
 * ========================================================================== */

export const LIVE_RES = 4096;          // canlı özet çözünürlüğü (kare)
export const LIVE_TILE = 256;          // tile kenarı (px)
export const LIVE_MAX_ZOOM = 4;        // 256 * 2^4 = 4096 → z=0..4
export const LIVE_URL = '/minimap/live';

/**
 * Canlı tile adresi. `canvasId` = hangi dünya (kendi dünyanı açtıysan onun
 * kimliği). `stamp` verilirse tarayıcı önbelleği kırılır → tile gerçekten
 * tazelenir (canlılığın sırrı bu).
 */
export function liveTileUrl(canvasId, z, x, y, stamp) {
  const c = Number.isFinite(Number(canvasId)) ? Number(canvasId) : 0;
  const base = `${LIVE_URL}/${z}/${x}/${y}.png?c=${c}`;
  return stamp === undefined || stamp === null ? base : `${base}&t=${stamp}`;
}

/** Durum/meta uçlarının dünya parametreli adresi. */
export function liveStateUrl(canvasId, since) {
  const c = Number.isFinite(Number(canvasId)) ? Number(canvasId) : 0;
  const s = Math.max(0, Math.floor(Number(since) || 0));
  return `${LIVE_URL}/state?since=${s}&c=${c}`;
}

export function liveMetaUrl(canvasId) {
  const c = Number.isFinite(Number(canvasId)) ? Number(canvasId) : 0;
  return `${LIVE_URL}/meta.json?c=${c}`;
}
/* Panele sığdırmaya göre büyütme seviyeleri: 1x (tüm dünya) … 8x */
export const ZOOM_LEVELS = [1, 2, 4, 8];

export function clampLevel(level) {
  const n = Number(level);
  if (!Number.isFinite(n) || n <= 0) return ZOOM_LEVELS[0];
  /* sadece izin verilen seviyeler */
  let best = ZOOM_LEVELS[0];
  for (let i = 0; i < ZOOM_LEVELS.length; i += 1) {
    if (ZOOM_LEVELS[i] <= n) best = ZOOM_LEVELS[i];
  }
  return best;
}

/** bir üst / alt zoom seviyesi (wheel ve +/- düğmeleri) */
export function nextZoomLevel(level, dir) {
  const current = clampLevel(level);
  const idx = ZOOM_LEVELS.indexOf(current);
  const next = clamp(idx + (dir > 0 ? 1 : -1), 0, ZOOM_LEVELS.length - 1);
  return ZOOM_LEVELS[next];
}

export function zoomLabel(level) {
  return `${clampLevel(level)}x`;
}

/** panelde gösterilen canlı piksel penceresi (kenar uzunluğu) */
export function windowLive(level) {
  return LIVE_RES / clampLevel(level);
}

/** Bu seviyede kullanılacak tile zoom'u. */
export function tileZoomForLevel(level) {
  return clampLevel(level) <= 1 ? 3 : LIVE_MAX_ZOOM;
}

/** canlı px ↔ minimap px (2048 taban) */
export function liveToMm(live) {
  return live * (MM_RES / LIVE_RES);
}

export function mmToLive(mm) {
  return mm * (LIVE_RES / MM_RES);
}

/**
 * Panelin gösterdiği pencere (canlı px). Kenarlara taşmaz: dünya dışına
 * çıkarsa pencere içeri kaydırılır.
 */
export function liveViewport(level, cx, cy, res = LIVE_RES) {
  const lv = clampLevel(level);
  const w = res / lv;
  const half = w / 2;
  const ccx = Number.isFinite(Number(cx)) ? Number(cx) : res / 2;
  const ccy = Number.isFinite(Number(cy)) ? Number(cy) : res / 2;
  const x0 = clamp(ccx - half, 0, Math.max(0, res - w));
  const y0 = clamp(ccy - half, 0, Math.max(0, res - w));
  return {
    level: lv,
    w,
    x0,
    y0,
    x1: x0 + w,
    y1: y0 + w,
    cx: x0 + (w / 2),
    cy: y0 + (w / 2),
  };
}

/**
 * Görünür tile listesi: +margin kadar çevresi de (ön yükleme için).
 * @param {number} [canvasId] hangi dünya (varsayılan 0)
 */
export function liveVisibleTiles(level, cx, cy, margin = 1, canvasId = 0) {
  const vp = liveViewport(level, cx, cy);
  const z = tileZoomForLevel(level);
  const per = 2 ** z;
  const span = LIVE_RES / per;
  const tx0 = clamp(Math.floor(vp.x0 / span) - margin, 0, per - 1);
  const tx1 = clamp(Math.floor((vp.x1 - 1) / span) + margin, 0, per - 1);
  const ty0 = clamp(Math.floor(vp.y0 / span) - margin, 0, per - 1);
  const ty1 = clamp(Math.floor((vp.y1 - 1) / span) + margin, 0, per - 1);
  const list = [];
  for (let y = ty0; y <= ty1; y += 1) {
    for (let x = tx0; x <= tx1; x += 1) {
      list.push({
        z,
        x,
        y,
        url: liveTileUrl(canvasId, z, x, y),
        key: `${z}:${x}:${y}`,
      });
    }
  }
  return list;
}

/** Tile'ın canlı px cinsinden kapsadığı kare. */
export function liveTileRect(z, x, y) {
  const span = LIVE_RES / (2 ** z);
  return { x: x * span, y: y * span, size: span, z };
}

/** Kamera merkezini canlı px'e çevirir (view = [x, y, scale]). */
export function viewLiveCenter(view, canvasSize) {
  const size = Number(canvasSize) || 65536;
  const vx = Number(view && view[0]) || 0;
  const vy = Number(view && view[1]) || 0;
  const k = LIVE_RES / size;
  return { x: (vx + (size / 2)) * k, y: (vy + (size / 2)) * k };
}

/**
 * Panel içindeki bir noktanın canlı px karşılığı.
 * @param relX panel içi yatay konum (0..1)
 * @param relY panel içi dikey konum (0..1)
 */
export function liveFromPanel(relX, relY, vp) {
  return {
    x: vp.x0 + (clamp(relX, 0, 1) * vp.w),
    y: vp.y0 + (clamp(relY, 0, 1) * vp.w),
  };
}

/** Panel ölçüsündeki kalem/çerçeve dönüşümü (ekran px per minimap px). */
export function liveTransform(vp, panelW) {
  const w = Number(panelW) || 1;
  const mmSpan = liveToMm(vp.w);
  const k = w / Math.max(1e-6, mmSpan);
  return { k, ox: liveToMm(vp.x0), oy: liveToMm(vp.y0) };
}

/* ------------------------------------------------------------ küçükler */

export function clamp(value, min, max) {
  if (Number.isNaN(value) || value === null || value === undefined) return min;
  if (value < min) return min;
  if (value > max) return max;
  return value;
}

export function formatNumber(value) {
  const n = Math.max(0, Math.round(Number(value) || 0));
  return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
}

export function formatCompact(value) {
  const n = Math.max(0, Number(value) || 0);
  if (n < 1000) return String(Math.round(n));
  if (n < 1000000) return `${(n / 1000).toFixed(n < 10000 ? 1 : 0).replace('.', ',')}b`;
  return `${(n / 1000000).toFixed(1).replace('.', ',')}m`;
}

/*
 * Tile sırası: merkezden dışa doğru (radar gibi) ama her tile'a kendi
 * deterministik sapması eklenir; böylece açılış "soldan sağa satır satır"
 * değil organik bir tarama gibi görünür. Sabit girdi = sabit çıktı (test).
 */
let cachedOrder = null;

export function revealOrder() {
  if (cachedOrder) return cachedOrder;
  const mid = (TILES_PER_AXIS - 1) / 2;
  const items = new Array(TILE_COUNT);
  for (let ty = 0; ty < TILES_PER_AXIS; ty += 1) {
    for (let tx = 0; tx < TILES_PER_AXIS; tx += 1) {
      const id = ty * TILES_PER_AXIS + tx;
      const dx = tx - mid;
      const dy = ty - mid;
      const jitter = (((id * 2654435761) % 997) / 997) * 7.5;
      items[id] = { id, key: Math.sqrt(dx * dx + dy * dy) + jitter };
    }
  }
  items.sort((a, b) => (a.key - b.key) || (a.id - b.id));
  cachedOrder = Int32Array.from(items.map((item) => item.id));
  return cachedOrder;
}

/* --------------------------------------------------------- canvas kapısı */

/**
 * Minimap taban haritası Dünya (Web Mercator). 3D canvas'larda ve dünya
 * boyutuyla tam bölünmeyen canvas'larda minimap açılmaz.
 */
/**
 * Minimap her DÜZ (2D) dünyada çalışır — 65536'lık Dünya da, kendi açtığın
 * küçük dünya da. 3D kürede anlamsız olduğu için kapanır.
 */
export function isMinimapCanvas(canvas) {
  if (!canvas) return false;
  if (canvas.v) return false;                       // 3D globe
  const size = Number(canvas.size);
  return Number.isFinite(size) && size >= 1024;     // en az 1024x1024
}

export function canvasScale(canvasSize) {
  return Number(canvasSize) / MM_RES;
}

/* -------------------------------------------------- piksel <-> minimap */

export function pixelToMm(px, py, canvasSize) {
  const k = MM_RES / Number(canvasSize);
  return { x: px * k, y: py * k };
}

export function mmToPixel(mx, my, canvasSize) {
  const k = Number(canvasSize) / MM_RES;
  return { x: mx * k, y: my * k };
}

/**
 * Socket'ten gelen chunk güncellemesini global piksele çevirir.
 * `i, j` mutlak 256'lık chunk indeksi, `offset` chunk içi satır-major ofset.
 */
export function chunkOffsetToPixel(i, j, offset) {
  return {
    px: (i * 256) + (offset % 256),
    py: (j * 256) + Math.floor(offset / 256),
  };
}

/* ------------------------------------------------------- kamera dikdörtgeni */

/**
 * state.canvas.view = [x, y, scale] — x,y EKRAN MERKEZİNİN view koordinatı
 * (view = piksel - canvasSize/2), scale = ekran pikseli / canvas pikseli.
 * Dönen dikdörtgen minimap uzayındadır (0..MM_RES).
 */
export function viewToRect(view, canvasSize, screen) {
  const size = Number(canvasSize) || 0;
  const vx = Number(view && view[0]) || 0;
  const vy = Number(view && view[1]) || 0;
  const scale = Number(view && view[2]) || 0.02;
  const width = Math.max(1, Number(screen && screen.width) || 1);
  const height = Math.max(1, Number(screen && screen.height) || 1);

  const k = size ? MM_RES / size : 0;
  const cxPx = vx + (size / 2);       // ekran merkezinin mutlak pikseli
  const cyPx = vy + (size / 2);
  const spanX = width / scale;        // görünen dünya genişliği (piksel)
  const spanY = height / scale;

  const w = spanX * k;
  const h = spanY * k;
  return {
    x: (cxPx - (spanX / 2)) * k,
    y: (cyPx - (spanY / 2)) * k,
    w,
    h,
    cx: cxPx * k,
    cy: cyPx * k,
    scale,
    coversAll: w >= MM_RES && h >= MM_RES,
  };
}

/** Minimap üzerinde bir noktaya tıklanınca kameranın yeni view'ı. */
export function mmToView(mx, my, canvasSize, scale) {
  const k = Number(canvasSize) / MM_RES;
  const half = Number(canvasSize) / 2;
  const scaled = Number(scale) || 0.02;
  return [clamp((mx * k) - half, -half, half - 1),
    clamp((my * k) - half, -half, half - 1),
    scaled];
}

/* ----------------------------------------------------------- tile ızgarası */

export function tileIndexOf(mx, my) {
  const tx = clamp(Math.floor(mx / TILE_MM), 0, TILES_PER_AXIS - 1);
  const ty = clamp(Math.floor(my / TILE_MM), 0, TILES_PER_AXIS - 1);
  return (ty * TILES_PER_AXIS) + tx;
}

export function tileGridOf(index) {
  return {
    tx: index % TILES_PER_AXIS,
    ty: Math.floor(index / TILES_PER_AXIS),
  };
}

export function tileRect(index) {
  const { tx, ty } = tileGridOf(index);
  return { x: tx * TILE_MM, y: ty * TILE_MM, size: TILE_MM };
}

/** Minimap noktasının hangi sunucu tile'ına (z=3 ızgarası) düştüğü. */
export function netTileOf(mx, my) {
  return {
    x: clamp(Math.floor(mx / NET_TILE_PX), 0, NET_TILES_PER_AXIS - 1),
    y: clamp(Math.floor(my / NET_TILE_PX), 0, NET_TILES_PER_AXIS - 1),
  };
}

export function netTileRect(x, y) {
  return { x: x * NET_TILE_PX, y: y * NET_TILE_PX, size: NET_TILE_PX };
}

/**
 * Canvas boyutundan sunucu tile zoom'unu bulur: bir tile 256 minimap pikseli
 * (8192 oyun pikseli) kaplamalı. 65536 için z=3 (8x8 = 64 tile).
 */
export function netZoomFor(canvasSize) {
  const size = Number(canvasSize) || 0;
  const target = NET_TILE_PX * (size / MM_RES);
  if (!target) return null;
  const zoom = Math.log2(size / target);
  if (!Number.isFinite(zoom) || zoom < 0) return null;
  return Math.round(zoom * 1000) / 1000;
}

/** z=3 ızgarasındaki tile'ların adresleri (canlı görüntü taraması). */
export function snapshotTiles(canvasId, canvasSize) {
  const zoom = netZoomFor(canvasSize);
  if (zoom === null || zoom < MIN_SNAP_ZOOM) return null;
  const z = Math.round(zoom);
  if (Math.abs(z - zoom) > 0.001) return null;
  if (canvasId === null || canvasId === undefined) return null;
  const tiles = [];
  for (let y = 0; y < NET_TILES_PER_AXIS; y += 1) {
    for (let x = 0; x < NET_TILES_PER_AXIS; x += 1) {
      tiles.push({ x, y, url: `/tiles/${canvasId}/${z}/${x}/${y}.webp` });
    }
  }
  return { zoom: z, tiles };
}

/** Bir alt-tile'ı kapsayan sunucu tile'ı (canlı yama için). */
export function netTileOfTile(index) {
  const { tx, ty } = tileGridOf(index);
  const per = NET_TILE_PX / TILE_MM;      // 8 alt-tile = 1 sunucu tile
  return { x: Math.floor(tx / per), y: Math.floor(ty / per) };
}

/* ---------------------------------------------------------- ısı haritası */

export function heatIndex(mx, my) {
  const hx = clamp(Math.floor((mx / MM_RES) * HEAT_RES), 0, HEAT_RES - 1);
  const hy = clamp(Math.floor((my / MM_RES) * HEAT_RES), 0, HEAT_RES - 1);
  return (hy * HEAT_RES) + hx;
}

/* ------------------------------------------------------------ palet */

/**
 * Renk indeksini CSS rengine çevirir. `palette` şu biçimlerde olabilir:
 *   • Palette sınıfı örneği (palette.rgb = Uint8Array, index*3)
 *   • [[r,g,b], ...] dizisi
 *   • düz [r,g,b,r,g,b,...] dizisi
 *   • ['rgb(...)', ...] dizisi
 */
export function pickColor(palette, index) {
  if (!palette) return null;
  const idx = Number(index);
  if (!Number.isInteger(idx) || idx < 0) return null;

  if (Array.isArray(palette)) {
    const first = palette[0];
    if (Array.isArray(first)) {
      const entry = palette[idx];
      if (!entry) return null;
      return `rgb(${entry[0]},${entry[1]},${entry[2]})`;
    }
    if (typeof first === 'string') return palette[idx] || null;
    const off = idx * 3;
    if (palette.length >= off + 3) {
      return `rgb(${palette[off]},${palette[off + 1]},${palette[off + 2]})`;
    }
    return null;
  }

  if (palette.rgb) {
    const off = idx * 3;
    if (palette.rgb.length < off + 3) return null;
    return `rgb(${palette.rgb[off]},${palette.rgb[off + 1]},${palette.rgb[off + 2]})`;
  }

  if (typeof palette.colors !== 'undefined' && palette.colors[idx]) {
    return palette.colors[idx];
  }
  return null;
}

/* --------------------------------------------------------------- model */

/**
 * MinimapModel — canlı veriyi tutan durum makinesi (canvas yok).
 * Bileşen bunu besler, çizer; testler doğrudan kullanır.
 */
export class MinimapModel {
  constructor(options = {}) {
    this.reset(options.canvasId ?? null, options.canvasSize ?? 65536);
  }

  reset(canvasId, canvasSize) {
    this.canvasId = canvasId;
    this.canvasSize = canvasSize;
    this.livePixels = 0;          // oturumda görülen canlı pixel
    this.batches = 0;             // gelen chunk paketi
    this.recomposed = 0;          // yeniden birleştirilen tile sayısı
    this.dirty = new Set();       // kirli alt-tile indeksleri
    this.revealed = new Set();    // açılmış alt-tile indeksleri
    this.blips = [];
    this.heat = new Uint16Array(HEAT_RES * HEAT_RES);
    this.heatMax = 1;
    this.lastDecay = -1;   /* -1: "henüz sonum hesaplanmadı" (0 gerçek bir zaman) */
    this.firstSeenAt = 0;
    this.lastSeenAt = 0;
  }

  /* ------------------------------------------------------------- tile */

  markDirty(mx, my) {
    const index = tileIndexOf(mx, my);
    this.dirty.add(index);
    return index;
  }

  takeDirty() {
    if (!this.dirty.size) return [];
    const list = Array.from(this.dirty);
    this.dirty.clear();
    return list;
  }

  markRevealed(index) {
    this.revealed.add(index);
  }

  get revealProgress() {
    return this.revealed.size / TILE_COUNT;
  }

  /* ------------------------------------------------------- canlı pixel */

  /**
   * Tek bir yerleştirmeyi işler. Dönen değer minimap koordinatıdır.
   */
  notePixel(px, py, colorIndex, now = 0) {
    const { x, y } = pixelToMm(px, py, this.canvasSize);
    if (x < 0 || y < 0 || x >= MM_RES || y >= MM_RES) return null;

    this.livePixels += 1;
    if (!this.firstSeenAt) this.firstSeenAt = now;
    this.lastSeenAt = now;

    const index = this.markDirty(x, y);
    const hi = heatIndex(x, y);
    if (this.heat[hi] < 65000) this.heat[hi] += 1;
    if (this.heat[hi] > this.heatMax) this.heatMax = this.heat[hi];

    this.blips.push({ x, y, tile: index, color: colorIndex, at: now });
    if (this.blips.length > MAX_BLIPS) {
      this.blips.splice(0, this.blips.length - MAX_BLIPS);
    }
    return { x, y, tile: index };
  }

  /** Socket paketi: { i, j, pixels: [[offset, color], ...] } */
  noteBatch(i, j, pixels, now = 0) {
    if (!Array.isArray(pixels) || !pixels.length) return 0;
    this.batches += 1;
    let n = 0;
    for (let p = 0; p < pixels.length; p += 1) {
      const entry = pixels[p];
      if (!entry) continue;
      const { px, py } = chunkOffsetToPixel(i, j, entry[0]);
      if (this.notePixel(px, py, entry[1], now)) n += 1;
    }
    return n;
  }

  /* --------------------------------------------------------- ısı/izler */

  decayHeat(now) {
    if (this.lastDecay < 0) {
      this.lastDecay = now;
      return;
    }
    const dt = Math.max(0, now - this.lastDecay);
    if (dt < 120) return;
    this.lastDecay = now;
    const factor = Math.pow(0.5, dt / HEAT_HALF_LIFE_MS);
    let max = 1;
    for (let i = 0; i < this.heat.length; i += 1) {
      if (!this.heat[i]) continue;
      const next = this.heat[i] * factor;
      this.heat[i] = next < 1 ? 0 : next;
      if (this.heat[i] > max) max = this.heat[i];
    }
    this.heatMax = max;
  }

  pruneBlips(now, ttl = BLIP_MS) {
    if (!this.blips.length) return this.blips;
    let cut = 0;
    while (cut < this.blips.length && now - this.blips[cut].at > ttl) cut += 1;
    if (cut) this.blips.splice(0, cut);
    return this.blips;
  }

  heatValue(mx, my) {
    const raw = this.heat[heatIndex(mx, my)];
    if (!raw) return 0;
    const norm = raw / Math.max(HEAT_MAX, this.heatMax / 3);
    return clamp(norm, 0, 1);
  }

  stats() {
    return {
      livePixels: this.livePixels,
      batches: this.batches,
      recomposed: this.recomposed,
      tiles: TILE_COUNT,
      revealed: this.revealed.size,
      reveal: this.revealProgress,
      dirty: this.dirty.size,
      blips: this.blips.length,
    };
  }
}

export default {
  MM_RES,
  MM_VERSION,
  TILE_MM,
  TILE_COUNT,
  LIVE_RES,
  LIVE_MAX_ZOOM,
  ZOOM_LEVELS,
  MinimapModel,
  isMinimapCanvas,
  viewToRect,
  mmToView,
  snapshotTiles,
  pickColor,
  clampLevel,
  nextZoomLevel,
  zoomLabel,
  windowLive,
  tileZoomForLevel,
  liveViewport,
  liveVisibleTiles,
  liveTileRect,
  viewLiveCenter,
  liveFromPanel,
  liveTransform,
  liveToMm,
  mmToLive,
  liveTileUrl,
  liveStateUrl,
  liveMetaUrl,
};
