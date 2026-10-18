/**
 * Notifications
 *
 */
import { t } from 'ttag';

export default (store) => (next) => (action) => {
  try {
    if (!document.hasFocus()) {
      switch (action.type) {
        case 's/REC_ME': {
          if (window.Notification
            && Notification.permission !== 'granted'
            && Notification.permission !== 'denied'
          ) {
            Notification.requestPermission();
          }
          break;
        }

        case 'COOLDOWN_END': {
          const state = store.getState();

          // do not notify if last cooldown end was <15s ago
          const { lastCoolDownEnd } = state.user;
          if (lastCoolDownEnd
            && lastCoolDownEnd + 15000 > Date.now()) {
            break;
          }

          if (window.Notification && Notification.permission === 'granted') {
            new Notification(t`Your next pixels are ready`, {
              icon: '/tile.png',
              silent: false,
              vibrate: [200, 100],
              body: t`You can now place more on pixelplanet.fun :)`,
            });
          }
          break;
        }

        default:
          // nothing
      }
    }
  } catch (e) {
    console.error(e);
  }
  return next(action);
};
