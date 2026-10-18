/**
 * MarketWheel — "Günün Çarkı" (günde 1 çevirme).
 * ============================================
 * Kurallar (kullanıcı isteği):
 *   - Market içinde bir çark düğmesi/sekmesi var, basınca çark gelir.
 *   - Günde SADECE 1 kez çevrilir (hak sunucuda tutulur; bkz. data/sql/Wheel.js).
 *   - Ödül dağılımı ağırlıklı: +20/+50 sık, +100/+150 orta, +500 nadir,
 *     +1000 jackpot çok nadir. Yüzdeler çarkın altında dürüstçe yazar.
 *   - Çevirme efektli + sesli. Sonuç ekrana "+50 GCOIN KAZANDIN!" diye yazıp
 *     kaybolur; jackpot çıkarsa ekran patlar (konfeti + sarsıntı + fanfar).
 *
 * Şans yüzdesi ve ödül miktarı istemciden gelmez: sunucu `prize` gönderir,
 * istemci sadece o dilime dönerek gösterir.
 */
import {
  useCallback, useEffect, useMemo, useRef, useState,
} from 'preact/hooks';

import { pgT } from '../../utils/pgI18n.js';
import { formatNumber } from '../../utils/pgPulse.js';
import { sfx } from '../../utils/pgFeedback.js';

const SPIN_MS = 4600;
const SEGMENT_DEG = 360 / 8;
/* jackpotta ekran ne kadar "patlar" */
const JACKPOT_MS = 7200;
const RESULT_MS = 5200;

/*
 * Dönüş süresi. Normalde 4.6 saniye; iki durumda kısalır:
 *   - oyuncu sistemde "hareketi azalt" (prefers-reduced-motion) seçtiyse
 *   - `window.pixelglobe.wheelSpinMs` ile açıkça kısaltıldıysa (erişilebilirlik
 *     ve otomatik test kancası)
 * Ödül/sonuç mantığı bu süreye bağlı olmadığı için kısaltmak hileyi etkilemez.
 */
function spinDuration() {
  try {
    const override = Number(window && window.pixelglobe && window.pixelglobe.wheelSpinMs);
    if (Number.isFinite(override) && override > 0) return Math.round(override);
    if (window && typeof window.matchMedia === 'function'
      && window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      return 1200;
    }
  } catch {
    /* tarayıcı desteklemiyorsa varsayılan süre */
  }
  return SPIN_MS;
}

function wheelPath(index, radius = 96, inner = 30) {
  /* -90°'den başlayıp saat yönünde dilim */
  const start = (index * SEGMENT_DEG - 90) * (Math.PI / 180);
  const end = ((index + 1) * SEGMENT_DEG - 90) * (Math.PI / 180);
  const large = SEGMENT_DEG > 180 ? 1 : 0;
  const x1 = 100 + radius * Math.cos(start);
  const y1 = 100 + radius * Math.sin(start);
  const x2 = 100 + radius * Math.cos(end);
  const y2 = 100 + radius * Math.sin(end);
  const ix1 = 100 + inner * Math.cos(end);
  const iy1 = 100 + inner * Math.sin(end);
  const ix2 = 100 + inner * Math.cos(start);
  const iy2 = 100 + inner * Math.sin(start);
  return `M ${x1} ${y1} A ${radius} ${radius} 0 ${large} 1 ${x2} ${y2} L ${ix1} ${iy1} A ${inner} ${inner} 0 ${large} 0 ${ix2} ${iy2} Z`;
}

/** Dilimin ortasına denk gelen yazı açısı (derece). */
function labelAngle(index) {
  return index * SEGMENT_DEG + SEGMENT_DEG / 2;
}

/** Ödülün tepedeki iğnenin altına gelmesi için gereken dönüş. */
function rotationFor(index, extraTurns = 6) {
  return extraTurns * 360 - labelAngle(index) - 90 + (Math.random() * SEGMENT_DEG * 0.5 - SEGMENT_DEG * 0.25);
}

const TIER_ORDER = { common: 0, uncommon: 1, rare: 2, epic: 3, legendary: 4 };

const MarketWheel = ({ onBalance }) => {
  const [state, setState] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [spinMs, setSpinMs] = useState(SPIN_MS);
  const [rotation, setRotation] = useState(0);
  const [spinning, setSpinning] = useState(false);
  const [prize, setPrize] = useState(null);
  const [jackpot, setJackpot] = useState(false);
  const [now, setNow] = useState(Date.now());
  const timers = useRef([]);
  const mounted = useRef(true);
  const wheelRef = useRef(null);

  const clearTimers = () => {
    timers.current.forEach((timer) => window.clearTimeout(timer));
    timers.current = [];
  };

  useEffect(() => () => {
    mounted.current = false;
    clearTimers();
  }, []);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/market/wheel', { credentials: 'include' });
      if (res.status === 401) {
        setError(pgT('market.login'));
        return;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      if (data.errors) throw new Error(data.errors[0]);
      if (!mounted.current) return;
      setState(data);
    } catch (e) {
      if (mounted.current) setError(pgT('market.error', { msg: e.message }));
    } finally {
      if (mounted.current) setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const prizes = (state && state.prizes) || [];
  const canSpin = Boolean(state && state.canSpin) && !spinning;

  /* sunucu saati ile geri sayım (istemci saati kandırılamasın) */
  const offset = state && state.serverTime ? state.serverTime - now : 0;
  const nextSpinAt = state && state.nextSpinAt ? state.nextSpinAt - offset : 0;
  const untilNext = Math.max(0, nextSpinAt - Date.now());
  const countdown = useMemo(() => {
    const total = Math.floor(untilNext / 1000);
    const hours = String(Math.floor(total / 3600)).padStart(2, '0');
    const minutes = String(Math.floor((total % 3600) / 60)).padStart(2, '0');
    const seconds = String(total % 60).padStart(2, '0');
    return `${hours}:${minutes}:${seconds}`;
  }, [untilNext]);

  /* çarkın dönerken "tık tık" sesi: yavaşlayan aralıklarla */
  const tickLoop = useCallback((startedAt, duration = null) => {
    const span = (duration || SPIN_MS) + 120;
    const schedule = () => {
      const progress = Math.min(1, (Date.now() - startedAt) / span);
      if (progress >= 1) return;
      sfx('wheelTick');
      const wait = 55 + 520 * (progress ** 2.8);
      const timer = window.setTimeout(schedule, wait);
      timers.current.push(timer);
    };
    schedule();
  }, []);

  const spin = useCallback(async () => {
    if (spinning || !state || !state.canSpin) return;
    setSpinning(true);
    setPrize(null);
    setJackpot(false);
    clearTimers();

    const duration = spinDuration();
    setSpinMs(duration);
    sfx('wheelSpin');
    tickLoop(Date.now(), duration);

    let data = null;
    try {
      const res = await fetch('/api/market/wheel', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      data = await res.json();
    } catch {
      data = { errors: ['network'] };
    }
    if (!mounted.current) return;

    if (!data || data.errors || !data.prize) {
      setSpinning(false);
      setState((prev) => (prev ? { ...prev, canSpin: false, nextSpinAt: data?.nextSpinAt || prev.nextSpinAt } : prev));
      setError(data?.errors?.[0] || pgT('market.error', { msg: 'network' }));
      return;
    }

    const index = Math.max(0, prizes.findIndex((item) => item.id === data.prize.id));
    const target = rotation + rotationFor(index);
    setRotation(target);

    /* dönüş bitince sonucu göster */
    const after = window.setTimeout(() => {
      if (!mounted.current) return;
      setSpinning(false);
      setPrize(data.prize);
      const epic = data.prize.tier === 'legendary';
      setJackpot(epic);
      sfx(epic ? 'wheelJackpot' : 'wheelWin');
      if (data.newBalance !== null && data.newBalance !== undefined) onBalance(data.newBalance);
      setState((prev) => (prev ? {
        ...prev,
        canSpin: false,
        nextSpinAt: data.nextSpinAt || prev.nextSpinAt,
        totalSpins: (prev.totalSpins || 0) + 1,
        totalCoins: (prev.totalCoins || 0) + data.prize.coins,
        lastSpin: { prizeId: data.prize.id, coins: data.prize.coins, at: Date.now() },
        history: [{ prizeId: data.prize.id, coins: data.prize.coins, at: Date.now() }]
          .concat(prev.history || []).slice(0, 14),
      } : prev));
    }, duration + 150);
    timers.current.push(after);

    /* sonuç yazısı bir süre sonra kendiliğinden gider */
    const clear = window.setTimeout(() => {
      if (mounted.current) {
        setPrize(null);
        setJackpot(false);
      }
    }, duration + 150 + (data.prize.tier === 'legendary' ? JACKPOT_MS : RESULT_MS));
    timers.current.push(clear);
  }, [onBalance, prizes, rotation, spinning, state, tickLoop]);

  const legendary = prizes.find((item) => item.tier === 'legendary');
  const lastSpin = state && state.lastSpin;

  if (loading) {
    return (
      <div className="pg-mk-note">
        <span className="pg-mk-spinner" aria-hidden="true" />
        {pgT('market.loading')}
      </div>
    );
  }

  if (error && !state) {
    return (
      <div className="pg-mk-note pg-mk-note-error">
        <span>{error}</span>
        <button type="button" className="pg-mk-btn tiny" onClick={load}>{pgT('market.retry')}</button>
      </div>
    );
  }

  return (
    <section className={`pg-mk-wheel${jackpot ? ' is-jackpot' : ''}${spinning ? ' is-spinning' : ''}`}>
      <header className="pg-mk-wheel-head">
        <span className="pg-mk-wheel-icon" aria-hidden="true">🎡</span>
        <div>
          <strong>{pgT('market.tab.wheel')}</strong>
          <em>{pgT('wheel.sub')}</em>
        </div>
      </header>

      <div className="pg-mk-wheel-stage">
        <div
          className="pg-mk-wheel-rig"
          ref={wheelRef}
          style={{ '--pg-wheel-rot': `${rotation}deg`, '--pg-wheel-ms': `${spinMs}ms` }}
        >
          <span className="pg-mk-wheel-needle" aria-hidden="true" />
          <svg className="pg-mk-wheel-svg" viewBox="0 0 200 200" role="img" aria-label={pgT('market.tab.wheel')}>
            <g className="pg-mk-wheel-rotor">
              <circle cx="100" cy="100" r="98" className="pg-mk-wheel-rim" />
              {prizes.map((item, index) => (
                <path
                  key={item.id}
                  d={wheelPath(index)}
                  fill={item.color}
                  className={`pg-mk-slice tier-${item.tier}`}
                />
              ))}
              {prizes.map((item, index) => {
                const angle = labelAngle(index);
                /* alt yarıdaki yazılar ters durmasın: kendi etrafında çevir */
                const flip = angle > 90 && angle < 270;
                return (
                  <g key={`label-${item.id}`} transform={`rotate(${angle} 100 100)`}>
                    <text
                      className="pg-mk-slice-label"
                      x="100"
                      y="40"
                      textAnchor="middle"
                      dominantBaseline="middle"
                      transform={flip ? 'rotate(180 100 40)' : undefined}
                    >
                      {`+${formatNumber(item.coins)}`}
                    </text>
                  </g>
                );
              })}
              <circle cx="100" cy="100" r="30" className="pg-mk-wheel-hub" />
              <text x="100" y="106" textAnchor="middle" className="pg-mk-wheel-hub-text">G</text>
            </g>
          </svg>
        </div>

        {prize && (
          <div className={`pg-mk-wheel-result tier-${prize.tier}`} role="status" aria-live="assertive">
            <strong>
              {prize.tier === 'legendary' ? pgT('wheel.jackpot', { n: formatNumber(prize.coins) })
                : pgT('wheel.won', { n: formatNumber(prize.coins) })}
            </strong>
            <em>{prize.tier === 'legendary' ? pgT('wheel.jackpotSub') : pgT('wheel.luckSub')}</em>
          </div>
        )}

        {jackpot && (
          <div className="pg-mk-wheel-confetti" aria-hidden="true">
            {Array.from({ length: 64 }, (unused, index) => (
              <i
                key={`confetti-${index}`}
                style={{
                  left: `${Math.round(Math.random() * 100)}%`,
                  background: ['#ffd479', '#f0ad2c', '#ff4d6d', '#b06cc9', '#56d98a', '#5aa9e6'][index % 6],
                  animationDelay: `${Math.round(Math.random() * 500)}ms`,
                  animationDuration: `${1100 + Math.round(Math.random() * 1200)}ms`,
                }}
              />
            ))}
          </div>
        )}
      </div>

      <div className="pg-mk-wheel-status">
        {spinning ? (
          <span className="pg-mk-wheel-msg is-spin">🎡 {pgT('wheel.spinning')}</span>
        ) : canSpin ? (
          <span className="pg-mk-wheel-msg is-ready">✅ {pgT('wheel.ready')}</span>
        ) : (
          <span className="pg-mk-wheel-msg is-used">
            ⏳ {pgT('wheel.used')} · {pgT('wheel.nextIn', { time: countdown })}
          </span>
        )}
      </div>

      <button
        type="button"
        className={`pg-mk-wheel-btn${canSpin ? '' : ' is-disabled'}`}
        onClick={spin}
        disabled={!canSpin}
      >
        {spinning ? pgT('wheel.spinning') : (canSpin ? `🎡 ${pgT('wheel.spin')}` : pgT('wheel.nextIn', { time: countdown }))}
      </button>

      <div className="pg-mk-wheel-prizes">
        {prizes.map((item) => (
          <span key={item.id} className={`pg-mk-wheel-prize tier-${item.tier}`}>
            <b style={{ background: item.color }} />
            +{formatNumber(item.coins)}
            <em>{pgT('wheel.odds', { n: item.chance })}</em>
            <small>{pgT(`wheel.tier.${item.tier}`)}</small>
          </span>
        ))}
      </div>

      <div className="pg-mk-wheel-stats">
        <span>{pgT('wheel.totalSpins', { n: formatNumber((state && state.totalSpins) || 0) })}</span>
        <span>{pgT('wheel.totalWon', { n: formatNumber((state && state.totalCoins) || 0) })}</span>
        {legendary ? (
          <span className="pg-mk-wheel-tip">{pgT('wheel.legendaryTip', { n: legendary.chance })}</span>
        ) : null}
      </div>

      {state && state.history && state.history.length ? (
        <div className="pg-mk-wheel-history">
          <strong>{pgT('wheel.history')}</strong>
          <ul>
            {state.history.slice(0, 7).map((row, index) => (
              <li key={`${row.at}-${index}`} className={TIER_ORDER[prizes.find((p) => p.id === row.prizeId)?.tier] >= 3 ? 'high' : ''}>
                <span>🪙 +{formatNumber(row.coins)}</span>
                <em>{row.at ? new Date(row.at).toLocaleDateString() : pgT('wheel.today')}</em>
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <p className="pg-mk-hint">{pgT('wheel.noHistory')}</p>
      )}

      {lastSpin && !canSpin && lastSpin.guarded ? (
        <p className="pg-mk-hint warn">{pgT('wheel.guardCapped')}</p>
      ) : null}

      <p className="pg-mk-hint">{pgT('wheel.firstFree')}</p>
    </section>
  );
};

export default MarketWheel;
