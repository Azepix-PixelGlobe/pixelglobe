/*
 * change faction role settings
 *
 */
import logger from '../../core/logger.js';
import socketEvents from '../../socket/socketEvents.js';
import { validateFactionName } from '../../utils/validation.js';
import {
  getFactionLvlOfUser, getAllMembersOfFaction,
  getFactionRole, setFactionRoleFlag, setFactionRoleProperty,
  setFlagOfFactionRole,
} from '../../data/sql/Faction.js';
import { getMediaDimensions } from '../../data/sql/Media.js';
import {
  FACTION_PERMISSIONS, FACTION_ROLE_FLAGS,
} from '../../core/constants.js';

export default async function factionrolechange(req, res) {
  req.tickRateLimiter(7000);
  const { ttag: { t, gettext }, user, body: factionRoleData } = req;
  const { frid, customFlagId, factionlvl, isDefault } = factionRoleData;

  if (!frid || typeof frid !== 'string') {
    throw new Error('No faction role given');
  }

  const {
    factionName, sqlFrid, factionlvl: cFactionlvl, isProtected,
  } = await getFactionRole(frid);

  if (!factionName || !sqlFrid) {
    throw new Error('This faction or faction role does not exist');
  }

  const { sqlFid, powerlvl } = await getFactionLvlOfUser(user.id, factionName);
  if (!sqlFid) {
    throw new Error('This faction does not exist or you are not a member');
  }
  if (!powerlvl || powerlvl < FACTION_PERMISSIONS.EDIT_ROLES) {
    throw new Error('Insufficient permissions on this faction');
  }
  if (cFactionlvl > powerlvl) {
    throw new Error(t`Can not change a role above your own`);
  }
  if (powerlvl < FACTION_PERMISSIONS.MANAGE_YOURSELF
    && cFactionlvl === powerlvl
  ) {
    throw new Error(t`Can not change a role that is equal to your own`);
  }

  const { name } = factionRoleData;

  let changed = false;
  const factionRoleChanges = {};

  if (typeof isDefault === 'boolean') {
    changed = true;
    factionRoleChanges.isDefault = isDefault;
    if (isProtected) {
      throw new Error(t`Can not change the default setting of this role`);
    }
    const success = await setFlagOfFactionRole(
      sqlFrid, FACTION_ROLE_FLAGS.DEFAULT, isDefault,
    );
    if (!success) {
      throw new Error('Could not set this faction roles default property');
    }
    logger.info(
      // eslint-disable-next-line max-len
      `AUTH: Changed faction role ${frid} default to ${isDefault} by ${user.id}`,
    );
  }

  if (typeof factionlvl === 'number') {
    changed = true;
    factionRoleChanges.factionlvl = factionlvl;
    if (cFactionlvl >= FACTION_PERMISSIONS.SOVEREIGN) {
      throw new Error(t`Can not change the powerlevel of the Sovereign`);
    }
    if (cFactionlvl >= powerlvl) {
      throw new Error(
        t`Can not change the powerlevel of a role equal or above you`,
      );
    }
    if (factionlvl >= powerlvl) {
      if (factionlvl > powerlvl) {
        throw new Error(
          t`Can not elevate the powerlevel of a role beyond yours`,
        );
      }
      if (factionlvl === FACTION_PERMISSIONS.SOVEREIGN) {
        throw new Error(
          t`Can only have one Sovereign role`,
        );
      }
      if (powerlvl < FACTION_PERMISSIONS.MANAGE_YOURSELF) {
        throw new Error(
          t`Can not elevate the powerlevel of a role to yours`,
        );
      }
    }
    if (factionlvl > 127 || factionlvl < -128) {
      throw new Error('Invalid powerlevel');
    }
    const success = await setFactionRoleProperty(
      sqlFrid, 'factionlvl', factionlvl,
    );
    if (!success) {
      throw new Error('Could not set this roles powerlevel');
    }
    logger.info(
      // eslint-disable-next-line max-len
      `AUTH: Changed faction role ${frid} powerlevel to ${factionlvl} by ${user.id}`,
    );
  }

  if (typeof name === 'string') {
    changed = true;

    const error = validateFactionName(name);
    if (error) {
      throw new Error(gettext(error));
    }
    factionRoleChanges.name = name;
    const success = await setFactionRoleProperty(sqlFrid, 'name', name);
    if (!success) {
      throw new Error('Could not set name');
    }
    logger.info(
      `AUTH: Changed faction role name for ${frid} to ${name} by ${user.id}`,
    );
  }

  if (customFlagId === null || typeof customFlagId === 'string') {
    changed = true;
    factionRoleChanges.customFlagId = customFlagId;
    if (customFlagId) {
      const mediaInfo = await getMediaDimensions(customFlagId);
      if (mediaInfo?.type !== 'image') {
        throw new Error(t`Role flag can only be an image`);
      }
      if (mediaInfo.width !== 16 || mediaInfo.height !== 11) {
        throw new Error(t`Role flag needs to be 16x11`);
      }
    }
    const success = await setFactionRoleFlag(sqlFrid, customFlagId);
    if (!success) {
      throw new Error(t`Could not change the flag of this role`);
    }
    logger.info(
      // eslint-disable-next-line max-len
      `AUTH: Changed faction role ${frid} flag to ${customFlagId} by ${user.id}`,
    );
  }

  if (!changed) {
    throw new Error('You did not define anything to change');
  }

  const affectedUserIds = await getAllMembersOfFaction(sqlFid);
  if (affectedUserIds.length) {
    const changedKeys = Object.keys(factionRoleChanges);
    for (let i = 0; i < changedKeys.length; i += 1) {
      const key = changedKeys[i];
      const value = factionRoleChanges[key];
      socketEvents.patchUserState(user.id, 'profile', {
        op: 'setex',
        path: `factions[name:${factionName}].roles[frid:${frid}].${key}`,
        value,
      });
    }
  }

  res.json({
    status: 'ok',
  });
}
