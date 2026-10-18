/*
 * leave a faction
 */
import logger from '../../core/logger.js';
import socketEvents from '../../socket/socketEvents.js';
import { getFactionInfo, leaveFaction } from '../../data/sql/Faction.js';
import { CHANNEL_TYPES } from '../../core/constants.js';

export default async function factionleave(req, res) {
  req.tickRateLimiter(2000);
  const { ttag: { t }, user, body: { name } } = req;

  if (!name || typeof name !== 'string') {
    throw new Error('No faction given');
  }

  const [[leaveRet, hadRoleActive], factionInfo] = await Promise.all([
    leaveFaction(user.id, name),
    getFactionInfo(name),
  ]);
  switch (leaveRet) {
    case 0:
      break;
    case 1:
      throw new Error(t`This faction does not exist`);
    case 2:
      /* t: when leaving a faction and you are the last owner */
      throw new Error(t`Can not orphan a faction`);
    default:
      throw new Error(t`Server Error`);
  }
  if (!factionInfo) {
    throw new Error(t`This faction does not exist`);
  }

  const patches = [];
  if (factionInfo.channelId) {
    const chatPatch = {
      op: 'del',
      path: `channels.${CHANNEL_TYPES.FACTION}[0:${factionInfo.channelId}]`,
    };
    socketEvents.patchUserState(user.id, 'chat', chatPatch);
    patches.push(['chat', chatPatch]);
  }

  const profilePatch = {
    op: 'del',
    path: `factions[name:${name}]`,
    value: factionInfo,
  };
  socketEvents.patchUserState(user.id, 'profile', profilePatch);
  patches.push(['profile', profilePatch]);

  if (hadRoleActive) {
    const activeProfilePatch = {
      op: 'set',
      path: 'activeFactionRole',
      value: null,
    };
    socketEvents.patchUserState(user.id, 'profile', activeProfilePatch);
    patches.push(['profile', activeProfilePatch]);
  }

  logger.info(`User ${user.id} left faction ${name}`);
  res.json({
    status: 'ok',
    patches,
  });
}
