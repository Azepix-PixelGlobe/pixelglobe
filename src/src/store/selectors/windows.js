/*
 * selectors for window manager
 *
 * Memoize heavy selectors or else they recalculate on any store update
 * see https://redux.js.org/usage/deriving-data-selectors
 */
import { createSelector } from 'reselect';

const selectWindows = (state) => state.windows.windows;
export const selectShowWindows = (state) => state.windows.showWindows;

export const selectActiveWindowIds = createSelector(
  selectWindows,
  (windows) => windows.map((win) => win.windowId),
);

export const selectHasVisibleWindow = createSelector(
  selectWindows,
  selectShowWindows,
  (windows, showWindows) => windows.some((win) => (
    win.open && win.hidden === false && (showWindows || win.fullscreen)
  )),
);

export const selectChatWindowStatus = createSelector(
  selectWindows,
  selectShowWindows,
  (windows, showWindows) => [
    windows.some((win) => win.windowType === 'CHAT'
      && win.hidden === false && (showWindows || win.fullscreen)),
    windows.some((win) => win.windowType === 'CHAT'
      && win.hidden === true) && showWindows,
  ],
);

/*
 * function factory returning a selector for given windowId
 * use useMemo to cache result
 */
export const makeSelectWindowById = (windowId) => createSelector(
  selectWindows,
  (windows) => windows.find((win) => win.windowId === windowId),
);

/*
 * function factory for non-memorized selector
 * use useMemo to cache result
 */
// eslint-disable-next-line max-len
export const makeSelectWindowPosById = (windowId) => (state) => state.windows.positions[windowId];

// eslint-disable-next-line max-len
export const makeSelectWindowArgs = (windowId) => (state) => state.windows.args[windowId] || {};
