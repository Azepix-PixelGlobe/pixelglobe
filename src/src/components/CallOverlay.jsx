/**
 * CallOverlay — özel arama paneli (sesli / görüntülü / ekran paylaşımı).
 * ======================================================================
 * • Çalan telefon: gelen arama ekranı (kabul / reddet).
 * • Arama sürerken: karşı tarafın görüntüsü, kendi önizlemen, süre sayacı,
 *   mikrofon-kamera-ekran-kapat düğmeleri.
 * • "Küçült" ile tek satır kapsüle iner; oyunu kapatmaz.
 * • Sohbet penceresi kapansa bile bu panel ekranda kalır: arama durumu
 *   utils/pgCall.js içinde tutulur (pencereye bağlı değildir).
 *
 * PixelGlobeTheme içinde bir kez çizilir.
 */

import {
  useCallback, useEffect, useMemo, useRef, useState,
} from 'preact/hooks';
import { memo } from 'preact/compat';

import { useSelector } from '../store/react-redux/index.js';
import call, { CALL_STATE, CALL_KIND } from '../utils/pgCall.js';
import { pgT } from '../utils/pgI18n.js';
import '../styles/pixelglobe-call.css';

const POS_KEY = 'pgx_call_pos_v1';
const MIN_KEY = 'pgx_call_min_v1';

function readPos() {
  try {
    const raw = window.localStorage.getItem(POS_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (typeof parsed.x === 'number' && typeof parsed.y === 'number') return parsed;
  } catch (error) { /* yok say */ }
  return null;
}

function formatClock(seconds) {
  const total = Math.max(0, Math.floor(seconds));
  const mm = String(Math.floor(total / 60)).padStart(2, '0');
  const ss = String(total % 60).padStart(2, '0');
  return `${mm}:${ss}`;
}

/** Karşı tarafın görüntüsünü <video> etiketine bağla. */
const RemoteVideo = ({ stream }) => {
  const ref = useRef();
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.srcObject = stream || null;
    if (stream && typeof el.play === 'function') {
      try {
        const played = el.play();
        if (played && typeof played.catch === 'function') played.catch(() => {});
      } catch (error) { /* otomatik oynatma engellendi */ }
    }
  }, [stream]);
  if (!stream) return null;
  return <video className="pg-call-remote" ref={ref} autoPlay playsInline />;
};

const LocalPreview = ({ stream, muted, sharing }) => {
  const ref = useRef();
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.srcObject = stream || null;
    if (stream && typeof el.play === 'function') {
      try {
        const played = el.play();
        if (played && typeof played.catch === 'function') played.catch(() => {});
      } catch (error) { /* otomatik oynatma engellendi */ }
    }
  }, [stream]);
  if (!stream) return null;
  return (
    <video
      className={`pg-call-local${sharing ? ' is-sharing' : ''}`}
      ref={ref}
      autoPlay
      playsInline
      muted={muted}
    />
  );
};

const CallOverlay = () => {
  const [snap, setSnap] = useState(() => call.snapshot());
  const [pos, setPos] = useState(readPos);
  const [minimized, setMinimized] = useState(() => {
    try { return window.localStorage.getItem(MIN_KEY) === '1'; } catch (error) { return false; }
  });
  const [tick, setTick] = useState(0);
  const dragRef = useRef(null);
  const rootRef = useRef();

  const selfUid = useSelector((state) => state.user.id);
  const myStream = useRef(null);

  useEffect(() => {
    call.install();
    const unsubscribe = call.subscribe(setSnap);
    return unsubscribe;
  }, []);

  useEffect(() => {
    if (selfUid) call.setSelfUid(selfUid);
  }, [selfUid]);

  /* süre sayacı */
  useEffect(() => {
    if (snap.state !== CALL_STATE.ACTIVE || !snap.startedAt) return undefined;
    const id = window.setInterval(() => setTick((t) => t + 1), 1000);
    return () => window.clearInterval(id);
  }, [snap.state, snap.startedAt]);

  /* yerel görüntü akışını panelde göstermek için */
  useEffect(() => {
    myStream.current = call.localStream;
  }, [snap.state, snap.videoOn, snap.sharing]);

  /* konum/küçültme tercihlerini hatırla */
  useEffect(() => {
    try {
      if (pos) window.localStorage.setItem(POS_KEY, JSON.stringify(pos));
      else window.localStorage.removeItem(POS_KEY);
    } catch (error) { /* yok say */ }
  }, [pos]);

  /* küçültme tercihini ANINDA kaydet: panel kapanıp açılsa da tercih korunur */
  const applyMinimized = useCallback((next) => {
    setMinimized(next);
    try { window.localStorage.setItem(MIN_KEY, next ? '1' : '0'); } catch (error) { /* yok say */ }
  }, []);

  /* paneli fareyle taşı */
  const startDrag = (evt) => {
    if (evt.button !== undefined && evt.button !== 0) return;
    const box = rootRef.current?.getBoundingClientRect();
    if (!box) return;
    dragRef.current = {
      dx: evt.clientX - box.left,
      dy: evt.clientY - box.top,
    };
    const onMove = (e) => {
      const maxX = window.innerWidth - 120;
      const maxY = window.innerHeight - 60;
      setPos({
        x: Math.min(Math.max(4, e.clientX - dragRef.current.dx), maxX),
        y: Math.min(Math.max(4, e.clientY - dragRef.current.dy), maxY),
      });
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  const peerLabel = useMemo(() => {
    if (snap.peer && snap.peer.name) return snap.peer.name;
    return pgT('call.unknown');
  }, [snap.peer]);

  const seconds = snap.startedAt ? (Date.now() - snap.startedAt) / 1000 : 0;
  const remote = snap.remoteVideo[0] || null;

  if (snap.state === CALL_STATE.IDLE) return null;

  const style = pos ? { left: `${pos.x}px`, top: `${pos.y}px`, right: 'auto' } : undefined;

  /* ------------------------------------------------------------- gelen */
  if (snap.state === CALL_STATE.INCOMING) {
    return (
      <div className="pg-call pg-call--incoming" ref={rootRef} style={style}>
        <div className="pg-call-pulse" />
        <div className="pg-call-info">
          <span className="pg-call-kicker">{pgT('call.incoming')}</span>
          <strong className="pg-call-name">{peerLabel}</strong>
          <span className="pg-call-kind">
            {snap.kind === CALL_KIND.VIDEO ? pgT('call.videoCall') : pgT('call.voiceCall')}
          </span>
        </div>
        <div className="pg-call-actions">
          <button
            type="button"
            className="pg-call-btn pg-call-btn--ok"
            title={pgT('call.accept')}
            onClick={() => call.acceptCall()}
          >
            📞 {pgT('call.accept')}
          </button>
          <button
            type="button"
            className="pg-call-btn pg-call-btn--no"
            title={pgT('call.reject')}
            onClick={() => call.rejectCall()}
          >
            ✕ {pgT('call.reject')}
          </button>
        </div>
      </div>
    );
  }

  /* ---------------------------------------------------------- arama bitti */
  if (snap.state === CALL_STATE.ENDED) {
    const reasons = {
      hangup: 'call.ended',
      rejected: 'call.rejected',
      missed: 'call.missed',
      busy: 'call.busy',
      timeout: 'call.noAnswer',
      'peer-ended': 'call.endedByPeer',
      'peer-left': 'call.endedByPeer',
      'media-denied': 'call.mediaDenied',
      'connection-lost': 'call.connectionLost',
    };
    return (
      <div className="pg-call pg-call--ended" ref={rootRef} style={style}>
        <span className="pg-call-kicker">{peerLabel}</span>
        <strong>{pgT(reasons[snap.endedReason] || 'call.ended')}</strong>
      </div>
    );
  }

  /* ------------------------------------------------------------- arıyor */
  if (snap.state === CALL_STATE.OUTGOING) {
    return (
      <div className="pg-call pg-call--outgoing" ref={rootRef} style={style}>
        <div className="pg-call-pulse" />
        <div className="pg-call-info">
          <span className="pg-call-kicker">{pgT('call.calling')}</span>
          <strong className="pg-call-name">{peerLabel}</strong>
          <span className="pg-call-kind">
            {snap.kind === CALL_KIND.VIDEO ? pgT('call.videoCall') : pgT('call.voiceCall')}
          </span>
        </div>
        <button
          type="button"
          className="pg-call-btn pg-call-btn--no"
          title={pgT('call.cancel')}
          onClick={() => call.hangUp()}
        >
          ✕ {pgT('call.cancel')}
        </button>
      </div>
    );
  }

  /* ------------------------------------------------------- aktif arama */
  if (minimized) {
    return (
      <button
        type="button"
        className="pg-call-pill"
        style={style}
        title={pgT('call.expand')}
        onClick={() => applyMinimized(false)}
      >
        <span className="pg-call-pill-dot" />
        {peerLabel} · {formatClock(seconds)}
      </button>
    );
  }

  return (
    <div className="pg-call pg-call--active" ref={rootRef} style={style}>
      <div className="pg-call-head" onPointerDown={startDrag} role="presentation">
        <span className="pg-call-kicker">
          {snap.sharing ? pgT('call.sharing') : pgT('call.connected')}
        </span>
        <strong className="pg-call-name">{peerLabel}</strong>
        <span className="pg-call-timer">{formatClock(seconds)}</span>
        <button
          type="button"
          className="pg-call-min"
          title={pgT('call.minimize')}
          onClick={() => applyMinimized(true)}
        >
          ▁
        </button>
      </div>

      <div className={`pg-call-stage${remote ? ' has-remote' : ''}`}>
        {remote
          ? <RemoteVideo stream={remote.stream} />
          : (
            <div className="pg-call-avatar">
              <span>{(peerLabel || '?').slice(0, 1).toUpperCase()}</span>
              <em>{snap.state === CALL_STATE.ACTIVE ? pgT('call.voiceOnly') : pgT('call.connecting')}</em>
            </div>
          )}
        {snap.sharing && <span className="pg-call-badge">{pgT('call.shareOn')}</span>}
        {remote && remote.sharing && <span className="pg-call-badge">{pgT('call.peerSharing')}</span>}
        <LocalPreview
          stream={myStream.current}
          muted
          sharing={snap.sharing}
        />
      </div>

      <div className="pg-call-controls">
        <button
          type="button"
          className={`pg-call-btn${snap.muted ? ' is-off' : ''}`}
          title={snap.muted ? pgT('call.unmute') : pgT('call.mute')}
          onClick={() => call.toggleMute()}
        >
          {snap.muted ? '🔇' : '🎙️'}
        </button>
        <button
          type="button"
          className={`pg-call-btn${snap.videoOn ? ' is-on' : ''}`}
          title={snap.videoOn ? pgT('call.camOff') : pgT('call.camOn')}
          onClick={() => call.toggleVideo()}
        >
          🎥
        </button>
        <button
          type="button"
          className={`pg-call-btn${snap.sharing ? ' is-on' : ''}`}
          title={snap.sharing ? pgT('call.shareStop') : pgT('call.shareStart')}
          onClick={() => call.toggleShare()}
        >
          🖥️
        </button>
        <button
          type="button"
          className="pg-call-btn pg-call-btn--no"
          title={pgT('call.hangup')}
          onClick={() => call.hangUp()}
        >
          📴
        </button>
      </div>
    </div>
  );
};

export default memo(CallOverlay);
