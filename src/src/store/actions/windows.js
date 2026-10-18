/*
 * Actions that are exclusively used by windows
 */


export function setWindowArgs(
  windowId,
  args,
) {
  return {
    type: 'SET_WIN_ARGS',
    windowId,
    args,
  };
}

export function changeWindowType(
  windowId,
  windowType,
  title = '',
  args = null,
) {
  return {
    type: 'CHANGE_WIN_TYPE',
    windowId,
    windowType,
    title,
    args,
  };
}

export function setWindowTitle(windowId, title) {
  return {
    type: 'SET_WIN_TITLE',
    windowId,
    title,
  };
}

export function closeWindow(windowId) {
  return {
    type: 'CLOSE_WIN',
    windowId,
  };
}

export function removeWindow(windowId) {
  return {
    type: 'REMOVE_WIN',
    windowId,
  };
}

export function focusWindow(windowId) {
  return {
    type: 'FOCUS_WIN',
    windowId,
  };
}

export function cloneWindow(windowId) {
  return {
    type: 'CLONE_WIN',
    windowId,
  };
}

/**
 * maximize or restore window
 * @param windowId
 * @param [maximize] optional boolean on what state to force
 */
export function toggleMaximizeWindow(windowId, maximize) {
  return {
    type: 'TGL_MAXIMIZE_WIN',
    windowId,
    maximize,
  };
}

export function moveWindow(windowId, xDiff, yDiff) {
  return {
    type: 'MOVE_WIN',
    windowId,
    xDiff,
    yDiff,
  };
}

export function resizeWindow(windowId, xDiff, yDiff) {
  return {
    type: 'RESIZE_WIN',
    windowId,
    xDiff,
    yDiff,
  };
}

export function setWindowPosition(windowId, xPos, yPos) {
  return {
    type: 'SET_WIN_POS',
    windowId,
    xPos,
    yPos,
  };
}

export function closeAllWindowTypes(windowType) {
  return {
    type: 'CLOSE_ALL_WIN_TYPE',
    windowType,
  };
}

export function hideAllWindowTypes(
  windowType,
  hide,
) {
  return {
    type: 'HIDE_ALL_WIN_TYPE',
    windowType,
    hide,
  };
}

export function openWindow(
  windowType,
  reuseExistingWindow = false,
  title = '',
  args = null,
  fullscreen = false,
  cloneable = true,
  xPos = null,
  yPos = null,
  width = null,
  height = null,
) {
  return (dispatch, getState) => {
    if (reuseExistingWindow) {
      // open in existing window of same type
      const state = getState().windows;
      const existingWin = state.windows.find(
        (win) => win.windowType === windowType,
      );
      if (existingWin) {
        if (existingWin.hidden) {
          dispatch(hideAllWindowTypes(windowType, false));
        }
        const { windowId } = existingWin;
        if (title && title !== existingWin.title) {
          dispatch(setWindowTitle(windowId, title));
        }
        dispatch(setWindowArgs(windowId, args));
        dispatch(focusWindow(windowId));
        return;
      }
      // if we tend to reuse a window type, it makes no sense to be cloneable
      cloneable = false;
    }
    dispatch({
      type: 'OPEN_WIN',
      windowType,
      title,
      args,
      fullscreen,
      cloneable,
      xPos,
      yPos,
      width,
      height,
    });
  };
}

export function openChatWindow() {
  const width = 350;
  const height = 350;
  return openWindow(
    'CHAT',
    false,
    '',
    null,
    false,
    true,
    window.innerWidth - width - 62,
    window.innerHeight - height - 64,
    width,
    height,
  );
}
