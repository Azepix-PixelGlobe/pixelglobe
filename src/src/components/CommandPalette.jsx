/**
 * CommandPalette — Ctrl/Cmd + K ile açılan komut paleti.
 *
 * Oyuncular oyunu klavyeyle yönetmek ister: koordinata git, panel aç, sesi
 * kapat, ekran görüntüsü al. Bu bileşen hepsini tek arama kutusunda toplar;
 * Türkçe ve İngilizce arama yapar, klavyeyle gezilir (↑↓, Enter, Esc).
 *
 * Kullanım (theme içinde):
 *   <CommandPalette
 *     open={paletteOpen}
 *     onClose={() => setPaletteOpen(false)}
 *     onToggleMissions={...}
 *   />
 */

import {
  useCallback, useEffect, useMemo, useRef, useState,
} from 'preact/hooks';
import { memo } from 'preact/compat';
import fileDownload from 'js-file-download';

import { useDispatch, useSelector } from '../store/react-redux/index.js';
import { openWindow } from '../store/actions/windows.js';
import {
  setViewCoordinates, toggleGrid, toggleMute, toggleOpenPalette,
} from '../store/actions/index.js';
import { getRenderer } from '../ui/rendererFactory.js';
import { toggleEnabled as toggleUiSounds } from '../utils/pgFeedback.js';
import { refresh as refreshPulse } from '../utils/pgPulse.js';
import { clearManualPosition, dockNow } from '../utils/pgDock.js';
import { pushToast } from './PulsePanel.jsx';
import { pgT } from '../utils/pgI18n.js';

/* Turkish characters should not break the search ("ayarlar" vs "Ayarlar") */
function normalize(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/ı/g, 'i').replace(/İ/g, 'i')
    .replace(/ş/g, 's').replace(/ğ/g, 'g')
    .replace(/ü/g, 'u').replace(/ö/g, 'o').replace(/ç/g, 'c')
    .replace(/\s+/g, ' ')
    .trim();
}

function scoreMatch(query, haystack) {
  const q = normalize(query);
  if (!q) return 1;
  const text = normalize(haystack);
  if (!text) return 0;
  if (text.startsWith(q)) return 100;
  if (text.includes(` ${q}`)) return 80;
  if (text.includes(q)) return 60;
  // subsequence match, cheap fuzzy behaviour
  let index = 0;
  for (let i = 0; i < text.length && index < q.length; i += 1) {
    if (text[i] === q[index]) index += 1;
  }
  return index === q.length ? 25 : 0;
}

function takeScreenshot(view) {
  try {
    const renderer = getRenderer();
    const viewport = renderer && renderer.getViewport();
    if (!viewport || !viewport.toBlob) return false;
    const [x, y] = (view || [0, 0]).map(Math.round);
    viewport.toBlob((blob) => fileDownload(blob, `pixelglobe-${x}-${y}.png`));
    return true;
  } catch {
    return false;
  }
}

const CommandPalette = ({ open, onClose, onToggleMissions, onToggleGuardReport }) => {
  const dispatch = useDispatch();
  const online = useSelector((state) => state.ranks.online.total);
  const muted = useSelector((state) => state.gui.mute);
  const view = useSelector((state) => state.canvas.view);

  const [query, setQuery] = useState('');
  const [cursor, setCursor] = useState(0);
  const inputRef = useRef(null);
  const listRef = useRef(null);

  const openPanel = useCallback((type) => {
    dispatch(openWindow(type, true));
  }, [dispatch]);

  const actions = useMemo(() => [
    {
      id: 'missions',
      group: pgT('cmd.groupMain'),
      label: pgT('cmd.toggleMissions'),
      icon: '🔥',
      keywords: 'gorev mission streak nabiz pulse',
      run: () => {
        if (onToggleMissions) onToggleMissions();
      },
    },
    {
      id: 'chat',
      group: pgT('cmd.groupPanel'),
      label: pgT('cmd.openChat'),
      icon: '💬',
      keywords: 'sohbet chat mesaj',
      run: () => openPanel('CHAT'),
    },
    {
      id: 'settings',
      group: pgT('cmd.groupPanel'),
      label: pgT('cmd.openSettings'),
      icon: '⚙️',
      keywords: 'ayar settings tercih tema',
      run: () => openPanel('SETTINGS'),
    },
    {
      id: 'userarea',
      group: pgT('cmd.groupPanel'),
      label: pgT('cmd.openUserArea'),
      icon: '👤',
      keywords: 'hesap profil user area kullanici',
      run: () => openPanel('USERAREA'),
    },
    {
      id: 'templates',
      group: pgT('cmd.groupPanel'),
      label: pgT('cmd.openTemplates'),
      icon: '🎨',
      keywords: 'sablon template cizim',
      run: () => openPanel('TEMPLATES'),
    },
    {
      id: 'templateshare',
      group: pgT('cmd.groupPanel'),
      label: pgT('cmd.openMarkers'),
      icon: '📋',
      keywords: 'paylas share sablon',
      run: () => openPanel('TEMPLATESHARE'),
    },
    {
      id: 'market',
      group: pgT('cmd.groupPanel'),
      label: pgT('cmd.openMarket'),
      icon: '🛒',
      keywords: 'market magaza gcoin kozmetik',
      run: () => openPanel('MARKET'),
    },
    {
      id: 'wheel',
      group: pgT('cmd.groupPanel'),
      label: pgT('cmd.wheel'),
      icon: '🎡',
      keywords: 'cark wheel sans gcoin gunluk odul',
      run: () => {
        openPanel('MARKET');
        /* market penceresi tembel yukleniyor: sekme istegini biraz sonra gonder */
        window.setTimeout(() => {
          window.dispatchEvent(new CustomEvent('pg:open-wheel'));
        }, 260);
      },
    },
    {
      id: 'frames',
      group: pgT('cmd.groupPanel'),
      label: pgT('cmd.frames'),
      icon: '🖼️',
      keywords: 'cerceve frame avatar animasyonlu kozmetik market nitro',
      run: () => {
        openPanel('MARKET');
        window.setTimeout(() => {
          window.dispatchEvent(new CustomEvent('pg:open-frames'));
        }, 260);
      },
    },
    {
      id: 'stats',
      group: pgT('cmd.groupPanel'),
      label: pgT('cmd.openStats'),
      icon: '📊',
      keywords: 'istatistik statistics grafik',
      run: () => openPanel('STATISTICS'),
    },
    {
      id: 'archive',
      group: pgT('cmd.groupPanel'),
      label: pgT('cmd.openArchive'),
      icon: '🕰️',
      keywords: 'arsiv archive gecmis history',
      run: () => openPanel('ARCHIVE'),
    },
    {
      id: 'help',
      group: pgT('cmd.groupPanel'),
      label: pgT('cmd.openHelp'),
      icon: '❔',
      keywords: 'yardim help destek',
      run: () => openPanel('HELP'),
    },
    {
      id: 'palette',
      group: pgT('cmd.groupCanvas'),
      label: pgT('cmd.togglePalette'),
      icon: '🎨',
      keywords: 'palet renk palette',
      run: () => dispatch(toggleOpenPalette()),
    },
    {
      id: 'grid',
      group: pgT('cmd.groupCanvas'),
      label: pgT('cmd.toggleGrid'),
      icon: '▦',
      keywords: 'izgara grid kare',
      run: () => dispatch(toggleGrid()),
    },
    {
      id: 'screenshot',
      group: pgT('cmd.groupCanvas'),
      label: pgT('cmd.screenshot'),
      icon: '📸',
      keywords: 'ekran goruntusu screenshot resim',
      run: () => {
        if (!takeScreenshot(view)) pushToast({ title: pgT('cmd.screenshot'), icon: '📸' });
      },
    },
    {
      id: 'mute',
      group: pgT('cmd.groupSound'),
      label: pgT('cmd.toggleMute'),
      icon: muted ? '🔇' : '🔊',
      keywords: 'ses mute site sesini kapat',
      run: () => dispatch(toggleMute()),
    },
    {
      id: 'uisounds',
      group: pgT('cmd.groupSound'),
      label: pgT('cmd.toggleSounds'),
      icon: '🎵',
      keywords: 'arayuz sesi efekt tik',
      run: () => toggleUiSounds(),
    },
    {
      id: 'guard',
      group: pgT('cmd.groupMain'),
      label: pgT('cmd.toggleGuard'),
      icon: '🛡️',
      keywords: 'koruma guard guvenlik rapor',
      run: () => {
        if (onToggleGuardReport) onToggleGuardReport();
      },
    },
    {
      id: 'verdict',
      group: pgT('cmd.groupMain'),
      label: pgT('cmd.verdict'),
      icon: '🔐',
      keywords: 'vpn proxy bot guvenlik security kontrol kilit',
      run: () => {
        const security = window.pixelglobe && window.pixelglobe.security;
        const status = security && security.status ? security.status() : null;
        const verdict = status && status.verdict;
        pushToast({
          title: verdict ? `${verdict.label}` : pgT('guard.clean'),
          body: verdict ? ((verdict.detail && verdict.detail.reason) || null) : null,
          icon: verdict ? '🔒' : '✅',
          tone: verdict ? 'warn' : 'good',
          ttl: 6000,
        });
        if (security && security.check) security.check();
      },
    },
    {
      id: 'pill-reset',
      group: pgT('cmd.groupMain'),
      label: pgT('cmd.resetPill'),
      icon: '📌',
      keywords: 'nabiz kapsul buton konum sifirla tasi',
      run: () => { clearManualPosition(); dockNow(); },
    },
    {
      id: 'pulse-refresh',
      group: pgT('cmd.groupMain'),
      label: pgT('cmd.refreshPulse'),
      icon: '↻',
      keywords: 'gorev goals yenile refresh nabiz pulse',
      run: () => refreshPulse(),
    },
  ], [dispatch, muted, openPanel, onToggleGuardReport, onToggleMissions, view]);

  /* "git 120 80" / "goto -40 12" jumps the canvas */
  const jump = useMemo(() => {
    const match = normalize(query).match(/^(?:git|goto|go|is(?:inla)?)\s+(-?\d{1,6})\s*[, ]\s*(-?\d{1,6})$/);
    if (!match) return null;
    const x = Number(match[1]);
    const y = Number(match[2]);
    return {
      id: 'goto',
      group: pgT('cmd.groupCanvas'),
      label: pgT('cmd.jumpTo', { x, y }),
      icon: '📍',
      keywords: query,
      run: () => dispatch(setViewCoordinates([x, y, 0])),
    };
  }, [dispatch, query]);

  const results = useMemo(() => {
    const list = [];
    if (jump) list.push(jump);
    const scored = actions
      .map((action) => ({
        action,
        score: Math.max(
          scoreMatch(query, action.label),
          scoreMatch(query, `${action.keywords || ''} ${action.id}`),
        ),
      }))
      .filter((entry) => (query ? entry.score > 0 : true))
      .sort((a, b) => b.score - a.score)
      .map((entry) => entry.action);
    return list.concat(scored);
  }, [actions, jump, query]);

  useEffect(() => {
    setCursor(0);
  }, [query, open]);

  useEffect(() => {
    if (open && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
    if (!open) setQuery('');
  }, [open]);

  const run = useCallback((action) => {
    if (!action) return;
    try {
      action.run();
    } catch {
      /* an action must never break the game */
    }
    if (onClose) onClose();
  }, [onClose]);

  const onKeyDown = useCallback((evt) => {
    if (evt.key === 'ArrowDown') {
      evt.preventDefault();
      setCursor((value) => Math.min(value + 1, results.length - 1));
    } else if (evt.key === 'ArrowUp') {
      evt.preventDefault();
      setCursor((value) => Math.max(0, value - 1));
    } else if (evt.key === 'Enter') {
      evt.preventDefault();
      run(results[cursor]);
    } else if (evt.key === 'Escape') {
      evt.preventDefault();
      if (onClose) onClose();
    }
  }, [cursor, onClose, results, run]);

  useEffect(() => {
    const node = listRef.current;
    if (!node) return;
    const active = node.querySelector('.pg-cmd-item.active');
    if (active && active.scrollIntoView) active.scrollIntoView({ block: 'nearest' });
  }, [cursor, results]);

  if (!open) return null;

  return (
    <div
      className="pg-cmd-overlay"
      role="dialog"
      aria-modal="true"
      aria-label={pgT('cmd.title')}
      onClick={(evt) => {
        if (evt.target === evt.currentTarget && onClose) onClose();
      }}
    >
      <div className="pg-cmd">
        <div className="pg-cmd-input-wrap">
          <span className="pg-cmd-icon" aria-hidden="true">⌘</span>
          <input
            ref={inputRef}
            className="pg-cmd-input"
            type="text"
            value={query}
            placeholder={pgT('cmd.placeholder')}
            aria-label={pgT('cmd.title')}
            onInput={(evt) => setQuery(evt.currentTarget.value)}
            onKeyDown={onKeyDown}
          />
          {online ? <span className="pg-cmd-online">{online} 👤</span> : null}
        </div>

        <ul className="pg-cmd-list" ref={listRef}>
          {results.length === 0 && (
            <li className="pg-cmd-empty">{pgT('cmd.empty')}</li>
          )}
          {results.map((action, index) => (
            <li key={action.id}>
              <button
                type="button"
                className={`pg-cmd-item${index === cursor ? ' active' : ''}`}
                onMouseEnter={() => setCursor(index)}
                onClick={() => run(action)}
              >
                <span className="pg-cmd-item-icon" aria-hidden="true">{action.icon}</span>
                <span className="pg-cmd-item-label">{action.label}</span>
                <span className="pg-cmd-item-group">{action.group}</span>
              </button>
            </li>
          ))}
        </ul>

        <div className="pg-cmd-foot">{pgT('cmd.hint')}</div>
      </div>
    </div>
  );
};

export default memo(CommandPalette);
