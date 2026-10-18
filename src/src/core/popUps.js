/*
 * keeping track of open popups
 */
import { unload } from '../store/actions/index.js';
import { buildPopUpUrl } from '../components/windows/popUpAvailable.js';

const wins = [];

export function addPopUp(win) {
  const pos = wins.indexOf(win);
  if (pos === -1) {
    wins.push(win);
  }
}

export function removePopUp(win) {
  const pos = wins.indexOf(win);
  if (~pos) wins.splice(pos, 1);
}

export function closeAllPopUps() {
  while (wins.length) {
    const win = wins.pop();
    win.close();
  }
}

export function dispatchToPopUps(msg, ignore = null) {
  try {
    for (let i = 0; i < wins.length; i += 1) {
      const win = wins[i];
      if (win.closed) {
        wins.splice(i, 1);
        i -= 1;
        continue;
      }
      if (win !== ignore) {
        win.postMessage(msg, window.location.origin);
      }
    }
  } catch {
    return false;
  }
  return true;
}

export function updateExistingPopUp(windowType, args) {
  const win = wins.find(
    (w) => !w.closed
      // eslint-disable-next-line max-len
      && w.location.pathname.substring(window.ssv?.basename?.length || 0).split('/')[1]?.toUpperCase() === windowType,
  );
  if (win) {
    win.location = buildPopUpUrl(windowType, args);
    win.focus();
    return true;
  }
  return false;
}

export function hasPopUps() {
  return wins.length;
}

window.addEventListener('beforeunload', () => {
  dispatchToPopUps(unload());
});

