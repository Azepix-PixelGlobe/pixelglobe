/*
 * create a faction invite
 */
import logger from '../../core/logger.js';
import { createInvite } from '../../data/sql/Faction.js';

export default async function factioninvitecreate(req, res) {
  req.tickRateLimiter(7000);
  const { ttag: { t }, user, body: factionInviteData } = req;
  const { factionName } = factionInviteData;

  if (!factionName || typeof factionName !== 'string') {
    throw new Error('No faction given');
  }

  let { isOneTime } = factionInviteData;
  isOneTime = !!isOneTime;

  const [createRet, inviteId] = await createInvite(
    user.id, factionName, isOneTime,
  );
  switch (createRet) {
    case 0:
      break;
    case 1:
      throw new Error('This faction does not exist');
    case 2:
      throw new Error('You are not a member of this faction');
    case 3:
      throw new Error('Insufficient permissions on this faction');
    case 4:
      throw new Error(t`Can not have more than 20 invites per faction`);
    default:
      throw new Error(t`Server Error`);
  }

  logger.info(`User ${user.id} created new faction invite ${inviteId}`);
  res.json({
    status: 'ok',
    inviteId,
  });
}
