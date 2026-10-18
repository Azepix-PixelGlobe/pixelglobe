/*
 * use invite to join faction
 */
import logger from '../../core/logger.js';
import socketEvents from '../../socket/socketEvents.js';
import { getFactionInfo, consumeInvite } from '../../data/sql/Faction.js';
import { MAX_FACTIONS_PER_USER, CHANNEL_TYPES } from '../../core/constants.js';

export default async function factioninvitecreate(req, res) {
  req.tickRateLimiter(4000);
  const { ttag: { t }, user, ip: { ipString }, body: { id } } = req;

  if (!id || typeof id !== 'string') {
    throw new Error('No invite id given');
  }

  const [deleteRet, factionName] = await consumeInvite(
    user.id, ipString, id,
  );
  switch (deleteRet) {
    case 0:
      break;
    case 1:
      throw new Error('This invite does not exist');
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
  const factionInfo = await getFactionInfo(factionName);

  if (!factionInfo) {
    throw new Error(t`Server Error`);
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
    const chatPatch = {
      op: 'addnx',
      path: `channels.${CHANNEL_TYPES.FACTION}[0:${factionInfo.channelId}]`,
      value: [
        factionInfo.channelId, factionName, Date.now(), Date.now(),
        false, factionInfo.avatarId,
      ],
    };
    socketEvents.patchUserState(user.id, 'chat', chatPatch);
    delete factionInfo.channelId;
    patches.push(['chat', chatPatch]);
  }

  const profilePatch = {
    op: 'pushnx',
    path: `factions[name:${factionName}]`,
    value: factionInfo,
  };
  socketEvents.patchUserState(user.id, 'profile', profilePatch);
  patches.push(['profile', profilePatch]);

  logger.info(`User ${user.id} joined faction ${factionName}`);
  res.json({
    status: 'ok',
    patches,
  });
}
