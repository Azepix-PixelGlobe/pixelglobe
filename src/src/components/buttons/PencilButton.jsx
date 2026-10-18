/**
 *
 */

import { useCallback } from 'preact/hooks';
import { memo } from 'preact/compat';
import {
  useSelector, shallowEqual, useDispatch,
} from '../../store/react-redux/index.js';
import TbPencil from '../../icons/TbPencil.svg';
import TbPencilMinus from '../../icons/TbPencilMinus.svg';
import { t } from 'ttag';

import useLongPress from '../hooks/useLongPress.js';
import { PENCIL_MODE } from '../../core/constants.js';
import { setHoldPaint } from '../../store/actions/index.js';
import { switchPencilMode } from '../../store/actions/thunks.js';

const PencilButton = () => {
  const [
    holdPaint,
    pencilMode,
    showMvmCtrls,
  ] = useSelector((state) => [
    state.gui.holdPaint,
    state.canvas.pencilMode,
    state.gui.showMvmCtrls,
  ], shallowEqual);
  const dispatch = useDispatch();

  const onLongPress = useCallback(() => {
    dispatch(switchPencilMode());
    if (!holdPaint) {
      dispatch(setHoldPaint(true));
    }
  }, [holdPaint, dispatch]);

  const onShortPress = useCallback(() => {
    dispatch(setHoldPaint(!holdPaint));
  }, [holdPaint, dispatch]);

  const refCallback = useLongPress(onShortPress, onLongPress);

  let className = 'actionbuttons';
  let title = t`Enable Pencil`;
  if (holdPaint) {
    switch (pencilMode) {
      case PENCIL_MODE.COLOR:
        className += ' ppencil pressed';
        title = t`Disable Pencil`;
        break;
      case PENCIL_MODE.HISTORY:
        className += ' phistory pressed';
        title = t`Disable History Pencil`;
        break;
      case PENCIL_MODE.OVERLAY:
        className += ' poverlay pressed';
        title = t`Disable Overlay Pencil`;
        break;
      default:
    }
  }

  return (
    <div
      id="pencilbutton"
      className={className}
      style={{
        bottom: (holdPaint || showMvmCtrls) ? 180 : 98,
      }}
      role="button"
      title={title}
      tabIndex={-1}
      ref={refCallback}
    >
      {(holdPaint) ? <TbPencilMinus /> : <TbPencil />}
    </div>
  );
};

export default memo(PencilButton);
