/*
 * detect click outside
 */



import { useEffect } from 'preact/hooks';

/*
 * Keeps listening to outside clicks or window resize
 * as long as active is true
 * @param insideRefs references to elements that are considered inside
 * @param callback function that gets fired on click outside
 * @param active boolean if we should listen or not
 */
export function useConditionalClickOutside(insideRefs, active, callback) {
  useEffect(() => {
    if (!active) {
      return undefined;
    }

    const insideElems = insideRefs.some((ref) => ref.current)
      ? insideRefs.map((ref) => ref.current)
      : null;

    if (insideElems === null) {
      return undefined;
    }

    const handleClickOutside = (event) => {
      if (insideElems.every((elem) => !elem || !elem.contains(event.target))) {
        callback();
      }
    };

    const handleWindowResize = () => {
      callback();
    };

    document.addEventListener('click', handleClickOutside, {
      capture: true,
    });
    window.addEventListener('resize', handleWindowResize);

    return () => {
      document.removeEventListener('click', handleClickOutside, {
        capture: true,
      });
      window.removeEventListener('resize', handleWindowResize);
    };
  }, [active, insideRefs, callback]);
}

/*
 * listen to click outside or window resize
 * @param insideRefs references to elements that are considered inside
 * @param callback function that gets fired on click outside
 */
export function useClickOutside(insideRefs, callback) {
  useEffect(() => {
    const insideElems = insideRefs.some((ref) => ref.current)
      ? insideRefs.map((ref) => ref.current)
      : null;

    if (insideElems === null) {
      return undefined;
    }

    const handleClickOutside = (event) => {
      if (insideElems.every((elem) => !elem || !elem.contains(event.target))) {
        callback();
      }
    };

    const handleWindowResize = () => {
      callback();
    };

    document.addEventListener('click', handleClickOutside, {
      capture: true,
    });
    window.addEventListener('resize', handleWindowResize);

    return () => {
      document.removeEventListener('click', handleClickOutside, {
        capture: true,
      });
      window.removeEventListener('resize', handleWindowResize);
    };
  }, [insideRefs, callback]);
}
