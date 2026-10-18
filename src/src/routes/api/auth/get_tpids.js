/*
 * get ThreePIDs and Session and OIDC consent information
 */
import { getTPIDsOfUser } from '../../../data/sql/ThreePID.js';
import { censorIdentifier } from '../../../core/utils.js';
import { generateTokenHash } from '../../../utils/hash.js';
import { getAllSessionsOfUser } from '../../../data/sql/Session.js';
import { getAllConsentsOfUser } from '../../../data/sql/OIDC.js';

export default async (req, res) => {
  const { id: userId } = req.user;
  const [tpids, sessions, consents] = await Promise.all([
    getTPIDsOfUser(userId),
    getAllSessionsOfUser(userId),
    getAllConsentsOfUser(userId),
  ]);

  for (let i = 0; i < tpids.length; i += 1) {
    const tpid = tpids[i];
    tpid.tpid = censorIdentifier(tpid.tpid);
  }

  for (let i = 0; i < sessions.length; i += 1) {
    const session = sessions[i];
    if (session.token === generateTokenHash(req.user.token)) {
      session.current = true;
    }
    if (!session.os) {
      session.os = 'Unknown';
    }
    if (!session.browser) {
      session.browser = 'Unknown';
    }
    delete session.token;
  }

  /*
   * tpids: {
   *   id, tpid, provider, verified,
   * },
   * sessions: {
   *   id, country, os, browser,
   * },
   * consents: {
   *   id, name, domain, expiresTs, image | null,
   * },
   */
  res.status(200).json({ tpids, sessions, consents });
};
