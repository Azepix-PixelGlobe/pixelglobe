/*
 * send moderation logs,
 * events will be filtered based on userlevel
 */

import { ModtoolsLogger } from '../../core/logger.js';

export default async (req, res) => {
  req.tickRateLimiter(1000);
  const userlvl = req.user?.userlvl || 0;

  res.removeHeader('Expires');
  res.set('Cache-Control', 'private, max-age=5');

  res.json({
    columnIds: ['time', 'name', 'description', 'type'],
    types: ['ts', 'user', 'mdstring', 'hidden'],
    uniqueColumnKey: 0,
    rows: await ModtoolsLogger.printLogs(userlvl),
  });
};
