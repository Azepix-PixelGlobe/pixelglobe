/*
 * actions that are fired when received by the websocket
 */
export function socketClose() {
  return {
    type: 'w/CLOSE',
  };
}

export function socketOpen() {
  return {
    type: 'w/OPEN',
  };
}

export function longTimeout() {
  return {
    type: 'w/LONG_TIMEOUT',
  };
}

export function receiveChatMessage(...messageArray) {
  // channelId
  const cid = Number(messageArray.shift());
  const notify = messageArray.shift();

  return {
    type: 's/REC_CHAT_MESSAGE',
    cid,
    messageArray,
    notify,
  };
}

export function deletePublicUserMessages(user) {
  return {
    type: 's/DELETE_PUB_USR_MSG',
    user,
  };
}

export function deleteUserChannelMessages(user, cid) {
  return {
    type: 's/DELETE_USR_CHN_MSGS',
    user,
    cid,
  };
}

export function deleteMessages(cid, msgIds) {
  return {
    type: 's/DELETE_CHAT_MSGS',
    cid,
    msgIds,
  };
}

export function receiveCoolDown(wait) {
  return {
    type: 'REC_COOLDOWN',
    wait,
  };
}

export function receiveOnline(online) {
  return {
    type: 'REC_ONLINE',
    online,
  };
}

export function addChatChannel(channelType, channel) {
  /* [ cid, name, lastTs, lastReadTs, muted, avatarId ] */
  return {
    type: 's/ADD_CHAT_CHANNEL',
    channelType,
    channel,
  };
}

export function removeChatChannel(cid) {
  return {
    type: 's/REMOVE_CHAT_CHANNEL',
    cid,
  };
}

export function setPixelsFetching(fetching) {
  return {
    type: 'SET_PXLS_FETCHING',
    fetching,
  };
}

export function receivePlacePixels(args) {
  args.type = 'REC_SET_PXLS';
  return args;
}
