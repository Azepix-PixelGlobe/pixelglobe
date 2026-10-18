/*
 *
 * change stuff of a user
 *
 */
import logger from '../../core/logger.js';
import socketEvents from '../../socket/socketEvents.js';
import { setFlagOfUser, setUserProperty } from '../../data/sql/User.js';
import { resolveSession } from '../../data/sql/Session.js';
import { validateUsername, validateName } from '../../utils/validation.js';
import { USER_FLAGS } from '../../core/constants.js';

export default async function userchange(req, res) {
  req.tickRateLimiter(10000);
  const { ttag: { t, gettext }, body: userData } = req;

  if (!userData || typeof userData !== 'object') {
    throw new Error('Invalid request, no user object included');
  }

  const { blockDm, priv, token } = userData;
  let { username, name } = userData;
  let changed = false;
  const userChanges = {};

  let { user } = req;
  if (token) {
    /*
     * We can change user data for a different user than the requesting one,
     * if a token is given.
     * This is used in the OIDC login portal, where a "Change Account" button
     * exists.
     */
    user = await resolveSession(token);
    if (!user) {
      throw new Error('Could not resolve user session');
    }
  }

  if (typeof priv === 'boolean') {
    changed = true;
    userChanges.priv = priv;
    const success = await setFlagOfUser(user.id, USER_FLAGS.PRIV, priv);
    if (!success) {
      throw new Error(t`Could not change this setting. Maybe try again later.`);
    }
    logger.info(`AUTH: User ${user.name} changed priv to ${priv}`);
  }

  if (typeof blockDm === 'boolean') {
    changed = true;
    userChanges.blockDm = blockDm;
    const success = await setFlagOfUser(user.id, USER_FLAGS.BLOCK_DM, blockDm);
    if (!success) {
      throw new Error(t`Could not change this setting. Maybe try again later.`);
    }
    logger.info(`AUTH: User ${user.name} changed blockDm to ${blockDm}`);
  }

  if (typeof username === 'string') {
    changed = true;
    let error;
    if (!user.username.startsWith('pp_')) {
      error = t`You already chose your username`;
    } else if (username.startsWith('pp_')) {
      error = t`Username can not start with pp_`;
    } else {
      username = username.toLowerCase();
      error = gettext(validateUsername(username));
    }
    if (error) {
      throw new Error(error);
    }
    userChanges.username = username;

    const success = await setUserProperty(user.id, 'username', username);
    if (!success) {
      throw new Error(t`Username already in use.`);
    }
    logger.info(
      // eslint-disable-next-line max-len
      `AUTH: Changed username for user ${user.name}(${user.id}) to ${username} by ${req.ip.ipString}`,
    );
  }

  if (typeof name === 'string') {
    changed = true;
    let error;
    if (user.name === name) {
      error = t`You already have that name.`;
    } else {
      name = name.trim();
      error = gettext(validateName(name));
    }
    if (error) {
      throw new Error(error);
    }
    userChanges.name = name;

    const success = await setUserProperty(user.id, 'name', name);
    if (!success) {
      throw new Error(t`Name already in use.`);
    }
    logger.info(
      // eslint-disable-next-line max-len
      `AUTH: Changed name for user ${user.name}(${user.id}) to ${name} by ${req.ip.ipString}`,
    );
  }

  if (!changed) {
    throw new Error('You did not define anything to change');
  }

  const changedKeys = Object.keys(userChanges);
  for (let i = 0; i < changedKeys.length; i += 1) {
    const key = changedKeys[i];
    const value = userChanges[key];
    socketEvents.patchUserState(user.id, 'user', {
      op: 'setex',
      path: key,
      value,
    });
  }

  res.json({
    status: 'ok',
  });
}
