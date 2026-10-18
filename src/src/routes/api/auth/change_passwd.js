/*
 * request password change
 */

import { AuthLogger } from '../../../core/logger.js';
import socketEvents from '../../../socket/socketEvents.js';
import { validatePassword } from '../../../utils/validation.js';
import { setPassword } from '../../../data/sql/User.js';

export default async (req, res) => {
  const { body: { newPassword }, ttag: { gettext } } = req;

  const validationError = validatePassword(newPassword);
  if (validationError) {
    res.status(400).json({ errors: [gettext(validationError)] });
    return;
  }

  const { user } = req;
  await setPassword(user.id, newPassword);

  AuthLogger.changePassword(user);

  socketEvents.reloadUser(user.id);

  res.json({
    success: true,
  });
};
