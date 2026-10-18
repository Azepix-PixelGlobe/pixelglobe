/*
 * close a session
 */
import { removeSessionById } from '../../../data/sql/Session.js';
import socketEvents from '../../../socket/socketEvents.js';

export default async (req, res) => {
  const { user, body: { id }, ttag: { t } } = req;

  const success = await removeSessionById(id, user.id);

  if (!success) {
    throw new Error(t`Could not close this Session.`);
  }

  socketEvents.reloadUser(user.id);

  res.status(200).json({ success: true });
};
