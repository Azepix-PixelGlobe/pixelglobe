import { ReactReduxContext } from '../components/Context.js';
import {
  createReduxContextHook,
  useReduxContext as useDefaultReduxContext,
} from './useReduxContext.js';

/**
 * Hook factory, which creates a `useStore` hook bound to a given context.
 *
 * @param {React.Context} Context passed to your `<Provider>`.
 * @returns {Function} A `useStore` hook bound to the specified context.
 */
export function createStoreHook(
  context = ReactReduxContext,
) {
  const useReduxContext
    = context === ReactReduxContext
      ? useDefaultReduxContext
      : createReduxContextHook(context);
  const useStore = () => {
    const { store } = useReduxContext();
    return store;
  };

  Object.assign(useStore, {
    withTypes: () => useStore,
  });

  return useStore;
}

/**
 * A hook to access the redux store.
 *
 * @returns {any} the redux store
 *
 * @example
 *
 * import React from 'preact/hooks'
 * import { useStore } from 'react-redux'
 *
 * export const ExampleComponent = () => {
 *   const store = useStore()
 *   return <div>{store.getState()}</div>
 * }
 */
export const useStore = /* #__PURE__ */ createStoreHook();
