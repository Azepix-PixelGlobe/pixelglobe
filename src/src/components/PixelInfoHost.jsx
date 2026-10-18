import { useEffect, useState } from 'preact/hooks';
import { memo } from 'preact/compat';
import PixelInfoBox from './PixelInfoBox.jsx';

function PixelInfoHost() {
  const [state, setState] = useState(null);

  useEffect(() => {
    const onShow = (event) => {
      const data = event.detail || {};
      if (
        data.canvasId === null || data.canvasId === undefined
        || data.x === null || data.x === undefined
        || data.y === null || data.y === undefined
      ) return;
      setState({
        canvasId: data.canvasId,
        x: data.x,
        y: data.y,
        screenX: data.screenX,
        screenY: data.screenY,
      });
    };
    const onHide = () => setState(null);
    const onKey = (event) => {
      if (event.key === 'Escape') setState(null);
    };

    window.addEventListener('pg-pixelinfo', onShow);
    window.addEventListener('pg-pixelinfo-close', onHide);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('pg-pixelinfo', onShow);
      window.removeEventListener('pg-pixelinfo-close', onHide);
      window.removeEventListener('keydown', onKey);
    };
  }, []);

  if (!state) return null;

  return (
    <>
      <div
        role="presentation"
        style={{
          position: 'fixed',
          inset: 0,
          zIndex: 9999,
          background: 'transparent',
        }}
        onClick={() => setState(null)}
        onTouchStart={() => setState(null)}
      />
      <PixelInfoBox
        {...state}
        onClose={() => setState(null)}
      />
    </>
  );
}

export default memo(PixelInfoHost);
