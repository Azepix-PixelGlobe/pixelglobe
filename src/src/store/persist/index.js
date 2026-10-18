import StateStorage from './StateStorage.js';
import stateReconciler from './stateReconciler.js';

export const FLUSH = 'persist/FLUSH';
export const REHYDRATE = 'persist/REHYDRATE';
export const PAUSE = 'persist/PAUSE';
export const PERSIST = 'persist/PERSIST';
export const PURGE = 'persist/PURGE';

const DEFAULT_TIMEOUT = 5000;

/* eslint-disable no-underscore-dangle */

export function persistReducer(
  /*
   * {
   *   key, version,
   *   [whitelist],
   *   [timeout: number],
   *   [migrate: (state, version, prevVersion) => state],
   * }
   */
  config,
  baseReducer,
) {
  const stateStorage = new StateStorage(config);

  const timeout = config.timeout !== undefined
    ? config.timeout : DEFAULT_TIMEOUT;

  let isPurge = false;
  let isPaused = true;

  return (state, action) => {
    const { _persist, ...rest } = state || {};
    const restState = rest;

    switch (action.type) {
      case PERSIST: {
        let isSealed = false;
        const rehydrate = (payload, err) => {
          // only rehydrate if we are not already sealed
          if (!isSealed) {
            /* payload may be undefined */
            action.rehydrate(config.key, payload, err);
            isSealed = true;
          }
        };
        timeout
        && setTimeout(() => {
          !isSealed
          && rehydrate(
            undefined,
            new Error(
              `redux-persist: persist timed out for persist key "${
                config.key
              }"`,
            ),
          );
        }, timeout);

        // @NOTE PERSIST resumes if paused.
        isPaused = false;

        if (_persist) {
          return {
            ...baseReducer(restState, action),
            _persist,
          };
        }

        if (typeof action.rehydrate !== 'function') {
          throw new Error(
            // eslint-disable-next-line max-len
            'redux-persist: rehydrate has to be a function on the PERSIST action.',
          );
        }

        stateStorage.getStoredState().then((restoredState) => {
          /* restoredState may be undefined */
          rehydrate(restoredState);
        }).catch((err) => {
          rehydrate(undefined, err);
        });

        return {
          ...baseReducer(restState, action),
          _persist: { version: stateStorage.version, rehydrated: false },
        };
      };

      case PURGE: {
        isPurge = true;
        action.result(stateStorage.purgeStoredState());
        return {
          ...baseReducer(restState, action),
          _persist,
        };
      };

      case FLUSH: {
        action.result(stateStorage.flushState());
        return {
          ...baseReducer(restState, action),
          _persist,
        };
      };

      case PAUSE: {
        isPaused = true;
        break;
      };

      case REHYDRATE: {
        // noop on restState if purging
        if (isPurge) {
          return {
            ...restState,
            _persist: { ..._persist, rehydrated: true },
          };
        }

        /* only care about our own state */
        if (action.key === config.key) {
          const reducedState = baseReducer(restState, action);
          const inboundState = action.payload;
          const reconciledRest = (inboundState !== undefined)
            ? stateReconciler(inboundState, state, reducedState)
            : reducedState;
          const newState = {
            ...reconciledRest,
            _persist: { ..._persist, rehydrated: true },
          };
          if (newState._persist.rehydrated && !isPaused) {
            stateStorage.update(newState);
          }
          return newState;
        }
        break;
      };

      default:
        // nothing
    }

    // if we have not already handled PERSIST, straight passthrough
    if (!_persist) {
      return baseReducer(state, action);
    }

    // run base reducer:
    // is state modified ? return original : return updated
    const newRestState = baseReducer(restState, action);
    if (newRestState === restState) {
      return state;
    }
    const newState = { ...newRestState, _persist };
    if (newState._persist.rehydrated && !isPaused) {
      stateStorage.update(newState);
    }
    return newState;
  };
}

export function persistStore(store) {
  return new Promise((resolve) => {
    store.dispatch({
      type: PERSIST,
      rehydrate: (key, payload, err) => {
        if (err) {
          console.error(err);
        }
        store.dispatch({
          type: REHYDRATE,
          payload,
          err,
          key,
        });
        resolve();
      },
    });
  });
}
