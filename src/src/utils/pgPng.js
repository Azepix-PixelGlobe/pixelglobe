/*
 * pgPng — bağımlılıksız PNG yazıcı (RGBA, 8 bit)
 * =============================================
 * Minimap tile'ları sunucuda ANLIK üretilir. Yeni bir npm paketi eklemek
 * istemiyoruz (kullanıcı Replit'te sadece dosyaları kopyalıyor, `npm install`
 * çalıştırmıyor olabilir) — bu yüzden PNG'yi kendimiz yazıyoruz:
 *
 *   IHDR → IDAT (zlib deflate, satır başına filtre 0) → IEND
 *   Her chunk: uzunluk(4) + tip(4) + veri + CRC32(4)
 *
 * 256x256 bir tile ≈ 262 KB ham veri; çoğu şeffaf olduğu için sıkıştırılmış
 * hâli genelde 1-3 KB. Kayıpsız, tarayıcıda doğrudan <img>/drawImage ile
 * kullanılabilir.
 */
import zlib from 'zlib';

const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) {
      c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    }
    table[n] = c;
  }
  return table;
})();

export function crc32(buffer) {
  let crc = -1;
  for (let i = 0; i < buffer.length; i += 1) {
    crc = CRC_TABLE[(crc ^ buffer[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ -1) >>> 0;
}

function chunk(type, data) {
  const typeBuf = Buffer.from(type, 'ascii');
  const out = Buffer.alloc(data.length + 12);
  out.writeUInt32BE(data.length, 0);
  typeBuf.copy(out, 4);
  data.copy(out, 8);
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  crcBuf.copy(out, 8 + data.length);
  return out;
}

/**
 * RGBA (Uint8Array/Buffer, uzunluk = width*height*4) verisini PNG'ye çevirir.
 * @param {number} width
 * @param {number} height
 * @param {Uint8Array|Buffer} rgba
 * @param {{level?: number}} [options] zlib sıkıştırma seviyesi (0-9)
 * @returns {Buffer}
 */
export function encodeRgbaPng(width, height, rgba, options = {}) {
  const w = Math.max(1, Math.floor(width || 1));
  const h = Math.max(1, Math.floor(height || 1));
  const expected = w * h * 4;
  if (!rgba || rgba.length < expected) {
    throw new Error(`encodeRgbaPng: veri kısa (${rgba ? rgba.length : 0}/${expected})`);
  }
  const stride = w * 4;
  const raw = Buffer.allocUnsafe((stride + 1) * h);
  for (let y = 0; y < h; y += 1) {
    const at = y * (stride + 1);
    raw[at] = 0; /* filtre tipi 0 (None): hızlı ve şeffaf alanlarda küçük çıkar */
    if (Buffer.isBuffer(rgba)) {
      rgba.copy(raw, at + 1, y * stride, y * stride + stride);
    } else {
      for (let i = 0; i < stride; i += 1) raw[at + 1 + i] = rgba[y * stride + i];
    }
  }

  const level = Number.isInteger(options.level) ? options.level : 6;
  const idat = zlib.deflateSync(raw, { level });

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;   /* bit derinliği */
  ihdr[9] = 6;   /* renk tipi 6 = RGBA */
  ihdr[10] = 0;  /* sıkıştırma */
  ihdr[11] = 0;  /* filtre */
  ihdr[12] = 0;  /* interlace yok */

  return Buffer.concat([
    SIGNATURE,
    chunk('IHDR', ihdr),
    chunk('IDAT', idat),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

export default { encodeRgbaPng, crc32 };
