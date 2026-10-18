/*
 * print information of public chat channels
 */
import chatProvider from '../../core/ChatProvider.js';

export default async function pubchannels(req, res) {
  req.tickRateLimiter(3000);

  res.status(200).json(chatProvider.getPublicChannels());
}
