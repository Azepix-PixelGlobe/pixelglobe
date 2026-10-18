/*
 * create a faction
 */
import logger from '../../core/logger.js';
import socketEvents from '../../socket/socketEvents.js';
import {
  validateFactionName, validateFactionTitle, validateDescription,
} from '../../utils/validation.js';
import {
  createFaction, getFactionInfo,
} from '../../data/sql/Faction.js';
import {
  MAX_FACTIONS_PER_USER, MAX_OWNED_FACTIONS_PER_USER, CHANNEL_TYPES,
} from '../../core/constants.js';

export default async function factioncreate(req, res) {
  req.tickRateLimiter(7000);
  const { ttag: { gettext, t }, user, body: factionData } = req;
  const { avatarId } = factionData;
  let {
    isPrivate, isPublic,
    name, title, description,
  } = factionData;

  name = name?.toLowerCase();
  title = title?.trim();
  description = description?.trim();
  isPrivate = !!isPrivate;
  isPublic = !!isPublic;

  const errors = [];
  let error = gettext(validateFactionName(name));
  if (error) errors.push(error);
  error = gettext(validateFactionTitle(title));
  if (error) errors.push(error);
  error = gettext(validateDescription(description));
  if (error) errors.push(error);
  if (typeof avatarId !== 'string') {
    errors.push(t`No Avatar given`);
  }

  if (errors.length) {
    res.status(400).json({ errors });
    return;
  }

  const createRet = await createFaction(
    user.id, name, title, description, isPrivate, isPublic, avatarId,
  );
  switch (createRet) {
    case 0:
      break;
    case 1:
      throw new Error(
        t`You can only have ${MAX_FACTIONS_PER_USER} factions in total`,
      );
    case 2:
      throw new Error(
        // eslint-disable-next-line max-len
        t`You can only be owner of ${MAX_OWNED_FACTIONS_PER_USER} factions in total`,
      );
    case 3:
      throw new Error(
        // eslint-disable-next-line max-len
        t`Your account must be at least two weeks old before you can create a faction`,
      );
    case 4:
      throw new Error(t`Avatar not given or not an image`);
    case 5:
      throw new Error(t`Name already in use.`);
    default:
      throw new Error(t`Server Error`);
  }

  const factionInfo = await getFactionInfo(name);
  if (!factionInfo) {
    /* no reason why this should even happen */
    throw new Error(t`Server Error`);
  }

  /*
   * turn info object into faction object for user profile
   */
  factionInfo.isHidden = false;
  for (let i = 0; i < factionInfo.roles.length; i += 1) {
    const role = factionInfo.roles[i];
    role.isMember = true;
  }
  delete factionInfo.sqlFid;

  const patches = [];
  if (factionInfo.channelId) {
    const chatPatch = {
      op: 'addnx',
      path: `channels.${CHANNEL_TYPES.FACTION}[0:${factionInfo.channelId}]`,
      value: [
        factionInfo.channelId, factionInfo.name, Date.now(), Date.now(),
        false, factionInfo.avatarId,
      ],
    };
    socketEvents.patchUserState(user.id, 'chat', chatPatch);
    delete factionInfo.channelId;
    patches.push(['chat', chatPatch]);
  }

  const profilePatch = {
    op: 'pushnx',
    path: `factions[name:${name}]`,
    value: factionInfo,
  };
  socketEvents.patchUserState(user.id, 'profile', profilePatch);
  patches.push(['profile', profilePatch]);

  logger.info(`User ${user.id} created new faction ${name}`);
  res.json({
    status: 'ok',
    name,
    patches,
  });
}
