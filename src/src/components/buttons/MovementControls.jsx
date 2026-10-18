/*
 *
 * Menu for WASD keys for mobile users
 */

import { useState, useCallback, useEffect } from 'preact/hooks';
import {
  useSelector, shallowEqual, useDispatch,
} from '../../store/react-redux/index.js';
import PiMagnifyingGlassMinus from '../../icons/PiMagnifyingGlassMinus.svg';
import PiMagnifyingGlassPlus from '../../icons/PiMagnifyingGlassPlus.svg';
import PiArrowFatLeft from '../../icons/PiArrowFatLeft.svg';
import PiArrowFatRight from '../../icons/PiArrowFatRight.svg';
import PiArrowFatUp from '../../icons/PiArrowFatUp.svg';
import PiArrowFatDown from '../../icons/PiArrowFatDown.svg';
import PiCaretDoubleUp from '../../icons/PiCaretDoubleUp.svg';
import PiCaretDoubleDown from '../../icons/PiCaretDoubleDown.svg';

import {
  setMoveU, setMoveV, setMoveW, cancelMove,
} from '../../store/actions/index.js';
import { selectMovementControlProps } from '../../store/selectors/gui.js';

const MovementControls = () => {
  const [render, setRender] = useState(false);
  const [is3D, open] = useSelector(
    selectMovementControlProps,
    shallowEqual,
  );
  const dispatch = useDispatch();

  useEffect(() => {
    if (open) window.setTimeout(() => setRender(true), 10);
  }, [open]);

  const refCallBack = useCallback((node) => {
    if (!node) {
      return;
    }

    const onPressStart = (event) => {
      event.preventDefault();
      switch (event.currentTarget.id) {
        case 'forwardbtn':
          dispatch(setMoveV(-1));
          break;
        case 'backwardbtn':
          dispatch(setMoveV(1));
          break;
        case 'leftbtn':
          dispatch(setMoveU(-1));
          break;
        case 'rightbtn':
          dispatch(setMoveU(1));
          break;
        case 'upbtn':
          dispatch(setMoveW(-1));
          break;
        case 'downbtn':
          dispatch(setMoveW(1));
          break;
        default:
      }
    };

    const onPressStop = (event) => {
      event.preventDefault();
      switch (event.currentTarget.id) {
        case 'forwardbtn':
          dispatch(setMoveV(0));
          break;
        case 'backwardbtn':
          dispatch(setMoveV(0));
          break;
        case 'leftbtn':
          dispatch(setMoveU(0));
          break;
        case 'rightbtn':
          dispatch(setMoveU(0));
          break;
        case 'upbtn':
          dispatch(setMoveW(0));
          break;
        case 'downbtn':
          dispatch(setMoveW(0));
          break;
        default:
      }
    };

    const onCancel = (event) => {
      event.preventDefault();
      dispatch(cancelMove());
    };

    node.addEventListener('touchstart', onPressStart, { passive: false });
    node.addEventListener('mousedown', onPressStart, { passive: false });
    node.addEventListener('touchend', onPressStop, { passive: false });
    node.addEventListener('mouseup', onPressStop, { passive: false });
    node.addEventListener('mouseleave', onCancel, { passive: false });
    node.addEventListener('touchcancel', onCancel, { passive: false });
  }, [dispatch]);

  return ((render || open) && (
    <div
      id="mvmctrls"
      className={render && open ? 'show' : ''}
      onTransitionEnd={() => !open && setRender(false)}
    >
      <div
        className="actionbuttons"
        id="forwardbtn"
        role="button"
        key="forward"
        tabIndex={0}
        style={{
          left: 57,
          bottom: 139,
        }}
        ref={refCallBack}
      >
        <PiArrowFatUp />
      </div>
      <div
        className="actionbuttons"
        id="backwardbtn"
        role="button"
        key="backward"
        tabIndex={0}
        style={{
          left: 57,
          bottom: 98,
        }}
        ref={refCallBack}
      >
        <PiArrowFatDown />
      </div>
      <div
        className="actionbuttons"
        id="leftbtn"
        role="button"
        key="left"
        tabIndex={0}
        style={{
          left: 16,
          bottom: 98,
        }}
        ref={refCallBack}
      >
        <PiArrowFatLeft />
      </div>
      <div
        className="actionbuttons"
        id="rightbtn"
        role="button"
        key="right"
        tabIndex={0}
        style={{
          left: 98,
          bottom: 98,
        }}
        ref={refCallBack}
      >
        <PiArrowFatRight />
      </div>
      <div
        className="actionbuttons"
        id="upbtn"
        role="button"
        key="up"
        tabIndex={0}
        style={{
          left: 16,
          bottom: 139,
        }}
        ref={refCallBack}
      >
        {(is3D) ? <PiCaretDoubleUp /> : <PiMagnifyingGlassMinus />}
      </div>
      <div
        className="actionbuttons"
        id="downbtn"
        role="button"
        key="down"
        tabIndex={0}
        style={{
          left: 98,
          bottom: 139,
        }}
        ref={refCallBack}
      >
        {(is3D) ? <PiCaretDoubleDown /> : <PiMagnifyingGlassPlus />}
      </div>
    </div>
  ));
};

export default MovementControls;
