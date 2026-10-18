import { useRef, useCallback } from 'preact/hooks';

import {
  useSyncExternalStoreWithSelector,
} from '../utils/useSyncExternalStoreWithSelector.js';
import { ReactReduxContext } from '../components/Context.js';
import {
  createReduxContextHook,
  useReduxContext as useDefaultReduxContext,
} from './useReduxContext.js';

const refEquality = (a, b) => a === b;

/**
 * Hook factory, which creates a `useSelector` hook bound to a given context.
 *
 * @param {React.Context} Context passed to your `<Provider>`.
 * @returns {Function} A `useSelector` hook bound to the specified context.
 */
export function createSelectorHook(
  context = ReactReduxContext,
) {
  const useReduxContext
    = context === ReactReduxContext
      ? useDefaultReduxContext
      : createReduxContextHook(context);

  const useSelector = (
    selector,
    equalityFnOrOptions = {},
  ) => {
    const { equalityFn = refEquality }
      = typeof equalityFnOrOptions === 'function'
        ? { equalityFn: equalityFnOrOptions }
        : equalityFnOrOptions;
    if (process.env.NODE_ENV !== 'production') {
      if (!selector) {
        throw new Error(`You must pass a selector to useSelector`);
      }
      if (typeof selector !== 'function') {
        throw new Error(
          `You must pass a function as a selector to useSelector`,
        );
      }
      if (typeof equalityFn !== 'function') {
        throw new Error(
          `You must pass a function as an equality function to useSelector`,
        );
      }
    }

    const reduxContext = useReduxContext();

    const { store, subscription, getServerState } = reduxContext;

    const firstRun = useRef(true);

    // eslint-disable-next-line react-hooks/exhaustive-deps
    const wrappedSelector = useCallback(
      {
        [selector.name](state) {
          const selected = selector(state);
          if (process.env.NODE_ENV !== 'production') {
            const { devModeChecks = {} }
              = typeof equalityFnOrOptions === 'function'
                ? {}
                : equalityFnOrOptions;
            const { identityFunctionCheck, stabilityCheck } = reduxContext;
            const {
              identityFunctionCheck: finalIdentityFunctionCheck,
              stabilityCheck: finalStabilityCheck,
            } = {
              stabilityCheck,
              identityFunctionCheck,
              ...devModeChecks,
            };
            if (
              finalStabilityCheck === 'always'
              || (finalStabilityCheck === 'once' && firstRun.current)
            ) {
              const toCompare = selector(state);
              if (!equalityFn(selected, toCompare)) {
                let stack = undefined;
                try {
                  throw new Error();
                } catch (e) {
                  ({ stack } = e);
                }
                console.warn(
                  /* eslint-disable max-len */
                  'Selector '
                  + (selector.name || 'unknown')
                  + ' returned a different result when called with the same parameters. This can lead to unnecessary rerenders.'
                  + '\nSelectors that return a new reference (such as an object or an array) should be memoized: https://redux.js.org/usage/deriving-data-selectors#optimizing-selectors-with-memoization',
                  {
                    state,
                    selected,
                    selected2: toCompare,
                    stack,
                  },
                );
              }
            }
            if (
              finalIdentityFunctionCheck === 'always'
              || (finalIdentityFunctionCheck === 'once' && firstRun.current)
            ) {
              // @ts-ignore
              if (selected === state) {
                let stack = undefined;
                try {
                  throw new Error();
                } catch (e) {
                  ({ stack } = e);
                }
                console.warn(
                  'Selector '
                  + (selector.name || 'unknown')
                  + ' returned the root state when called. This can lead to unnecessary rerenders.'
                  + '\nSelectors that return the entire state are almost certainly a mistake, as they will cause a rerender whenever *anything* in state changes.',
                  { stack },
                  /* eslint-enable max-len */
                );
              }
            }
            if (firstRun.current) firstRun.current = false;
          }
          return selected;
        },
      }[selector.name],
      [selector],
    );

    const selectedState = useSyncExternalStoreWithSelector(
      subscription.addNestedSub,
      store.getState,
      getServerState || store.getState,
      wrappedSelector,
      equalityFn,
    );

    return selectedState;
  };

  Object.assign(useSelector, {
    withTypes: () => useSelector,
  });

  return useSelector;
}

/**
 * A hook to access the redux store's state. This hook takes a selector function
 * as an argument. The selector is called with the store state.
 *
 * This hook takes an optional equality comparison function as the second
 * parameter that allows you to customize the way the selected state is compared
 * to determine whether the component needs to be re-rendered.
 *
 * @param selector the selector function
 * @param equalityFn the function that will be used to determine equality
 *
 * @returns {any} the selected state
 *
 * @example
 *
 * import React from 'preact/hooks'
 * import { useSelector } from 'react-redux'
 *
 * export const CounterComponent = () => {
 *   const counter = useSelector(state => state.counter)
 *   return <div>{counter}</div>
 * }
 */
export const useSelector = /* #__PURE__ */ createSelectorHook();
