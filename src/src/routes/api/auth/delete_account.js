/*
 * request password change
 */

import { AuthLogger } from '../../../core/logger.js';
import socketEvents from '../../../socket/socketEvents.js';
import { deleteUser } from '../../../data/sql/User.js';
import { getIIDofIP } from '../../../data/sql/IP.js';
import { deleteUserFromRanks } from '../../../data/redis/cooldown.js';
import { clearCookie } from '../../../middleware/session.js';

export default async (req, res) => {
  const { ttag: { t }, user, ip } = req;

  const dmChannels = await deleteUser(user.id);

  const iid = await getIIDofIP(ip.ipString);
  AuthLogger.deleteUser(user, iid, ip.country);

  if (!dmChannels) {
    res.status(500);
    res.json({
      errors: [t`Server error while deleting user.`],
    });
    return;
  }
  if (dmChannels.length) {
    dmChannels.forEach(({ dmuid }) => {
      socketEvents.reloadUser(dmuid);
    });
  }
  clearCookie(req, res);

  socketEvents.reloadUser(user.id);

  deleteUserFromRanks(user.id);

  res.json({
    success: true,
  });
};
