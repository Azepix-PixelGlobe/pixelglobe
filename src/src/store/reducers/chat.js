import { patchState } from '../index.js';
import { MAX_CHAT_MESSAGES, CHANNEL_TYPES } from '../../core/constants.js';

function getChannelIndexAndType(state, cid) {
  const types = Object.keys(state.channels);
  for (let i = 0; i < types.length; i += 1) {
    const type = Number(types[i]);
    const typeChannels = state.channels[type];
    for (let u = 0; u < typeChannels.length; u += 1) {
      if (typeChannels[u][0] === cid) {
        return [type, u];
      }
    }
  }
  return [null, -1];
}

const initialState = {
  /*
   * { [CHANNEL_TYPES.PUBLIC]: [[
   *   cid, name, lastTs, lastReadTs, muted, avatarId
   * ], ...], ... }
   */
  channels: {},
  // [[uId, userName], [userId2, userName2],...]
  blocked: [],
  /*
   * flag can be two letter country code or mediaId
   *
   * { cid: [[
   *   name, text, flag, userId, ts, msgId, flagLegit, avatarId, attachments
   * ],...], ... }
   *
   * with attachments:
   * [[mediaId, type, size, width, height, avgColor], ...]
   */
  messages: {},
  /*
   * channels we are currently viewing at
   * { cid: refCounter }
   */
  channelViews: {},
};

export default function chat(
  state = initialState,
  action,
) {
  switch (action.type) {
    case 's/REC_ME':
    case 's/LOGIN': {
      return {
        ...state,
        channels: action.channels,
        blocked: action.blocked,
      };
    }

    case 's/PATCH_STATE': {
      if (action.state === 'chat') {
        return patchState(state, action.patch)[0];
      }
      return state;
    }

    case 's/LOGOUT': {
      const messages = { ...state.messages };
      const publicChannels = state.channels[CHANNEL_TYPES.PUBLIC];
      const keys = Object.keys(messages);
      for (let i = 0; i < keys.length; i += 1) {
        const cid = keys[i];
        if (!publicChannels?.some(([c]) => c === cid)) {
          delete messages[cid];
        }
      }
      return {
        ...state,
        channels: {
          [CHANNEL_TYPES.PUBLIC]: publicChannels,
        },
        blocked: [],
        messages,
      };
    }

    case 's/REF_CHAT_CHAN': {
      const { cidAdditions } = action;
      let { messages } = state;
      let isMessagesRecreated = false;
      const channelViews = { ...state.channelViews };

      const cids = Object.keys(cidAdditions);
      for (let i = 0; i < cids.length; i += 1) {
        const cid = cids[i];
        let refCount = channelViews[cid] || 0;
        refCount += cidAdditions[cid];
        if (refCount > 0) {
          channelViews[cid] = refCount;
        } else {
          delete channelViews[cid];
          if (!isMessagesRecreated) {
            isMessagesRecreated = true;
            messages = { ...messages };
          }
          delete messages[cid];
        }
      }

      return {
        ...state,
        channelViews,
        messages,
      };
    }

    case 's/BLOCK_USER': {
      return {
        ...state,
        blocked: [
          ...state.blocked,
          [action.userId, action.userName],
        ],
      };
    }

    case 's/UNBLOCK_USER': {
      const { userId } = action;
      const blocked = state.blocked.filter((bl) => (bl[0] !== userId));
      return {
        ...state,
        blocked,
      };
    }

    case 's/MARK_CHANNEL_AS_READ': {
      const { cid } = action;

      const [type, channelIndex] = getChannelIndexAndType(state, cid);
      if (!type) {
        /* included PUBLIC */
        return state;
      }

      const typeChannels = [...state.channels[type]];
      typeChannels[channelIndex] = [...typeChannels[channelIndex]];
      typeChannels[channelIndex][3] = Math.ceil(Date.now() / 1000);

      return {
        ...state,
        channels: {
          ...state.channels,
          [type]: typeChannels,
        },
      };
    }

    case 's/ADD_CHAT_CHANNEL': {
      const { channelType, channel } = action;
      const cid = channel[0];
      if (state.channels[channelType]?.some(([i]) => i === cid)) {
        return state;
      }
      return {
        ...state,
        channels: {
          ...state.channels,
          [channelType]: [
            ...(state.channels[channelType] || []),
            channel,
          ],
        },
      };
    }

    case 's/REMOVE_CHAT_CHANNEL': {
      const { cid } = action;

      const [type, channelIndex] = getChannelIndexAndType(state, cid);
      if (type === null) {
        return state;
      }

      const messages = { ...state.messages };
      delete messages[cid];
      const typeChannels = state.channels[type];

      return {
        ...state,
        channels: {
          ...state.channels,
          [type]: [
            ...typeChannels.slice(0, channelIndex),
            ...typeChannels.slice(channelIndex + 1),
          ],
        },
        messages,
      };
    }

    case 's/REC_CHAT_MESSAGE': {
      const { cid, messageArray, notify } = action;

      const [type, channelIndex] = getChannelIndexAndType(state, cid);
      if (type === null) {
        return state;
      }

      /*
       * PixelGlobe: invisible protocol frames (typing / presence / profile)
       * must never move a channel to the top of the list or mark it unread.
       */
      const isProtocolFrame = typeof messageArray[1] === 'string'
        && messageArray[1].charCodeAt(0) === 0x2063;

      let typeChannels = state.channels[type];
      if (type !== CHANNEL_TYPES.PUBLIC) {
        typeChannels = [...typeChannels];
        typeChannels[channelIndex] = [...typeChannels[channelIndex]];
        const ts = Math.ceil(Date.now() / 1000);
        if (!isProtocolFrame) {
          typeChannels[channelIndex][2] = ts;
          if (!notify) {
            typeChannels[channelIndex][3] = ts;
          }
        }
      }

      const { messages } = state;
      if (messages[cid]) {
        const channelMessages = [
          ...messages[cid],
          messageArray,
        ];
        if (channelMessages.length > MAX_CHAT_MESSAGES) {
          channelMessages.splice(0, 2);
        }
        messages[cid] = channelMessages;
      }

      return {
        ...state,
        channels: {
          ...state.channels,
          [type]: typeChannels,
        },
        messages,
      };
    }

    case 's/DELETE_PUB_USR_MSG': {
      const { user } = action;

      const messages = {
        ...state.messages,
      };

      const publicChannels = state.channels[CHANNEL_TYPES.PUBLIC];
      for (let i = 0; i < publicChannels.length; i += 1) {
        const [cid] = publicChannels[i];
        messages[cid] = messages[cid]?.filter((m) => m[3] !== user);
      }

      return {
        ...state,
        messages,
      };
    }

    case 's/DELETE_USR_CHN_MSGS': {
      const { user, cid } = action;

      const channelMessages = state.messages[cid];
      if (!channelMessages) {
        return state;
      }

      return {
        ...state,
        messages: {
          ...state.messages,
          [cid]: channelMessages.filter((m) => m[3] !== user),
        },
      };
    }

    case 's/DELETE_CHAT_MSGS': {
      const { cid, msgIds } = action;

      const channelMessages = state.messages[cid];
      if (!channelMessages) {
        return state;
      }

      return {
        ...state,
        messages: {
          ...state.messages,
          [cid]: channelMessages.filter(
            ([,,,,, msgId]) => !msgIds.includes(msgId),
          ),
        },
      };
    }

    case 's/REC_CHAT_HISTORY': {
      const { cid, history } = action;
      if (!state.channelViews[cid]) {
        return state;
      }
      return {
        ...state,
        messages: {
          ...state.messages,
          [cid]: history,
        },
      };
    }

    default:
      return state;
  }
}
