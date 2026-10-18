/*
 * unban user from faction
 */
import logger from '../../core/logger.js';
import {
  getFactionLvlOfUser, unbanFromFaction,
} from '../../data/sql/Faction.js';
import { FACTION_PERMISSIONS } from '../../core/constants.js';

export default async function factionunban(req, res) {
  req.tickRateLimiter(7000);
  const { ttag: { t }, user, body: { fbid, factionName } } = req;

  if (!factionName || typeof factionName !== 'string') {
    throw new Error('No faction given');
  }
  if (!fbid || typeof fbid !== 'string') {
    throw new Error('No ban id given');
  }

  const { sqlFid, powerlvl } = await getFactionLvlOfUser(user.id, factionName);
  if (!sqlFid) {
    throw new Error('This faction does not exist or you are not a member');
  }
  if (!powerlvl || powerlvl < FACTION_PERMISSIONS.UNBAN) {
    throw new Error('Insufficient permissions on this faction');
  }

  const success = await unbanFromFaction(factionName, fbid);
  if (!success) {
    throw new Error(t`This faction does not exist`);
  }

  logger.info(`User ${user.id} removed ${fbid} from faction ${factionName}`);
  res.json({
    status: 'ok',
  });
}
