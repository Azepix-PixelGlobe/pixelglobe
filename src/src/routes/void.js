/*
 * send information about next void
 */

import { getState } from '../core/SharedState.js';

export default async (req, res) => {
  req.tickRateLimiter(1000);

  res.set({
    'Cache-Control': `public, max-age=${5 * 60}`,
  });

  const voidState = await getState('void');
  const eventTimestamp = voidState?.eventTimestamp;

  if (eventTimestamp) {
    const time = new Date(eventTimestamp);
    res.send(`Next void at ${time.toUTCString()}`);
  } else {
    res.send('No void');
  }
};
