/*
 * pgBrush — fırça boyutu yardımcıları (saf matematik, sunucu tarafından
 * bağımsız test edilebilir).
 *
 * Neden ayrı dosya?
 *   10x10 fırçası eklenirken "tam N×N boyama" kuralının tek bir yerde ve
 *   test edilebilir olması istendi. Kaos fırtınasında 100 kişi 10x10 ile
 *   boyadığında her istek tam 100 piksel taşır; geometri yanlış olsaydı
 *   eksik/fazla piksel giderdi.
 *
 * Kural:
 *   - Tek sayılı boyut (1, 3, 5): kare TIKLANAN pikselin tam ortasındadır
 *     (eski davranış birebir korunur).
 *   - Çift sayılı boyut (10): kare tıklanan pikselden başlar; böylece
 *     haritaya tam 10x10 oturur (taşma/eksik boyama olmaz).
 */

export const BRUSH_SIZES = [1, 3, 5, 10];

/** 1 → 3 → 5 → 10 → 1 ... (butona her tıklamada bir büyür, sonra başa döner) */
export function nextBrushSize(current) {
  const idx = BRUSH_SIZES.indexOf(current);
  if (idx === -1) return BRUSH_SIZES[0];
  return BRUSH_SIZES[(idx + 1) % BRUSH_SIZES.length];
}

/** Geçersiz/eksik değeri 1'e düşürür. */
export function normalizeBrushSize(size) {
  return BRUSH_SIZES.includes(size) ? size : 1;
}

/**
 * Fırça karesinin sol-üst köşesi.
 * @param x tıklanan pikselin x (kesirli olabilir)
 * @param y tıklanan pikselin y
 * @param size fırça boyutu (kare kenarı)
 * @return {{x0:number, y0:number, size:number}} kare boyanacak aralık:
 *         [x0, x0+size) × [y0, y0+size)
 */
export function brushRect(x, y, size) {
  const s = normalizeBrushSize(size);
  const half = Math.floor((s - 1) / 2);
  return {
    x0: Math.floor(x) - half,
    y0: Math.floor(y) - half,
    size: s,
  };
}

/** Kaç piksel boyanır (10x10 → 100). */
export function brushCellCount(size) {
  const s = normalizeBrushSize(size);
  return s * s;
}

export default {
  BRUSH_SIZES, nextBrushSize, normalizeBrushSize, brushRect, brushCellCount,
};
