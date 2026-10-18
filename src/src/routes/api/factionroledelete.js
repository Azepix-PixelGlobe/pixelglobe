/*
 * delete a faction role
 */
import logger from '../../core/logger.js';
import socketEvents from '../../socket/socketEvents.js';
import { deleteFactionRole } from '../../data/sql/Faction.js';

export default async function factionroledelete(req, res) {
  req.tickRateLimiter(10000);
  const { ttag: { t }, user, body: { frid } } = req;

  if (!frid || typeof frid !== 'string') {
    throw new Error('No faction role given');
  }

  const [
    deleteRet, factionName, affectedUsers, affectedActiveRoleUsers,
  ] = await deleteFactionRole(user.id, frid);
  switch (deleteRet) {
    case 0:
      break;
    case 1:
      throw new Error('This faction or faction role does not exist');
    case 2:
      throw new Error('Can not delete the Sovereign');
    case 3:
      throw new Error(t`Can not delete this role`);
    case 4:
      throw new Error('You are not a member of this faction');
    case 5:
      throw new Error('Insufficient permissions on this faction');
    case 6:
      throw new Error(t`Can not change a role above your own`);
    case 7:
      throw new Error(t`Can not delete a role on the same level as yours`);
    default:
      throw new Error(t`Server Error`);
  }

  const profilePatch = {
    op: 'del',
    path: `factions[name:${factionName}].roles[frid:${frid}]`,
  };
  const patches = [['profile', profilePatch]];

  if (affectedActiveRoleUsers.length) {
    const activeProfilePatch = {
      op: 'set',
      path: 'activeFactionRole',
      value: null,
    };
    socketEvents.patchUserState(
      affectedActiveRoleUsers, 'profile', activeProfilePatch,
    );
    if (affectedActiveRoleUsers.includes(user.id)) {
      patches.push(['profile', activeProfilePatch]);
    }
  }
  if (affectedUsers.length) {
    socketEvents.patchUserState(affectedUsers, 'profile', profilePatch);
  }

  logger.info(`User ${user.id} deleted faction role ${frid}`);
  res.json({
    status: 'ok',
    patches,
  });
}
