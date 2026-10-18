/*
 * print informations about invite
 */
import { getInviteData } from '../../data/sql/Faction.js';

export default async function factioninfo(req, res) {
  req.tickRateLimiter(1000);
  const { body: { id } } = req;

  if (!id || typeof id !== 'string') {
    throw new Error('No invite id given');
  }

  const inviteData = await getInviteData(id);
  if (!inviteData) {
    throw new Error(
      'Invite could not be found, is expired or got used already',
    );
  }

  res.json(inviteData);
}
