/*
 * Floating pixel metadata panel opened by a long press or right click.
 */
/* eslint-disable jsx-a11y/no-noninteractive-element-interactions */
import { useEffect, useState } from 'preact/hooks';
import { memo } from 'preact/compat';
import { t } from 'ttag';
import { api } from '../utils/utag.js';
import useLink from './hooks/link.js';

function PixelInfoBox({
  canvasId, x, y, screenX, screenY, onClose,
}) {
  const [loading, setLoading] = useState(true);
  const [info, setInfo] = useState(null);
  const link = useLink();

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setInfo(null);

    fetch(api`/api/pixelinfo?c=${canvasId}&x=${x}&y=${y}`, {
      credentials: 'include',
    })
      .then((response) => {
        if (!response.ok) {
          throw new Error(
            `Pixel info request failed: ${response.status}`,
          );
        }
        return response.json();
      })
      .then((data) => {
        if (cancelled) return;
        setInfo(data.found ? data.info : null);
        setLoading(false);
      })
      .catch(() => {
        if (!cancelled) {
          setInfo(null);
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [canvasId, x, y]);

  const openProfile = () => {
    if (!info?.uid && !info?.name) return;
    link('USER', {
      target: 'parent',
      args: {
        username: info.uid || info.name,
        name: info.name,
        uid: info.uid,
      },
    });
    onClose?.();
  };

  const left = Math.min(
    Math.max(8, (screenX || 40) - 20),
    Math.max(8, window.innerWidth - 248),
  );
  const top = Math.min(
    Math.max(8, (screenY || 40) + 12),
    Math.max(8, window.innerHeight - 180),
  );

  return (
    <div
      role="dialog"
      aria-label={t`Pixel information`}
      style={{
        position: 'fixed',
        left,
        top,
        zIndex: 10000,
        minWidth: 200,
        maxWidth: 260,
        padding: '12px 14px',
        borderRadius: 12,
        background: 'rgba(20,20,28,0.94)',
        color: '#f3f3f3',
        border: '1px solid rgba(168,85,247,0.35)',
        boxShadow: '0 8px 28px rgba(0,0,0,0.45)',
        fontSize: '0.9em',
      }}
      onClick={(event) => event.stopPropagation()}
      onTouchStart={(event) => event.stopPropagation()}
    >
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          marginBottom: 8,
        }}
      >
        <strong>{t`Pixel Info`}</strong>
        <button
          type="button"
          aria-label={t`Close`}
          onClick={onClose}
          style={{
            background: 'transparent',
            border: 'none',
            color: '#aaa',
            cursor: 'pointer',
            fontSize: '1.1em',
          }}
        >
          ✕
        </button>
      </div>
      <div style={{ opacity: 0.7, fontSize: '0.82em', marginBottom: 8 }}>
        ({x}, {y})
      </div>
      {loading && <div>{t`Loading…`}</div>}
      {!loading && !info && (
        <div style={{ opacity: 0.8 }}>
          {t`No placer data for this pixel (old or never tracked).`}
        </div>
      )}
      {!loading && info && (
        <div>
          <div style={{ marginBottom: 6 }}>
            <span style={{ opacity: 0.7 }}>{t`Placed by`}:</span>
            {' '}
            <strong style={{ color: '#c4b5fd' }}>
              {info.name || `#${info.uid}`}
            </strong>
          </div>
          {info.username && (
            <div style={{ marginBottom: 6, fontSize: '0.85em', opacity: 0.75 }}>
              @{info.username} <span style={{ fontFamily: 'monospace' }}>#{info.uid}</span>
            </div>
          )}
          {info.ts && (
            <div style={{ marginBottom: 6, fontSize: '0.8em', opacity: 0.6 }}>
              {new Date(info.ts).toLocaleString()} · ({info.x},{info.y})
            </div>
          )}
          {info.ip && (
            <div style={{ marginBottom: 6, padding: 6, borderRadius: 8, background: info.proxy?.isProxy ? 'rgba(239,68,68,.15)' : 'rgba(255,255,255,.06)', border: '1px solid rgba(255,255,255,.08)' }}>
              <div style={{ fontSize: '.82em', opacity: .7 }}>IP (MOD+)</div>
              <div style={{ fontFamily: 'monospace', fontWeight: 700, fontSize: '.9em' }}>{info.ip}</div>
              {info.ipMeta && <div style={{ fontSize: '.78em', opacity: .65 }}>{info.ipMeta.country} · {info.ipMeta.org} {info.ipMeta.asn ? `· ASN ${info.ipMeta.asn}` : ''}</div>}
              {info.proxy && <div style={{ fontSize: '.78em', marginTop: 4, color: info.proxy.isProxy ? '#fca5a5' : '#86efac' }}>{info.proxy.isProxy ? `⚠️ ${info.proxy.kindLabel} (${info.proxy.type || info.proxy.kind}) · Risk ${info.proxy.risk}` : '✅ Temiz IP'}</div>}
              {info.deviceHash && <div style={{ fontSize: '.75em', opacity: .5, fontFamily: 'monospace', marginTop: 4 }}>FP: {info.deviceHash}</div>}
            </div>
          )}
          <button
            type="button"
            onClick={openProfile}
            style={{
              width: '100%',
              padding: '8px',
              borderRadius: 8,
              border: 'none',
              cursor: 'pointer',
              fontWeight: 700,
              color: '#fff',
              background: 'linear-gradient(135deg,#7c3aed,#4f46e5)',
            }}
          >
            {t`Open profile`}
          </button>
        </div>
      )}
    </div>
  );
}

export default memo(PixelInfoBox);
