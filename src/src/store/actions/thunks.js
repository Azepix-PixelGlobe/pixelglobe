/*
 * thunk actions
 */
import { t } from 'ttag';

import {
  requestStartDm,
  requestBlock,
  requestMute,
  requestLeaveChan,
  requestRankings,
  requestProfile,
  requestChangeProfile,
  requestChangeUser,
  requestChangeUserFaction,
  requestChangeFaction,
  requestChangeFactionRole,
  requestMe,
} from './fetch.js';
import {
  pAlert,
  receiveStats,
  receiveMe,
  blockUser,
  unblockUser,
  selectPencilMode,
  patchState,
} from './index.js';
import {
  addChatChannel,
  removeChatChannel,
} from './socket.js';
import { isIntervalActive } from '../../core/utils.js';
import { PENCIL_MODE, CHANNEL_TYPES } from '../../core/constants.js';

/*
 * for ongoing fetches to avoid multiple fetching
 */
const fetchStates = {};

export function receiveChatHistory(
  cid,
  history,
) {
  return {
    type: 's/REC_CHAT_HISTORY',
    cid,
    history,
  };
}

/*
 * query with either userId or userName
 */
export function startDm(query, cb = null, alert = true) {
  return async (dispatch) => {
    if (fetchStates.startDm) {
      return null;
    }
    fetchStates.startDm = true;

    try {
      const res = await requestStartDm(query);
      if (typeof res === 'string') {
        if (alert) {
          dispatch(pAlert(
            'Direct Message Error',
            res,
            'error',
            'OK',
          ));
        }
        return res;
      }
      dispatch(addChatChannel(CHANNEL_TYPES.DM, res));
      if (cb) {
        cb(res[0]);
      }
    } finally {
      delete fetchStates.startDm;
    }
    return null;
  };
}

export function fetchStats() {
  return async (dispatch) => {
    const rankings = await requestRankings();
    if (!rankings.errors) {
      dispatch(receiveStats(rankings));
    }
  };
}

export function changeUser(userChanges, alert) {
  return async (dispatch, getState) => {
    if (fetchStates.changeUser) {
      return [];
    }
    fetchStates.changeUser = true;

    const revertOperations = [];
    /*
    * we can define a token, which will then be used instead of the logged
    * in user
    */
    if (!userChanges.token) {
      const state = getState().user;
      if (state) {
        for (const [key, value] of Object.entries(userChanges)) {
          revertOperations.push([key, state[key]]);
          dispatch(patchState('user', 'set', key, value));
        }
      }
    }

    try {
      const res = await requestChangeUser(userChanges);
      if (res.length) {
        revertOperations.forEach((args) => dispatch(
          patchState('user', 'set', ...args),
        ));
        if (alert) {
          dispatch(pAlert(
            'Changing User Settings Error',
            res[0],
            'error',
            'OK',
          ));
        }
      }
      return res;
    } finally {
      delete fetchStates.changeUser;
    }
  };
}

export function changeProfile(profileChanges, alert) {
  return async (dispatch, getState) => {
    if (fetchStates.changeProfile) {
      return [];
    }
    fetchStates.changeProfile = true;

    const state = getState().profile;
    const revertOperations = [];
    if (state) {
      for (const [key, value] of Object.entries(profileChanges)) {
        revertOperations.push([key, state[key]]);
        dispatch(patchState('profile', 'set', key, value));
      }
    }

    try {
      const res = await requestChangeProfile(profileChanges);
      if (res.length) {
        revertOperations.forEach((args) => dispatch(
          patchState('profile', 'set', ...args),
        ));
        if (alert) {
          dispatch(pAlert(
            'Changing Profile Settings Error',
            res[0],
            'error',
            'OK',
          ));
        }
      }
      return res;
    } finally {
      delete fetchStates.changeProfile;
    }
  };
}

export function changeUserFaction(userFactionChanges) {
  return async (dispatch, getState) => {
    if (fetchStates.changeUserFaction) {
      return [];
    }
    fetchStates.changeUserFaction = true;

    const { factionName } = userFactionChanges;
    const state = getState().profile.factions.find(
      (f) => f.name === factionName,
    );
    const revertOperations = [];
    if (state) {
      for (const [key, value] of Object.entries(userFactionChanges)) {
        if (key !== 'factionName') {
          const path = `factions[name:${factionName}].${key}`;
          revertOperations.push([path, state[key]]);
          dispatch(patchState('profile', 'setex', path, value));
        }
      }
    }

    try {
      const res = await requestChangeUserFaction(userFactionChanges);
      if (res.length) {
        revertOperations.forEach((args) => dispatch(
          patchState('profile', 'setex', ...args),
        ));
      }
      return res;
    } finally {
      delete fetchStates.changeUserFaction;
    }
  };
}

export function changeFaction(factionChanges) {
  return async (dispatch, getState) => {
    if (fetchStates.changeFaction) {
      return [];
    }
    fetchStates.changeFaction = true;

    const { name } = factionChanges;
    const state = getState().profile.factions.find((f) => f.name === name);
    const revertOperations = [];
    if (state) {
      for (const [key, value] of Object.entries(factionChanges)) {
        if (key !== 'name') {
          const path = `factions[name:${name}].${key}`;
          revertOperations.push([path, state[key]]);
          dispatch(patchState('profile', 'setex', path, value));
        }
      }
    }

    try {
      const res = await requestChangeFaction(factionChanges);
      if (res.length) {
        revertOperations.forEach((args) => dispatch(
          patchState('profile', 'setex', ...args),
        ));
      }
      return res;
    } finally {
      delete fetchStates.changeFaction;
    }
  };
}

export function changeFactionRole(factionRoleChanges) {
  return async (dispatch, getState) => {
    if (fetchStates.changeFactionRole) {
      return [];
    }
    fetchStates.changeFactionRole = true;

    const { frid } = factionRoleChanges;
    let factionName;
    let state;
    const factionsState = getState().profile.factions;
    if (factionsState) {
      for (let i = 0; i < factionsState.length; i += 1) {
        const factionState = factionsState[i];
        state = factionState.roles.find((r) => r.frid === frid);
        if (state) {
          factionName = factionState.name;
          break;
        }
      }
    }

    const revertOperations = [];
    if (state) {
      for (const [key, value] of Object.entries(factionRoleChanges)) {
        if (key !== 'frid') {
          // eslint-disable-next-line max-len
          const path = `factions[name:${factionName}].roles[frid:${frid}].${key}`;
          revertOperations.push([path, state[key]]);
          dispatch(patchState('profile', 'setex', path, value));
        }
      }
    }

    try {
      const res = await requestChangeFactionRole(factionRoleChanges);
      if (res.length) {
        revertOperations.forEach((args) => dispatch(
          patchState('profile', 'setex', ...args),
        ));
      }
      return res;
    } finally {
      delete fetchStates.changeFactionRole;
    }
  };
}

export function fetchProfile() {
  return async (dispatch, getState) => {
    if (fetchStates.profile) {
      return;
    }
    fetchStates.profile = true;

    try {
      if (!getState().user.username) {
        dispatch({ type: 's/REC_PROFILE', profile: {} });
        return;
      }
      let profile = await requestProfile();
      if (profile.errors) {
        profile = {};
      }
      dispatch({ type: 's/REC_PROFILE', profile });
    } finally {
      delete fetchStates.profile;
    }
  };
}

export function fetchMe() {
  return async (dispatch) => {
    const me = await requestMe();
    if (me.errors?.length) {
      return;
    }
    if (me.redirect) {
      window.location.href = me.redirect;
    }
    dispatch(receiveMe(me));
  };
}

export function setUserBlock(userId, userName, block) {
  return async (dispatch) => {
    if (fetchStates.userBlock) {
      return;
    }
    fetchStates.userBlock = true;

    try {
      const res = await requestBlock(userId, block);
      if (res) {
        dispatch(pAlert(
          'User Block Error',
          res,
          'error',
          'OK',
        ));
      } else if (block) {
        dispatch(blockUser(userId, userName));
      } else {
        dispatch(unblockUser(userId, userName));
      }
    } finally {
      delete fetchStates.userBlock;
    }
  };
}

export function setChannelMute(channelId, mute) {
  return async (dispatch) => {
    const res = await requestMute(channelId, mute);
    if (res) {
      dispatch(pAlert(
        'Channel Mute Error',
        res,
        'error',
        'OK',
      ));
    }
    return !res;
  };
}

export function setLeaveChannel(
  cid,
) {
  return async (dispatch) => {
    const res = await requestLeaveChan(cid);
    if (res) {
      dispatch(pAlert(
        'Leaving Channel Error',
        res,
        'error',
        'OK',
      ));
    } else {
      dispatch(removeChatChannel(cid));
    }
  };
}

function setNotification(notification) {
  return {
    type: 'SET_NOTIFICATION',
    notification,
  };
}

function unsetNotification() {
  return {
    type: 'UNSET_NOTIFICATION',
  };
}

let lastNotify = null;
export function notify(notification) {
  return (dispatch) => {
    dispatch(setNotification(notification));
    if (lastNotify) {
      clearTimeout(lastNotify);
      lastNotify = null;
    }
    lastNotify = setTimeout(() => {
      dispatch(unsetNotification());
    }, 1500);
  };
}

export function switchPencilMode() {
  return (dispatch, getState) => {
    let pencilMode = getState().canvas.pencilMode + 1;
    let bound = PENCIL_MODE.HISTORY;
    if (window.ssv?.backupurl) bound += 1;
    if (pencilMode >= bound) pencilMode = 0;
    let notification = t`Pencil picks: `;
    switch (pencilMode) {
      case 0:
        notification += t`Selected Color`;
        break;
      case 1:
        notification += t`From Template`;
        break;
      case 2:
        notification += t`From History`;
        break;
      default:
    }
    dispatch(selectPencilMode(pencilMode));
    dispatch(notify(notification));
  };
}

function getPendingActions(state) {
  const actions = [];
  const now = Date.now();

  const { wait } = state.user;

  const coolDown = wait - now;

  if (wait !== null && wait !== undefined) {
    if (coolDown > 0) {
      actions.push({ type: 'COOLDOWN_SET', coolDown });
    } else {
      actions.push({ type: 'COOLDOWN_END' });
    }
  }

  /* once per minute, 333 is same as in initTimer */
  if (now % 60000 < 333) {
    if (state.canvas.replacementInterval
      && state.canvas.replacementActive !== isIntervalActive(
        state.canvas.replacementInterval,
      )
    ) {
      actions.push({ type: 'UPDATE_INTERVAL_ACTIVE' });
    }
  }

  return actions;
}

export function initTimer() {
  return (dispatch, getState) => {
    function tick() {
      const state = getState();
      const actions = getPendingActions(state);
      dispatch(actions);
    }

    /* something shorter than 1000 ms */
    setInterval(tick, 333);
  };
}
