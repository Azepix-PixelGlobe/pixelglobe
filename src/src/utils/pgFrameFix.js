/*
 * pgFrameFix — çerçeve (iframe) içinde oturum sorunlarının İSTEMCİ tarafı.
 *
 * Sorun: pixelglobee.gt.tc sayfası oyunu çerçeve içinde gösteriyor. Tarayıcı
 * bunu "üçüncü taraf" sayıyor ve çerez/depolamayı engelliyor ya da bölümlüyor:
 *   • kayıt/giriş başarısız olur
 *   • sayfa yenilenince oturum düşer
 *   • "hoş geldin" mesajları tekrar eder, oyun oyuncuyu yeni sanar
 *
 * Çözüm: Storage Access API. İlk kullanıcı dokunuşunda (tarayıcılar izni
 * yalnızca kullanıcı hareketiyle verir) erişim istenir. İzin verilirse çerezler
 * ve depolama normal şekilde çalışır; giriş/oturum kalıcı olur.
 *
 * - Çerçeve içinde DEĞİLSE hiçbir şey yapmaz (doğrudan ziyaret/geliştirme).
 * - İzin verilirse bir kez sayfa yenilenir: oturum hemen geri gelir.
 * - İzin verilemezse oyun yine çalışır; durum
 *   window.pixelglobe.frameFix üzerinden okunabilir.
 *
 * Tüm fonksiyonlar isteğe bağlı olarak bir pencere nesnesi alır — böylece
 * testler jsdom penceresiyle çalışabilir.
 */

export const FRAME_STATE = {
  framed: false,        // çerçeve içinde miyiz?
  supported: false,     // tarayıcı Storage Access API destekliyor mu?
  granted: null,        // null = bilinmiyor, true/false
  tried: false,         // izin istendi mi?
  reloaded: false,      // izin sonrası sayfa yenilendi mi?
};

/** Çalışma zamanı penceresi: verilen pencere ya da global window. */
export function resolveWindow(target) {
  if (target) return target;
  return typeof window === 'undefined' ? null : window;
}

/** Çerçeve içinde miyiz? (cross-origin erişim hatasını da "çerçeve" sayar) */
export function isFramed(target) {
  const w = resolveWindow(target);
  if (!w) return false;
  try {
    return w.self !== w.top;
  } catch {
    return true;
  }
}

/** Tarayıcı Storage Access API sunuyor mu? */
export function isSupported(target) {
  const w = resolveWindow(target);
  return !!(w && w.document && typeof w.document.requestStorageAccess === 'function');
}

/** Daha önce izin verilmiş mi? (istekte bulunmadan öğrenir) */
export async function hasAccess(target) {
  const w = resolveWindow(target);
  if (!w || !w.document || typeof w.document.hasStorageAccess !== 'function') return null;
  try {
    return await w.document.hasStorageAccess();
  } catch {
    return null;
  }
}

function markDocument(w, value) {
  if (w && w.document && w.document.documentElement) {
    w.document.documentElement.setAttribute('data-pg-storage', value);
  }
}

/**
 * Erişim izni ister. Kullanıcı hareketi (dokunuş/tıklama) olmadan çağrılırsa
 * tarayıcı reddedebilir — bu yüzden installFrameFix() ilk dokunuşu bekler.
 */
export async function requestAccess(target) {
  const w = resolveWindow(target);
  if (!w || !isSupported(w)) {
    FRAME_STATE.granted = false;
    return false;
  }
  FRAME_STATE.tried = true;
  try {
    await w.document.requestStorageAccess();
    FRAME_STATE.granted = true;
    markDocument(w, 'granted');
    /* oturumun hemen geri gelmesi için bir kez yenile (oyun içi kısa kesinti) */
    if (!FRAME_STATE.reloaded && typeof w.setTimeout === 'function') {
      FRAME_STATE.reloaded = true;
      w.setTimeout(() => {
        try {
          if (w.location && typeof w.location.reload === 'function') w.location.reload();
        } catch {
          /* yenileme engellendiyse sorun değil */
        }
      }, 700);
    }
    return true;
  } catch {
    FRAME_STATE.granted = false;
    markDocument(w, 'denied');
    return false;
  }
}

/**
 * Kurulum: çerçeve içindeysek ilk dokunuşta izin ister, sonucu yayınlar.
 * @returns temizleme fonksiyonu
 */
export function installFrameFix(target) {
  const w = resolveWindow(target);
  if (!w) return () => {};

  FRAME_STATE.framed = isFramed(w);
  FRAME_STATE.supported = isSupported(w);
  if (!FRAME_STATE.framed) return () => {};

  /* daha önce izin verilmişse hemen öğren */
  hasAccess(w).then((granted) => {
    if (granted === true) {
      FRAME_STATE.granted = true;
      markDocument(w, 'granted');
    }
    try {
      if (typeof w.Event === 'function') w.dispatchEvent(new w.Event('pg-storage-access'));
    } catch {
      /* Event yoksa yut */
    }
  });

  if (!FRAME_STATE.supported) return () => {};

  /* ilk kullanıcı hareketinde izin iste (tarayıcı kuralı) */
  const onGesture = () => {
    const done = () => {
      try {
        if (typeof w.Event === 'function') w.dispatchEvent(new w.Event('pg-storage-access'));
      } catch {
        /* yut */
      }
    };
    const result = requestAccess(w);
    if (result && typeof result.finally === 'function') result.finally(done);
    else done();
  };
  const options = { once: true, capture: true, passive: true };
  w.addEventListener('pointerdown', onGesture, options);
  w.addEventListener('keydown', onGesture, options);
  w.addEventListener('touchend', onGesture, options);

  return () => {
    w.removeEventListener('pointerdown', onGesture, true);
    w.removeEventListener('keydown', onGesture, true);
    w.removeEventListener('touchend', onGesture, true);
  };
}

export default {
  installFrameFix, isFramed, isSupported, hasAccess, requestAccess, resolveWindow, FRAME_STATE,
};
