/*
 * create a faction
 */
import logger from '../../core/logger.js';
import socketEvents from '../../socket/socketEvents.js';
import { validateFactionName } from '../../utils/validation.js';
import {
  getFactionLvlOfUser, getAllMembersOfFaction, createFactionRole,
} from '../../data/sql/Faction.js';
import {
  FACTION_PERMISSIONS,
  MAX_ROLES_PER_FACTION,
} from '../../core/constants.js';

export default async function factionrolecreate(req, res) {
  req.tickRateLimiter(7000);
  const { ttag: { gettext, t }, user, body: factionRoleData } = req;
  const { customFlagId, factionName, factionlvl, name } = factionRoleData;

  if (!factionName || typeof factionName !== 'string') {
    throw new Error('No faction given');
  }

  let { isDefault } = factionRoleData;
  isDefault = !!isDefault;

  const { sqlFid, powerlvl } = await getFactionLvlOfUser(user.id, factionName);
  if (!sqlFid) {
    throw new Error('This faction does not exist or you are not a member');
  }
  if (!powerlvl || powerlvl < FACTION_PERMISSIONS.CREATE_ROLES) {
    throw new Error('Insufficient permissions on this faction');
  }

  const errors = [];
  const error = gettext(validateFactionName(name));
  if (error) errors.push(error);
  if (typeof factionlvl !== 'number') {
    errors.push('Must define a factionlvl');
  }
  if (typeof customFlagId !== 'string' && customFlagId !== null) {
    errors.push('Must define a customFlagId');
  }
  if (factionlvl > 127 || factionlvl < -128) {
    errors.push('Invalid factionlvl');
  }
  if (factionlvl >= powerlvl) {
    if (factionlvl > powerlvl) {
      errors.push(t`Can not create a role with a powerlevel beyond yours`);
    }
    if (factionlvl === FACTION_PERMISSIONS.SOVEREIGN) {
      errors.push(t`Can only have one Sovereign role`);
    }
    if (powerlvl < FACTION_PERMISSIONS.MANAGE_YOURSELF) {
      errors.push(t`Can not create a role on the same level as yours`);
    }
  }

  if (errors.length) {
    res.status(400).json({ errors });
    return;
  }

  const [createRet, frid] = await createFactionRole(
    factionName, name, factionlvl, customFlagId, isDefault,
  );
  switch (createRet) {
    case 0:
      break;
    case 1:
      throw new Error('This faction does not exist');
    case 2:
      throw new Error('Invalid customFlagId');
    case 3:
      throw new Error(
        t`Can not have more than ${MAX_ROLES_PER_FACTION} faction roles`,
      );
    default:
      throw new Error(t`Server Error`);
  }

  const profilePatch = {
    op: 'add',
    path: `factions[name:${factionName}].roles`,
    value: { frid, name, customFlagId, factionlvl, isMember: false },
  };

  const affectedUserIds = await getAllMembersOfFaction(sqlFid);
  if (affectedUserIds.length) {
    socketEvents.patchUserState(user.id, 'profile', profilePatch);
  }

  logger.info(`User ${user.id} created new faction role ${name}`);
  res.json({
    status: 'ok',
    frid,
    patches: [['profile', profilePatch]],
  });
}
