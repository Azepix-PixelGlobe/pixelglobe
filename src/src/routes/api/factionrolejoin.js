/*
 * add user to a faction role,
 */
import logger from '../../core/logger.js';
import socketEvents from '../../socket/socketEvents.js';
import {
  getFactionRole, joinFactionRole, getFactionLvlOfUser,
} from '../../data/sql/Faction.js';
import { FACTION_PERMISSIONS } from '../../core/constants.js';

export default async function factionrolejoin(req, res) {
  req.tickRateLimiter(500);
  const { ttag: { t }, user, body: { frid, uid } } = req;

  if (!frid || typeof frid !== 'string') {
    throw new Error('No faction role given');
  }
  if (typeof uid !== 'number' || !Number.isInteger(uid)) {
    throw new Error('No user given');
  }

  const {
    factionName, sqlFrid, factionlvl: cFactionlvl,
  } = await getFactionRole(frid);

  if (!factionName || !sqlFrid) {
    throw new Error('This faction or faction role does not exist');
  }

  const [
    { sqlFid, powerlvl: ownPowerlvl },
    { sqlFid: sqlTargetFid, powerlvl: targetPowerlvl },
  ] = await Promise.all([
    getFactionLvlOfUser(user.id, factionName),
    getFactionLvlOfUser(uid, factionName),
  ]);
  if (!sqlFid) {
    throw new Error('This faction does not exist or you are not a member');
  }
  if (!sqlTargetFid) {
    throw new Error('User is not a member');
  }
  if (!ownPowerlvl || ownPowerlvl < FACTION_PERMISSIONS.ASSIGN_ROLES) {
    throw new Error('Insufficient permissions on this faction');
  }
  if (targetPowerlvl >= ownPowerlvl
    && uid !== user.id
  ) {
    throw new Error(t`Can not modify user equal to you or above you`);
  }
  if (cFactionlvl > ownPowerlvl) {
    throw new Error(t`Can not change a role above your own`);
  }
  if (cFactionlvl === ownPowerlvl
    && ownPowerlvl < FACTION_PERMISSIONS.MANAGE_YOURSELF
  ) {
    throw new Error(t`Can not change a role that is equal to your own`);
  }

  const success = await joinFactionRole(sqlFrid, uid);
  if (!success) {
    throw new Error(t`Server Error`);
  }

  const profilePatch = {
    op: 'set',
    path: `factions[name:${factionName}].roles[frid:${frid}].isMember`,
    value: true,
  };
  socketEvents.patchUserState(uid, 'profile', profilePatch);

  logger.info(`User ${user.id} joined ${uid} to role ${frid}`);
  res.json({
    status: 'ok',
  });
}
