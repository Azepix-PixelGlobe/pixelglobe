/**
 *
 * Button to open/close palette
 */

import { memo } from 'preact/compat';
import {
  useSelector, shallowEqual, useDispatch,
} from '../../store/react-redux/index.js';
import MdPalette from '../../icons/MdPalette.svg';
import { t } from 'ttag';

import { toggleOpenPalette } from '../../store/actions/index.js';

const PalselButton = () => {
  const paletteOpen = useSelector((state) => state.gui.paletteOpen);
  const [palette, selectedColor] = useSelector((state) => [
    state.canvas.palette,
    state.canvas.selectedColor,
  ], shallowEqual);
  const dispatch = useDispatch();

  return (
    <div
      id="palselbutton"
      className={`actionbuttons${(paletteOpen) ? ' pressed' : ''}`}
      style={{
        color: palette.isDark(selectedColor) ? 'white' : 'black',
        backgroundColor: palette.colors[selectedColor],
      }}
      role="button"
      title={(paletteOpen) ? t`Close Palette` : t`Open Palette`}
      tabIndex={0}
      onClick={() => dispatch(toggleOpenPalette())}
    >
      <MdPalette />
    </div>
  );
};

export default memo(PalselButton);
