/**
 * PixelGlobe Market — kozmetik mağaza + günün görevleri + günün çarkı.
 * ===================================================================
 * Arayüz baştan yazıldı (kullanıcı isteği: "market arayüzü çok kötü, havalı
 * olsun"). Üç sekme:
 *
 *   🛒 Mağaza   — kozmetikler, sahiplik/aktiflik durumu, satın al / kullan
 *   🎯 Görevler — günlük görevler, ilerleme çubukları, ödül alma, geri sayım
 *   🎡 Günün Çarkı — günde 1 ücretsiz çevirme (bkz. MarketWheel.jsx)
 *
 * Veri kaynakları değişmedi:
 *   GET  /api/market          katalog + bakiye + görevler
 *   POST /api/market/buy      satın al
 *   POST /api/market/activate kullan / kapat
 *   POST /api/market/claim    görev ödülü
 *   POST /api/market/online   çevrimiçi dakika sayacı
 *   GET  /api/market/wheel    çark durumu (çark sekmesi açılınca)
 *   POST /api/market/wheel    çarkı çevir (günlük hak sunucuda korunur)
 */
import {
  useState, useEffect, useCallback, useMemo, useRef,
} from 'preact/hooks';
import { memo } from 'preact/compat';
import { useDispatch, useSelector } from '../../store/react-redux/index.js';
import { patchState } from '../../store/actions/index.js';
import { pgT } from '../../utils/pgI18n.js';
import { formatNumber } from '../../utils/pgPulse.js';
import { sfx } from '../../utils/pgFeedback.js';
import { pushToast } from '../PulsePanel.jsx';
import MarketWheel from './MarketWheel.jsx';
import {
  FRAME_KEYS, FRAME_META, frameClassName, setOwnFrame,
} from '../../utils/pgFrames.js';
import '../../styles/pixelglobe-market.css';
import '../../styles/pixelglobe-frames.css';

/* Mağaza öğeleri — sunucudaki SHOP_ITEMS ile aynı olmalı (data/sql/Coins.js) */
const SHOP_META = {
  rainbow_name: {
    icon: '🌈',
    preview: 'rainbow',
    tag: 'Chat efekti',
  },
};

/*
 * Çerçeve kartları: isim/açıklama sözlükten (frame.<efekt>.name / .desc),
 * ikon + kademe + ışıma rengi utils/pgFrames.js'ten gelir.
 */
function frameMeta(item) {
  const key = item.effect;
  const meta = FRAME_META[key] || {};
  return {
    key,
    icon: meta.icon || '🖼️',
    tier: item.tier || meta.tier || 'common',
    glow: meta.glow || '#8fa8ff',
    known: FRAME_KEYS.includes(key),
  };
}

const FRAME_TIER_ORDER = { common: 0, rare: 1, epic: 2, legendary: 3 };

/* Görev görselleri — sunucudaki DAILY_GOALS id'leri ile eşleşir */
const GOAL_META = {
  pixels_5k: { icon: '🎯', accent: 'gold' },
  online_10m: { icon: '⏱️', accent: 'blue' },
  chat_1: { icon: '💬', accent: 'green' },
};

function CoinIcon({ size = '1em' }) {
  return <span className="pg-mk-coin" style={{ fontSize: size }} aria-hidden="true">🪙</span>;
}

/** mm:ss / ss biçiminde geri sayım. */
function clockLabel(ms) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const days = Math.floor(total / 86400);
  const hours = Math.floor((total % 86400) / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  const pad = (value) => String(value).padStart(2, '0');
  if (days > 0) return `${days}g ${pad(hours)}:${pad(minutes)}`;
  if (hours > 0) return `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;
  return `${pad(minutes)}:${pad(seconds)}`;
}

/** Gece yarısına kadar kalan süre (görev yenilenmesi). */
function msToMidnight(now = Date.now()) {
  const date = new Date(now);
  date.setHours(24, 0, 0, 0);
  return date.getTime() - now;
}

const NamePreview = () => (
  <span className="chatname-rainbow pg-mk-namepreview">PixelGlobe</span>
);

const Market = () => {
  const dispatch = useDispatch();
  const userName = useSelector((state) => state.user.name);
  const storeCoins = useSelector((state) => state.profile && state.profile.coins);

  const [tab, setTab] = useState('wheel');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [coins, setCoins] = useState(0);
  const [isAdmin, setIsAdmin] = useState(false);
  const [shopItems, setShopItems] = useState([]);
  const [goals, setGoals] = useState([]);
  const [busy, setBusy] = useState(null);
  const [bump, setBump] = useState(0);
  const [now, setNow] = useState(Date.now());

  const mountedRef = useRef(true);
  useEffect(() => () => { mountedRef.current = false; }, []);

  /* saat: görev geri sayımı + çark geri sayımı için */
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  const applyBalance = useCallback((value) => {
    if (value === null || value === undefined) return;
    setCoins(value);
    setBump((count) => count + 1);
    dispatch(patchState('profile', 'set', 'coins', value));
  }, [dispatch]);

  const fetchMarket = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/market', { credentials: 'include' });
      if (res.status === 401) {
        setError(pgT('market.login'));
        return;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      if (data.errors) throw new Error(data.errors[0]);
      if (!mountedRef.current) return;
      setCoins(data.coins === null ? 0 : data.coins);
      setIsAdmin(!!data.isAdmin);
      setShopItems(data.shopItems || []);
      setGoals(data.goals || []);
    } catch (e) {
      if (mountedRef.current) setError(pgT('market.error', { msg: e.message }));
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }, []);

  useEffect(() => { fetchMarket(); }, [fetchMarket]);

  /* store'dan gelen bakiye (nabız paneli ödül verirse) ekrana yansısın */
  useEffect(() => {
    if (typeof storeCoins === 'number' && storeCoins !== coins) {
      setCoins(storeCoins);
      setBump((count) => count + 1);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storeCoins]);

  /* komut paletinden gelen sekme istekleri */
  useEffect(() => {
    const openWheel = () => setTab('wheel');
    const openFrames = () => setTab('frames');
    window.addEventListener('pg:open-wheel', openWheel);
    window.addEventListener('pg:open-frames', openFrames);
    if (window.pixelglobe && window.pixelglobe.openWheelTab) {
      window.pixelglobe.openWheelTab = false;
      setTab('wheel');
    }
    return () => {
      window.removeEventListener('pg:open-wheel', openWheel);
      window.removeEventListener('pg:open-frames', openFrames);
    };
  }, []);

  /* çevrimiçi dakika sayacı (görev: sitede kal) */
  useEffect(() => {
    if (!userName) return undefined;
    const heartbeat = () => fetch('/api/market/online', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ minutes: 1 }),
    }).then((res) => res.json()).then((data) => {
      if (data && data.goals && mountedRef.current) setGoals(data.goals);
    }).catch(() => {});
    heartbeat();
    const timer = window.setInterval(heartbeat, 60000);
    return () => window.clearInterval(timer);
  }, [userName]);

  /* mağaza listesi ikiye ayrılır: isim efektleri (Mağaza) / hareketli çerçeveler */
  const frameItems = useMemo(() => shopItems
    .filter((item) => item.type === 'frame_effect')
    .slice()
    .sort((a, b) => (a.price - b.price)
      || (FRAME_TIER_ORDER[frameMeta(a).tier] - FRAME_TIER_ORDER[frameMeta(b).tier])), [shopItems]);

  const otherItems = useMemo(() => shopItems
    .filter((item) => item.type !== 'frame_effect'), [shopItems]);

  const ownedFrames = frameItems.filter((item) => item.owned).length;

  const handleBuy = useCallback(async (item) => {
    setBusy(item.id);
    try {
      const res = await fetch('/api/market/buy', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ itemId: item.id }),
      });
      const data = await res.json();
      if (!res.ok || data.errors) {
        pushToast({ title: data.errors?.[0] || pgT('market.notEnough'), icon: '⚠️', tone: 'warn' });
        return;
      }
      applyBalance(data.newBalance);
      setShopItems((prev) => prev.map((row) => (row.id === item.id ? { ...row, owned: true } : row)));
      sfx('coin');
      pushToast({
        title: pgT('market.bought', { name: item.name }),
        icon: '🛒',
        tone: 'good',
        ttl: 6000,
      });
    } catch {
      pushToast({ title: pgT('market.error', { msg: 'network' }), icon: '⚠️', tone: 'warn' });
    } finally {
      setBusy(null);
    }
  }, [applyBalance]);

  const handleActivate = useCallback(async (item, currentlyActive) => {
    setBusy(item.id);
    try {
      const res = await fetch('/api/market/activate', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ itemId: item.id, active: !currentlyActive }),
      });
      const data = await res.json();
      if (!res.ok || data.errors) {
        pushToast({ title: data.errors?.[0] || 'Error', icon: '⚠️', tone: 'warn' });
        return;
      }
      setShopItems((prev) => prev.map((row) => {
        if (row.id === item.id) return { ...row, active: !currentlyActive };
        if (row.type === item.type) return { ...row, active: false };
        return row;
      }));
      dispatch(patchState('profile', 'set', 'activeItems', {
        nameEffect: data.nameEffect || null,
        frameEffect: data.frameEffect || null,
      }));
      /* kendi çerçevem: sohbet + profil anında güncellensin (herkes socket ile alır) */
      if (item.type === 'frame_effect') {
        setOwnFrame(currentlyActive ? null : (data.frameEffect || item.effect));
      }
      if (currentlyActive) sfx('ready');
      else sfx('claim');
      pushToast({
        title: pgT(currentlyActive ? 'market.deactivated' : 'market.activated', { name: item.name }),
        icon: currentlyActive ? '🔇' : '✨',
        tone: currentlyActive ? 'info' : 'good',
      });
    } catch {
      pushToast({ title: pgT('market.error', { msg: 'network' }), icon: '⚠️', tone: 'warn' });
    } finally {
      setBusy(null);
    }
  }, [dispatch]);

  const handleClaim = useCallback(async (goal) => {
    setBusy(goal.id);
    try {
      const res = await fetch('/api/market/claim', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ goalId: goal.id }),
      });
      const data = await res.json();
      if (!res.ok || data.errors) {
        pushToast({ title: data.errors?.[0] || pgT('market.claim'), icon: '⚠️', tone: 'warn' });
        return;
      }
      applyBalance(data.newBalance);
      setGoals((prev) => prev.map((row) => (row.id === goal.id
        ? { ...row, rewarded: true, completed: true } : row)));
      sfx('claim');
      pushToast({
        title: pgT('market.earned', { n: formatNumber(data.coinsAwarded) }),
        body: goal.name,
        icon: '🎁',
        tone: 'gold',
        ttl: 6000,
      });
    } catch {
      pushToast({ title: pgT('market.error', { msg: 'network' }), icon: '⚠️', tone: 'warn' });
    } finally {
      setBusy(null);
    }
  }, [applyBalance]);

  /** Çark ödülü bakiyeyi değiştirdiğinde market başlığı da güncellensin. */
  const onWheelBalance = useCallback((value) => {
    applyBalance(value);
  }, [applyBalance]);

  const claimable = goals.filter((goal) => goal.completed && !goal.rewarded).length;
  const goalResetText = useMemo(() => pgT('market.goalsResetIn', {
    time: clockLabel(msToMidnight(now)),
  }), [now]);

  const canAfford = (price) => isAdmin || coins >= price;

  return (
    <div className="inarea pg-mk">
      <header className="pg-mk-hero">
        <div className="pg-mk-brand">
          <span className="pg-mk-logo" aria-hidden="true">🛒</span>
          <div>
            <strong>{pgT('market.title')}</strong>
            <em>{pgT('market.sub')}</em>
          </div>
        </div>

        <div className="pg-mk-wallet" key={bump}>
          <span className="pg-mk-wallet-label">{pgT('market.coins')}</span>
          <span className="pg-mk-wallet-balance">
            {isAdmin ? <span className="pg-mk-wallet-inf">∞</span> : (
              <>
                <CoinIcon size="0.85em" />
                {formatNumber(coins)}
              </>
            )}
          </span>
          <span className="pg-mk-wallet-hint">
            {isAdmin ? pgT('market.adminInf') : pgT('market.onlyOwner')}
          </span>
        </div>
      </header>

      <nav className="pg-mk-tabs" role="tablist">
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'frames'}
          className={`pg-mk-tab pg-mk-tab-frames${tab === 'frames' ? ' on' : ''}`}
          onClick={() => setTab('frames')}
        >
          <span aria-hidden="true">🖼️</span> {pgT('market.tab.frames')}
          {frameItems.filter((item) => item.owned).length > 0
            ? <i className="pg-mk-tabdot">{frameItems.filter((item) => item.owned).length}</i>
            : null}
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'shop'}
          className={`pg-mk-tab${tab === 'shop' ? ' on' : ''}`}
          onClick={() => setTab('shop')}
        >
          <span aria-hidden="true">🛒</span> {pgT('market.tab.shop')}
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'goals'}
          className={`pg-mk-tab${tab === 'goals' ? ' on' : ''}`}
          onClick={() => setTab('goals')}
        >
          <span aria-hidden="true">🎯</span> {pgT('market.tab.goals')}
          {claimable ? <i className="pg-mk-tabdot">{claimable}</i> : null}
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'wheel'}
          className={`pg-mk-tab pg-mk-tab-wheel${tab === 'wheel' ? ' on' : ''}`}
          onClick={() => setTab('wheel')}
        >
          <span aria-hidden="true">🎡</span> {pgT('market.tab.wheel')}
          <i className="pg-mk-tabdot pg-mk-tabdot-free">1</i>
        </button>
      </nav>

      {loading && (
        <div className="pg-mk-note">
          <span className="pg-mk-spinner" aria-hidden="true" />
          {pgT('market.loading')}
        </div>
      )}

      {error && !loading && (
        <div className="pg-mk-note pg-mk-note-error">
          <span>{error}</span>
          <button type="button" className="pg-mk-btn tiny" onClick={fetchMarket}>
            {pgT('market.retry')}
          </button>
        </div>
      )}

      {!loading && !error && tab === 'shop' && (
        <section className="pg-mk-shop">
          {otherItems.map((item) => {
            const meta = SHOP_META[item.id] || {};
            const afford = canAfford(item.price);
            return (
              <article
                key={item.id}
                className={`pg-mk-item${item.active ? ' is-active' : ''}${item.owned ? ' is-owned' : ''}`}
              >
                <div className="pg-mk-item-head">
                  <span className="pg-mk-item-icon" aria-hidden="true">{meta.icon || '🎨'}</span>
                  <div className="pg-mk-item-title">
                    <strong>{item.name}</strong>
                    <em>{meta.tag || item.type}</em>
                  </div>
                  {item.owned && item.active
                    ? <span className="pg-mk-chip is-on">{pgT('market.active')}</span>
                    : null}
                  {item.owned && !item.active
                    ? <span className="pg-mk-chip">{pgT('market.owned')}</span>
                    : null}
                </div>

                <div className="pg-mk-preview">
                  {meta.preview === 'rainbow' ? <NamePreview /> : null}
                  <span className="pg-mk-preview-note">{item.description}</span>
                </div>

                <div className="pg-mk-item-foot">
                  {!item.owned ? (
                    <>
                      <span className={`pg-mk-price${afford ? '' : ' is-poor'}`}>
                        <CoinIcon /> {formatNumber(item.price)}
                      </span>
                      <button
                        type="button"
                        className="pg-mk-btn primary"
                        disabled={!afford || busy === item.id}
                        title={afford ? pgT('market.buy') : pgT('market.notEnough')}
                        onClick={() => handleBuy(item)}
                      >
                        {busy === item.id ? pgT('market.buying') : pgT('market.buy')}
                      </button>
                    </>
                  ) : (
                    <button
                      type="button"
                      className={`pg-mk-btn ${item.active ? 'danger' : 'good'}`}
                      disabled={busy === item.id}
                      onClick={() => handleActivate(item, item.active)}
                    >
                      {item.active ? pgT('market.deactivate') : pgT('market.activate')}
                    </button>
                  )}
                </div>
              </article>
            );
          })}
          <p className="pg-mk-hint">{pgT('market.tip')}</p>
        </section>
      )}

      {/* ------------------------------------------------ Çerçeveler sekmesi */}
      {!loading && !error && tab === 'frames' && (
        <section className="pg-mk-frames">
          <div className="pg-mk-frames-head">
            <span>🖼️ {pgT('market.tab.frames')}</span>
            <em>{pgT('market.framesHint')}</em>
          </div>

          {frameItems.length === 0 && (
            <div className="pg-mk-note">{pgT('market.framesEmpty')}</div>
          )}

          <div className="pg-mk-frame-grid">
            {frameItems.map((item) => {
              const meta = frameMeta(item);
              const afford = canAfford(item.price);
              return (
                <article
                  key={item.id}
                  className={`pg-mk-frame-card tier-${meta.tier}${item.active ? ' is-active' : ''}${item.owned ? ' is-owned' : ''}`}
                  style={{ '--pg-frame-glow': meta.glow }}
                >
                  <div className="pg-mk-frame-demo">
                    <span className={`avatar ${frameClassName(meta.key)}`} aria-hidden="true">
                      <i className="avatar-frame-ring" />
                      {pgT('market.frameInitial')}
                    </span>
                    <span className="pg-mk-frame-demo-note">{pgT('market.frameLive')}</span>
                  </div>

                  <div className="pg-mk-frame-body">
                    <div className="pg-mk-frame-head">
                      <span className="pg-mk-item-icon" aria-hidden="true">{meta.icon}</span>
                      <div className="pg-mk-item-title">
                        <strong>{pgT(`frame.${meta.key}.name`)}</strong>
                        <em className={`pg-mk-tier tier-${meta.tier}`}>
                          {pgT(`market.tier.${meta.tier}`)}
                        </em>
                      </div>
                      {item.active ? <span className="pg-mk-chip is-on">✦ {pgT('market.active')}</span> : null}
                      {item.owned && !item.active ? <span className="pg-mk-chip">{pgT('market.owned')}</span> : null}
                    </div>

                    <p className="pg-mk-frame-desc">{pgT(`frame.${meta.key}.desc`)}</p>

                    <div className="pg-mk-item-foot">
                      {!item.owned ? (
                        <>
                          <span className={`pg-mk-price${afford ? '' : ' is-poor'}`}>
                            <CoinIcon /> {formatNumber(item.price)}
                          </span>
                          <button
                            type="button"
                            className="pg-mk-btn primary"
                            disabled={!afford || busy === item.id}
                            title={afford ? pgT('market.buy') : pgT('market.notEnough')}
                            onClick={() => handleBuy(item)}
                          >
                            {busy === item.id ? pgT('market.buying') : pgT('market.buy')}
                          </button>
                        </>
                      ) : (
                        <button
                          type="button"
                          className={`pg-mk-btn ${item.active ? 'danger' : 'good'}`}
                          disabled={busy === item.id}
                          onClick={() => handleActivate(item, item.active)}
                        >
                          {item.active ? pgT('market.deactivate') : pgT('market.activate')}
                        </button>
                      )}
                    </div>
                  </div>
                </article>
              );
            })}
          </div>

          <p className="pg-mk-hint">
            {ownedFrames > 0
              ? pgT('market.framesOwned', { n: ownedFrames })
              : pgT('market.framesNone')}
          </p>
        </section>
      )}

      {!loading && !error && tab === 'goals' && (
        <section className="pg-mk-goals">
          <div className="pg-mk-goals-head">
            <span>🎯 {pgT('market.tab.goals')}</span>
            <em>{goalResetText}</em>
          </div>

          {goals.map((goal) => {
            const meta = GOAL_META[goal.id] || { icon: '🎯', accent: 'gold' };
            const pct = Math.max(0, Math.min(100, Math.round((goal.progress / goal.target) * 100)));
            return (
              <article
                key={goal.id}
                className={`pg-mk-goal accent-${meta.accent}${goal.rewarded ? ' is-claimed' : ''}${goal.completed ? ' is-done' : ''}`}
              >
                <div className="pg-mk-goal-head">
                  <span className="pg-mk-goal-icon" aria-hidden="true">{meta.icon}</span>
                  <div>
                    <strong>{goal.name}</strong>
                    <em>{goal.description}</em>
                  </div>
                  <span className="pg-mk-goal-reward">
                    <CoinIcon /> +{goal.reward}
                  </span>
                </div>

                <div className="pg-mk-bar">
                  <span style={{ width: `${pct}%` }} />
                  <i>{pct}%</i>
                </div>

                <div className="pg-mk-goal-foot">
                  <span className="pg-mk-goal-count">
                    {pgT('market.progress', {
                      done: formatNumber(goal.progress),
                      target: formatNumber(goal.target),
                    })}
                    {goal.unit === 'minute' || goal.unit === 'dakika' ? ' dk' : ''}
                  </span>
                  {goal.rewarded ? (
                    <span className="pg-mk-chip is-on">✓ {pgT('market.claimed')}</span>
                  ) : goal.completed ? (
                    <button
                      type="button"
                      className="pg-mk-btn gold"
                      disabled={busy === goal.id}
                      onClick={() => handleClaim(goal)}
                    >
                      {busy === goal.id ? pgT('market.claiming') : `🎁 ${pgT('market.claim')}`}
                    </button>
                  ) : (
                    <span className="pg-mk-goal-left">
                      {pgT('market.progress', {
                        done: formatNumber(Math.max(0, goal.target - goal.progress)),
                        target: formatNumber(goal.target),
                      }).replace('/', 'kaldı →')}
                    </span>
                  )}
                </div>
              </article>
            );
          })}

          <p className="pg-mk-hint">{pgT('market.goalsHint')}</p>
        </section>
      )}

      {!loading && !error && tab === 'wheel' && (
        <MarketWheel
          onBalance={onWheelBalance}
          onTabRequest={(next) => setTab(next)}
        />
      )}
    </div>
  );
};

export default memo(Market);
