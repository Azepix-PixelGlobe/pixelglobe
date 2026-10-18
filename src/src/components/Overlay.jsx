/*
 * Overlay to fade out background
 */

import { useState, useEffect } from 'preact/hooks';
import { memo } from 'preact/compat';

const Overlay = ({ show, onClick, z }) => {
  const [render, setRender] = useState(false);

  useEffect(() => {
    if (show) {
      window.setTimeout(() => {
        setRender(true);
      }, 10);
    }
  }, [show]);

  if (!render && !show) {
    return null;
  }

  return (
    <div
      className={(show && render)
        ? 'overlay show'
        : 'overlay'}
      style={(z) ? { zIndex: z } : {}}
      onTransitionEnd={() => {
        if (!show) setRender(false);
      }}
      tabIndex={-1}
      onClick={onClick}
    />
  );
};

export default memo(Overlay);
