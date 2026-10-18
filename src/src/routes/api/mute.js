/*
 *
 * mutes and unmutes a chat channel
 *
 */

import logger from '../../core/logger.js';
import socketEvents from '../../socket/socketEvents.js';
import { setUserChannelMute } from '../../data/sql/Channel.js';

export default async function block(req, res) {
  req.tickRateLimiter(4000);
  const channelId = parseInt(req.body.channelId, 10);
  const { mute } = req.body;

  const errors = [];
  if (channelId) {
    if (channelId && Number.isNaN(channelId)) {
      errors.push('Invalid channelId');
    }
  }
  if (typeof mute !== 'boolean') {
    errors.push('Not defined if muting or unmuting');
  }
  if (!channelId) {
    errors.push('No channelId defined');
  }

  if (errors.length) {
    res.status(400).json({ errors });
    return;
  }

  const { user } = req;

  const success = await setUserChannelMute(channelId, user.id, mute);
  if (!success) {
    logger.info(`User ${user.name} failed to (un)muted ${channelId}`);
    res.status(502).json({
      errors: ['Could not (un)mute channel'],
    });
    return;
  }
  logger.info(`User ${user.name} (un)muted ${channelId}`);
  socketEvents.reloadUser(user.id);

  res.json({ status: 'ok' });
}
