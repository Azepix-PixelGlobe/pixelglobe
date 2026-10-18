/**
 * PixelGlobeTheme — PixelGlobe arayüz katmanının tek montaj noktası.
 * ================================================================
 *   1) <html> üzerine `pg-black` sınıfını ekler (tüm tema kuralları bu sınıfa
 *      kapsanmıştır; katmanı kapatmak için bileşeni kaldırmak yeterli).
 *   2) Nabız verisini (pgPulse) sunucudan yükler, periyodik yeniler ve günde
 *      bir kez seri işareti atar (heartbeat).
 *   3) Koruma modülünü (pgGuard) başlatır: bot/otomasyon sinyalleri, tıklama
 *      ritmi, imleç sıçraması, honeypot, sekme sayısı.
 *   3b) Harita kaydırma/zoom sırasında tıklama ölçümünü DURDURUR (yanlış
 *      pozitif düzeltmesi) ve kaos etkinliğinde ritim ölçümünü kapatır.
 *   3c) Sunucudan güvenlik kararını (GET /api/security/verdict) alır: VPN,
 *      proxy, Tor, sunucu IP ya da bot tespit edilirse tam ekran, KAPATILAMAZ
 *      uyarı ekranı gösterilir (components/GuardOverlay.jsx).
 *   4) Hissiyat katmanı (pgFeedback): pixel atma sesi, kombo, ekran nabzı.
 *   5) Tuval üzerindeki yerleştirmeleri sayar, sohbet/palet/balık olaylarını
 *      oyuncu istatistiklerine işler.
 *   6) Nabız panelini, komut paletini (Ctrl/Cmd+K) ve bildirimleri çizer.
 *   7) Canlı minimap'i (MiniMap) bağlar: kendi ürettiğimiz taban harita +
 *      sunucu tile'ları + socket'ten akan canlı pixel'ler (kapsüle tıklayınca
 *      açılır; klavye kısayolu yoktur).
 *
 * Kurulum (App.jsx):
 *   import PixelGlobeTheme from './PixelGlobeTheme.jsx';
 *   ...
 *   <PixelGlobeTheme />
 *
 * Konsoldan: window.pixelglobe.{pulse,guard,feedback,dock,openPalette}
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'preact/hooks';

import { useStore, useSelector } from '../store/react-redux/index.js';
import {
  load as loadPulse, refresh as refreshPulse, heartbeat as pulseHeartbeat,
  loadActivity as loadPulseActivity,
  startPolling as startPulsePolling, stopPolling as stopPulsePolling,
  setStoreGetter as setPulseStore, setIntegritySink as setPulseIntegritySink,
  notePlacement, noteSessionMinute, noteTotals, getState as pulseState,
} from '../utils/pgPulse.js';
import {
  init as initGuard, onPointer, onPlacement, getStatus as guardStatus,
  report as guardReport, reportNow as guardReportNow, setMode as setGuardMode,
  setEnabled as setGuardEnabled, setNativeCheck as setGuardNativeCheck,
  subscribe as subscribeGuard, setChaos as setGuardChaos,
  noteNavigation as guardNoteNavigation, setVerdict as setGuardVerdict,
  getVerdict as guardVerdict,
} from '../utils/pgGuard.js';
import {
  placementFeedback, sfx, setMasterMuted, getState as feedbackState,
} from '../utils/pgFeedback.js';
import { dockNow, findPaletteElement } from '../utils/pgDock.js';
import PulsePanel, { ToastHost, pushToast } from './PulsePanel.jsx';
import CommandPalette from './CommandPalette.jsx';
import GuardOverlay from './GuardOverlay.jsx';
import MiniMap from './MiniMap.jsx';
import CallOverlay from './CallOverlay.jsx';
import { pgT, pgLang } from '../utils/pgI18n.js';
import { FRAME_STATE, installFrameFix, requestAccess } from '../utils/pgFrameFix.js';
import '../styles/pixelglobe-black.css';
import '../styles/pixelglobe-pulse.css';

/* tuval üzerinde sürüklerken kaç ms'de bir yerleştirme sayılır */
const PAINT_SAMPLE_MS = 60;
const SESSION_TICK_MS = 60000;

export default function PixelGlobeTheme() {
  const store = useStore();
  const mute = useSelector((state) => state.gui.mute);
  const chaosEnd = useSelector((state) => state.gui.chaosEnd);
  const online = useSelector((state) => state.ranks.online.total);

  const [paletteOpen, setPaletteOpen] = useState(false);
  const [verdict, setVerdict] = useState(null);
  const snapshotRef = useRef(null);
  const holdPaintRef = useRef(false);

  /* ---------------------------------------------------------- başlangıç */

  /* çerçeve (iframe) içinde oturum sorunlarını çöz — Storage Access API */
  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    const cleanup = installFrameFix();
    window.pixelglobe = window.pixelglobe || {};
    window.pixelglobe.frameFix = {
      state: () => ({ ...FRAME_STATE }),
      request: requestAccess,
    };
    return cleanup;
  }, []);

  useEffect(() => {
    const root = document.documentElement;
    root.classList.add('pg-black');

    if (!window.pixelglobe) window.pixelglobe = {};
    window.pixelglobe.version = '2.0.0-pulse';

    setPulseStore(() => store.getState());
    setPulseIntegritySink((signal) => {
      if (signal && signal.type === 'localTamper') {
        guardReport('localTamper', signal.detail || 'local-cache');
      }
    });

    /* polyfill/WebView ortamlarında yanlış pozitif çıkmasın diye kapatılabilir */
    if (typeof window.pixelglobe.guardNativeCheck === 'function') {
      setGuardNativeCheck(window.pixelglobe.guardNativeCheck);
    }

    initGuard({
      mode: window.pixelglobe.guardMode || 'log',
      reportUrl: window.pixelglobe.reportUrl || '/api/security/report',
      getStore: () => store.getState(),
    });

    /* istemci sinyalleri (ör. otomasyon) kilit kararı üretirse ekrana yansıt */
    const unsubscribeGuard = subscribeGuard((event) => {
      if (!event) return;
      if (event.type === 'verdict' || event.type === 'block') {
        setVerdict(guardVerdict());
      }
    });

    loadPulse();
    loadPulseActivity({ silent: true });
    pulseHeartbeat({ force: true });
    const stopPolling = startPulsePolling();

    /*
     * Kapsül/palet çakışması: palet açılıp kapandığında ve ekran
     * değiştiğinde yerleşimi yeniden hesapla (utils/pgDock.js).
     */
    const redock = () => dockNow();
    const onResize = () => redock();
    redock();
    window.addEventListener('resize', onResize);
    window.addEventListener('orientationchange', onResize);
    let paletteObserver = null;
    let paletteTimer = 0;
    const palette = findPaletteElement(document);
    if (palette && typeof MutationObserver === 'function') {
      paletteObserver = new MutationObserver(redock);
      paletteObserver.observe(palette, { attributes: true, attributeFilter: ['style', 'class'] });
    }
    /* palet her açılışta yeniden oluşturulabiliyor: hafif yoklama */
    paletteTimer = window.setInterval(redock, 2000);

    return () => {
      root.classList.remove('pg-black');
      stopPolling();
      stopPulsePolling();
      window.removeEventListener('resize', onResize);
      window.removeEventListener('orientationchange', onResize);
      if (paletteObserver) paletteObserver.disconnect();
      if (paletteTimer) window.clearInterval(paletteTimer);
      unsubscribeGuard();
    };
  }, [store]);

  /* konsoldan erişilebilen küçük API (test + moderasyon araçları) */
  useEffect(() => {
    window.pixelglobe = window.pixelglobe || {};
    window.pixelglobe.pulse = {
      state: pulseState,
      load: loadPulse,
      refresh: refreshPulse,
      heartbeat: pulseHeartbeat,
      activity: loadPulseActivity,
      events: null,
    };
    window.pixelglobe.dock = {
      layout: () => dockNow(),
      palette: () => findPaletteElement(document),
    };
    window.pixelglobe.guard = {
      status: guardStatus,
      report: guardReport,
      reportNow: guardReportNow,
      setMode: setGuardMode,
      setEnabled: setGuardEnabled,
      setNativeCheck: setGuardNativeCheck,
      /** elle kilit kararı (test/moderasyon): 'vpn' | 'bot' | ... | null */
      setVerdict: setGuardVerdict,
    };
    window.pixelglobe.feedback = { state: feedbackState };
    window.pixelglobe.openPalette = () => setPaletteOpen(true);
    window.pixelglobe.lang = pgLang();
  }, []);

  /* --------------------------------------- güvenlik kararı (VPN / bot / proxy) */

  /*
   * Sunucu kararı sayfa açılışında ve düzenli aralıklarla sorulur. Karar
   * gelince ekran çizilir ve SAYFA YENİLENENE KADAR gitmez: bu yüzden karar
   * sadece "var" yönünde güncellenir, temiz cevap ekranı kapatmaz.
   */
  useEffect(() => {
    let cancelled = false;
    let locked = false;

    const verify = async () => {
      try {
        const res = await fetch('/api/security/verdict', {
          credentials: 'include',
          headers: { Accept: 'application/json' },
        });
        if (!res.ok) return null;
        const data = await res.json();
        if (cancelled) return data;
        if (data && data.blocked && data.kind) {
          locked = true;
          setGuardVerdict(data.kind, {
            kindLabel: data.kindLabel,
            reason: data.reason,
            source: 'server',
            ip: data.ip,
            country: data.country,
            profile: data.profile,
            risk: data.risk,
            banned: data.banned,
            muted: data.muted,
          });
          setVerdict(guardVerdict());
        }
        return data;
      } catch {
        return null;
      }
    };

    window.pixelglobe.security = {
      check: verify,
      status: () => ({ verdict: guardVerdict(), locked }),
    };

    verify();
    const timer = window.setInterval(() => {
      /* kilit açıldıysa yoklamayı bırak: ekran zaten gitmiyor */
      if (!locked) verify();
    }, 25000);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, []);

  /*
   * Kilitliyken sayfayı gerçekten kilitle (kaydırma + işaretçi).
   * DİKKAT: `#pg-locked` kilit sınıfını yalnızca bu bileşen kaldırabilir; ekranda
   * açık bir GuardOverlay varsa (ör. yerel bir rapor kilit açtıysa) sınıfı
   * kaldırmayız. Aksi halde temiz bir verdict, kapatılamaz uyarının kilidini
   * yanlışlıkla açardı.
   */
  useEffect(() => {
    if (typeof document === 'undefined') return undefined;
    const root = document.documentElement;
    const overlayOpen = () => !!document.querySelector('.pg-guard-backdrop');
    if (verdict) root.classList.add('pg-locked');
    else if (!overlayOpen()) root.classList.remove('pg-locked');
    return () => { if (!overlayOpen()) root.classList.remove('pg-locked'); };
  }, [verdict]);

  /* site geneli ses ayarı (gui.mute) hissiyat katmanına bağlanır */
  useEffect(() => {
    setMasterMuted(mute);
  }, [mute]);

  /* --------------------------------------------- store olay bağlantısı */

  const isChaos = useCallback(() => Boolean(chaosEnd && chaosEnd > Date.now()), [chaosEnd]);

  /*
   * Kaos etkinliği: oyunun amacı zaten çok hızlı pixel atmak. Bu sürede koruma
   * ritim/teleport ölçümü yapmaz, böylece "kaosta hile sandılar" şikayeti
   * tekrar etmez. Etkinlik bitince ölçümler normale döner.
   */
  useEffect(() => {
    const apply = () => setGuardChaos(isChaos());
    apply();
    if (!chaosEnd || chaosEnd <= Date.now()) return undefined;
    const timer = window.setTimeout(apply, Math.min(chaosEnd - Date.now() + 500, 3600000));
    return () => window.clearTimeout(timer);
  }, [chaosEnd, isChaos]);

  useEffect(() => {
    const readOwnMessageCount = (state) => {
      try {
        const own = state.user.name;
        if (!own) return 0;
        const messages = state.chat.messages || {};
        let count = 0;
        Object.keys(messages).forEach((cid) => {
          const list = messages[cid] || [];
          const start = Math.max(0, list.length - 40);
          for (let i = start; i < list.length; i += 1) {
            if (list[i] && list[i][0] === own) count += 1;
          }
        });
        return count;
      } catch {
        return 0;
      }
    };

    const snapshot = (state) => ({
      coolDown: state.user.coolDown,
      selectedColor: state.canvas.selectedColor,
      ownMessages: readOwnMessageCount(state),
      totalPixels: state.ranks.totalPixels,
      dailyPixels: state.ranks.dailyTotalPixels,
    });

    snapshotRef.current = snapshot(store.getState());

    const unsubscribe = store.subscribe(() => {
      const state = store.getState();
      const previous = snapshotRef.current || snapshot(state);
      const next = snapshot(state);

      /* toplam/günlük pixel sayaçları (yerel modda seviye tahmini için) */
      if (next.totalPixels !== previous.totalPixels
        || next.dailyPixels !== previous.dailyPixels) {
        noteTotals({ total: next.totalPixels, daily: next.dailyPixels });
      }

      /* palet rengi */
      if (next.selectedColor !== previous.selectedColor) {
        sfx('paletteSelect');
      }

      /* fırça modu (holdPaint): kapalıyken sol tık sürükleme = kamera kaydırma */
      holdPaintRef.current = Boolean(state.gui && state.gui.holdPaint);

      /* stok doldu -> hazır sinyali */
      if (previous.coolDown && !next.coolDown) {
        sfx('ready');
        pushToast({ title: pgT('toast.cooldownReady'), icon: '⚡', tone: 'good' });
      }

      snapshotRef.current = next;
    });

    return unsubscribe;
  }, [store]);

  /* --------------------------------------- tuval işaretçi izleme */

  /*
   * ÖNEMLİ DÜZELTME (bildirilen hata: "sadece haritayı hareket ettiriyorum,
   * bir sürü uyarı veriyor"):
   *
   * Oyun iki modda çalışıyor (controls/PixelPainterControls.js):
   *   - holdPaint AÇIK  : sürüklerken pixel atılır (fırça)
   *   - holdPaint KAPALI: sol tık + sürükleme KAMERAYI kaydırır, pixel atılmaz
   *
   * Eski sürüm her pointermove'u "pixel atıldı" sayıyordu; harita kaydırırken
   * yüzlerce sahte yerleştirme üretiyor ve koruma "bot ritmi" sanıyordu.
   * Artık:
   *   - holdPaint kapalıyken basılı hareket = kameranın kaydırılması sayılır,
   *     ne pixel sayılır ne de koruma ölçümü beslenir (noteNavigation(true)).
   *   - Kısa tıklama (<=6px, <=250ms) oyunun kendi kuralıyla eşleşecek şekilde
   *     TEK pixel yerleştirme sayılır (bkz. PixelPainterControls.onMouseUp).
   *   - Kaos etkinliğinde ölçüm yapılmaz; oyunun kendi sayaçları (ranks) zaten
   *     gerçek toplamı verir ve seviye/grafik o veriyi kullanır.
   */
  useEffect(() => {
    let lastPaintAt = 0;
    let pointerDown = false;
    let navigating = false;
    let startPoint = null;
    let previousPoint = null;

    const isCanvasTarget = (target) => {
      if (!target || !target.closest) return false;
      return Boolean(target.closest('.viewport, canvas'));
    };

    const storeState = () => {
      try {
        return store.getState();
      } catch {
        return null;
      }
    };

    const isHoldPaint = () => {
      const state = storeState();
      if (!state || !state.gui) return holdPaintRef.current;
      holdPaintRef.current = Boolean(state.gui.holdPaint);
      return holdPaintRef.current;
    };

    const countPlacement = (evt) => {
      const chaos = isChaos();
      notePlacement({ count: 1, chaos });
      placementFeedback({ count: 1, chaos });
      onPlacement({ count: 1, trusted: evt ? evt.isTrusted !== false : true, chaos });
    };

    const onDown = (evt) => {
      if (!isCanvasTarget(evt.target)) return;
      pointerDown = true;
      startPoint = { x: evt.clientX || 0, y: evt.clientY || 0, at: Date.now() };
      previousPoint = { x: evt.clientX || 0, y: evt.clientY || 0, at: Date.now() };

      if (isHoldPaint()) {
        countPlacement(evt);
        onPointer(evt, {});
        return;
      }

      /* fırça kapalı: bu jest kamera kaydırma olabilir, ölçümü durdur */
      navigating = true;
      guardNoteNavigation(true);
    };

    const onMove = (evt) => {
      if (!isCanvasTarget(evt.target)) return;
      const stamp = Date.now();

      if (!pointerDown) {
        onPointer(evt, { previous: previousPoint });
        previousPoint = { x: evt.clientX || 0, y: evt.clientY || 0, at: stamp };
        return;
      }

      /* kamerayı kaydırıyoruz: ne sayım ne ölçüm */
      if (navigating) {
        previousPoint = { x: evt.clientX || 0, y: evt.clientY || 0, at: stamp };
        return;
      }

      onPointer(evt, { previous: previousPoint });
      previousPoint = { x: evt.clientX || 0, y: evt.clientY || 0, at: stamp };
      if (stamp - lastPaintAt < PAINT_SAMPLE_MS) return;
      lastPaintAt = stamp;
      countPlacement(evt);
    };

    const onUp = (evt) => {
      const wasNavigating = navigating;
      const started = startPoint;
      pointerDown = false;
      navigating = false;
      previousPoint = null;
      startPoint = null;
      guardNoteNavigation(false);

      if (!wasNavigating || !started) return;

      /*
       * Oyun kısa tıklamada (<=250ms, <=6px) TEK pixel yerleştirir; uzun
       * basma pixel bilgisi açar, sürükleme kamerayı kaydırır. Aynı kuralı
       * uygularız ki sayılan pixel oyunun saydığıyla aynı olsun.
       */
      const dx = Math.abs((evt && evt.clientX ? evt.clientX : started.x) - started.x);
      const dy = Math.abs((evt && evt.clientY ? evt.clientY : started.y) - started.y);
      const quick = Date.now() - started.at <= 250;
      if (dx < 6 && dy < 6 && quick) countPlacement(evt);
    };

    document.addEventListener('pointerdown', onDown, true);
    document.addEventListener('pointermove', onMove, true);
    document.addEventListener('pointerup', onUp, true);
    document.addEventListener('pointercancel', onUp, true);

    return () => {
      document.removeEventListener('pointerdown', onDown, true);
      document.removeEventListener('pointermove', onMove, true);
      document.removeEventListener('pointerup', onUp, true);
      document.removeEventListener('pointercancel', onUp, true);
      guardNoteNavigation(false);
    };
  }, [isChaos, store]);

  /* ------------------------------------------------ oturum sayacı */

  useEffect(() => {
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') noteSessionMinute();
    }, SESSION_TICK_MS);
    return () => window.clearInterval(timer);
  }, []);

  /* sekme geri geldiğinde veriyi tazele + seri işaretini dene */
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === 'visible') {
        refreshPulse();
        pulseHeartbeat();
      }
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, []);

  /* -------------------------------------------- Ctrl/Cmd + K kısayolu */

  useEffect(() => {
    const onKey = (evt) => {
      const isPaletteKey = (evt.key === 'k' || evt.key === 'K')
        && (evt.metaKey || evt.ctrlKey);
      const tag = evt.target && evt.target.tagName;
      const typing = tag === 'INPUT' || tag === 'TEXTAREA'
        || (evt.target && evt.target.isContentEditable);
      if (isPaletteKey && !typing) {
        evt.preventDefault();
        setPaletteOpen((value) => !value);
      }
      if (evt.key === 'Escape') setPaletteOpen(false);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  /* --------------------------------------------------------- eylemler */

  const toggleGuardReport = useCallback(() => {
    const status = guardStatus();
    const lines = status.signals
      .map((signal) => `• ${pgT(`guard.${signal.type}`)} (${signal.count})`)
      .join('  ');
    pushToast({
      title: pgT('guard.title'),
      body: status.signals.length
        ? `${pgT('guard.score', { n: status.score })} — ${lines}`
        : pgT('guard.clean'),
      icon: '🛡️',
      tone: status.warned ? 'warn' : 'info',
      ttl: 7000,
    });
    guardReportNow();
  }, []);

  const toggleMissions = useCallback(() => {
    const pill = document.querySelector('.pg-pill');
    if (pill) pill.click();
  }, []);

  const missionStats = useMemo(() => ({ online }), [online]);

  return (
    <>
      <ToastHost />
      <PulsePanel stats={missionStats} />
      <MiniMap />
      {/* özel arama paneli: sohbet kapansa da ekranda kalır (utils/pgCall.js) */}
      <CallOverlay />
      <CommandPalette
        open={paletteOpen}
        onClose={() => setPaletteOpen(false)}
        onToggleMissions={toggleMissions}
        onToggleGuardReport={toggleGuardReport}
      />
      {verdict ? (
        <GuardOverlay
          kind={verdict.kind}
          detail={verdict.detail}
          onRecheck={async () => {
            const result = await (window.pixelglobe.security
              && window.pixelglobe.security.check
              ? window.pixelglobe.security.check()
              : null);
            if (result && result.blocked) {
              setGuardVerdict(result.kind, {
                kindLabel: result.kindLabel,
                reason: result.reason,
                source: 'server',
                ip: result.ip,
                country: result.country,
                profile: result.profile,
                risk: result.risk,
              });
              setVerdict(guardVerdict());
            }
            return result;
          }}
        />
      ) : null}
    </>
  );
}
