/*
 * close a session
 */
import { removeConsentById } from '../../../data/sql/OIDC.js';

export default async (req, res) => {
  const { user: { id: uid }, body: { id }, ttag: { t } } = req;

  const success = await removeConsentById(id, uid);

  if (!success) {
    throw new Error(t`Could not close this Session.`);
  }

  res.status(200).json({ success: true });
};
