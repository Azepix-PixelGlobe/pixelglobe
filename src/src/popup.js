/*
 * Main Script for windows (pop-ups and stuff)
 */
import { persistStore } from './store/persist/index.js';

import { parentExists } from './core/utils.js';
import store from './store/storePopUp.js';
import {
  urlChange, parseCanvases,
} from './store/actions/index.js';
import {
  fetchMe,
} from './store/actions/thunks.js';
import renderAppPopUp from './components/AppPopUp.jsx';

// eslint-disable-next-line
__webpack_public_path__ = `${window.ssv?.basename || ''}/assets/`;

persistStore(store).then(() => {
  window.addEventListener('message', store.dispatch);

  store.dispatch({ type: 'HYDRATED' });

  window.addEventListener('popstate', () => {
    store.dispatch(urlChange());
  });

  store.dispatch(parseCanvases());
  if (!parentExists()) {
    store.dispatch(fetchMe());
  }
});

(function load() {
  const onLoad = () => {
    renderAppPopUp(document.getElementById('app'), store);
    document.removeEventListener('DOMContentLoaded', onLoad);
  };
  document.addEventListener('DOMContentLoaded', onLoad, false);
}());
