/*
 * user context menu
 */
import { t } from 'ttag';

import { startDm, setUserBlock } from '../../store/actions/thunks.js';
import { escapeMd } from '../../core/utils.js';

export default function userContextMenu(store, args) {
  const {
    name, uid, setChannel, addToInput,
  } = args;

  return [{
    id: 'pi',
    type: 'func',
    func: () => {
      const ping = `@[${escapeMd(name)}](${uid})`;
      addToInput(ping);
    },
    text: t`Ping`,
  }, {
    id: 'pr',
    type: 'link',
    link: 'USER',
    /*
     * this is currently supported since we expose uid and use it a lot
     */
    args: { username: uid },
    text: t`Profile`,

  }, {
    id: 'dm',
    type: 'func',
    func: () => {
      /*
       * if dm channel already exists,
       * just switch
       */
      const { chat: { channels } } = store.getState();
      const cids = Object.keys(channels);
      for (let i = 0; i < cids.length; i += 1) {
        const cid = cids[i];
        if (channels[cid].length === 4 && channels[cid][3] === uid) {
          setChannel(cid);
          return;
        }
      }
      store.dispatch(startDm({ userId: uid }, setChannel));
    },
    text: t`DM`,
  }, {
    id: 'bl',
    type: 'func',
    func: () => {
      store.dispatch(setUserBlock(uid, name, true));
    },
    text: t`Block`,
  }];
}
