/*
 * delete a faction
 */
import logger from '../../core/logger.js';
import socketEvents from '../../socket/socketEvents.js';
import { deleteFaction } from '../../data/sql/Faction.js';
import { CHANNEL_TYPES } from '../../core/constants.js';

export default async function factiondelete(req, res) {
  req.tickRateLimiter(10000);
  const { ttag: { t }, user, body: { name } } = req;

  if (!name || typeof name !== 'string') {
    throw new Error('No faction given');
  }

  const [
    deleteRet, factionChannelId, affectedUsers, affectedActiveFactionUsers,
  ] = await deleteFaction(user.id, name);
  switch (deleteRet) {
    case 0:
      break;
    case 1:
      throw new Error('This faction does not exist');
    case 2:
      throw new Error('You are not a member of this faction');
    case 3:
      throw new Error('Insufficient permissions on this faction');
    default:
      throw new Error(t`Server Error`);
  }

  const profilePatch = {
    op: 'del',
    path: `factions[name:${name}]`,
  };
  const patches = [['profile', profilePatch]];

  if (factionChannelId) {
    const chatPatch = {
      op: 'del',
      path: `channels.${CHANNEL_TYPES.FACTION}[0:${factionChannelId}]`,
    };
    socketEvents.patchUserState(user.id, 'chat', chatPatch);
    patches.push(['chat', chatPatch]);
  }

  if (affectedActiveFactionUsers.length) {
    const activeProfilePatch = {
      op: 'set',
      path: 'activeFactionRole',
      value: null,
    };
    socketEvents.patchUserState(
      affectedActiveFactionUsers, 'profile', activeProfilePatch,
    );
    if (affectedActiveFactionUsers.includes(user.id)) {
      patches.push(['profile', activeProfilePatch]);
    }
  }
  if (affectedUsers.length) {
    socketEvents.patchUserState(affectedUsers, 'profile', profilePatch);
  }

  logger.info(`User ${user.id} deleted faction ${name}`);
  res.json({
    status: 'ok',
    patches,
  });
}
