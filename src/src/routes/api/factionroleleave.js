/*
 * remove user from a faction role,
 */
import logger from '../../core/logger.js';
import socketEvents from '../../socket/socketEvents.js';
import { leaveFactionRole } from '../../data/sql/Faction.js';

export default async function factionroleleave(req, res) {
  req.tickRateLimiter(500);
  const { ttag: { t }, user, body: { frid, uid } } = req;

  if (!frid || typeof frid !== 'string') {
    throw new Error('No faction role given');
  }
  if (typeof uid !== 'number' || !Number.isInteger(uid)) {
    throw new Error('No user given');
  }

  const [
    leaveRet, hadRoleActive, factionName,
  ] = await leaveFactionRole(user.id, uid, frid);
  switch (leaveRet) {
    case 0:
      break;
    case 1:
      throw new Error('This faction or faction role does not exist');
    case 2:
      throw new Error('You are not a member of this faction');
    case 3:
      throw new Error('Insufficient permissions on this faction');
    case 4:
      throw new Error('User is not a member');
    case 5:
      throw new Error(t`Can not modify user equal to you or above you`);
    case 6:
      throw new Error(t`Can not orphan a faction`);
    default:
      throw new Error(t`Server Error`);
  }

  const profilePatch = {
    op: 'set',
    path: `factions[name:${factionName}].roles[frid:${frid}].isMember`,
    value: false,
  };
  socketEvents.patchUserState(uid, 'profile', profilePatch);

  if (hadRoleActive) {
    const activeProfilePatch = {
      op: 'set',
      path: 'activeFactionRole',
      value: null,
    };
    socketEvents.patchUserState(uid, 'profile', activeProfilePatch);
  }

  logger.info(`User ${user.id} removed role ${frid} from ${uid}`);
  res.json({
    status: 'ok',
  });
}
