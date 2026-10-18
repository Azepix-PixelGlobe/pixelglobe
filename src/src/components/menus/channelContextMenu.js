/*
 * channel onContextmen
 */
import { t } from 'ttag';
import MdOutlineSensorDoor from '../../icons/MdOutlineSensorDoor.svg';

import { CHANNEL_TYPES } from '../../core/constants.js';
import { toggleChatCompact } from '../../store/actions/index.js';
import { setLeaveChannel, setChannelMute } from '../../store/actions/thunks.js';

export default function channelContextMenu(store, args) {
  const { cid, type, muted } = args;

  const elements = [];

  if (type !== CHANNEL_TYPES.PUBLIC) {
    elements.push({
      id: 'mu',
      type: 'boolean',
      func: (state) => store.dispatch(setChannelMute(cid, !state)),
      state: muted,
      text: t`Mute Channel`,
    });
    if (type !== CHANNEL_TYPES.FACTION) {
      elements.push({
        id: 'cl',
        type: 'func',
        func: () => {
          store.dispatch(setLeaveChannel(cid));
        },
        symbol: MdOutlineSensorDoor,
        text: t`Close`,
      });
    }
  }
  elements.push({
    id: 'co',
    type: 'boolean',
    state: store.getState().gui.chatCompact,
    func: () => {
      store.dispatch(toggleChatCompact());
      return true;
    },
    text: t`Compact Chat`,
  });
  return elements;
}
