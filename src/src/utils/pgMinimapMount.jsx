/*
 * pgMinimapMount — MiniMap'i kendi dünyana/arayüzüne tek satırla tak
 * ==================================================================
 * Minimap kendi başına çalışan bir bileşendir; oyunun ağacına dokunmadan
 * sayfaya eklenebilir. İki yol var:
 *
 *   1) Zaten PixelGlobe teması kullanan site: hiçbir şey yapmana gerek yok,
 *      MiniMap orada çiziliyor.
 *   2) Kendi arayüzün / kendi dünyan: giriş dosyana iki satır ekle:
 *
 *        import store from './store/store.js';
 *        import { mountMiniMap } from './utils/pgMinimapMount.jsx';
 *        mountMiniMap({ store });
 *
 *      Store'u elle vermek istemiyorsan `window.__pgStore` tanımlıysa o da
 *      kullanılır. Konsoldan: pixelglobe.minimap.mount()
 *
 * MiniMap hangi dünyayı gösterir? O an oynan dünya (store.canvas.canvasId).
 * Yeni bir dünya açtığında minimap kendiliğinden o dünyaya bağlanır; sunucu
 * tarafı ilk istekte o dünyanın özetini kurar ve chunk'larını tarar.
 */
import { h, render } from 'preact';

import { Provider } from '../store/react-redux/index.js';
import MiniMap from '../components/MiniMap.jsx';

const MOUNT_ID = 'pg-minimap-host';

/**
 * MiniMap'i sayfaya bağlar. İki kez çağrılırsa ikinci çağrı mevcut kökü
 * kullanır (çift panel oluşmaz).
 * @param {Document} [doc]  hedef doküman (testler için)
 * @returns {HTMLElement|null} minimap'in yaşadığı kapsayıcı
 */
/** Oyunun store'unu bulur: açıkça verilen → window.__pgStore → pixelglobe.store */
export function resolveStore(explicit) {
  if (explicit) return explicit;
  if (typeof window === 'undefined') return null;
  if (window.__pgStore) return window.__pgStore;
  if (window.pixelglobe && window.pixelglobe.store) return window.pixelglobe.store;
  return null;
}

export function mountMiniMap(options = {}) {
  /* mountMiniMap(document) · mountMiniMap({ doc, store }) */
  const opts = options && typeof options.getElementById === 'function'
    ? { doc: options } : (options || {});
  const target = opts.doc || (typeof document !== 'undefined' ? document : null);
  if (!target || !target.body) return null;
  const activeStore = resolveStore(opts.store);
  if (!activeStore) {
    /* store olmadan minimap oyunun durumunu okuyamaz: sessizce boş çizmek yerine uyar */
    if (typeof console !== 'undefined' && console.warn) {
      console.warn('[minimap] store bulunamadı: mountMiniMap({ store }) ile ver.');
    }
    return null;
  }
  let host = target.getElementById(MOUNT_ID);
  if (!host) {
    host = target.createElement('div');
    host.id = MOUNT_ID;
    target.body.appendChild(host);
  }
  /* aynı host'a iki kez render etmek güvenli: preact mevcut ağacı günceller */
  render(h(Provider, { store: activeStore }, h(MiniMap, null)), host);
  return host;
}

/** MiniMap'i kaldırır (kapsayıcıyı da siler). */
export function unmountMiniMap(doc) {
  const opts = doc && typeof doc.getElementById === 'function' ? { doc } : (doc || {});
  const target = opts.doc || (typeof document !== 'undefined' ? document : null);
  if (!target) return false;
  const host = target.getElementById(MOUNT_ID);
  if (!host) return false;
  render(null, host);
  if (host.parentNode) host.parentNode.removeChild(host);
  return true;
}

/** Konsoldan erişim: pixelglobe.minimap.mount() / unmount() */
if (typeof window !== 'undefined') {
  window.pixelglobe = window.pixelglobe || {};
  window.pixelglobe.minimap = window.pixelglobe.minimap || {};
  window.pixelglobe.minimap.mount = (opts) => !!mountMiniMap(opts || {});
  window.pixelglobe.minimap.unmount = () => unmountMiniMap();
}

export default mountMiniMap;
