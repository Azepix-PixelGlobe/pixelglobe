/*
 * kick / ban user from faction
 */
import logger from '../../core/logger.js';
import socketEvents from '../../socket/socketEvents.js';
import {
  getFactionInfo, leaveFaction, getFactionLvlOfUser, banUserFromFaction,
} from '../../data/sql/Faction.js';
import { deleteUserChannelMessages } from '../../data/sql/Message.js';
import { getLastIPOfUser } from '../../data/sql/User.js';
import {
  FACTION_PERMISSIONS, CHANNEL_TYPES,
} from '../../core/constants.js';

export default async function factionkickban(req, res) {
  req.tickRateLimiter(7000);
  const { ttag: { t }, user, body: { factionName, uid, isBan } } = req;

  if (!factionName || typeof factionName !== 'string') {
    throw new Error('No faction given');
  }
  if (typeof uid !== 'number' || !Number.isInteger(uid)) {
    throw new Error('No user given');
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
  if (!ownPowerlvl
    || (ownPowerlvl < FACTION_PERMISSIONS.KICK && !isBan)
    || ownPowerlvl < FACTION_PERMISSIONS.BAN
  ) {
    throw new Error('Insufficient permissions on this faction');
  }
  if (targetPowerlvl >= ownPowerlvl) {
    throw new Error(t`Can not modify user equal to you or above you`);
  }

  const lastOnlineIPString = await getLastIPOfUser(uid);

  const [[leaveRet, hadRoleActive], factionInfo] = await Promise.all([
    leaveFaction(uid, factionName),
    getFactionInfo(factionName),
  ]);
  switch (leaveRet) {
    case 0:
      break;
    case 1:
      throw new Error(t`This faction does not exist`);
    case 2:
      /* t: when leaving a faction and it is the last owner */
      throw new Error(t`Can not orphan a faction`);
    default:
      throw new Error(t`Server Error`);
  }
  if (!factionInfo) {
    throw new Error(t`This faction does not exist`);
  }

  if (isBan) {
    let { reason, durationMs: duration } = req.body;
    if (typeof reason !== 'string') {
      throw new Error('No reason given');
    }
    reason = reason.trim();
    if (reason.length > 200) {
      throw new Error('Reason can only have 200 characters');
    }
    if (typeof duration === 'number') {
      duration = Math.ceil(duration / 1000);
    } else {
      /* default to perma ban */
      duration = null;
    }

    const success = await banUserFromFaction(
      factionInfo.sqlFid, uid, lastOnlineIPString, reason, duration, user.id,
    );
    if (!success) {
      throw new Error(t`Server Error`);
    }
  }

  let chatPatch;
  if (factionInfo.channelId) {
    const { channelId } = factionInfo;
    chatPatch = {
      op: 'del',
      path: `channels.${CHANNEL_TYPES.FACTION}[0:${channelId}]`,
    };
    socketEvents.patchUserState(uid, 'chat', chatPatch);
    await deleteUserChannelMessages(uid, channelId);
    socketEvents.broadcastUserChannelMessageDeletion(uid, channelId);
  }

  const profilePatch = {
    op: 'del',
    path: `factions[name:${factionName}]`,
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

  logger.info(
    // eslint-disable-next-line max-len
    `User ${uid} ${(isBan) ? 'banned' : 'kicked'} ${uid} from faction ${factionInfo.name}`,
  );
  res.json({
    status: 'ok',
  });
}
