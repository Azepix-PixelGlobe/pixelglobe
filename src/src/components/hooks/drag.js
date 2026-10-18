/*
 * mouse dragging
 */



import { useEffect, useCallback, useState } from 'preact/hooks';

/**
 * Follow dragging and clicking of element
 * @param elRef element reference from useRef
 * @param startHandler function called on start of drag
 * @param diffHandler function that is called with dragged distance
 * @param doubleClickHandler function called when double clicked
 */
function useDrag(elRef, startHandler, diffHandler, doubleClickHandler) {
  const [lastPressTs, setLastPressTs] = useState(0);

  const startDrag = useCallback((event) => {
    event.preventDefault();
    event.stopPropagation();

    /* double click */
    const now = Date.now();
    if (now - lastPressTs < 300 && doubleClickHandler) {
      doubleClickHandler();
      return;
    }
    setLastPressTs(now);

    let {
      clientX: startX,
      clientY: startY,
    } = event.touches ? event.touches[0] : event;

    if (startHandler) startHandler(startX, startY);

    const drag = (evt) => {
      evt.preventDefault();
      evt.stopPropagation();
      const {
        clientX: curX,
        clientY: curY,
      } = evt.touches ? evt.touches[0] : evt;
      const skipReset = diffHandler(
        curX - startX, curY - startY, startX, startY,
      );
      if (!skipReset) {
        startX = curX;
        startY = curY;
      }
    };
    document.addEventListener('mousemove', drag);
    document.addEventListener('touchmove', drag);
    const stopDrag = (evt) => {
      evt.preventDefault();
      evt.stopPropagation();
      document.removeEventListener('mousemove', drag);
      document.removeEventListener('touchmove', drag);
      document.removeEventListener('mouseup', stopDrag);
      document.removeEventListener('touchcancel', stopDrag);
      document.removeEventListener('touchend', stopDrag);

      for (const i of document.getElementsByTagName('iframe')) {
        i.style.removeProperty('pointer-events');
        i.style.removeProperty('touch-action');
      }
    };
    document.addEventListener('mouseup', stopDrag);
    document.addEventListener('touchcancel', stopDrag);
    document.addEventListener('touchend', stopDrag);

    for (const i of document.getElementsByTagName('iframe')) {
      i.style['pointer-events'] = 'none';
      i.style['touch-action'] = 'none';
    }
  }, [startHandler, diffHandler, lastPressTs, doubleClickHandler]);

  useEffect(() => {
    const refElem = elRef.current;

    if (!refElem) {
      return undefined;
    }

    refElem.addEventListener('mousedown', startDrag, {
      passive: false,
    });
    refElem.addEventListener('touchstart', startDrag, {
      passive: false,
    });

    return () => {
      refElem.removeEventListener('mousedown', startDrag);
      refElem.removeEventListener('touchstart', startDrag);
    };
  }, [elRef, startDrag]);
}

export default useDrag;
