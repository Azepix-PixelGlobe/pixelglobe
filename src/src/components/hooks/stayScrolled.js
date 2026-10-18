import {
  useEffect, useLayoutEffect, useRef, useCallback,
} from 'preact/hooks';

/* eslint-disable react-hooks/exhaustive-deps */

export default (domRef, {
  initialScroll = null,
  inaccuracy = 0,
}) => {
  const wasScrolled = useRef(null);

  const isScrolled = useCallback(() => {
    if (domRef.current === null) {
      return false;
    }
    const domObject = domRef.current;
    const maxScrollTop = domObject.scrollHeight - domObject.clientHeight;
    return (Math.ceil(domObject.scrollTop) >= maxScrollTop - inaccuracy);
  }, [inaccuracy]);

  useEffect(() => {
    const onScroll = () => {
      wasScrolled.current = isScrolled();
    };

    const domObject = domRef.current;
    domObject.addEventListener('scroll', onScroll);
    return () => {
      domObject.removeEventListener('scroll', onScroll);
    };
  }, []);

  const scroll = useCallback((position) => {
    if (!domRef.current) {
      return;
    }
    const domObject = domRef.current;
    const maxScrollTop = domObject.scrollHeight - domObject.clientHeight;
    const offset = Math.min(maxScrollTop, position);
    domRef.current.scrollTop = offset;
  }, []);

  const scrollBottom = useCallback(() => {
    scroll(Number.POSITIVE_INFINITY);
  }, [scroll]);

  const stayScrolled = useCallback(() => {
    if (wasScrolled.current) scrollBottom();

    return wasScrolled.current;
  }, [scrollBottom]);

  useLayoutEffect(() => {
    if (initialScroll !== null) {
      scroll(initialScroll);
    }
    wasScrolled.current = isScrolled();
  }, []);

  return {
    scroll,
    stayScrolled,
    scrollBottom,
    isScrolled,
  };
};
