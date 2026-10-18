/*
 * logout
 */

import { AuthLogger } from '../../../core/logger.js';
import socketEvents from '../../../socket/socketEvents.js';
import { closeSession } from '../../../middleware/session.js';

export default async (req, res) => {
  const { user } = req;

  AuthLogger.logout(user);

  await closeSession(req, res);

  socketEvents.reloadUser(user.id);

  res.status(200);
  res.json({
    success: true,
  });
};
