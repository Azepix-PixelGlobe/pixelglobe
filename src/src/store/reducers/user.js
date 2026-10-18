import { patchState } from '../index.js';
import { USERLVL } from '../../core/constants.js';

const initialState = {
  id: null,
  name: null,
  username: null,
  nameStyle: 'none',
  wait: null,
  coolDown: null, // ms
  lastCoolDownEnd: null,
  userlvl: USERLVL.ANONYM,
  // messages are sent by api/me, like not_verified status
  messages: [],
  /*
   * whether or not the user has a password set (third party login might not
   * have one)
   */
  havePassword: false,
  // blocking all Dms
  blockDm: false,
  // profile is private
  priv: false,
  // if user is using touchscreen
  isOnMobile: false,
  // small notifications for received cooldown
  notification: null,
  /*
   * can be: {
   *   type, size,
   *   screenSize, screenPosX, screenPosY, screenRotation,
   * }
   */
  fish: {},
};

export default function user(
  state = initialState,
  action,
) {
  switch (action.type) {
    case 'COOLDOWN_SET': {
      const { coolDown } = action;
      return {
        ...state,
        coolDown: coolDown || null,
      };
    }

    case 'COOLDOWN_END': {
      return {
        ...state,
        coolDown: null,
        lastCoolDownEnd: Date.now(),
        wait: null,
      };
    }

    case 'REC_SET_PXLS': {
      const {
        wait: duration,
      } = action;
      return {
        ...state,
        /*
         * A zero wait is an explicit "ready now" response. Keeping the old
         * timestamp here leaves the client in a stale cooldown state after
         * zero-cooldown events or a cooldown transition.
         */
        wait: duration > 0 ? Date.now() + duration : null,
      };
    }

    case 'REC_COOLDOWN': {
      const { wait: duration } = action;
      const wait = duration
        ? Date.now() + duration
        : null;
      return {
        ...state,
        wait,
        coolDown: null,
      };
    }

    case 's/PATCH_STATE': {
      if (action.state === 'user') {
        return patchState(state, action.patch)[0];
      }
      return state;
    }

    case 'SET_MOBILE': {
      const { mobile: isOnMobile } = action;
      return {
        ...state,
        isOnMobile,
      };
    }

    case 's/REC_ME':
    case 's/LOGIN': {
      const {
        id,
        name,
        username,
        nameStyle,
        havePassword,
        blockDm,
        priv,
        userlvl,
      } = action;
      const messages = (action.messages) ? action.messages : [];
      return {
        ...state,
        id,
        name,
        username,
        nameStyle: nameStyle || 'none',
        messages,
        havePassword,
        blockDm,
        priv,
        userlvl,
      };
    }

    case 's/LOGOUT': {
      return {
        ...state,
        id: null,
        name: null,
        username: null,
        messages: [],
        havePassword: false,
        blockDm: false,
        priv: false,
        userlvl: USERLVL.ANONYM,
      };
    }

    case 'SET_NOTIFICATION': {
      return {
        ...state,
        notification: action.notification,
      };
    }

    case 'UNSET_NOTIFICATION': {
      return {
        ...state,
        notification: null,
      };
    }

    case 's/REM_FROM_MESSAGES': {
      const { message } = action;
      const messages = [...state.messages];
      const index = messages.indexOf(message);
      if (index > -1) {
        messages.splice(index);
      }
      return {
        ...state,
        messages,
      };
    }

    case 's/SET_HAVE_PASSWORD': {
      const { havePassword } = action;
      return {
        ...state,
        havePassword,
      };
    }

    case 'FISH_APPEARS': {
      const { fishType: type, size } = action;
      // 10 - 40 depending on size
      const screenSize = Math.ceil(10 + size / 25 * 30);
      const fish = {
        type,
        size,
        screenSize,
        screenPosX: Math.floor(Math.random() * (100 - screenSize)),
        screenPosY: Math.floor(Math.random() * (100 - screenSize)),
        screenRotation: Math.floor(Math.random() * 360),
      };
      return {
        ...state,
        fish,
      };
    }

    case 'FISH_CATCHED':
    case 'FISH_VANISHES':
      return {
        ...state,
        fish: {},
      };

    default:
      return state;
  }
}
