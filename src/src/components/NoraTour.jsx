/**
 * Nora Tour — first-visit guided tour
 * -----------------------------------
 * Nora is the little guide that walks a new player through the canvas the
 * first time they enter the game.
 *
 * Flow
 *  1) Language gate: "Selam ben Nora, sana oyunu öğreteceğim!
 *     İlk hangi dil ile konuşmamı istersin?" with Speak English / Türkçe Konuş.
 *  2) 13 guided steps. Each step dims the screen, spotlights the real UI
 *     element, drops a "tap here" bubble on it and explains what it does.
 *     Interactive steps (pick a color, place a pixel, open the menu, open your
 *     account) continue on their own the moment the player really does it.
 *  3) Progress is stored in localStorage. Once the tour is finished it never
 *     shows up again; if the player closes it early, the position is kept and
 *     a small "Rehberi sürdür" pill offers to continue later.
 *
 * Console helpers (handy while developing):
 *   noraTour.reset()   -> forget progress, show the tour again
 *   noraTour.start()   -> restart from step 1 right now
 *   noraTour.resume()  -> continue from the stored step
 *   noraTour.finish()  -> mark as done
 *   noraTour.state()   -> what is saved right now
 *
 * Mount it once in App.jsx:
 *   import NoraTour from './NoraTour.jsx';
 *   ...
 *   <NoraTour />
 */

import {
  useCallback, useEffect, useMemo, useRef, useState,
} from 'preact/hooks';
import { memo } from 'preact/compat';

import { useDispatch, useSelector } from '../store/react-redux/index.js';
import {
  openWindow, closeAllWindowTypes,
} from '../store/actions/windows.js';
import { toggleOpenPalette } from '../store/actions/index.js';
import { notify } from '../store/actions/thunks.js';

import {
  TOUR_KEY, getSteps, getUiText, getGate,
} from './noraTourSteps.js';
import '../styles/nora-tour.css';

/* ------------------------------------------------------------------ setup */

const RULES_KEY = 'pg_welcome_v1'; // key used by the welcome + rules modal
const IMAGE_PATH = '/nora.png';    // override with window.NORA_TOUR_IMAGE
const DEBUG = false;               // logs step transitions to the console

const log = (...args) => {
  // eslint-disable-next-line no-console
  if (DEBUG) console.log('[nora]', ...args);
};

/* Image candidates: custom override -> plain public path -> basename path. */
function imageCandidates() {
  const list = [];
  const custom = (typeof window !== 'undefined' && window.NORA_TOUR_IMAGE) || '';
  const base = (typeof window !== 'undefined' && window.ssv && window.ssv.basename) || '';
  if (custom) list.push(custom);
  list.push(IMAGE_PATH);
  if (base) list.push(`${String(base).replace(/\/$/, '')}${IMAGE_PATH}`);
  return list.filter((value, index) => value && list.indexOf(value) === index);
}

function readSaved() {
  try {
    const raw = localStorage.getItem(TOUR_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null; // private mode / storage disabled
  }
}

function writeSaved(patch) {
  try {
    const next = { ...(readSaved() || {}), ...patch, updatedAt: Date.now() };
    localStorage.setItem(TOUR_KEY, JSON.stringify(next));
    return next;
  } catch {
    return null;
  }
}

/*
 * The welcome + rules modal takes the first slot on a fresh visit. Wait for it
 * (it renders .pg-welcome-overlay) and for its acknowledgement key, but do not
 * wait forever: if the rules flow is not mounted at all, start the tour after
 * a short grace period.
 */
function rulesModalIsBlocking(graceTries) {
  if (typeof document === 'undefined') return false;
  if (document.querySelector('.pg-welcome-overlay')) return true;
  let acknowledged = true;
  try {
    acknowledged = localStorage.getItem(RULES_KEY) === '1';
  } catch {
    acknowledged = true;
  }
  return !acknowledged && graceTries < 15; // ~3s grace, then go ahead
}

function findTarget(selectors) {
  if (!selectors || typeof document === 'undefined') return null;
  const list = Array.isArray(selectors) ? selectors : [selectors];
  for (let i = 0; i < list.length; i += 1) {
    const el = document.querySelector(list[i]);
    if (!el) continue;
    const rect = el.getBoundingClientRect();
    // skip hidden / zero size elements (controls hide behind open windows)
    if (rect.width < 2 || rect.height < 2) continue;
    return el;
  }
  return null;
}

function rectOf(el) {
  if (!el) return null;
  const r = el.getBoundingClientRect();
  if (r.width < 2 || r.height < 2) return null;
  return {
    top: r.top, left: r.left, width: r.width, height: r.height,
  };
}

function sameRect(a, b) {
  if (!a || !b) return a === b;
  return a.top === b.top && a.left === b.left
    && a.width === b.width && a.height === b.height;
}

/* Typewriter for the body copy — clicking the card finishes it instantly. */
function useTypewriter(text, active, speed = 14) {
  const full = text || '';
  const [shown, setShown] = useState(full);

  useEffect(() => {
    if (!active) {
      setShown(full);
      return undefined;
    }
    setShown('');
    let i = 0;
    const id = window.setInterval(() => {
      i += 2;
      setShown(full.slice(0, i));
      if (i >= full.length) window.clearInterval(id);
    }, speed);
    return () => window.clearInterval(id);
  }, [full, active, speed]);

  const skip = useCallback(() => setShown(full), [full]);
  return [shown, shown === full, skip];
}

/* --------------------------------------------------------------- component */

const NoraTour = () => {
  const dispatch = useDispatch();

  const paletteOpen = useSelector((state) => state.gui.paletteOpen);
  const selectedColor = useSelector((state) => state.canvas.selectedColor);
  const coolDown = useSelector((state) => state.user.coolDown);

  const [phase, setPhase] = useState('idle'); // idle | gate | tour
  const [lang, setLang] = useState('tr');
  const [stepIndex, setStepIndex] = useState(0);
  const [rect, setRect] = useState(null);
  const [hintRect, setHintRect] = useState(null);
  const [satisfied, setSatisfied] = useState(false);
  const [resumeAt, setResumeAt] = useState(null);
  const [imgIndex, setImgIndex] = useState(0);

  const steps = useMemo(() => getSteps(lang), [lang]);
  const step = phase === 'tour' ? steps[Math.min(stepIndex, steps.length - 1)] : null;
  const ui = useMemo(() => getUiText(lang), [lang]);
  const gate = useMemo(() => getGate(lang), [lang]);
  const images = useMemo(imageCandidates, []);
  const imgSrc = images[Math.min(imgIndex, images.length - 1)];

  /*
   * Everything below is written with refs so the callbacks stay stable. The
   * tour must survive re-renders (store updates, spotlights moving, ...)
   * without restarting its timers or dropping listeners.
   */
  const liveRef = useRef({});
  liveRef.current = { paletteOpen, selectedColor, coolDown };

  const metaRef = useRef({});
  metaRef.current = { lang, stepIndex, total: steps.length };

  const dispatchRef = useRef(dispatch);
  dispatchRef.current = dispatch;

  const entryRef = useRef({});        // store values captured at step start
  const autoTimerRef = useRef(null);  // pending "advance automatically" timer
  const stepTokenRef = useRef(0);     // identifies the step that timer belongs to
  const handledRef = useRef(-1);      // token already satisfied
  const bootRef = useRef(false);

  /* --------------------------------------------------------- callbacks */

  const clickSelector = useCallback((selector) => {
    const el = document.querySelector(selector);
    if (el) el.click();
  }, []);

  const runAction = useCallback((action) => {
    const live = liveRef.current;
    switch (action) {
      case 'togglePalette':
        dispatchRef.current(toggleOpenPalette());
        break;
      case 'ensurePalette':
        if (!live.paletteOpen) dispatchRef.current(toggleOpenPalette());
        break;
      case 'openMenu':
      case 'ensureMenu':
        if (!document.querySelector('#topbtncol.open')) clickSelector('#topbtnrow .topbtn');
        break;
      case 'openSettings':
        dispatchRef.current(openWindow('SETTINGS', true));
        break;
      case 'ensureSettings':
        if (!document.querySelector('#wm .window.SETTINGS')) {
          dispatchRef.current(openWindow('SETTINGS', true));
        }
        break;
      case 'openUserArea':
        dispatchRef.current(openWindow('USERAREA', true));
        break;
      case 'ensureUserArea':
        if (!document.querySelector('#wm .window.USERAREA')) {
          dispatchRef.current(openWindow('USERAREA', true));
        }
        break;
      case 'closeWindows':
        dispatchRef.current(closeAllWindowTypes('SETTINGS'));
        dispatchRef.current(closeAllWindowTypes('USERAREA'));
        break;
      default:
        break;
    }
  }, [clickSelector]);

  const clearAutoTimer = useCallback(() => {
    if (autoTimerRef.current) {
      window.clearTimeout(autoTimerRef.current);
      autoTimerRef.current = null;
    }
  }, []);

  const finish = useCallback(() => {
    const { lang: currentLang, total } = metaRef.current;
    clearAutoTimer();
    handledRef.current = stepTokenRef.current;
    writeSaved({ status: 'done', step: total - 1, lang: currentLang });
    setResumeAt(null);
    setSatisfied(false);
    setPhase('idle');
    dispatchRef.current(closeAllWindowTypes('SETTINGS'));
    dispatchRef.current(closeAllWindowTypes('USERAREA'));
    dispatchRef.current(notify(getUiText(currentLang).complete));
    log('finished');
  }, [clearAutoTimer]);

  const advance = useCallback((delta) => {
    const { lang: currentLang, total, stepIndex: current } = metaRef.current;
    clearAutoTimer();
    const next = current + delta;
    if (next >= total) {
      // pressing Next on the last step wraps up the tour
      window.setTimeout(() => finish(), 60);
      return;
    }
    const clamped = Math.max(0, next);
    writeSaved({ status: 'active', step: clamped, lang: currentLang });
    setSatisfied(false);
    setStepIndex(clamped);
    log('advance ->', clamped);
  }, [clearAutoTimer, finish]);

  const skip = useCallback(() => {
    const { lang: currentLang, stepIndex: current } = metaRef.current;
    clearAutoTimer();
    writeSaved({ status: 'active', step: current, lang: currentLang });
    setResumeAt({ step: current, lang: currentLang });
    setSatisfied(false);
    setPhase('idle');
    dispatchRef.current(closeAllWindowTypes('SETTINGS'));
    dispatchRef.current(closeAllWindowTypes('USERAREA'));
    log('skipped at', current);
  }, [clearAutoTimer]);

  const startAt = useCallback((index, nextLang) => {
    const { total } = metaRef.current;
    const safeLang = nextLang === 'en' ? 'en' : 'tr';
    const safeIndex = Math.max(0, Math.min(index, total - 1));
    clearAutoTimer();
    setLang(safeLang);
    setStepIndex(safeIndex);
    setResumeAt(null);
    setSatisfied(false);
    writeSaved({ status: 'active', step: safeIndex, lang: safeLang });
    setPhase('tour');
    log('start at', safeIndex, safeLang);
  }, [clearAutoTimer]);

  /* ------------------------------------------------------------ boot */

  useEffect(() => {
    if (bootRef.current) return undefined;
    bootRef.current = true;

    const saved = readSaved();
    if (saved && saved.status === 'done') return undefined; // never again
    if (saved && typeof saved.step === 'number' && saved.step > 0) {
      setResumeAt({ step: saved.step, lang: saved.lang === 'en' ? 'en' : 'tr' });
    }

    let tries = 0;
    let cancelled = false;
    const timer = window.setInterval(() => {
      tries += 1;
      if (cancelled) {
        window.clearInterval(timer);
        return;
      }
      const ready = document.querySelector('#topbtnbar')
        || document.querySelector('#app')
        || document.querySelector('.viewport');
      if (ready && !rulesModalIsBlocking(tries)) {
        window.clearInterval(timer);
        window.setTimeout(() => {
          if (cancelled) return;
          const state = readSaved();
          if (state && typeof state.step === 'number' && state.step > 0) {
            startAt(state.step, state.lang);
          } else {
            setPhase('gate');
          }
        }, 900); // let the canvas paint first
        return;
      }
      if (tries > 600) window.clearInterval(timer); // ~2min, then stay quiet
    }, 200);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [startAt]);

  /* ------------------------------------------- spotlight + hint tracking */

  useEffect(() => {
    if (phase !== 'tour' || !step) {
      setRect((prev) => (prev === null ? prev : null));
      setHintRect((prev) => (prev === null ? prev : null));
      return undefined;
    }

    const update = () => {
      const target = step.target ? findTarget(step.target) : null;
      const nextRect = rectOf(target);
      setRect((prev) => (sameRect(prev, nextRect) ? prev : nextRect));

      let nextHint = null;
      if (step.hintOn === 'pencil') {
        nextHint = rectOf(document.querySelector('#pencilbutton'));
      } else if (step.hint) {
        nextHint = rectOf(target);
      }
      setHintRect((prev) => (sameRect(prev, nextHint) ? prev : nextHint));
    };

    update();
    const timer = window.setInterval(update, 250);
    window.addEventListener('resize', update);
    window.addEventListener('scroll', update, true);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('resize', update);
      window.removeEventListener('scroll', update, true);
    };
  }, [phase, stepIndex, lang, step]);

  /* ------------------------------------------------ step enter / watch */

  useEffect(() => {
    if (phase !== 'tour' || !step) return undefined;
    stepTokenRef.current += 1;
    clearAutoTimer();
    entryRef.current = { ...liveRef.current };
    setSatisfied(false);
    writeSaved({ status: 'active', step: stepIndex, lang });
    if (step.onEnter) runAction(step.onEnter);
    log('enter step', stepIndex, step.id);
    return undefined;
  }, [phase, stepIndex, lang, step, runAction, clearAutoTimer]);

  useEffect(() => {
    if (phase !== 'tour' || !step || !step.watch) return undefined;
    const watch = step.watch || {};
    const entry = { ...entryRef.current };
    const token = stepTokenRef.current;

    const succeed = () => {
      if (handledRef.current === token) return;
      handledRef.current = token;
      setSatisfied(true);
      clearAutoTimer();
      autoTimerRef.current = window.setTimeout(() => {
        if (stepTokenRef.current === token) advance(1);
      }, 620);
      log('step satisfied', step.id);
    };

    /* clicks on the highlighted element count as "done" */
    const listeners = [];
    (watch.click || []).forEach((selector) => {
      document.querySelectorAll(selector).forEach((el) => {
        const handler = () => succeed();
        el.addEventListener('pointerup', handler);
        listeners.push([el, handler]);
      });
    });

    /* a tap / click on the canvas = a pixel was placed */
    if (watch.pixel) {
      const canvas = document.querySelector('.viewport')
        || document.querySelector('#app canvas');
      if (canvas) {
        const onUp = () => succeed();
        canvas.addEventListener('pointerup', onUp);
        listeners.push([canvas, onUp]);
      }
    }

    /* poll DOM conditions + store values */
    const timer = window.setInterval(() => {
      const live = liveRef.current;
      if ((watch.dom || []).some((selector) => document.querySelector(selector))) {
        succeed();
        return;
      }
      if ((watch.state || []).some((key) => live[key] !== entry[key])) {
        succeed();
        return;
      }
      if (watch.pixel && live.coolDown && live.coolDown !== entry.coolDown) {
        succeed();
      }
    }, 200);

    return () => {
      window.clearInterval(timer);
      listeners.forEach(([el, handler]) => el.removeEventListener('pointerup', handler));
    };
  }, [phase, stepIndex, lang, step, advance, clearAutoTimer]);

  /* cancel a pending auto-advance when the tour unmounts */
  useEffect(() => () => clearAutoTimer(), [clearAutoTimer]);

  /* -------------------------------------------------------- keyboard */

  useEffect(() => {
    if (phase !== 'tour') return undefined;
    const onKey = (evt) => {
      if (evt.key === 'Escape') skip();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [phase, skip]);

  /* ------------------------------------------------- debug API + events */

  useEffect(() => {
    if (typeof window === 'undefined') return undefined;

    const onStart = (evt) => {
      const detail = (evt && evt.detail) || {};
      startAt(typeof detail.step === 'number' ? detail.step : 0, detail.lang || metaRef.current.lang);
    };

    window.addEventListener('nora-tour:start', onStart);
    window.noraTour = {
      reset: () => {
        try { localStorage.removeItem(TOUR_KEY); } catch { /* ignore */ }
        startAt(0, metaRef.current.lang);
      },
      start: () => startAt(0, metaRef.current.lang),
      resume: () => {
        const saved = readSaved();
        startAt(
          saved && typeof saved.step === 'number' ? saved.step : 0,
          (saved && saved.lang) || metaRef.current.lang,
        );
      },
      finish,
      skip,
      state: () => readSaved(),
    };

    return () => {
      window.removeEventListener('nora-tour:start', onStart);
      if (window.noraTour) delete window.noraTour;
    };
  }, [finish, skip, startAt]);

  /* ------------------------------------------------------------- layout */

  const layout = useMemo(() => {
    if (typeof window === 'undefined') return null;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const W = Math.min(600, vw - 24);
    const H = Math.min(300, vh * 0.5);
    const gap = 18;

    if (!rect) {
      return {
        place: 'center',
        style: { left: Math.round(vw / 2 - W / 2), top: Math.round(vh - H - 40), width: W },
      };
    }

    let place = (step && step.placement) || 'auto';
    if (place === 'auto') {
      if (vh - rect.top - rect.height > H + gap + 20) place = 'bottom';
      else if (rect.top > H + gap + 20) place = 'top';
      else if (vw - rect.left - rect.width > W + gap + 20) place = 'right';
      else if (rect.left > W + gap + 20) place = 'left';
      else place = 'center';
    }

    let left;
    let top;
    if (place === 'bottom') {
      left = rect.left + rect.width / 2 - W / 2;
      top = rect.top + rect.height + gap;
    } else if (place === 'top') {
      left = rect.left + rect.width / 2 - W / 2;
      top = rect.top - H - gap;
    } else if (place === 'right') {
      left = rect.left + rect.width + gap;
      top = rect.top + rect.height / 2 - H / 2;
    } else if (place === 'left') {
      left = rect.left - W - gap;
      top = rect.top + rect.height / 2 - H / 2;
    } else {
      place = 'center';
      left = vw / 2 - W / 2;
      top = vh - H - 40;
    }

    left = Math.max(12, Math.min(left, vw - W - 12));
    top = Math.max(12, Math.min(top, vh - H - 12));
    return { place, style: { left: Math.round(left), top: Math.round(top), width: W } };
  }, [rect, step]);

  const hintPosition = useMemo(() => {
    if (!hintRect || typeof window === 'undefined') return null;
    const vw = window.innerWidth;
    const side = step && step.hint === 'inside' ? 'inside' : ((step && step.hint) || 'top');
    if (side === 'inside') {
      return {
        side,
        style: {
          left: Math.round(hintRect.left + 10),
          top: Math.round(hintRect.top + 10),
        },
      };
    }
    const x = Math.min(Math.max(hintRect.left + hintRect.width / 2, 80), vw - 80);
    if (side === 'bottom') {
      return {
        side,
        style: {
          left: Math.round(x),
          top: Math.round(hintRect.top + hintRect.height + 14),
        },
      };
    }
    return {
      side: 'top',
      style: { left: Math.round(x), top: Math.round(hintRect.top - 14) },
    };
  }, [hintRect, step]);

  const [typedText, typingDone, finishTyping] = useTypewriter(
    step ? step.text : '',
    phase === 'tour',
  );

  /* ------------------------------------------------------------- render */

  const holeStyle = rect ? {
    top: Math.round(rect.top - 8),
    left: Math.round(rect.left - 8),
    width: Math.round(rect.width + 16),
    height: Math.round(rect.height + 16),
  } : null;

  const primaryLabel = step && step.nextLabel === 'done' ? ui.done : ui.next;

  return (
    <div className="nora-root">
      {/* --------------------------------------------------- language gate */}
      {phase === 'gate' && (
        <div className="nora-gate" role="dialog" aria-modal="true" aria-label={gate.hello}>
          <div className="nora-gate-orbits" aria-hidden="true" />
          <div className="nora-gate-card">
            <div className="nora-gate-art">
              <div className="nora-gate-halo" aria-hidden="true" />
              <img
                className="nora-gate-img"
                src={imgSrc}
                alt="Nora"
                onError={() => setImgIndex((i) => (i + 1 < images.length ? i + 1 : i))}
              />
            </div>
            <div className="nora-gate-body">
              <div className="nora-gate-name">
                <Crown />
                <span>{ui.name}</span>
              </div>
              <h2 className="nora-gate-hello">{gate.hello}</h2>
              <p className="nora-gate-hello-sub">{gate.helloSub}</p>
              <div className="nora-gate-ask">
                <strong>{gate.ask}</strong>
                <span>{gate.askSub}</span>
              </div>
              <div className="nora-gate-btns">
                <button
                  type="button"
                  className="nora-gate-btn primary"
                  onClick={() => startAt(0, 'en')}
                >
                  <span aria-hidden="true">🇺🇸</span>
                  {gate.en}
                </button>
                <button
                  type="button"
                  className="nora-gate-btn"
                  onClick={() => startAt(0, 'tr')}
                >
                  <span aria-hidden="true">🇹🇷</span>
                  {gate.tr}
                </button>
              </div>
              <button
                type="button"
                className="nora-gate-later"
                onClick={() => {
                  writeSaved({ status: 'active', step: 0, lang });
                  setResumeAt({ step: 0, lang });
                  setPhase('idle');
                }}
              >
                {gate.later}
              </button>
              <div className="nora-gate-meta">{gate.meta}</div>
            </div>
          </div>
        </div>
      )}

      {/* --------------------------------------------------------- tour */}
      {phase === 'tour' && step && (
        <>
          {holeStyle ? (
            <>
              <div className="nora-hole" style={holeStyle} aria-hidden="true" />
              <div
                className={`nora-ring${satisfied ? ' done' : ''}`}
                style={holeStyle}
                aria-hidden="true"
              />
            </>
          ) : (
            <div className="nora-dim" aria-hidden="true" />
          )}

          {hintPosition && (
            <div
              className={`nora-taphint${hintPosition.side === 'inside' ? ' inside' : ''}`}
              style={hintPosition.style}
              aria-hidden="true"
            >
              {ui.tapHere}
            </div>
          )}

          {satisfied && (
            <div
              className="nora-check"
              style={holeStyle || { left: '50%', top: '40%', width: 0, height: 0 }}
              aria-hidden="true"
            >
              ✓
            </div>
          )}

          <div
            className={`nora-card nora-card--${layout ? layout.place : 'center'}`}
            style={layout ? layout.style : undefined}
            role="dialog"
            aria-label={`${ui.name}: ${step.title}`}
            onClick={finishTyping}
          >
            <div className="nora-progress" aria-hidden="true">
              <span style={{ width: `${((stepIndex + 1) / steps.length) * 100}%` }} />
            </div>

            <div className="nora-avatar" aria-hidden="true">
              <img
                src={imgSrc}
                alt=""
                onError={() => setImgIndex((i) => (i + 1 < images.length ? i + 1 : i))}
              />
            </div>

            <div className="nora-content">
              <div className="nora-head">
                <Crown />
                <span className="nora-name">{ui.name}</span>
              </div>
              <h3 className="nora-title">{step.title}</h3>
              <p className="nora-text">
                {typedText}
                {!typingDone && <span className="nora-caret" aria-hidden="true" />}
              </p>
              {(step.watch && !satisfied) && (
                <div className="nora-note">{ui.autoNote}</div>
              )}
            </div>

            <div className="nora-foot">
              <button type="button" className="nora-skip" onClick={skip}>
                <span aria-hidden="true">✕</span>
                {ui.skip}
              </button>
              <div className="nora-nav">
                <span className="nora-step">{stepIndex + 1} / {steps.length}</span>
                <button
                  type="button"
                  className="nora-btn ghost"
                  disabled={stepIndex === 0}
                  onClick={() => advance(-1)}
                >
                  <span aria-hidden="true">‹</span>
                  {ui.back}
                </button>
                <button
                  type="button"
                  className="nora-btn primary"
                  onClick={() => {
                    if (step.nextLabel === 'done') {
                      finish();
                      return;
                    }
                    if (step.onNext) runAction(step.onNext);
                    advance(1);
                  }}
                >
                  {primaryLabel}
                  <span aria-hidden="true">{step.nextLabel === 'done' ? '✓' : '›'}</span>
                </button>
              </div>
            </div>
          </div>
        </>
      )}

      {/* -------------------------------------------- resume helper pill */}
      {phase === 'idle' && resumeAt && (
        <button
          type="button"
          className="nora-resume"
          title={ui.resume}
          onClick={() => startAt(resumeAt.step, resumeAt.lang)}
        >
          <img src={imgSrc} alt="" aria-hidden="true" />
          <span className="nora-resume-label">{ui.resume}</span>
          <span className="nora-resume-dot" aria-hidden="true">?</span>
        </button>
      )}
    </div>
  );
};

const Crown = () => (
  <svg className="nora-crown" viewBox="0 0 24 16" width="18" height="12" aria-hidden="true">
    <path d="M2 15h20l1.5-11-5.5 4L12 1 6 8 0.5 4 2 15z" fill="currentColor" />
  </svg>
);

export default memo(NoraTour);
