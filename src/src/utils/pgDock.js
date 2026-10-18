/**
 * pgDock — Nabız kapsülünü ve panelini oyun arayüzüyle çakıştırmayan konum
 * mantığı. (Kullanıcı geri bildirimi: kapsül renk paletinin üstüne biniyordu
 * ve paletin altındaki renkler seçilemiyordu.)
 * ==============================================================
 * Kural: kapsül asla paletin üstüne gelmez.
 *   1) Palet görünmüyorsa: sağ alt köşede varsayılan yer (16 / 76).
 *   2) Palet sağ altta ve yeterli yer varsa: paletin SOLUNA hizalanır.
 *   3) Dar ekranda (panel sığmıyorsa): paletin ÜSTÜNE yerleşir.
 *   4) Oyuncu kapsülü sürüklediyse: manuel konum kazanır (kalıcıdır).
 * Panel de aynı kurala uyar; üstelik üstte yer kalmadıysa üstten hizalanır.
 *
 * Buradaki her şey saf hesaptır: jsdom altında da test edilir.
 */

export const DOCK_KEY = 'pgx_pill_pos_v1';

/* oyun arayüzündeki palet kutusu (Palette.jsx -> #palettebox) */
export const PALETTE_SELECTORS = [
  '#palettebox',
  '.palettebox',
  '#palette',
  '[data-pg-palette]',
];

export const DEFAULT_LAYOUT = {
  pill: { right: 16, bottom: 76 },
  panel: { right: 16, bottom: 126 },
};

export const PILL_SIZE = { width: 134, height: 40 };

const GAP = 10;          // palet ile aramızda kalan boşluk (px)
const EDGE = 12;         // ekran kenarından en az boşluk
const PANEL_WIDTH = 392;
const MIN_PANEL_SPACE = 220; // solunda panel sığmıyorsa üstte yerleş

/* ------------------------------------------------------------ ölçümler */

export function findPaletteElement(doc = typeof document !== 'undefined' ? document : null) {
  if (!doc) return null;
  for (let i = 0; i < PALETTE_SELECTORS.length; i += 1) {
    const node = doc.querySelector(PALETTE_SELECTORS[i]);
    if (node) return node;
  }
  return null;
}

/**
 * Paletin görünür dikdörtgeni; görünmüyorsa null.
 */
export function measurePalette(element) {
  if (!element || typeof element.getBoundingClientRect !== 'function') return null;
  try {
    if (typeof window !== 'undefined' && typeof window.getComputedStyle === 'function') {
      const style = window.getComputedStyle(element);
      if (style && (style.display === 'none' || style.visibility === 'hidden')) return null;
    }
  } catch {
    /* hesaplanan stil alınamadı: ölçüme devam */
  }
  const rect = element.getBoundingClientRect();
  if (!rect) return null;
  if (!(rect.width >= 8) || !(rect.height >= 8)) return null;
  return {
    left: rect.left,
    right: rect.right,
    top: rect.top,
    bottom: rect.bottom,
    width: rect.width,
    height: rect.height,
  };
}

export function viewportSize(win = typeof window !== 'undefined' ? window : null) {
  if (!win) return { width: 1280, height: 800 };
  const width = win.innerWidth || (win.document && win.document.documentElement.clientWidth) || 1280;
  const height = win.innerHeight || (win.document && win.document.documentElement.clientHeight) || 800;
  return { width, height };
}

/* --------------------------------------------------------- dikdörtgenler */

/**
 * CSS konumundan (right/bottom) ekran dikdörtgenine çevirir — test ve
 * çakışma kontrolü için.
 */
export function pillRect(position, viewport, size = PILL_SIZE) {
  const right = Number(position.right) || 0;
  const bottom = Number(position.bottom) || 0;
  const width = Number(size.width) || PILL_SIZE.width;
  const height = Number(size.height) || PILL_SIZE.height;
  const left = viewport.width - right - width;
  const top = viewport.height - bottom - height;
  return {
    left, top, right: left + width, bottom: top + height, width, height,
  };
}

/**
 * İki dikdörtgen kesişiyor mu? margin > 0 ise arada en az o kadar boşluk
 * bırakılmasını şart koşar.
 */
export function rectsOverlap(a, b, margin = 0) {
  if (!a || !b) return false;
  return !(
    a.right + margin <= b.left
    || a.left >= b.right + margin
    || a.bottom + margin <= b.top
    || a.top >= b.bottom + margin
  );
}

/* ------------------------------------------------------------- manuel */

export function getManualPosition(storage = typeof localStorage !== 'undefined' ? localStorage : null) {
  if (!storage) return null;
  try {
    const raw = storage.getItem(DOCK_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;
    const right = Number(parsed.right);
    const bottom = Number(parsed.bottom);
    if (!Number.isFinite(right) || !Number.isFinite(bottom)) return null;
    return { right: Math.max(0, right), bottom: Math.max(0, bottom) };
  } catch {
    return null;
  }
}

export function setManualPosition(position, storage = typeof localStorage !== 'undefined' ? localStorage : null) {
  if (!storage || !position) return null;
  const clean = {
    right: Math.max(0, Math.round(Number(position.right) || 0)),
    bottom: Math.max(0, Math.round(Number(position.bottom) || 0)),
  };
  try {
    storage.setItem(DOCK_KEY, JSON.stringify(clean));
  } catch {
    /* depolama kapalı */
  }
  return clean;
}

export function clearManualPosition(storage = typeof localStorage !== 'undefined' ? localStorage : null) {
  if (!storage) return;
  try {
    storage.removeItem(DOCK_KEY);
  } catch {
    /* ignore */
  }
}

/* ------------------------------------------------------- ana hesap */

/**
 * Kapsül + panel yerleşimini hesaplar.
 *
 * @param {object} options
 *   viewport    { width, height }
 *   paletteRect { left, top, right, bottom, width, height } | null
 *   manual      { right, bottom } | null   (oyuncu sürüklediyse)
 *   pill        { width, height }
 *   gap, edge, panelWidth, minPanelSpace
 * @return { mode, pill:{right,bottom,width,height}, panel:{right,bottom,top,maxWidth,maxHeight}, palette }
 */
export function computeLayout(options = {}) {
  const viewport = options.viewport || { width: 1280, height: 800 };
  const palette = options.paletteRect || null;
  const pill = options.pill || PILL_SIZE;
  const gap = Number.isFinite(options.gap) ? options.gap : GAP;
  const edge = Number.isFinite(options.edge) ? options.edge : EDGE;
  const panelWidth = Number.isFinite(options.panelWidth) ? options.panelWidth : PANEL_WIDTH;
  const minPanelSpace = Number.isFinite(options.minPanelSpace)
    ? options.minPanelSpace : MIN_PANEL_SPACE;

  const placePill = (right, bottom, mode) => {
    const height = pill.height || PILL_SIZE.height;
    const pillBottom = bottom;
    const pillTop = viewport.height - pillBottom - height;
    const roomAbove = pillTop - edge;
    const panelBottom = pillBottom + height + gap;

    /*
     * Panel açıkken de paletin üzerine binmesin: yeterli yer varsa panelin
     * sağ kenarını paletin soluna hizala (kapsül gibi).
     */
    let panelRight = right;
    if (palette) {
      const rightOfPalette = viewport.width - palette.left + gap;
      const room = viewport.width - rightOfPalette - edge;
      if (rightOfPalette > panelRight && room >= minPanelSpace) {
        panelRight = rightOfPalette;
      }
    }

    const panel = {
      right: panelRight,
      bottom: panelBottom,
      top: null,
      maxWidth: Math.max(200, Math.min(panelWidth, viewport.width - panelRight - edge)),
      maxHeight: Math.max(200, Math.min(
        Math.round(viewport.height * 0.74),
        roomAbove,
      )),
    };

    /* üstte panel için yer yoksa paneli üstten hizala */
    if (roomAbove < 240) {
      panel.top = edge;
      panel.bottom = null;
      panel.maxHeight = Math.min(
        Math.round(viewport.height * 0.74),
        viewport.height - height - 2 * edge,
      );
    }

    /*
     * Son kontrol: panel yatayda paletin şeridine giriyorsa palette
     * çarpmasın. İki durum var:
     *   1) alttan hizalı panel paletin üstüne taşıyorsa -> paneli üst kenara al
     *   2) zaten üstten hizalıysa (dar ekran) -> yüksekliğini paletin üstünde
     *      kesecek şekilde sınırla
     * Böylece kapsül de panel de paletin üstüne binmez (bildirilen hatanın
     * tekrarı olmaz) ve paletin altındaki renkler her zaman tıklanabilir kalır.
     */
    if (palette) {
      const panelWidthPx = Math.min(panel.maxWidth, panelWidth);
      const panelLeft = viewport.width - panel.right - panelWidthPx;
      const panelRightEdge = viewport.width - panel.right;
      const sharesBand = panelLeft < palette.right + gap && panelRightEdge > palette.left - gap;
      if (sharesBand) {
        const roomOverPalette = palette.top - edge - gap;
        if (panel.bottom === null) {
          panel.maxHeight = Math.max(160, Math.min(panel.maxHeight, roomOverPalette));
        } else if (panel.bottom > palette.top - gap) {
          panel.top = edge;
          panel.bottom = null;
          panel.maxHeight = Math.max(160, Math.min(
            Math.round(viewport.height * 0.74),
            Math.min(pillTop - edge - gap, roomOverPalette),
          ));
        }
      }
    }

    return {
      mode,
      palette,
      pill: {
        right, bottom: pillBottom, width: pill.width || PILL_SIZE.width, height,
      },
      panel,
    };
  };

  /* 1) oyuncu sürüklediyse manuel konum */
  if (options.manual) {
    const right = Math.max(0, Math.min(options.manual.right, viewport.width - 40));
    const bottom = Math.max(0, Math.min(options.manual.bottom, viewport.height - 40));
    const layout = placePill(right, bottom, 'manual');
    /* manuel konumda bile palette denk gelirse yukarı kaydır */
    if (palette) {
      const rect = pillRect({ right, bottom }, viewport, pill);
      if (rectsOverlap(rect, palette, 4)) {
        const lifted = Math.max(edge, viewport.height - palette.top + gap);
        return placePill(right, lifted, 'manual-lifted');
      }
    }
    return layout;
  }

  /* 2) palet görünmüyor: varsayılan köşe */
  if (!palette) {
    return placePill(DEFAULT_LAYOUT.pill.right, DEFAULT_LAYOUT.pill.bottom, 'default');
  }

  /* 3) paletin soluna hizala */
  const leftOfPaletteRight = viewport.width - palette.left + gap;
  const roomForPanel = viewport.width - leftOfPaletteRight - edge;
  const bottomAligned = Math.max(edge, viewport.height - palette.bottom);
  if (roomForPanel >= minPanelSpace) {
    return placePill(leftOfPaletteRight, bottomAligned, 'left');
  }

  /* 4) dar ekran: paletin üstüne */
  const abovePalette = Math.max(edge, viewport.height - palette.top + gap);
  return placePill(DEFAULT_LAYOUT.pill.right, abovePalette, 'above');
}

/**
 * Yerleşimi CSS değişkenlerine yazar; stiller bu değişkenleri kullanır.
 */
export function applyLayout(layout, root = typeof document !== 'undefined' ? document.documentElement : null) {
  if (!root || !layout) return;
  const style = root.style;
  if (!style || typeof style.setProperty !== 'function') return;
  style.setProperty('--pg-pill-right', `${Math.round(layout.pill.right)}px`);
  style.setProperty('--pg-pill-bottom', `${Math.round(layout.pill.bottom)}px`);
  style.setProperty('--pg-panel-right', `${Math.round(layout.panel.right)}px`);
  style.setProperty('--pg-panel-bottom', layout.panel.bottom === null || layout.panel.bottom === undefined
    ? 'auto' : `${Math.round(layout.panel.bottom)}px`);
  style.setProperty('--pg-panel-top', layout.panel.top === null || layout.panel.top === undefined
    ? 'auto' : `${Math.round(layout.panel.top)}px`);
  style.setProperty('--pg-panel-maxw', `${Math.round(layout.panel.maxWidth)}px`);
  style.setProperty('--pg-panel-maxh', `${Math.round(layout.panel.maxHeight)}px`);
  style.setProperty('--pg-dock-mode', String(layout.mode || 'default'));
}

/**
 * Tek çağrıda: ölç, hesapla, uygula. Tema bileşeni bunu kullanır.
 * @return { layout, palette }
 */
export function dockNow(options = {}) {
  const win = options.window || (typeof window !== 'undefined' ? window : null);
  const doc = options.document || (typeof document !== 'undefined' ? document : null);
  const viewport = options.viewport || viewportSize(win);
  const element = options.paletteElement !== undefined
    ? options.paletteElement : findPaletteElement(doc);
  const palette = measurePalette(element);
  const manual = options.manual !== undefined
    ? options.manual : getManualPosition(options.storage);

  const layout = computeLayout({
    viewport, paletteRect: palette, manual, pill: options.pill,
  });
  applyLayout(layout, options.root || (doc ? doc.documentElement : null));
  return { layout, palette };
}

export default {
  computeLayout,
  dockNow,
  applyLayout,
  findPaletteElement,
  measurePalette,
  viewportSize,
  pillRect,
  rectsOverlap,
  getManualPosition,
  setManualPosition,
  clearManualPosition,
  DEFAULT_LAYOUT,
  PILL_SIZE,
  DOCK_KEY,
  PALETTE_SELECTORS,
};
