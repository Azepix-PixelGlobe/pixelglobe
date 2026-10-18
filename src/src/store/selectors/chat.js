/*
 * selectors for chat
 */
import { createSelector } from 'reselect';

import { CHANNEL_TYPES } from '../../core/constants.js';

export function isChannelUnread(channelArray) {
  /* [cid, name, lastTs, lastReadTs, muted, avatarId] */
  const [,, lastTs, lastReadTs, muted] = channelArray;
  return lastTs && !muted && (!lastReadTs || lastReadTs < lastTs);
}

export const selectUnreadCategories = createSelector(
  (state) => state.chat.channels[CHANNEL_TYPES.DM],
  (state) => state.chat.channels[CHANNEL_TYPES.GROUP],
  (state) => state.chat.channels[CHANNEL_TYPES.FACTION],
  (dmChannels, groupChannels, factionChannels) => {
    const unreadCategories = [];
    if (dmChannels?.some(isChannelUnread)) {
      unreadCategories.push(CHANNEL_TYPES.DM);
    }
    if (groupChannels?.some(isChannelUnread)) {
      unreadCategories.push(CHANNEL_TYPES.GROUP);
    }
    if (factionChannels?.some(isChannelUnread)) {
      unreadCategories.push(CHANNEL_TYPES.FACTION);
    }
    return unreadCategories;
  },
);
