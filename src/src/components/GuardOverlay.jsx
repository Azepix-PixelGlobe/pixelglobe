/**
 * GuardOverlay — VPN / Proxy / Tor / Bot tespit edildiğinde çıkan TAM EKRAN,
 * KAPATILAMAZ güvenlik uyarısı.
 * ========================================================================
 * Kural (kullanıcı isteği):
 *   "VPN tespit edildi desin ve bir ekran çıksın: VPN'i kapatın ve sayfanızı
 *    yenileyin. Bu ekran, sen VPN'i kapatıp sayfayı yenilene kadar gitmesin."
 *
 * Bu yüzden ekranda kapatma düğmesi yoktur; Esc, dışına tıklama, odak kaçırma
 * gibi hiçbir yol ekranı kapatmaz. Ekran yalnızca sayfa yenilenince gider ve
 * sayfa yenilendiğinde karar sunucudan (GET /api/security/verdict) yeniden
 * sorulur — bağlantı hâlâ VPN ise ekran geri gelir.
 *
 * "Tekrar kontrol et" düğmesi vardır ama o da ekranı kapatmaz; sadece sunucuya
 * yeniden sorar ve sonucu ekranda gösterir (temizse "sayfayı yenile" der).
 *
 * Kilit altındayken:
 *   - <html> üzerine `pg-locked` sınıfı eklenir: sayfa kaydırması kapanır,
 *     alttaki arayüz işaretçi olaylarını almaz.
 *   - Nabız kapsülü/panel ve komut paleti gizlenir.
 *   - Uyarı sesi bir kez çalar.
 */

import { useEffect, useMemo, useRef, useState } from 'preact/hooks';

import { pgT } from '../utils/pgI18n.js';
import { sfx } from '../utils/pgFeedback.js';
import '../styles/pixelglobe-guard.css';

/* Kademeye göre simge, başlık anahtarı, adım anahtarları ve renk tonu. */
const PRESETS = {
  vpn: {
    icon: '🛡️',
    titleKey: 'block.vpn.title',
    bodyKey: 'block.vpn.body',
    steps: ['block.step.vpn1', 'block.step.vpn2', 'block.step.vpn3'],
    tone: 'gold',
    accuse: 'VPN',
  },
  proxy: {
    icon: '🕵️',
    titleKey: 'block.proxy.title',
    bodyKey: 'block.proxy.body',
    steps: ['block.step.vpn1', 'block.step.vpn2', 'block.step.vpn3'],
    tone: 'gold',
    accuse: 'Proxy',
  },
  tor: {
    icon: '🧅',
    titleKey: 'block.tor.title',
    bodyKey: 'block.tor.body',
    steps: ['block.step.vpn1', 'block.step.vpn2', 'block.step.vpn3'],
    tone: 'red',
    accuse: 'Tor',
  },
  hosting: {
    icon: '🖥️',
    titleKey: 'block.hosting.title',
    bodyKey: 'block.hosting.body',
    steps: ['block.step.vpn1', 'block.step.vpn2', 'block.step.vpn3'],
    tone: 'red',
    accuse: 'Datacenter IP',
  },
  bot: {
    icon: '🤖',
    titleKey: 'block.bot.title',
    bodyKey: 'block.bot.body',
    steps: ['block.step.bot1', 'block.step.bot2', 'block.step.bot3'],
    tone: 'red',
    accuse: 'Bot',
  },
};

const FALLBACK = PRESETS.proxy;

/** Yerel saatte "14:32" biçiminde tespit anı. */
function timeLabel(ts) {
  try {
    return new Date(ts || Date.now()).toLocaleTimeString(undefined, {
      hour: '2-digit', minute: '2-digit',
    });
  } catch {
    return '--:--';
  }
}

const GuardOverlay = ({
  kind,
  detail,
  onRecheck,
}) => {
  const preset = PRESETS[kind] || FALLBACK;
  const [busy, setBusy] = useState(false);
  const [check, setCheck] = useState(null);
  const [tick, setTick] = useState(0);
  const rootRef = useRef(null);

  /* tespit anı canlı kalsın */
  useEffect(() => {
    const timer = window.setInterval(() => setTick((value) => value + 1), 30000);
    return () => window.clearInterval(timer);
  }, []);

  /* kilit sesi + sayfa kilidi */
  useEffect(() => {
    sfx('locked');
    if (typeof document === 'undefined') return undefined;
    document.documentElement.classList.add('pg-locked');
    const blockKeys = (evt) => {
      if (evt.key === 'Escape' || evt.key === 'F5' || evt.key === 'F12') return;
      if (evt.key === 'Tab') evt.preventDefault();
    };
    document.addEventListener('keydown', blockKeys, true);
    return () => {
      document.removeEventListener('keydown', blockKeys, true);
    };
  }, [kind]);

  /* odak ekrandan kaçamaz: panel açılınca tekrar buraya alınır */
  useEffect(() => {
    const node = rootRef.current;
    if (!node || typeof node.focus !== 'function') return;
    node.focus();
  }, [kind, check]);

  const lines = useMemo(() => {
    if (!detail) return [];
    const out = [];
    if (detail.profile) {
      const profile = detail.profile;
      if (profile.type) out.push(`type: ${profile.type}`);
      if (profile.operator) out.push(`operator: ${profile.operator}`);
      if (profile.city) out.push(`city: ${profile.city}`);
      if (profile.risk) out.push(`risk: ${profile.risk}`);
      if (profile.confidence) out.push(`confidence: ${profile.confidence}%`);
      if (profile.devices > 1) out.push(`devices: ${profile.devices}`);
    }
    if (detail.risk && detail.risk.signals && detail.risk.signals.length) {
      out.push(`signals: ${detail.risk.signals.join(', ')}`);
    }
    if (detail.reason) out.push(`reason: ${detail.reason}`);
    return out;
  }, [detail]);

  const recheck = async () => {
    setBusy(true);
    setCheck(null);
    try {
      const result = onRecheck ? await onRecheck() : null;
      setCheck(result && result.blocked ? 'bad' : 'good');
      if (result && result.blocked) sfx('warn');
      else sfx('ready');
    } catch {
      setCheck('bad');
    } finally {
      setBusy(false);
    }
  };

  const accuse = (detail && detail.kindLabel) || preset.accuse;
  const detectedAt = (detail && detail.at) || Date.now();

  return (
    <div
      className={`pg-guard-backdrop pg-guard-backdrop--${preset.tone}`}
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="pg-guard-title"
      aria-describedby="pg-guard-body"
      ref={rootRef}
      tabIndex={-1}
    >
      <div className="pg-guard-card">
        <div className="pg-guard-siren" aria-hidden="true">
          <span /><span /><span /><span />
        </div>

        <div className="pg-guard-head">
          <span className="pg-guard-icon" aria-hidden="true">{preset.icon}</span>
          <div>
            <span className="pg-guard-kicker">{pgT('block.kicker')}</span>
            {/* eslint-disable-next-line react/no-danger */}
            <h2 id="pg-guard-title">{pgT(preset.titleKey)}</h2>
          </div>
        </div>

        <p className="pg-guard-body" id="pg-guard-body">{pgT(preset.bodyKey)}</p>

        <ol className="pg-guard-steps">
          {preset.steps.map((key) => (
            <li key={key}>{pgT(key)}</li>
          ))}
        </ol>

        <div className={`pg-guard-status pg-guard-status--${check || 'idle'}`}>
          {check === 'bad' ? pgT('block.stillBad', { kind: accuse }) : null}
          {check === 'good' ? pgT('block.cleared') : null}
          {check === null ? pgT('block.keepOpen') : null}
        </div>

        <div className="pg-guard-meta">
          <span>{pgT('block.detectedAt', { time: timeLabel(detectedAt), ip: (detail && detail.ip) || '•••' })}</span>
          {detail && detail.profile && detail.profile.confidence
            ? <span>{pgT('block.confidence', { n: detail.profile.confidence, risk: detail.profile.risk || 0 })}</span>
            : null}
          {(detail && (detail.country || '').toUpperCase())
            ? <span>{(detail.country || '').toUpperCase()}</span>
            : null}
        </div>

        {lines.length ? (
          <details className="pg-guard-evidence">
            <summary>{pgT('block.evidence')}</summary>
            <ul>
              {lines.map((line) => <li key={line}>{line}</li>)}
            </ul>
          </details>
        ) : null}

        <div className="pg-guard-actions">
          <button type="button" className="pg-guard-btn" onClick={recheck} disabled={busy}>
            {busy ? pgT('block.checking') : pgT('block.recheck')}
          </button>
          <span className="pg-guard-lock">🔒 {pgT('block.locked')}</span>
        </div>

        <div className="pg-guard-why">
          <strong>{pgT('block.why')}</strong>
          <em>{pgT('block.whyBody')}</em>
          <span>{pgT('block.ifWrong')}</span>
        </div>

        <div className="pg-guard-timer" key={tick} aria-hidden="true" />
      </div>
    </div>
  );
};

export default GuardOverlay;
