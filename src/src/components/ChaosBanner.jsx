/**
 * Top banner shown while Chaos event is active.
 * - Countdown until end
 * - Dismissible with X (local only; refresh brings it back)
 */

import { useEffect, useState, useCallback } from 'preact/hooks';
import { memo } from 'preact/compat';
import { useSelector, useDispatch } from '../store/react-redux/index.js';
import { dismissChaosBanner } from '../store/actions/index.js';

function formatRemaining(ms) {
  if (ms <= 0) return '00:00';
  const totalSec = Math.ceil(ms / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

const ChaosBanner = () => {
  const dispatch = useDispatch();
  const chaosEnd = useSelector((state) => state.gui.chaosEnd);
  const chaosDismissed = useSelector((state) => state.gui.chaosDismissed);
  const [remaining, setRemaining] = useState(0);
  const [visible, setVisible] = useState(false);

  const active = Boolean(chaosEnd && chaosEnd > Date.now() && !chaosDismissed);

  useEffect(() => {
    if (!chaosEnd || chaosEnd <= Date.now()) {
      setRemaining(0);
      setVisible(false);
      return undefined;
    }
    if (chaosDismissed) {
      setVisible(false);
      return undefined;
    }

    setVisible(true);
    const tick = () => {
      const left = chaosEnd - Date.now();
      setRemaining(left);
      if (left <= 0) {
        setVisible(false);
      }
    };
    tick();
    const id = setInterval(tick, 250);
    return () => clearInterval(id);
  }, [chaosEnd, chaosDismissed]);

  const onClose = useCallback(() => {
    dispatch(dismissChaosBanner());
    setVisible(false);
  }, [dispatch]);

  if (!visible || !active) return null;

  const progress = chaosEnd
    ? Math.max(0, Math.min(1, remaining / (30 * 60 * 1000)))
    : 0;

  return (
    <div className="chaos-banner" role="status" aria-live="polite">
      <div className="chaos-banner-glow" />
      <div className="chaos-banner-inner">
        <div className="chaos-banner-icon" aria-hidden="true">🔥</div>
        <div className="chaos-banner-text">
          <div className="chaos-banner-title">CHAOS BAŞLADI!</div>
          <div className="chaos-banner-sub">
            FRENZY ~15ms/px · Bitiş:
            {' '}
            <span className="chaos-banner-timer">{formatRemaining(remaining)}</span>
          </div>
        </div>
        <button
          type="button"
          className="chaos-banner-close"
          title="Kapat"
          aria-label="Kapat"
          onClick={onClose}
        >
          ✕
        </button>
      </div>
      <div className="chaos-banner-progress" style={{ transform: `scaleX(${progress})` }} />
    </div>
  );
};

export default memo(ChaosBanner);
