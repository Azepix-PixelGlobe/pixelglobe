/*
 * create a faction
 */
import logger from '../../core/logger.js';
import { deleteInvite } from '../../data/sql/Faction.js';

export default async function factioninvitecreate(req, res) {
  req.tickRateLimiter(7000);
  const { ttag: { t }, user, body: { id } } = req;

  if (!id || typeof id !== 'string') {
    throw new Error('No invite id given');
  }

  const deleteRet = await deleteInvite(
    user.id, id,
  );
  switch (deleteRet) {
    case 0:
      break;
    case 1:
      throw new Error('This invite does not exist');
    case 2:
      throw new Error('You are not a member of this faction');
    case 3:
      throw new Error('Insufficient permissions on this faction');
    default:
      throw new Error(t`Server Error`);
  }

  logger.info(`User ${user.id} deleted faction invite ${id}`);
  res.json({
    status: 'ok',
  });
}
