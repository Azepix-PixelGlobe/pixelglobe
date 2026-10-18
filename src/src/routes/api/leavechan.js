/*
 *
 * starts a DM session
 *
 */

import logger from '../../core/logger.js';
import socketEvents from '../../socket/socketEvents.js';
import {
  leaveChannel,
} from '../../data/sql/Channel.js';

async function leaveChan(req, res) {
  req.tickRateLimiter(4000);
  const channelId = parseInt(req.body.channelId, 10);
  const { user, ttag: { t } } = req;

  if (Number.isNaN(channelId)) {
    res.status(400).json({
      errors: ['Invalid channelId'],
    });
    return;
  }

  const leaveReturn = await leaveChannel(user.id, channelId);

  if (!leaveReturn) {
    res.status(401).json({
      errors: [t`Could not leave this channel`],
    });
    return;
  }

  const [affectedUsers, channelType] = leaveReturn;

  logger.info(
    `Removed user ${user.name} from channel ${channelId}`,
  );

  if (channelType) {
    for (let i = 0; i < affectedUsers.length; i += 1) {
      const chatPatch = {
        op: 'del',
        path: `channels.${channelType}[0:${channelId}]`,
      };
      socketEvents.patchUserState(affectedUsers[i], 'chat', chatPatch);
    }
  }

  res.json({ status: 'ok' });
}

export default leaveChan;
