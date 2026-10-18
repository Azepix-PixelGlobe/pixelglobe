/*
 * print all informations about faction, except users
 *
 */
import {
  getFactionLvlOfUser, getFactionInfo,
} from '../../data/sql/Faction.js';
import { getFactionRanks } from '../../data/redis/ranks.js';

export default async function factioninfo(req, res) {
  req.tickRateLimiter(1000);
  /* user can be undefined when not logged in */
  const { ttag: { t }, user, body: { name } } = req;

  if (!name || typeof name !== 'string') {
    throw new Error('No faction given');
  }

  const [{ powerlvl }, faction] = await Promise.all([
    (user) ? getFactionLvlOfUser(user.id, name) : { powerlvl: null },
    getFactionInfo(name),
  ]);

  if (!faction) {
    throw new Error(t`This faction does not exist`);
  }

  if (faction.isPrivate && powerlvl === null) {
    throw new Error(t`This faction is private`);
  }

  const ranks = await getFactionRanks(faction.sqlFid);
  if (ranks) {
    const [
      totalPixels,
      dailyTotalPixels,
      ranking,
      dailyRanking,
    ] = ranks;
    faction.totalPixels = totalPixels;
    faction.dailyTotalPixels = dailyTotalPixels;
    faction.ranking = ranking;
    faction.dailyRanking = dailyRanking;
  } else {
    faction.totalPixels = 0;
    faction.dailyTotalPixels = 0;
    faction.ranking = 0;
    faction.dailyRanking = 0;
  }

  delete faction.sqlFid;
  delete faction.channelId;

  res.json({
    powerlvl,
    faction,
    myUid: user ? user.id : null,
  });
}
