/*
 * print all informations about user
 *
 */
import { getFishesOfUser, getBadgesOfUser } from '../../data/sql/Goodies.js';
import { getUserInfo } from '../../data/sql/User.js';
import { getUserRanks } from '../../data/redis/ranks.js';

export default async function userinfo(req, res) {
  req.tickRateLimiter(1000);
  /* user can be undefined when not logged in */
  const { ttag: { t }, body: { uidOrUsername } } = req;

  if (!uidOrUsername || (
    typeof uidOrUsername !== 'string' && typeof uidOrUsername !== 'number'
  )) {
    throw new Error('No user given');
  }

  const userData = await getUserInfo(uidOrUsername);

  if (!userData) {
    throw new Error('No such user exists');
  }
  if (userData.isPrivate) {
    throw new Error(t`This user is private`);
  }

  const { uid } = userData;

  const [fishes, badges, ranks] = await Promise.all([
    getFishesOfUser(uid),
    getBadgesOfUser(uid),
    getUserRanks(uid),
  ]);
  userData.fishes = fishes;
  userData.badges = badges;

  if (ranks) {
    const [
      totalPixels,
      dailyTotalPixels,
      ranking,
      dailyRanking,
    ] = ranks;
    userData.totalPixels = totalPixels;
    userData.dailyTotalPixels = dailyTotalPixels;
    userData.ranking = ranking;
    userData.dailyRanking = dailyRanking;
  } else {
    userData.totalPixels = 0;
    userData.dailyTotalPixels = 0;
    userData.ranking = 0;
    userData.dailyRanking = 0;
  }

  res.json(userData);
}
