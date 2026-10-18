/*
 * join a faction
 */
import logger from '../../core/logger.js';
import socketEvents from '../../socket/socketEvents.js';
import { getFactionInfo, joinFactionPublic } from '../../data/sql/Faction.js';
import { MAX_FACTIONS_PER_USER, CHANNEL_TYPES } from '../../core/constants.js';

export default async function factionjoin(req, res) {
  req.tickRateLimiter(4000);
  const { ttag: { t }, user, ip: { ipString }, body: { name } } = req;

  if (!name || typeof name !== 'string') {
    throw new Error('No faction given');
  }

  const [joinRet, factionInfo] = await Promise.all([
    joinFactionPublic(user.id, ipString, name),
    getFactionInfo(name),
  ]);
  switch (joinRet) {
    case 0:
      break;
    case 1:
      throw new Error(t`This faction does not exist`);
    case 2:
      throw new Error(
        t`You can only have ${MAX_FACTIONS_PER_USER} factions in total`,
      );
    case 3:
      throw new Error(t`You are banned from this faction`);
    case 4:
      throw new Error(t`You are already part of this faction`);
    case 5:
      throw new Error(t`This faction is full`);
    case 6:
      throw new Error(t`You need an invite to join this faction`);
    default:
      throw new Error(t`Server Error`);
  }
  if (!factionInfo) {
    throw new Error(t`This faction does not exist`);
  }

  /*
   * turn info object into faction object for user profile
   */
  factionInfo.isHidden = user.isPrivate;
  for (let i = 0; i < factionInfo.roles.length; i += 1) {
    const role = factionInfo.roles[i];
    role.isMember = role.isDefault;
  }
  delete factionInfo.sqlFid;

  const patches = [];
  if (factionInfo.channelId) {
    const ts = Math.floor(Date.now() / 1000);
    const chatPatch = {
      op: 'addnx',
      path: `channels.${CHANNEL_TYPES.FACTION}[0:${factionInfo.channelId}]`,
      value: [
        factionInfo.channelId, factionInfo.name, ts, ts,
        false, factionInfo.avatarId,
      ],
    };
    socketEvents.patchUserState(user.id, 'chat', chatPatch);
    delete factionInfo.channelId;
    patches.push(['chat', chatPatch]);
  }

  const profilePatch = {
    op: 'pushnx',
    path: `factions[name:${name}]`,
    value: factionInfo,
  };
  socketEvents.patchUserState(user.id, 'profile', profilePatch);
  patches.push(['profile', profilePatch]);

  logger.info(`User ${user.id} joined faction ${factionInfo.name}`);
  res.json({
    status: 'ok',
    patches,
  });
}
