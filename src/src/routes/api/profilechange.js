/*
 *
 * change stuff in a users profile
 *
 */
import fs from 'fs';
import path from 'path';

import logger from '../../core/logger.js';
import socketEvents from '../../socket/socketEvents.js';
import { getMediaType } from '../../data/sql/Media.js';
import {
  setUserAvatar, setCustomFlag, setActiveFactionRole,
} from '../../data/sql/Profile.js';

export default async function profilechange(req, res) {
  req.tickRateLimiter(3000);
  const { ttag: { t }, user, body: profile } = req;

  if (!profile || typeof profile !== 'object') {
    throw new Error('Invalid request, no profile object included');
  }

  const { avatarId, customFlag, activeFactionRole } = profile;
  let changed = false;
  const profileChanges = {};

  if (avatarId === null || typeof avatarId === 'string') {
    changed = true;
    profileChanges.avatarId = avatarId;
    if (avatarId) {
      const isLegitMedia = await getMediaType(avatarId) === 'image';
      if (!isLegitMedia) {
        throw new Error(t`Avatar can only be an image`);
      }
    }
    const success = await setUserAvatar(user.id, avatarId);
    if (!success) {
      throw new Error(t`Could not set your avatar`);
    }
    logger.info(`AUTH: User ${user.name} changed avatar to ${avatarId}`);
  }

  if (customFlag === null) {
    changed = true;
    profileChanges.customFlag = null;
    const success = await setCustomFlag(user.id, null);
    if (!success) {
      throw new Error('Could not remove your custom flag');
    }
    logger.info(`AUTH: User ${user.name} removed his custom flag`);
  } else if (typeof customFlag === 'string') {
    changed = true;
    profileChanges.customFlag = customFlag;
    if (customFlag.length !== 2
      /* eslint-disable max-len */
      || customFlag.includes('/') || customFlag.includes('\\') || customFlag.includes('.')
      || ['zz', 'z1', 'z2', 'z3', 'xx', 'a1', 'a2', 'yy', 'ap'].includes(customFlag)
      || !fs.existsSync(path.join(__dirname, 'public', 'cf', `${customFlag}.gif`))
      /* eslint-enable max-len */
    ) {
      throw new Error('This custom flag is invalid');
    }
    const success = await setCustomFlag(user.id, customFlag);
    if (!success) {
      throw new Error('Could not set your custom flag');
    }
    logger.info(`AUTH: User ${user.name} changed flag to ${customFlag}`);
  }

  if (activeFactionRole === null || typeof activeFactionRole === 'string') {
    changed = true;
    profileChanges.activeFactionRole = activeFactionRole;
    const success = await setActiveFactionRole(user.id, activeFactionRole);
    if (!success) {
      throw new Error(t`Could not set your faction role`);
    }
    logger.info(
      `AUTH: User ${user.name} changed active faction to ${activeFactionRole}`,
    );
  }

  if (!changed) {
    throw new Error('You did not define anything to change');
  }

  const changedKeys = Object.keys(profileChanges);
  for (let i = 0; i < changedKeys.length; i += 1) {
    const key = changedKeys[i];
    const value = profileChanges[key];
    socketEvents.patchUserState(user.id, 'profile', {
      op: 'set',
      path: key,
      value,
    });
  }

  res.json({
    status: 'ok',
  });
}
