/*
    - merges 1 level of substate
    - skips substate if already modified
*/
export default function stateReconciler(
  inboundState,
  originalState,
  reducedState,
) {
  const newState = { ...reducedState };
  // only rehydrate if inboundState exists and is an object
  if (inboundState && typeof inboundState === 'object') {
    const keys = Object.keys(inboundState);
    keys.forEach((key) => {
      // ignore _persist data
      if (key === '_persist') return;
      // if reducer modifies substate, skip auto rehydration
      if (originalState[key] !== reducedState[key]) {
        return;
      }
      // otherwise hard set the new value
      newState[key] = inboundState[key];
    });
  }

  return newState;
}
