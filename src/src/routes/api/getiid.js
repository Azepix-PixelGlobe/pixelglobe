/*
 * tell user his own IID
 */
import { getIIDofIP } from '../../data/sql/IP.js';

export default async function getiid(req, res) {
  req.tickRateLimiter(3000);

  const iid = await getIIDofIP(req.ip.ipString);
  if (!iid) {
    throw new Error('Could not get IID');
  }

  res.status(200).json({ iid });
}
