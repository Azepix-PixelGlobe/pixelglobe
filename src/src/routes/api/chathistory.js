/*
 *
 * returns chat messages of given channel
 *
 */
import chatProvider from '../../core/ChatProvider.js';
import { markChannelsRead } from '../../data/sql/Channel.js';
import socketEvents from '../../socket/socketEvents.js';
import { CHANNEL_TYPES } from '../../core/constants.js';

async function chatHistory(req, res) {
  req.tickRateLimiter(1000);

  let { cid, limit } = req.query;

  if (!cid || !limit) {
    res.status(400);
    res.json({
      errors: ['cid or limit not defined'],
    });
    return;
  }
  cid = parseInt(cid, 10);
  limit = parseInt(limit, 10);
  if (Number.isNaN(cid) || Number.isNaN(limit)
    || limit <= 0 || limit > 200) {
    res.status(400);
    res.json({
      errors: ['cid or limit not a valid value'],
    });
    return;
  }

  const isPublicChannel = chatProvider.isPublicChannel(cid);
  if (!isPublicChannel && !req.user?.hasChannel(cid)) {
    res.status(403);
    res.json({
      errors: ['You don\'t have access to this channel'],
    });
    if (req.user) {
      /*
      * channel could be a desync, tell user that he doesn't have this channel
      */
      socketEvents.patchUserState(req.user.id, 'chat', {
        op: 'del',
        path: `channels.${CHANNEL_TYPES.DM}[0:${cid}]`,
      });
    }
    return;
  }

  const promises = [
    chatProvider.getHistory(cid, limit),
  ];
  if (!isPublicChannel) {
    promises.push(markChannelsRead(cid, req.user.id));
  }
  const [history] = await Promise.all(promises);
  res.json({
    history,
  });
}

export default chatHistory;
