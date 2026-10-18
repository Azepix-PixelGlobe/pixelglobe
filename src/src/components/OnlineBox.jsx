/**
 *
 */

import { Fragment } from 'preact';
import { memo } from 'preact/compat';
import {
  useSelector, shallowEqual, useDispatch,
} from '../store/react-redux/index.js';
import MdPerson from '../icons/MdPerson.svg';
import FaPaintBrush from '../icons/FaPaintBrush.svg';
import FaFlipboard from '../icons/FaClipboard.svg';
import FaCalendarDay from '../icons/FaCalendarDay.svg';
import { t } from 'ttag';

import {
  toggleOnlineCanvas,
  toggleNoRound,
  toggleDailyPxls,
} from '../store/actions/index.js';
import { numberToString, numberToStringFull } from '../core/utils.js';


const OnlineBox = () => {
  const [
    online,
    totalPixels,
    dailyTotalPixels,
    name,
    onlineCanvas,
    dailyPxls,
    noRound,
    canvasId,
  ] = useSelector((state) => [
    state.ranks.online,
    state.ranks.totalPixels,
    state.ranks.dailyTotalPixels,
    state.user.name,
    state.gui.onlineCanvas,
    state.gui.dailyPxls,
    state.gui.noRound,
    state.canvas.canvasId,
  ], shallowEqual);
  const dispatch = useDispatch();

  let pixelAmount = (dailyPxls) ? dailyTotalPixels : totalPixels;
  pixelAmount = (noRound)
    ? numberToStringFull(pixelAmount) : numberToString(pixelAmount);

  return (
    <div
      className="onlinebox"
    >
      {(onlineCanvas)
        ? (
            <span
              title={t`Online Users on Canvas`}
              role="button"
              tabIndex="0"
              key="onlinec"
              onClick={() => dispatch(toggleOnlineCanvas())}
            >
              {online[canvasId] || 0}&nbsp;<MdPerson /><FaFlipboard />
            </span>
          )
        : (
            <span
              role="button"
              tabIndex="0"
              key="onlinec"
              onClick={() => dispatch(toggleOnlineCanvas())}
              title={t`Total Online Users`}
            >
              {online.total}&nbsp;<MdPerson />
            </span>
          )}
       &nbsp;
      {(!!name)
        && (
          <Fragment key="plxc">
            <span
              role="button"
              tabIndex="0"
              onClick={() => dispatch(toggleNoRound())}
              title={t`Placed Pixels`}
            >
              {pixelAmount}
            </span>&nbsp;
            <span
              role="button"
              tabIndex="0"
              onClick={() => dispatch(toggleDailyPxls())}
              title={(dailyPxls) ? t`Today` : t`Total`}
            >
              {(dailyPxls) ? <FaCalendarDay /> : <FaPaintBrush />}
            </span>
          </Fragment>
        )}
    </div>
  );
};

export default memo(OnlineBox);
