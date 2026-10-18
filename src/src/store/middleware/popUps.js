/*
 * send and receive actions from popups
 */

import { propagateMe } from '../actions/index.js';
import {
  removePopUp, addPopUp, dispatchToPopUps, hasPopUps,
} from '../../core/popUps.js';

export default (store) => (next) => (action) => {
  if (action instanceof MessageEvent) {
    if (action.origin !== window.location.origin
      || !action.data.type
    ) {
      return null;
    }
    if (action.data.type === 't/UNLOAD') {
      console.log('popup closed');
      removePopUp(action.source);
    } else if (action.data.type === 't/LOAD') {
      const state = store.getState();
      action.source.postMessage(
        propagateMe(state),
        window.location.origin,
      );
      addPopUp(action.source);
      console.log('popup added');
    } else if (action.data.type.startsWith('s/')) {
      dispatchToPopUps(action.data, action.source);
    }
    return next(action.data);
  }

  if (hasPopUps()
    && action.type?.startsWith('s/')
  ) {
    dispatchToPopUps(action);
  }

  return next(action);
};
