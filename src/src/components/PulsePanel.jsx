/**
 * PulsePanel — "Nabız": günün görevleri, seri, seviye, aktivite grafiği,
 * günün rekoru, ses ve koruma.
 * ===================================================================
 * Ekranın sağ altında duran kapsül (🔥 seri + görev halkası) ve tıklanınca
 * açılan panel. Veriler pgPulse'tan (sunucu: /api/market + /api/pulse/*)
 * gelir; giriş yoksa yerel modda çalışır.
 *
 * ÖNEMLİ (kullanıcı geri bildirimi): kapsül eskiden renk paletinin üstüne
 * biniyor ve paletin altındaki renkler seçilemiyordu. Artık konum
 * utils/pgDock.js ile hesaplanıyor: kapsül paletin SOLUNA (dar ekranda
 * ÜSTÜNE) yerleşir, asla üstüne gelmez. Oyuncu kapsülü sürükleyebilir;
 * konum kalıcıdır ve "sıfırla" ile otomatik yerleşime döner.
 */

import {
  useCallback, useEffect, useMemo, useRef, useState,
} from 'preact/hooks';
import { memo } from 'preact/compat';

import {
  subscribe as subscribePulse, getState as pulseState, claimGoal, refresh,
  loadBoard, loadActivity, goalTitle, goalDescription, resetCountdown,
  formatNumber, formatCompact, weekdayLabel, chartDays,
} from '../utils/pgPulse.js';
import {
  subscribe as subscribeFeedback, getState as feedbackState,
  setVolume, toggleEnabled,
} from '../utils/pgFeedback.js';
import { subscribe as subscribeGuard, getStatus as guardStatus } from '../utils/pgGuard.js';
import { dockNow, clearManualPosition } from '../utils/pgDock.js';
import { pgT } from '../utils/pgI18n.js';

/* --------------------------------------------------------------- toasts */

const toastListeners = new Set();
let toastSeq = 0;

export function pushToast({
  title, body, tone = 'info', icon = '✨', ttl = 4200,
}) {
  toastSeq += 1;
  const toast = {
    id: toastSeq, title, body, tone, icon, ttl,
  };
  toastListeners.forEach((fn) => {
    try { fn(toast); } catch { /* ignore */ }
  });
  return toast.id;
}

export const ToastHost = () => {
  const [items, setItems] = useState([]);

  useEffect(() => {
    const onToast = (toast) => {
      setItems((current) => [...current.slice(-3), toast]);
      window.setTimeout(() => {
        setItems((current) => current.filter((item) => item.id !== toast.id));
      }, toast.ttl);
    };
    toastListeners.add(onToast);
    return () => toastListeners.delete(onToast);
  }, []);

  if (!items.length) return null;

  return (
    <div className="pg-toasts" role="status" aria-live="polite">
      {items.map((toast) => (
        <div key={toast.id} className={`pg-toast pg-toast--${toast.tone}`}>
          <span className="pg-toast-icon" aria-hidden="true">{toast.icon}</span>
          <span className="pg-toast-body">
            <strong>{toast.title}</strong>
            {toast.body ? <em>{toast.body}</em> : null}
          </span>
        </div>
      ))}
    </div>
  );
};

/* ------------------------------------------------------------- konfeti */

const Confetti = ({ burst }) => {
  const pieces = useMemo(() => {
    if (!burst) return [];
    const colors = ['#ffd479', '#f0ad2c', '#56d98a', '#5aa9e6', '#b06cc9', '#ef6b6b'];
    return Array.from({ length: 26 }, (unused, index) => ({
      id: `${burst}-${index}`,
      left: Math.round(Math.random() * 100),
      delay: Math.round(Math.random() * 220),
      duration: 900 + Math.round(Math.random() * 700),
      color: colors[index % colors.length],
      rotate: Math.round(Math.random() * 360),
    }));
  }, [burst]);

  if (!burst) return null;

  return (
    <div className="pg-confetti" aria-hidden="true">
      {pieces.map((piece) => (
        <i
          key={piece.id}
          style={{
            left: `${piece.left}%`,
            animationDelay: `${piece.delay}ms`,
            animationDuration: `${piece.duration}ms`,
            background: piece.color,
            transform: `rotate(${piece.rotate}deg)`,
          }}
        />
      ))}
    </div>
  );
};

/* ---------------------------------------------------------- grafik */

export const ActivityChart = ({ activity }) => {
  const days = activity.days && activity.days.length
    ? activity.days
    : chartDays();
  const max = Math.max(1, ...days.map((day) => day.pixels || 0));
  const empty = days.every((day) => !day.pixels);

  return (
    <div className="pg-chart-wrap">
      <div className="pg-chart" role="img" aria-label={pgT('pulse.chart')}>
        {days.map((day) => {
          const pixels = day.pixels || 0;
          const percent = pixels > 0 ? Math.max(7, Math.round((pixels / max) * 100)) : 0;
          const label = `${weekdayLabel(day.key)} ${day.key.slice(8)}.${day.key.slice(5, 7)}`;
          return (
            <div
              key={day.key}
              className={`pg-chart-col${day.isToday ? ' today' : ''}${day.isBest ? ' best' : ''}${pixels ? '' : ' empty'}`}
              title={pgT('pulse.tip', { day: label, n: formatNumber(pixels) })}
            >
              <span className="pg-chart-value">{pixels ? formatCompact(pixels) : ''}</span>
              <span className="pg-chart-track" aria-hidden="true">
                <i style={{ height: `${percent}%` }} />
              </span>
              <span className="pg-chart-label">
                {weekdayLabel(day.key)}
                {day.isToday ? <b aria-hidden="true">•</b> : null}
              </span>
            </div>
          );
        })}
      </div>

      <div className="pg-chart-foot">
        <span>{pgT('pulse.weekTotal', { n: formatNumber(activity.week.total) })}</span>
        <span>{pgT('pulse.chartAverage', { n: formatNumber(activity.week.average) })}</span>
      </div>

      {activity.week.best && activity.week.best.pixels > 0 ? (
        <div className="pg-chart-best">
          {pgT('pulse.chartBest', {
            day: weekdayLabel(activity.week.best.key),
            n: formatNumber(activity.week.best.pixels),
          })}
        </div>
      ) : null}

      {empty ? <p className="pg-note small">{pgT('pulse.chartEmpty')}</p> : null}
      {activity.local && !empty ? <p className="pg-note small">{pgT('pulse.localChart')}</p> : null}
    </div>
  );
};

/* ------------------------------------------------------- günün rekoru */

export const RecordCard = ({ record }) => {
  const percent = Math.round((record.ratio || 0) * 100);
  const isRecord = !!record.isRecord;
  const hasPrevious = !record.isFirstDay && record.previousBest > 0;

  return (
    <div className={`pg-record${isRecord ? ' is-record' : ''}`}>
      <div className="pg-record-head">
        <span className="pg-record-kicker">
          <span aria-hidden="true">🏅</span>
          {' '}
          {pgT('pulse.record')}
        </span>
        {isRecord ? <span className="pg-record-badge">{pgT('pulse.recordNew')}</span> : null}
      </div>

      <div className="pg-record-main">
        <span className="pg-record-icon" aria-hidden="true">🏆</span>
        <div className="pg-record-numbers">
          <em>{pgT('pulse.recordMine')}</em>
          <strong>
            {formatNumber(record.today)}
            <span>{pgT('pulse.pixels')}</span>
          </strong>
        </div>
      </div>

      {hasPrevious ? (
        <div className="pg-record-prev">
          {pgT('pulse.recordPrev', { n: formatNumber(record.previousBest) })}
          {record.previousBestDay ? (
            <span className="pg-record-prevday">
              {pgT('pulse.recordPrevDay', {
                day: `${record.previousBestDay.slice(8)}.${record.previousBestDay.slice(5, 7)}`,
              })}
            </span>
          ) : null}
        </div>
      ) : null}

      <div className="pg-bar record" aria-hidden="true">
        <span style={{ width: `${isRecord ? 100 : percent}%` }} />
      </div>

      <p className={`pg-record-line${isRecord ? ' good' : ''}`}>
        {record.isFirstDay
          ? pgT('pulse.recordFirst')
          : isRecord
            ? pgT('pulse.recordDelta', { n: formatNumber(record.delta) })
            : pgT('pulse.recordBehind', { n: formatNumber(record.toGo) })}
      </p>
    </div>
  );
};

/* -------------------------------------------------------------- parçalar */

const GoalRow = ({ goal, busy, onClaim, mode }) => {
  const percent = goal.target ? Math.min(100, Math.round((goal.progress / goal.target) * 100)) : 0;
  const claimable = mode === 'server' && goal.completed && !goal.rewarded;
  return (
    <li className={`pg-mission${goal.completed ? ' done' : ''}${goal.rewarded ? ' claimed' : ''}`}>
      <div className="pg-mission-head">
        <span className="pg-mission-title">
          {goal.rewarded ? '✅' : goal.completed ? '🎯' : '•'}
          {' '}
          {goalTitle(goal)}
        </span>
        <span className="pg-mission-count">
          {formatCompact(goal.progress)}
          /
          {formatCompact(goal.target)}
        </span>
      </div>
      <p className="pg-mission-desc">{goalDescription(goal)}</p>
      <div className="pg-bar" aria-hidden="true">
        <span style={{ width: `${percent}%` }} />
      </div>
      <div className="pg-mission-foot">
        <span className="pg-reward">
          🪙
          {' '}
          {goal.reward}
        </span>
        <button
          type="button"
          className={`pg-btn tiny${claimable ? ' primary' : ''}`}
          disabled={!claimable || busy}
          onClick={() => onClaim(goal.id)}
        >
          {goal.rewarded
            ? pgT('pulse.claimed')
            : goal.completed ? pgT('pulse.claim') : pgT('pulse.percent', { n: percent })}
        </button>
      </div>
    </li>
  );
};

const StreakStrip = ({ streak }) => (
  <div className="pg-streak">
    <div className="pg-streak-main">
      <span className="pg-streak-flame" data-on={streak.streak > 0 ? '1' : '0'}>🔥</span>
      <div>
        <strong>{pgT('pulse.streakDays', { n: streak.streak || 0 })}</strong>
        <em>{pgT('pulse.best', { n: streak.best || 0 })}</em>
      </div>
    </div>
    <div className="pg-dots" aria-hidden="true">
      {Array.from({ length: 7 }, (unused, index) => {
        const daysAgo = 6 - index;
        const filled = daysAgo < Math.min(streak.streak || 0, 7);
        return <i key={`dot-${daysAgo}`} className={filled ? 'on' : ''} />;
      })}
    </div>
    <span className="pg-freeze" title={pgT('pulse.freeze')}>
      🧊
      {' '}
      {streak.freezeCount || 0}
    </span>
  </div>
);

/* ---------------------------------------------------------------- panel */

const PulsePanel = ({ stats = {} }) => {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(null);
  const [burst, setBurst] = useState(0);
  const [, forceRender] = useState(0);

  const dragRef = useRef(null);
  const draggedRef = useRef(false);

  useEffect(() => subscribePulse(() => forceRender((value) => value + 1)), []);
  useEffect(() => subscribeFeedback(() => forceRender((value) => value + 1)), []);
  useEffect(() => subscribeGuard(() => forceRender((value) => value + 1)), []);

  /* --------------------------------------------------- palet ile dock */

  useEffect(() => {
    let raf = 0;
    const update = () => {
      if (typeof window.requestAnimationFrame !== 'function') {
        dockNow();
        return;
      }
      window.cancelAnimationFrame(raf);
      raf = window.requestAnimationFrame(() => dockNow());
    };

    update();
    window.addEventListener('resize', update);
    window.addEventListener('orientationchange', update);
    window.addEventListener('scroll', update, true);

    /* palet açılıp kapanınca (stil değişimi) yeniden ölç */
    let observer = null;
    const palette = typeof document !== 'undefined' ? document.querySelector('#palettebox') : null;
    if (palette && typeof MutationObserver === 'function') {
      observer = new MutationObserver(update);
      observer.observe(palette, { attributes: true, attributeFilter: ['style', 'class'] });
    }
    /* tema/diğer bileşenler paleti yeniden çizebilir: hafif yoklama */
    const timer = window.setInterval(update, 1500);

    return () => {
      if (raf) window.cancelAnimationFrame(raf);
      window.removeEventListener('resize', update);
      window.removeEventListener('orientationchange', update);
      window.removeEventListener('scroll', update, true);
      if (observer) observer.disconnect();
      window.clearInterval(timer);
    };
  }, []);

  /* motor olayları -> bildirim */
  useEffect(() => subscribePulse((event) => {
    if (event.type === 'goalDone') {
      pushToast({
        title: pgT('toast.goalDone', { title: event.title }),
        body: pgT('pulse.claim'),
        icon: '🎯',
        tone: 'good',
      });
    }
    if (event.type === 'claimed') {
      setBurst((value) => value + 1);
      pushToast({
        title: pgT('toast.goalClaim', { title: event.title, coins: event.coins }),
        icon: '🪙',
        tone: 'good',
      });
    }
    if (event.type === 'levelUp') {
      setBurst((value) => value + 1);
      pushToast({
        title: pgT('toast.levelUp', { n: event.level, title: event.title }),
        icon: '⬆️',
        tone: 'gold',
      });
    }
    if (event.type === 'streak') {
      setBurst((value) => value + 1);
      pushToast({
        title: event.milestone
          ? pgT('toast.streakMilestone', { n: event.milestone, coins: event.coins || 0 })
          : pgT('toast.streakUp', { n: event.count }),
        icon: '🔥',
        tone: 'gold',
      });
    }
    if (event.type === 'freezeUsed') {
      pushToast({ title: pgT('toast.freezeUsed'), icon: '🧊', tone: 'info', ttl: 6000 });
    }
    if (event.type === 'record') {
      setBurst((value) => value + 1);
      pushToast({
        title: pgT('toast.record', {
          n: formatNumber(event.today),
          prev: formatNumber(event.previousBest),
        }),
        body: event.bonus && event.bonus.awarded
          ? pgT('toast.recordBonus', { n: event.bonus.coins })
          : pgT('pulse.recordNew'),
        icon: '🏆',
        tone: 'gold',
        ttl: 8000,
      });
    }
    if (event.type === 'error' && event.error) {
      pushToast({
        title: pgT('toast.claimFail', { error: event.error }),
        icon: '⚠️',
        tone: 'warn',
      });
    }
  }), []);

  useEffect(() => subscribeGuard((event) => {
    if (!event) return;
    if (event.type === 'warn') {
      /*
       * Uyari artik saniyor degil bilgilendiriyor: oyuncuya engellenmedigini
       * acikca soyluyor (eski metin "Olagan disi tiklama deseni algilandi" idi
       * ve ölçüm hatasi yuzunden masum oyuncuyu korkutuyordu).
       */
      const lines = (event.signals || [])
        .map((signal) => pgT(`guard.${signal}`))
        .slice(0, 3)
        .join(' · ');
      pushToast({
        title: pgT('guard.warnTitle'),
        body: lines ? pgT('guard.warnBody', { lines }) : null,
        icon: '🛡️',
        tone: 'warn',
        ttl: 9000,
      });
    } else if (event.type === 'block') {
      pushToast({
        title: pgT('guard.lockedNow'),
        icon: '🔒',
        tone: 'warn',
        ttl: 6000,
      });
    }
  }), []);

  /* panel açıkken 30 saniyede bir tazele */
  useEffect(() => {
    if (!open) return () => {};
    loadActivity({ silent: true });
    loadBoard();
    const timer = window.setInterval(() => {
      if (document.visibilityState !== 'visible') return;
      loadActivity({ silent: true });
    }, 30000);
    return () => window.clearInterval(timer);
  }, [open]);

  const onClaim = useCallback(async (goalId) => {
    setBusy(goalId);
    await claimGoal(goalId);
    setBusy(null);
  }, []);

  const toggle = useCallback(() => {
    setOpen((value) => {
      const next = !value;
      if (next) {
        refresh();
        loadActivity({ silent: true });
        loadBoard();
      }
      return next;
    });
  }, []);

  /* --------------------------------------------------- sürükleme */

  const resetPosition = useCallback(() => {
    clearManualPosition();
    dockNow();
  }, []);

  const onPointerDown = useCallback((evt) => {
    if (evt.pointerType === 'mouse' && evt.button !== 0) return;
    const rect = evt.currentTarget.getBoundingClientRect();
    dragRef.current = {
      startX: evt.clientX,
      startY: evt.clientY,
      right: window.innerWidth - rect.right,
      bottom: window.innerHeight - rect.bottom,
      moved: false,
    };
    try {
      evt.currentTarget.setPointerCapture(evt.pointerId);
    } catch { /* tarayıcı desteklemiyorsa sorun değil */ }
  }, []);

  const onPointerMove = useCallback((evt) => {
    const drag = dragRef.current;
    if (!drag) return;
    const dx = evt.clientX - drag.startX;
    const dy = evt.clientY - drag.startY;
    if (!drag.moved && Math.abs(dx) + Math.abs(dy) < 6) return;
    drag.moved = true;
    const right = Math.max(0, Math.min(window.innerWidth - 40, drag.right - dx));
    const bottom = Math.max(0, Math.min(window.innerHeight - 40, drag.bottom - dy));
    drag.right = right;
    drag.bottom = bottom;
    const root = document.documentElement;
    root.style.setProperty('--pg-pill-right', `${Math.round(right)}px`);
    root.style.setProperty('--pg-pill-bottom', `${Math.round(bottom)}px`);
    root.style.setProperty('--pg-panel-right', `${Math.round(right)}px`);
  }, []);

  const onPointerUp = useCallback(() => {
    const drag = dragRef.current;
    dragRef.current = null;
    if (!drag || !drag.moved) return;
    draggedRef.current = true;
    window.setTimeout(() => { draggedRef.current = false; }, 400);
    /* konumu kalıcı hale getir (pgDock.setManualPosition) */
    import('../utils/pgDock.js').then((mod) => {
      mod.setManualPosition({ right: drag.right, bottom: drag.bottom });
      dockNow();
    }).catch(() => {});
  }, []);

  const onPillClick = useCallback(() => {
    if (draggedRef.current) return;
    toggle();
  }, [toggle]);

  const pulse = pulseState();
  const feedback = feedbackState();
  const guard = guardStatus();
  const goals = pulse.goals || [];
  const doneCount = goals.filter((goal) => goal.rewarded || goal.completed).length;
  const ring = goals.length ? doneCount / goals.length : 0;
  const board = pulse.board;
  const isServer = pulse.mode === 'server';
  const activity = pulse.activity;

  return (
    <>
      <Confetti burst={burst} />

      <button
        type="button"
        className={`pg-pill${open ? ' open' : ''}`}
        title={`${pgT('pulse.open')} · ${pgT('pulse.dragHint')}`}
        aria-expanded={open}
        onClick={onPillClick}
        onDblClick={resetPosition}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        <span
          className="pg-pill-flame"
          data-streak={(pulse.streak.streak || 0) > 0 ? 'on' : 'off'}
          aria-hidden="true"
        >
          🔥
        </span>
        <span className="pg-pill-streak">{pulse.streak.streak || 0}</span>
        <span className="pg-ring" aria-hidden="true">
          <svg viewBox="0 0 36 36">
            <circle className="pg-ring-bg" cx="18" cy="18" r="15.5" />
            <circle
              className="pg-ring-fg"
              cx="18"
              cy="18"
              r="15.5"
              style={{ strokeDasharray: `${ring * 97.4} 97.4` }}
            />
          </svg>
        </span>
        <span className="pg-pill-count">
          {doneCount}/{goals.length}
        </span>
      </button>

      {open && (
        <section className="pg-panel" aria-label={pgT('pulse.title')}>
          <header className="pg-panel-head">
            <div className="pg-panel-title">
              <span className="pg-panel-kicker">{pgT('pulse.title')}</span>
              <strong>{pulse.level.title}</strong>
              <em>
                {pgT('pulse.level', { n: pulse.level.level })}
                {' · '}
                {isServer ? pgT('pulse.serverSaved') : pgT('pulse.localMode')}
              </em>
            </div>
            <div className="pg-panel-econ">
              <span className="pg-coins" title={pgT('pulse.coins')}>
                🪙
                {' '}
                {formatNumber(pulse.coins)}
              </span>
              <button
                type="button"
                className="pg-icon-btn"
                title={pgT('pulse.refresh')}
                aria-label={pgT('pulse.refresh')}
                onClick={() => { refresh(); loadActivity({ silent: true }); loadBoard(); }}
              >
                ↻
              </button>
              <button
                type="button"
                className="pg-icon-btn"
                title={pgT('pulse.close')}
                aria-label={pgT('pulse.close')}
                onClick={() => setOpen(false)}
              >
                ✕
              </button>
            </div>
          </header>

          <div className="pg-xp">
            <div className="pg-bar xp" aria-hidden="true">
              <span style={{ width: `${Math.round((pulse.level.ratio || 0) * 100)}%` }} />
            </div>
            <span className="pg-xp-text">
              {pulse.level.next
                ? pgT('pulse.nextLevel', { n: formatNumber(pulse.level.next) })
                : pgT('pulse.maxLevel')}
            </span>
          </div>

          <StreakStrip streak={pulse.streak} />

          <div className="pg-section-title">
            <span>{pgT('pulse.chart')}</span>
            <em>{pgT('pulse.chartHint')}</em>
          </div>
          <ActivityChart activity={activity} />

          <RecordCard record={activity.record} />

          <div className="pg-section-title">
            <span>{pgT('pulse.goals')}</span>
            <em>{pgT('pulse.missionsReset', { time: resetCountdown() })}</em>
          </div>

          {isServer ? (
            <ul className="pg-missions">
              {goals.map((goal) => (
                <GoalRow
                  key={goal.id}
                  goal={goal}
                  mode={pulse.mode}
                  busy={busy === goal.id}
                  onClaim={onClaim}
                />
              ))}
            </ul>
          ) : (
            <p className="pg-note">
              {pgT('pulse.localNote')}
            </p>
          )}

          <div className="pg-section-title">
            <span>{pgT('pulse.board')}</span>
            {board && board.me ? <em>{pgT('pulse.rank', { n: board.me.rank || '—' })}</em> : null}
          </div>

          <ol className="pg-board">
            {(!board || !board.leaderboard || !board.leaderboard.length) && (
              <li className="pg-board-empty">
                {pulse.boardLoading ? '…' : pgT('pulse.boardEmpty')}
              </li>
            )}
            {board && board.leaderboard && board.leaderboard.map((row) => (
              <li key={`${row.id}-${row.rank}`} className={board.me && board.me.id === row.id ? 'me' : ''}>
                <span className="pg-board-rank">{row.rank}</span>
                <span className="pg-board-name">
                  {row.name}
                  {board.me && board.me.id === row.id ? ` (${pgT('pulse.you')})` : ''}
                </span>
                <span className="pg-board-pixels">{formatNumber(row.pixels)}</span>
              </li>
            ))}
          </ol>

          <div className="pg-stats">
            <span>
              <b>{isServer ? formatNumber(pulse.today.pixels) : formatNumber(pulse.stats.todayPixels)}</b>
              {pgT('pulse.todayPixels')}
            </span>
            <span>
              <b>{pgT('pulse.minute', { n: pulse.stats.sessionMinutes })}</b>
              {pgT('pulse.sessionTime')}
            </span>
            <span>
              <b>{formatCompact(pulse.stats.chaosPixels)}</b>
              {pgT('pulse.chaosTime')}
            </span>
            {feedback.combo > 1 && (
              <span className="combo">
                <b>
                  {feedback.combo}
                  x
                </b>
                {pgT('pulse.combo')}
              </span>
            )}
          </div>

          <div className="pg-foot">
            <label className="pg-switch">
              <input
                type="checkbox"
                checked={feedback.enabled}
                onChange={() => toggleEnabled()}
              />
              <span className="pg-switch-track" aria-hidden="true"><i /></span>
              <span className="pg-switch-label">
                {pgT('pulse.sound')}
                {' '}
                {feedback.enabled ? pgT('pulse.soundOn') : pgT('pulse.soundOff')}
              </span>
            </label>
            <input
              className="pg-range"
              type="range"
              min="0"
              max="100"
              value={Math.round(feedback.volume * 100)}
              aria-label={pgT('pulse.volume')}
              onInput={(evt) => setVolume(Number(evt.currentTarget.value) / 100)}
            />
            <span className={`pg-guard${guard.warned ? ' warn' : ''}`} title={pgT('guard.title')}>
              🛡️
              {' '}
              {guard.warned
                ? pgT('pulse.guardWarn', { n: guard.signals.length })
                : pgT('pulse.guardOk')}
            </span>
          </div>

          {stats.online ? (
            <div className="pg-live">
              <span className="pg-live-dot" aria-hidden="true" />
              {stats.online}
              {' '}
              {pgT('chat.onlineNow')}
            </div>
          ) : null}
        </section>
      )}
    </>
  );
};

export default memo(PulsePanel);
