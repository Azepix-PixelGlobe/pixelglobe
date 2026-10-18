/*
 * A game-wide state shared between shards, must be serializable
 */

import {
  getState as getStateQuery,
  setState as setStateQuery,
} from '../data/sql/Config.js';
import socketEvents from '../socket/socketEvents.js';
import { queueWithoutGracePeriod as queue } from '../utils/queue.js';

const cache = new Map();

const getStateQueryQueued = queue(getStateQuery);

export async function getState(key) {
  let value = cache.get(key);
  if (!value) {
    value = await getStateQueryQueued(key);
    cache.set(key, value);
  }
  return value;
}

export async function setState(key, value) {
  const success = await setStateQuery(key, value);
  if (success) {
    cache.set(key, value);
    socketEvents.updateSharedState(key, value);
  }
  return success;
}

export async function getMultipleStates(keys) {
  const ret = {};
  for (let i = 0; i < keys.length; i += 1) {
    const key = keys[i];
    // eslint-disable-next-line no-await-in-loop
    ret[key] = await getState(key);
  }
  return ret;
}

socketEvents.on('sharedstate', (key, value) => {
  console.log('SharedState received update');
  cache.set(key, value);
});
