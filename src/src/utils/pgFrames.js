/**
 * pgFrames — hareketli avatar çerçeveleri (DarkNitro tarzı kozmetikler).
 * ====================================================================
 * Çerçeveler bir "efekt anahtarı" ile temsil edilir: 'flame', 'glitch', …
 * Görsel karşılığı `styles/pixelglobe-frames.css` içindeki
 * `.avatar-frame-<anahtar>` sınıfları ve animasyonlarıdır.
 *
 * Çerçeve KİMİN taktığı sunucudan gelir, iki yoldan:
 *   1. Sohbet geçmişi/ilk yükleme: GET /api/market/styles → { styles, frames }
 *      (bkz. components/windows/Chat.jsx)
 *   2. Canlı yayın: websocket 'fs' paketi → window.__pgFrameStyles[uid]
 *      (bkz. socket/SocketClient.js + socket/SocketServer.js)
 * Böylece bir oyuncu çerçevesini taktığı an HERKESİN ekranında görünür; sadece
 * taktığı kişide değil. Bu dosya o iki kaynağı tek yerden okunur kılar.
 *
 * Kendi çerçevem ayrıca localStorage'da (`pgx_my_frame_v1`) tutulur ki profil
 * kartı ve sohbet, ilk yüklemede sunucu yanıtı gelmeden de doğru görünsün.
 */

export const FRAME_KEYS = [
  'frost', 'flame', 'toxic', 'glitch', 'neon',
  'storm', 'galaxy', 'gold', 'void', 'prisma',
];

/** Kademe sırası + mağaza rozetleri. */
export const FRAME_TIERS = ['common', 'rare', 'epic', 'legendary'];

/** İstemci tarafı görseller (isim/açıklama i18n'den gelir). */
export const FRAME_META = {
  frost: { icon: '❄️', tier: 'common', glow: '#7fdcff' },
  flame: { icon: '🔥', tier: 'common', glow: '#ff8a1f' },
  toxic: { icon: '☢️', tier: 'rare', glow: '#6bf06b' },
  glitch: { icon: '📺', tier: 'rare', glow: '#ff2fd0' },
  neon: { icon: '💡', tier: 'rare', glow: '#9d6bff' },
  storm: { icon: '⚡', tier: 'epic', glow: '#7fb6ff' },
  galaxy: { icon: '🌌', tier: 'epic', glow: '#a26bff' },
  gold: { icon: '🏆', tier: 'epic', glow: '#ffd479' },
  void: { icon: '🕳️', tier: 'legendary', glow: '#c04bff' },
  prisma: { icon: '🌈', tier: 'legendary', glow: '#ff4d9d' },
};

const OWN_KEY = 'pgx_my_frame_v1';

let ownUid = null;

/** Aktif çerçevenin sınıf adı (efekt yoksa boş string). */
export function frameClassName(effect) {
  return (effect && FRAME_KEYS.includes(effect)) ? `avatar-frame-${effect}` : '';
}

export function isFrameKey(effect) {
  return Boolean(effect) && effect !== 'none' && FRAME_KEYS.includes(effect);
}

/** Sunucudan gelen efekt değerini normalize eder ('none' → null). */
export function normalizeFrame(effect) {
  return isFrameKey(effect) ? effect : null;
}

/** Kendi uid'imizi biliriz; kendi çerçevemizi yedek olarak gösterebilmek için. */
export function setOwnUid(uid) {
  const value = Number(uid);
  ownUid = Number.isFinite(value) && value > 0 ? value : null;
}

export function getOwnUid() {
  return ownUid;
}

/* ------------------------------------------------------------ canlı harita */

export function getLiveFrames() {
  if (typeof window === 'undefined') return {};
  return window.__pgFrameStyles || {};
}

export function getLiveFrame(uid) {
  const map = getLiveFrames();
  return map[uid] !== undefined ? map[uid] : map[String(uid)];
}

/** Sunucudan gelen çerçeve haritasını canlı haritaya karıştırır + yayın yapar. */
export function setLiveFrames(map) {
  if (typeof window === 'undefined' || !map) return;
  window.__pgFrameStyles = { ...(window.__pgFrameStyles || {}), ...map };
  window.dispatchEvent(new CustomEvent('pg-framestyle'));
}

/* --------------------------------------------------------- kendi çerçevem */

export function getOwnFrame() {
  try {
    const stored = localStorage.getItem(OWN_KEY);
    return normalizeFrame(stored);
  } catch {
    return null;
  }
}

export function setOwnFrame(effect) {
  const value = normalizeFrame(effect);
  try {
    if (value) localStorage.setItem(OWN_KEY, value);
    else localStorage.removeItem(OWN_KEY);
  } catch {
    /* depolama kapalıysa sorun değil */
  }
  /* canlı haritada da kendi uid'imize yazalım: sohbet ve profil aynı kaynaktan okur */
  if (typeof window !== 'undefined' && ownUid) {
    window.__pgFrameStyles = { ...(window.__pgFrameStyles || {}), [ownUid]: value || 'none' };
  }
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('pg-framestyle'));
  return value;
}

/**
 * Bir oyuncunun göstereceği çerçeveyi çözer.
 * Sıra: elde verilen ipucu → canlı harita (sunucu gerçeği) → kendi önbelleğim.
 */
export function resolveFrame(uid, hint = null) {
  const hinted = normalizeFrame(hint);
  if (hinted) return hinted;
  if (uid !== undefined && uid !== null) {
    const live = getLiveFrame(uid);
    if (live !== undefined) return normalizeFrame(live);
    if (ownUid && Number(uid) === ownUid) return getOwnFrame();
  }
  return null;
}

/** Çerçeve değişimlerini dinle (sohbet mesajları ve profiller bunu kullanır). */
export function subscribeFrames(listener) {
  if (typeof window === 'undefined' || typeof listener !== 'function') return () => {};
  const handler = () => listener();
  window.addEventListener('pg-framestyle', handler);
  return () => window.removeEventListener('pg-framestyle', handler);
}

export default {
  FRAME_KEYS,
  FRAME_TIERS,
  FRAME_META,
  frameClassName,
  isFrameKey,
  normalizeFrame,
  setOwnUid,
  getOwnUid,
  getLiveFrames,
  getLiveFrame,
  setLiveFrames,
  getOwnFrame,
  setOwnFrame,
  resolveFrame,
  subscribeFrames,
};
