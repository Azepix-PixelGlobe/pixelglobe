/**
 * Button that cycles brush size: 1x1 → 3x3 → 5x5 → 10x10 → 1x1
 * Placed next to the palette/notification buttons in the bottom-right toolbar.
 *
 * 10x10 = 100 piksel tek tıkta. Kaos fırtınasında 100 kişi bununla boyasa da
 * sunucu bunu normal oyun sayar (pixel yolu DDoS sayacının tamamen dışında).
 */

import { memo } from 'preact/compat';
import { useSelector, useDispatch } from '../../store/react-redux/index.js';
import { setBrushSize } from '../../store/actions/index.js';
import { BRUSH_SIZES, nextBrushSize } from '../../utils/pgBrush.js';

const SIZES = BRUSH_SIZES;

const BrushSizeButton = () => {
  const brushSize = useSelector((state) => state.gui.brushSize);
  const dispatch = useDispatch();

  const handleClick = () => {
    dispatch(setBrushSize(nextBrushSize(brushSize)));
  };

  const label = `${brushSize}x${brushSize}`;
  const pixels = brushSize * brushSize;

  return (
    <div
      id="brushsizebutton"
      className={`actionbuttons${brushSize > 1 ? ' pressed' : ''}`}
      role="button"
      title={`Fırça boyutu: ${label} — tek tıkta ${pixels} piksel (tıkla: büyült)`}
      tabIndex={0}
      onClick={handleClick}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') handleClick(); }}
      style={{ fontSize: '0.75em', fontWeight: 'bold', minWidth: '2.8em' }}
    >
      {label}
    </div>
  );
};

export default memo(BrushSizeButton);
