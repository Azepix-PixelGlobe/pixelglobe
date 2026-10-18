import { createContext } from 'preact';

const ContextKey = /* @__PURE__ */ Symbol.for(`react-redux-context`);
const gT = (
  typeof globalThis !== 'undefined'
    ? globalThis
    : /* per-module scope if `globalThis` is not available */ {}
);

function getContext() {
  if (!createContext) return {};

  const contextMap = (gT[ContextKey] ??= new Map());
  let realContext = contextMap.get(createContext);
  if (!realContext) {
    realContext = createContext(null);
    if (process.env.NODE_ENV !== 'production') {
      realContext.displayName = 'ReactRedux';
    }
    contextMap.set(createContext, realContext);
  }
  return realContext;
}

export const ReactReduxContext = getContext();
