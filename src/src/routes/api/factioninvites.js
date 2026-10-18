/*
 * print all informations about faction bans
 *
 */
import { getFactionLvlOfUser, getInviteInfo } from '../../data/sql/Faction.js';
import { FACTION_PERMISSIONS } from '../../core/constants.js';

export default async function factioninvites(req, res) {
  req.tickRateLimiter(5000);
  /* user can be undefined when not logged in */
  const { ttag: { t }, user, body: { name } } = req;

  if (!name || typeof name !== 'string') {
    throw new Error('No faction given');
  }

  const { sqlFid, powerlvl } = await getFactionLvlOfUser(user.id, name);

  if (!sqlFid) {
    throw new Error(t`This faction does not exist`);
  }
  if (!powerlvl || powerlvl < FACTION_PERMISSIONS.MANAGE_INVITES) {
    throw new Error('Insufficient permissions on this faction');
  }

  const invites = await getInviteInfo(sqlFid);
  if (!invites) {
    throw new Error(t`Server Error`);
  }

  /*
    * [{
    *   id,
    *   isOneTime,
    *   createdAt,
    * }, ...]
    */
  res.json(invites);
}
