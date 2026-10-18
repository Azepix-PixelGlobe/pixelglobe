/*
 * change faction settings
 *
 */
import logger from '../../core/logger.js';
import socketEvents from '../../socket/socketEvents.js';
import {
  validateFactionTitle, validateDescription,
} from '../../utils/validation.js';
import {
  getFactionLvlOfUser, getAllMembersOfFaction,
  setFlagOfFaction, setFactionProperty, setFactionAvatar,
} from '../../data/sql/Faction.js';
import { getMediaType } from '../../data/sql/Media.js';
import { FACTION_PERMISSIONS, FACTION_FLAGS } from '../../core/constants.js';

export default async function factionchange(req, res) {
  req.tickRateLimiter(7000);
  const { ttag: { gettext, t }, user, body: factionData } = req;
  const { isPrivate, isPublic, avatarId, name } = factionData;

  if (!name || typeof name !== 'string') {
    throw new Error('No faction given');
  }

  const { sqlFid, powerlvl } = await getFactionLvlOfUser(user.id, name);
  if (!sqlFid) {
    throw new Error('This faction does not exist or you are not a member');
  }
  if (!powerlvl || powerlvl < FACTION_PERMISSIONS.EDIT_FACTION) {
    throw new Error('Insufficient permissions on this faction');
  }

  let { title, description } = factionData;

  let changed = false;
  const factionChanges = {};

  if (typeof isPrivate === 'boolean') {
    changed = true;
    factionChanges.isPrivate = isPrivate;
    const success = await setFlagOfFaction(
      name, FACTION_FLAGS.PRIV, isPrivate,
    );
    if (!success) {
      throw new Error('Could not set this factions private property');
    }
    logger.info(
      `AUTH: Changed faction ${name} private to ${isPrivate} by ${user.id}`,
    );
  }

  if (typeof isPublic === 'boolean') {
    changed = true;
    factionChanges.isPublic = isPublic;
    const success = await setFlagOfFaction(
      name, FACTION_FLAGS.PUBLIC, isPublic,
    );
    if (!success) {
      throw new Error('Could not set this factions public property');
    }
    logger.info(
      `AUTH: Changed faction ${name} public to ${isPublic} by ${user.id}`,
    );
  }

  if (typeof title === 'string') {
    changed = true;

    title = title.trim();
    const error = validateFactionTitle(title);
    if (error) {
      throw new Error(gettext(error));
    }
    factionChanges.title = title;
    const success = await setFactionProperty(sqlFid, 'title', title);
    if (!success) {
      throw new Error('Title could not be set.');
    }
    logger.info(
      `AUTH: Changed factions title for  ${name} to ${title} by ${user.id}`,
    );
  }

  if (typeof description === 'string') {
    changed = true;

    description = description.trim();
    const error = validateDescription(description);
    if (error) {
      throw new Error(gettext(error));
    }
    factionChanges.description = description;
    const success = await setFactionProperty(
      sqlFid, 'description', description,
    );
    if (!success) {
      throw new Error('Description could not be set.');
    }
    logger.info(
      // eslint-disable-next-line max-len
      `AUTH: Changed factions description for ${name} to ${description} by ${user.id}`,
    );
  }

  if (typeof avatarId === 'string' || avatarId === null) {
    changed = true;
    factionChanges.avatarId = avatarId;
    if (avatarId) {
      const isLegitMedia = await getMediaType(avatarId) === 'image';
      if (!isLegitMedia) {
        throw new Error(t`Avatar can only be an image`);
      }
    }
    const success = await setFactionAvatar(sqlFid, avatarId);
    if (!success) {
      throw new Error(t`Could not set this factions avatar`);
    }
    logger.info(
      `AUTH: Changed faction ${name} avatar to ${avatarId} by ${user.id}`,
    );
  }

  if (!changed) {
    throw new Error('You did not define anything to change');
  }

  const affectedUserIds = await getAllMembersOfFaction(sqlFid);
  if (affectedUserIds.length) {
    const changedKeys = Object.keys(factionChanges);
    for (let i = 0; i < changedKeys.length; i += 1) {
      const key = changedKeys[i];
      const value = factionChanges[key];
      socketEvents.patchUserState(affectedUserIds, 'profile', {
        op: 'setex',
        path: `factions[name:${name}].${key}`,
        value,
      });
    }
  }

  res.json({
    status: 'ok',
  });
}
