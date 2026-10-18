import { useMemo, useLayoutEffect } from 'preact/hooks';

import { createSubscription } from '../utils/Subscription.js';
import { ReactReduxContext } from './Context.js';

function Provider(providerProps) {
  const { children, context, serverState, store } = providerProps;

  const contextValue = useMemo(() => {
    const subscription = createSubscription(store);

    const baseContextValue = {
      store,
      subscription,
      getServerState: serverState ? () => serverState : undefined,
    };

    if (process.env.NODE_ENV === 'production') {
      return baseContextValue;
    } else {
      const { identityFunctionCheck = 'once', stabilityCheck = 'once' }
        = providerProps;

      return /* @__PURE__ */ Object.assign(baseContextValue, {
        stabilityCheck,
        identityFunctionCheck,
      });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store, serverState]);

  const previousState = useMemo(() => store.getState(), [store]);

  useLayoutEffect(() => {
    const { subscription } = contextValue;
    subscription.onStateChange = subscription.notifyNestedSubs;
    subscription.trySubscribe();

    if (previousState !== store.getState()) {
      subscription.notifyNestedSubs();
    }
    return () => {
      subscription.tryUnsubscribe();
      subscription.onStateChange = undefined;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contextValue, previousState]);

  const Context = context || ReactReduxContext;

  return <Context.Provider value={contextValue}>{children}</Context.Provider>;
}

export default Provider;
