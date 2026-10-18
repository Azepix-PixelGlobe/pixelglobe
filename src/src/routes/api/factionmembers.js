/*
 * print all informations about faction members
 *
 */
import {
  getFactionLvlOfUser, getFactionInfo, getFactionMemberInfo,
} from '../../data/sql/Faction.js';
import { FACTION_PERMISSIONS } from '../../core/constants.js';

export default async function factionrolechange(req, res) {
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

  const showHiddenUsers = powerlvl >= FACTION_PERMISSIONS.SEE_HIDDEN_USERS;
  const members = await getFactionMemberInfo(faction.sqlFid, showHiddenUsers);
  if (!members) {
    throw new Error(t`Server Error`);
  }

  /*
    * [{
    *   uid,
    *   name,
    *   username,
    *   avatarId,
    *   roles: [frid1, frid2, ...],
    * }, ...]
    */
  res.json(members);
}
