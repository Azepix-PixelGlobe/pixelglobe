/*
 * hook that returns the current day and month
 */

import { useState, useEffect, useRef } from 'preact/hooks';

function useDate() {
  const [day, setDay] = useState(() => new Date().getDate());
  const [month, setMonth] = useState(() => new Date().getMonth() + 1);
  const timeoutIdRef = useRef(null);

  useEffect(() => {
    const scheduleMidnight = () => {
      if (timeoutIdRef.current) {
        clearTimeout(timeoutIdRef.current);
      }
      const midnight = new Date().setHours(24, 0, 0, 0);
      const timeUntilMidnight = midnight - Date.now();

      timeoutIdRef.current = setTimeout(() => {
        const curDate = new Date();
        setDay(curDate.getDate());
        setMonth(curDate.getMonth() + 1);
        scheduleMidnight(); // This will update timeoutIdRef.current
      }, timeUntilMidnight);
    };

    scheduleMidnight();
    return () => {
      if (timeoutIdRef.current) {
        clearTimeout(timeoutIdRef.current);
      }
    };
  }, []);

  return [day, month];
}

export default useDate;
