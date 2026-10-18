/*
 * selectors related to gui
 */
import { createSelector } from 'reselect';

import { CANVAS_TYPES } from '../../core/constants.js';

export const selectIsDarkMode = createSelector(
  (state) => state.gui.style,
  (style) => style.indexOf('dark') !== -1,
);

export const selectMovementControlProps = (state) => [
  state.canvas.rendererType === CANVAS_TYPES.THREED,
  state.canvas.rendererType !== CANVAS_TYPES.DUMMY && (
    state.gui.showMvmCtrls || (
      state.user.isOnMobile && (
        state.canvas.rendererType === CANVAS_TYPES.THREED
        || (
          state.gui.holdPaint > 0 && !state.canvas.isHistoricalView
        )
      )
    )
  ),
];
