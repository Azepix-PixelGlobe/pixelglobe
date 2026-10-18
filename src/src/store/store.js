/*
 * redux store
 */

import {
  /*
   * redux wants us to use the redux-toolkit really hard,
   * we do not want that, it abstracts too much away,
   * if there should ever arise a necessity to use the redux toolkit,
   * we shall switch to a different librry or make our own
   */
  applyMiddleware, combineReducers, legacy_createStore as createStore,
} from 'redux';
import { thunk } from 'redux-thunk';
import { persistReducer } from './persist/index.js';

import sharedReducers from './sharedReducers.js';

/*
 * reducers
 */
import windows from './reducers/windows.js';
import alert from './reducers/alert.js';

/*
 * middleware
 */
import audio from './middleware/audio.js';
import socketClientHook from './middleware/socketClientHook.js';
import rendererHook from './middleware/rendererHook.js';
import array from './middleware/array.js';
import notifications from './middleware/notifications.js';
import title from './middleware/title.js';
import popUps from './middleware/popUps.js';
import extensions from './middleware/extensions.js';

const windowsPersist = persistReducer({
  key: 'wind',
  version: 18,
}, windows);

const reducers = combineReducers({
  ...sharedReducers,
  windows: windowsPersist,
  alert,
});

const store = createStore(
  reducers,
  applyMiddleware(
    thunk,
    array,
    popUps,
    audio,
    notifications,
    title,
    socketClientHook,
    extensions,
    rendererHook,
  ),
);

/*
 * persistStore of redux-persist is called in client.js
 */

export default store;
