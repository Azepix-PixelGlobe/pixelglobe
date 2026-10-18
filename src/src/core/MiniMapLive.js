/*
 * MiniMapLive — CANLI minimap tile motoru (sunucu tarafı)
 * ======================================================
 * Ürün isteği: "gerçekten canlı harita olsun, PixelPlanet gibi tile'ları olsun,
 * kaliteli olsun, normal haritaya göre biraz daha küçük olsun".
 *
 * HER DÜNYA İÇİN ÇALIŞIR: motor canvasId ile kurulur ve dünyanın gerçek
 * boyutunu (canvases.json → size) kendisi okur. 65536'lık Dünya'da 1 hücre =
 * 16 oyun pikseli; kendi açtığın küçük/büyük bir dünyada ölçek otomatik
 * uyarlanır (dünya her zaman 4096x4096 özete sığdırılır). Yeni dünya açtığında
 * minimap ilk istendiğinde kendini kurar ve o dünyanın chunk'larını tarar.
 *
 * Nasıl çalışır?
 *   1) Bellekte 4096x4096'lık bir "özet harita" tutulur (her hücre = oyunun
 *      16x16 pikseli). 65536'lık dünya 16 kat küçültülmüş olur → panelde
 *      "büyük ama haritadan küçük" görünür.
 *   2) Her pixel yerleştirmesi bu özete ANINDA işlenir (setPixel.js kancası),
 *      dosya/rollback gibi toplu değişimler chunk'tan işlenir
 *      (RedisCanvas.setChunk/delChunk kancası).
 *   3) Özetten mipmap zinciri (256, 512, 1024, 2048, 4096) üretilir; her zoom
 *      bir mipmap'ten 1:1 okunur → tile üretimi ucuz ve kayıpsız.
 *   4) GET /minimap/live/:z/:x/:y.png ile tile'lar anlık üretilir, sürüm
 *      numarasıyla önbelleğe alınır; değişmeyen tile bir daha üretilmez.
 *   5) GET /minimap/live/state?since=N → "senin gördüğünden beri hangi tile'lar
 *      değişti" listesini döner. İstemci yalnızca onları tazeler → gerçek
 *      canlılık, boşa trafik yok.
 *   6) Açılışta Redis'teki mevcut chunk'lar arka planda taranır (kontrollü
 *      hızda) → sunucu yeni başlasa da harita kendini doldurur.
 *
 * Sıfır yeni bağımlılık: PNG yazıcı utils/pgPng.js (zlib).
 */
import { commandOptions } from 'redis';

import client from '../data/redis/client.js';
import logger from './logger.js';
import canvases from './canvases.js';
import { encodeRgbaPng } from '../utils/pgPng.js';

export const LIVE_WORLD = 65536;              // oyun canvas'ı (Dünya)
export const LIVE_RES = 4096;                 // özet harita çözünürlüğü
export const LIVE_CELL = LIVE_WORLD / LIVE_RES;   // 1 hücre = 16 oyun pikseli
export const TILE_PX = 256;                   // tile kenarı
export const LIVE_MAX_ZOOM = 4;               // z=4 → 16x16 = 256 tile (4096 px)

const EMPTY_BOX = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity, any: false };

/*
 * Açılış taraması: Redis'teki mevcut chunk'ları kontrollü hızda okur.
 * 200'lük paketler, aralarında 40 ms nefes, aynı anda en fazla 32 okuma →
 * sunucu açılışta kilitlenmez, yüz binlerce chunk'ta bile sorunsuz döner.
 */
const SCAN_BATCH = 200;
const SCAN_DELAY_MS = 40;
const SCAN_CONCURRENCY = 32;

function sleep(ms) {
  return new Promise((resolve) => { setTimeout(resolve, ms); });
}

/* palet: indeks+1 ile saklanır (0 = boş) → [r,g,b,...] */
function buildPalette(canvasId) {
  const canvas = canvases[canvasId];
  const colors = (canvas && Array.isArray(canvas.colors)) ? canvas.colors : [];
  const count = Math.max(1, colors.length);
  const lut = new Uint8Array((count + 1) * 3);
  for (let c = 0; c < colors.length; c += 1) {
    const [r, g, b] = colors[c];
    lut[(c + 1) * 3] = r;
    lut[(c + 1) * 3 + 1] = g;
    lut[(c + 1) * 3 + 2] = b;
  }
  return lut;
}

export class MiniMapLive {
  /**
   * @param {number} canvasId  hangi dünya (canvases.json kimliği)
   * @param {object} [options] { worldSize } — testler için ölçek geçersiz kılma
   */
  constructor(canvasId = 0, options = {}) {
    this.canvasId = Number(canvasId) || 0;
    this.worldSize = Number(options.worldSize)
      || (() => {
        const canvas = canvases[this.canvasId];
        return (canvas && Number(canvas.size)) || LIVE_WORLD;
      })();
    /* dünya → özet ölçeği: dünya ne kadar büyükse hücre o kadar çok oyun
     * pikseli kapsar; böylece her dünya 4096x4096'lık özete sığar. */
    this.scale = LIVE_RES / this.worldSize;
    this.cellSize = this.worldSize / LIVE_RES;
    this.lastUsed = Date.now();
    this.reset();
  }

  reset() {
    this.cells = new Uint8Array(LIVE_RES * LIVE_RES);
    this.palette = buildPalette(this.canvasId);
    /*
     * Palet sözleşmesi: hücre 0 = boş, hücre c+1 = renk indeksi c.
     * colorCount = renk sayısı → geçerli indeksler 0..colorCount-1.
     */
    this.colorCount = Math.max(1, (this.palette.length / 3) - 1);
    this.version = 0;                     /* her tile sürümü bu sayaçtan alır */
    this.tileVers = [];
    for (let z = 0; z <= LIVE_MAX_ZOOM; z += 1) {
      const per = 2 ** z;
      this.tileVers.push(new Uint32Array(per * per));
    }
    this.log = [];                        /* {v, z, x, y} değişim günlüğü */
    this.logCap = 4096;
    this.pending = { ...EMPTY_BOX };
    this.dirtyBox = null;                 /* mipmap için bekleyen bölge */

    this.mip = new Array(LIVE_MAX_ZOOM + 1).fill(null);
    this.mip[LIVE_MAX_ZOOM] = this.cells;
    this.mipDirty = true;
    this.builtAt = 0;
    this.builtVersion = 0;
    this.minBuildInterval = 150;          /* ms: mipmap yeniden kurma hız sınırı */

    this.cache = new Map();
    this.cacheCap = 900;
    this.renders = 0;
    this.cacheHits = 0;
    this.tilesServed = 0;

    this.scannedKeys = new Set();
    this.scanRunning = false;
    this.scanDone = false;
  }

  /* ----------------------------------------------------------- indeksler */

  cellIndex(cx, cy) {
    return (cy * LIVE_RES) + cx;
  }

  touch(cx, cy) {
    const p = this.pending;
    if (!p.any) {
      p.minX = cx; p.maxX = cx; p.minY = cy; p.maxY = cy; p.any = true;
      return;
    }
    if (cx < p.minX) p.minX = cx;
    if (cx > p.maxX) p.maxX = cx;
    if (cy < p.minY) p.minY = cy;
    if (cy > p.maxY) p.maxY = cy;
  }

  /* ------------------------------------------------------- pixel kancası */

  /**
   * Tek bir oyun pikseli → özet hücresi.
   * @returns {boolean} özet değişti mi
   */
  notePixel(canvasId, x, y, color) {
    if (Number(canvasId) !== this.canvasId) return false;
    const fx = Number(x);
    const fy = Number(y);
    if (!Number.isFinite(fx) || !Number.isFinite(fy)) return false;
    const cx = Math.floor(fx * this.scale);
    const cy = Math.floor(fy * this.scale);
    if (cx < 0 || cy < 0 || cx >= LIVE_RES || cy >= LIVE_RES) return false;
    /* aralık dışı renk gelirse paletin son rengine kırp: siyah delik oluşmasın */
    const ci = Math.min(Math.max(Number(color) || 0, 0), this.colorCount - 1);
    const value = ci <= 0 ? 0 : (Math.min(ci, 254) + 1);
    const idx = this.cellIndex(cx, cy);
    if (this.cells[idx] === value) return false;
    this.cells[idx] = value;
    this.touch(cx, cy);
    return true;
  }

  /**
   * Chunk ofseti biçimi (socket/setPixel yolu): i,j chunk, offset içi ofset.
   * 256x256'lık 2D chunk varsayılır.
   */
  notePixelByOffset(canvasId, color, i, j, offset) {
    if (Number(canvasId) !== this.canvasId) return false;
    const off = Number(offset) || 0;
    const x = (i * 256) + (off % 256);
    const y = (j * 256) + Math.floor(off / 256);
    return this.notePixel(canvasId, x, y, color);
  }

  /* -------------------------------------------------- toplu (chunk) yolu */

  /**
   * 256x256'lık hazır chunk verisini özete işler (dosya yükleme, rollback,
   * temizleme, açılış taraması). 16x16 blokların sol-üst pikseli örneklenir.
   */
  /**
   * Chunk'ın özet ızgarasındaki hücre aralığı (dünya boyutundan bağımsız).
   * Her hücre için ÖRNEKLENEN piksel hücrenin ortasıdır: 16x16'lık bloğun
   * merkezi, bloğun gerçek rengini kenar pikselinden daha iyi temsil eder.
   */
  chunkCellRange(i, j) {
    const px0 = i * 256;
    const py0 = j * 256;
    const cx0 = Math.max(0, Math.floor(px0 * this.scale));
    const cy0 = Math.max(0, Math.floor(py0 * this.scale));
    const cx1 = Math.min(LIVE_RES - 1, Math.floor(((px0 + 255) * this.scale) + 1e-9));
    const cy1 = Math.min(LIVE_RES - 1, Math.floor(((py0 + 255) * this.scale) + 1e-9));
    return { cx0, cy0, cx1, cy1, px0, py0 };
  }

  applyChunk(canvasId, i, j, buffer) {
    if (Number(canvasId) !== this.canvasId) return false;
    if (!buffer || buffer.length < 256 * 256) return false;
    const r = this.chunkCellRange(i, j);
    if (r.cx1 < r.cx0 || r.cy1 < r.cy0) return false;
    let changed = false;
    for (let cy = r.cy0; cy <= r.cy1; cy += 1) {
      /* hücrenin temsil ettiği oyun pikseli (hücre merkezi) → chunk içi satır */
      const wy = Math.min(((cy + 0.5) / this.scale), this.worldSize - 1);
      const by = Math.min(255, Math.max(0, Math.floor(wy) - r.py0));
      const row = by * 256;
      for (let cx = r.cx0; cx <= r.cx1; cx += 1) {
        const wx = Math.min(((cx + 0.5) / this.scale), this.worldSize - 1);
        const bx = Math.min(255, Math.max(0, Math.floor(wx) - r.px0));
        const byte = buffer[row + bx];
        /* üst bit = korumalı işareti; indeks paletin dışına çıkamaz */
        const ci = Math.min(byte & 0x7f, this.colorCount - 1);
        const value = ci === 0 ? 0 : (Math.min(ci, 254) + 1);
        const idx = this.cellIndex(cx, cy);
        if (this.cells[idx] !== value) {
          this.cells[idx] = value;
          changed = true;
        }
      }
    }
    if (changed) {
      this.touch(r.cx0, r.cy0);
      this.touch(r.cx1, r.cy1);
    }
    return changed;
  }

  /** Chunk silindi/temizlendi (haftalık temizlik, rollback). */
  clearChunk(canvasId, i, j) {
    if (Number(canvasId) !== this.canvasId) return false;
    const r = this.chunkCellRange(i, j);
    if (r.cx1 < r.cx0 || r.cy1 < r.cy0) return false;
    let changed = false;
    for (let cy = r.cy0; cy <= r.cy1; cy += 1) {
      for (let cx = r.cx0; cx <= r.cx1; cx += 1) {
        const idx = this.cellIndex(cx, cy);
        if (this.cells[idx] !== 0) {
          this.cells[idx] = 0;
          changed = true;
        }
      }
    }
    if (changed) {
      this.touch(r.cx0, r.cy0);
      this.touch(r.cx1, r.cy1);
    }
    return changed;
  }

  /* -------------------------------------------------------- sürüm/günlük */

  /**
   * Bekleyen değişiklikleri tile sürümlerine işler. Üretimde 200 ms'de bir
   * çağrılır (pixel başına sürüm şişmesini engeller).
   * @returns {number} sürümü artan tile sayısı
   */
  flush() {
    const p = this.pending;
    if (!p.any) return 0;
    this.pending = { ...EMPTY_BOX };
    this.dirtyBox = this.dirtyBox ? {
      minX: Math.min(this.dirtyBox.minX, p.minX),
      minY: Math.min(this.dirtyBox.minY, p.minY),
      maxX: Math.max(this.dirtyBox.maxX, p.maxX),
      maxY: Math.max(this.dirtyBox.maxY, p.maxY),
      any: true,
    } : { ...p };

    let bumped = 0;
    for (let z = 0; z <= LIVE_MAX_ZOOM; z += 1) {
      const per = 2 ** z;
      const cellsPerTile = LIVE_RES / per;
      const x0 = Math.floor(p.minX / cellsPerTile);
      const x1 = Math.floor(p.maxX / cellsPerTile);
      const y0 = Math.floor(p.minY / cellsPerTile);
      const y1 = Math.floor(p.maxY / cellsPerTile);
      for (let y = y0; y <= y1; y += 1) {
        for (let x = x0; x <= x1; x += 1) {
          this.version += 1;
          this.tileVers[z][(y * per) + x] = this.version;
          this.log.push({ v: this.version, z, x, y });
          bumped += 1;
        }
      }
    }
    if (this.log.length > this.logCap) {
      this.log.splice(0, this.log.length - this.logCap);
    }
    this.mipDirty = true;
    return bumped;
  }

  /**
   * İstemci "en son N sürümünü gördüm" der; yalnızca o sürümden sonra
   * değişen tile'ları döneriz. Günlük yetmezse full=true → istemci görünür
   * tile'ları baştan çeker.
   */
  state(since) {
    const s = Math.max(0, Math.floor(Number(since) || 0));
    if (!s || s > this.version) {
      return { v: this.version, full: true, tiles: [] };
    }
    if (s === this.version) {
      return { v: this.version, full: false, tiles: [] };
    }
    const first = this.log.length ? this.log[0].v : 0;
    if (!first || first > s + 1) {
      return { v: this.version, full: true, tiles: [] };
    }
    const tiles = [];
    for (let i = this.log.length - 1; i >= 0; i -= 1) {
      const entry = this.log[i];
      if (entry.v <= s) break;
      tiles.push({ z: entry.z, x: entry.x, y: entry.y });
      if (tiles.length >= 2000) break;
    }
    tiles.reverse();
    return { v: this.version, full: false, tiles };
  }

  /* ------------------------------------------------------------ mipmap */

  /**
   * Özetten mipmap zincirini kurar (yalnızca kirli bölgeyi yeniden hesaplar).
   * @returns {boolean} bu çağrıda kuruldu mu
   */
  buildMips(now = Date.now()) {
    if (!this.mipDirty) return false;
    if (this.builtAt && this.minBuildInterval > 0
      && (now - this.builtAt) < this.minBuildInterval) {
      return false;   /* hız sınırı: çağıran önbelleğe yazmadan servis eder */
    }
    const box = this.dirtyBox || { minX: 0, minY: 0, maxX: LIVE_RES - 1, maxY: LIVE_RES - 1, any: true };
    this.mip[LIVE_MAX_ZOOM] = this.cells;
    for (let z = LIVE_MAX_ZOOM - 1; z >= 0; z -= 1) {
      const size = TILE_PX * (2 ** z);
      const src = this.mip[z + 1];
      let dst = this.mip[z];
      if (!dst || dst.length !== size * size) {
        dst = new Uint8Array(size * size);
        this.mip[z] = dst;
        /* hedef yeni: tamamını hesapla */
        this.fillLevel(dst, src, size, { minX: 0, minY: 0, maxX: size - 1, maxY: size - 1 });
        continue;
      }
      const shift = LIVE_MAX_ZOOM - z;      /* z+1 → z: 2 hücre/piksel */
      const x0 = Math.max(0, box.minX >> shift);
      const y0 = Math.max(0, box.minY >> shift);
      const x1 = Math.min(size - 1, box.maxX >> shift);
      const y1 = Math.min(size - 1, box.maxY >> shift);
      if (x0 > x1 || y0 > y1) continue;
      this.fillLevel(dst, src, size, { minX: x0, minY: y0, maxX: x1, maxY: y1 });
    }
    this.mipDirty = false;
    this.builtAt = now;
    this.builtVersion = this.version;
    this.dirtyBox = null;
    return true;
  }

  /**
   * Kaynak seviyeden 2x2 blokları "en çok görünen renk" kuralıyla küçültür.
   * (Şeffaf alanlar renk saymaz; tek bir dolu piksel bile görünür kalır.)
   */
  fillLevel(dst, src, size, box) {
    const srcW = size * 2;
    const tally = new Uint16Array(33);
    for (let y = box.minY; y <= box.maxY; y += 1) {
      const sy = y * 2;
      for (let x = box.minX; x <= box.maxX; x += 1) {
        const sx = x * 2;
        const a = src[(sy * srcW) + sx];
        const b = src[(sy * srcW) + sx + 1];
        const c = src[((sy + 1) * srcW) + sx];
        const d = src[((sy + 1) * srcW) + sx + 1];
        if (!a && !b && !c && !d) {
          dst[(y * size) + x] = 0;
          continue;
        }
        tally.fill(0);
        let best = 0;
        let bestCount = 0;
        const votes = [a, b, c, d];
        for (let v = 0; v < 4; v += 1) {
          const value = votes[v];
          if (!value) continue;
          tally[value] += 1;
          if (tally[value] > bestCount) {
            bestCount = tally[value];
            best = value;
          }
        }
        dst[(y * size) + x] = best;
      }
    }
  }

  /* ------------------------------------------------------------- tile */

  tileVersion(z, x, y) {
    const per = 2 ** z;
    /* 0 = hic dokunulmadi; baslikta kullanilabilsin diye en az 1 dondurur */
    return Math.max(1, this.tileVers[z][(y * per) + x]);
  }

  validTile(z, x, y) {
    if (!Number.isInteger(z) || z < 0 || z > LIVE_MAX_ZOOM) return false;
    const per = 2 ** z;
    if (!Number.isInteger(x) || !Number.isInteger(y)) return false;
    return x >= 0 && y >= 0 && x < per && y < per;
  }

  /** Tile'ı palet + mipmap'ten RGBA olarak çizer (önbellek yok). */
  drawTile(z, x, y) {
    const size = TILE_PX;
    const level = this.mip[z] || this.cells;
    const levelW = size * (2 ** z);
    const rgba = Buffer.allocUnsafe(size * size * 4);
    const { palette } = this;
    for (let oy = 0; oy < size; oy += 1) {
      const sy = ((y * size) + oy) * levelW;
      let at = oy * size * 4;
      for (let ox = 0; ox < size; ox += 1) {
        const value = level[sy + (x * size) + ox];
        if (!value) {
          rgba[at] = 0; rgba[at + 1] = 0; rgba[at + 2] = 0; rgba[at + 3] = 0;
        } else {
          const po = value * 3;
          rgba[at] = palette[po];
          rgba[at + 1] = palette[po + 1];
          rgba[at + 2] = palette[po + 2];
          rgba[at + 3] = 255;
        }
        at += 4;
      }
    }
    return rgba;
  }

  /**
   * Tile PNG'si. Sürüm değişmediyse önbellekten döner; mipmap hız sınırına
   * takıldıysa önbelleğe YAZMADAN servis eder (bir sonraki istek taze olur).
   */
  renderTile(z, x, y, now = Date.now()) {
    if (!this.validTile(z, x, y)) return null;
    const ver = this.tileVersion(z, x, y);
    const key = `${z}:${x}:${y}`;
    const hit = this.cache.get(key);
    if (hit && hit.ver === ver) {
      this.cacheHits += 1;
      this.tilesServed += 1;
      return hit.buf;
    }
    const built = this.buildMips(now);
    if (this.mipDirty && !built) {
      /* mipmap hâlâ kirli: eski görüntüyü önbelleğe yazmadan ver */
      const buf = encodeRgbaPng(TILE_PX, TILE_PX, this.drawTile(z, x, y));
      this.renders += 1;
      this.tilesServed += 1;
      return buf;
    }
    const buf = encodeRgbaPng(TILE_PX, TILE_PX, this.drawTile(z, x, y));
    this.renders += 1;
    this.tilesServed += 1;
    this.cache.set(key, { buf, ver });
    if (this.cache.size > this.cacheCap) {
      let excess = this.cache.size - this.cacheCap;
      const it = this.cache.keys();
      while (excess > 0) {
        const k = it.next();
        if (k.done) break;
        this.cache.delete(k.value);
        excess -= 1;
      }
    }
    return buf;
  }

  /* ------------------------------------------------------------ api */

  meta() {
    return {
      ok: true,
      canvasId: this.canvasId,
      world: this.worldSize,
      res: LIVE_RES,
      cell: Number(this.cellSize.toFixed(4)),
      colors: this.colorCount,
      tile: TILE_PX,
      tileSize: TILE_PX,
      maxZoom: LIVE_MAX_ZOOM,
      version: this.version,
      ready: this.scanDone,
      scanned: this.scannedKeys.size,
      renders: this.renders,
      cacheHits: this.cacheHits,
      cacheSize: this.cache.size,
      scannedAt: this.scanDoneAt || null,
    };
  }

  stats() {
    return {
      version: this.version,
      cells: this.cells.length,
      scanned: this.scannedKeys.size,
      scanDone: this.scanDone,
      renders: this.renders,
      cacheHits: this.cacheHits,
      cacheSize: this.cache.size,
      logSize: this.log.length,
      mipDirty: this.mipDirty,
      pending: this.pending.any,
    };
  }

  /* --------------------------------------------------- açılış taraması */

  /**
   * Redis'teki mevcut chunk'ları kontrollü hızda tarar ve özete işler.
   * Sunucu ağır iş yapmasın diye gruplar arasında nefes verir.
   */
  async startScan(options = {}) {
    if (this.scanRunning) return { started: false };
    if (!client || typeof client.scanIterator !== 'function') {
      return { started: false, reason: 'no-scan' };
    }
    const batchSize = options.batchSize || SCAN_BATCH;
    const delayMs = Number.isInteger(options.delayMs) ? options.delayMs : SCAN_DELAY_MS;
    this.scanRunning = true;
    let scanned = 0;
    try {
      const pattern = `ch:${this.canvasId}:*`;
      let batch = [];
      const iterator = client.scanIterator({ MATCH: pattern, COUNT: 1000 });
      /* eslint-disable no-restricted-syntax, no-await-in-loop */
      for await (const key of iterator) {
        batch.push(key);
        if (batch.length >= batchSize) {
          scanned += await this.scanKeys(batch);
          batch = [];
          await sleep(delayMs);
        }
      }
      if (batch.length) scanned += await this.scanKeys(batch);
      /* eslint-enable no-restricted-syntax, no-await-in-loop */
      this.scanDone = true;
      this.scanDoneAt = Date.now();
      logger.info(`Minimap canlı özet hazır: ${scanned} chunk tarandı`);
    } catch (err) {
      logger.warn(`Minimap taraması yarıda kaldı: ${err.message}`);
    } finally {
      this.scanRunning = false;
      this.flush();
    }
    return { started: true, scanned };
  }

  async scanKeys(keys) {
    let handled = 0;
    const concurrency = SCAN_CONCURRENCY;
    let cursor = 0;
    const workers = new Array(Math.min(concurrency, keys.length)).fill(0).map(async () => {
      while (cursor < keys.length) {
        const myIndex = cursor;
        cursor += 1;
        const key = keys[myIndex];
        const match = /^ch:(\d+):(\d+):(\d+)$/.exec(String(key));
        if (!match) continue;
        const canvasId = Number(match[1]);
        const i = Number(match[2]);
        const j = Number(match[3]);
        if (canvasId !== this.canvasId) continue;
        this.scannedKeys.add(key);
        try {
          // eslint-disable-next-line no-await-in-loop
          const raw = await client.get(commandOptions({ returnBuffers: true }), key);
          if (!raw) continue;
          const buffer = Buffer.isBuffer(raw) ? raw : Buffer.from(raw);
          this.applyChunk(canvasId, i, j, buffer);
          handled += 1;
        } catch {
          /* tek chunk hatası taramayı durdurmasın */
        }
      }
    });
    await Promise.all(workers);
    return handled;
  }
}

/* ==========================================================================
 * ÇOKLU DÜNYA KAYIT DEFTERİ
 * --------------------------------------------------------------------------
 * Oyuncu hangi dünyada oynuyorsa (/minimap/live/...?c=ID) minimap o dünyaya
 * kurulur. Bellek tavanı: aynı anda en fazla MAX_LIVE_INSTANCES dünya motorda
 * tutulur (her özet 16 MB); en eski kullanılmayan düşürülür ve tekrar
 * istendiğinde yeniden kurulup o dünyanın chunk'larını tarar.
 * ========================================================================== */
export const MAX_LIVE_INSTANCES = 4;

const registry = new Map();

/** Bu dünya için motor var mı? (yoksa null — bellek ayırmaz) */
export function liveOrNull(canvasId) {
  return registry.get(Number(canvasId) || 0) || null;
}

/** Motoru getir; yoksa kur. Tanımsız/3D dünyada null döner. */
export function liveFor(canvasId) {
  const id = Number(canvasId) || 0;
  const existing = registry.get(id);
  if (existing) {
    existing.lastUsed = Date.now();
    return existing;
  }
  const canvas = canvases[id];
  if (!canvas || canvas.v) return null;          /* olmayan ya da 3D küre */
  const instance = new MiniMapLive(id);
  registry.set(id, instance);
  evictIfNeeded(id);
  return instance;
}

function evictIfNeeded(keepId) {
  if (registry.size <= MAX_LIVE_INSTANCES) return;
  /* canvas 0 (ana dünya) ve yeni kurulan dünya korunur */
  let oldestId = null;
  let oldestAt = Infinity;
  registry.forEach((inst, id) => {
    if (id === 0 || id === keepId) return;
    if (inst.lastUsed < oldestAt) {
      oldestAt = inst.lastUsed;
      oldestId = id;
    }
  });
  if (oldestId !== null) registry.delete(oldestId);
}

/**
 * Motoru hazırla ve (gerekiyorsa) o dünyanın mevcut chunk'larını arka planda
 * tara. İstemci ilk kez minimap'i açtığında çağrılır.
 */
export function ensureLive(canvasId) {
  const inst = liveFor(canvasId);
  if (!inst) return null;
  if (!inst.scanDone && !inst.scanRunning && !inst.scanStartedAt) {
    inst.scanStartedAt = Date.now();
    inst.startScan().catch(() => {});
  }
  return inst;
}

/* ---------------- kancalar: motor YOKSA hiçbir maliyet yok ---------------- */

export function notifyPixel(canvasId, x, y, color) {
  const inst = liveOrNull(canvasId);
  return inst ? inst.notePixel(canvasId, x, y, color) : false;
}

export function notifyPixelByOffset(canvasId, color, i, j, offset) {
  const inst = liveOrNull(canvasId);
  return inst ? inst.notePixelByOffset(canvasId, color, i, j, offset) : false;
}

export function notifyChunk(canvasId, i, j, buffer) {
  const inst = liveOrNull(canvasId);
  return inst ? inst.applyChunk(canvasId, i, j, buffer) : false;
}

export function notifyClearChunk(canvasId, i, j) {
  const inst = liveOrNull(canvasId);
  return inst ? inst.clearChunk(canvasId, i, j) : false;
}

/** Sunucu kapanışı / test temizliği: tüm dünyaları unut. */
export function resetLiveRegistry() {
  registry.forEach((inst) => {
    if (inst.tickTimer) clearInterval(inst.tickTimer);
  });
  registry.clear();
}

/*
 * Üretimde: kurulmuş her dünya için bekleyen değişiklikler 200 ms'de bir
 * sürüme işlenir. Kayıt defteri boşken hiçbir iş yapılmaz.
 */
const globalTick = setInterval(() => {
  registry.forEach((inst) => {
    try {
      inst.flush();
    } catch {
      /* sayaç hatası sunucuyu düşürmesin */
    }
  });
}, 200);
if (globalTick && typeof globalTick.unref === 'function') {
  globalTick.unref();
}

/* Geriye dönük uyumluluk: ana dünya (canvas 0) motoru. */
export const miniMapLive = liveFor(0);
export default miniMapLive;

