/*
 * reducers that are shared between pages
 */

import { persistReducer } from './persist/index.js';

import gui from './reducers/gui.js';
import ranks from './reducers/ranks.js';
import user from './reducers/user.js';
import canvas from './reducers/canvas.js';
import templates from './reducers/templates.js';
import chat from './reducers/chat.js';
import profile from './reducers/profile.js';

const guiPersist = persistReducer({
  key: 'gui',
  version: 21,
}, gui);

const ranksPersist = persistReducer({
  key: 'ranks',
  version: 21,
}, ranks);

const templatesPersist = persistReducer({
  key: 'tem',
  version: 18,
}, templates);

const canvasPersist = persistReducer({
  key: 'can',
  version: 2,
  whitelist: ['prevCanvasState'],
}, canvas);

export default {
  gui: guiPersist,
  ranks: ranksPersist,
  templates: templatesPersist,
  canvas: canvasPersist,
  chat,
  user,
  profile,
};
