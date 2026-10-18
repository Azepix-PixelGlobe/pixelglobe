/*
 * wraper for ban and whitelist that notices websocket for updates
 */
import {
  ban as banQuery,
  unban as unbanQuery,
  prolongExistingBan as prolongExistingBanQuery,
} from '../data/sql/Ban.js';
import {
  banMedia as banMediaQuery,
  hasMediaBan as hasMediaBanQuery,
} from '../data/sql/MediaBan.js';
import {
  getUsersOfMedia as getUsersOfMediaQuery,
  getMessagesOfMedia as getMessagesOfMediaQuery,
  getIpsOfMedia as getIpsOfMediaQuery,
  deregisterMedia as deregisterMediaQuery,
} from '../data/sql/Media.js';
import {
  deleteMessagesByIds as deleteMessagesByIdsQuery,
} from '../data/sql/Message.js';
import {
  whitelist as whitelistQuery, unwhitelist as unwhitelistQuery,
} from '../data/sql/IP.js';
import socketEvents from '../socket/socketEvents.js';
import { MEDIA_BAN_REASONS } from './constants.js';

export { unbanMedia } from '../data/sql/MediaBan.js';

/**
 * notice sockets that users / ips changed
 * @param ipStrings Array of ipStrings
 * @param userIds Array of user ids
 */
export function notifyUserIpChanges(ipStrings, userIds) {
  if (userIds) {
    if (Array.isArray(userIds)) {
      userIds.forEach((id) => socketEvents.reloadUser(id, true));
    } else {
      socketEvents.reloadUser(userIds, true);
    }
  }
  if (ipStrings) {
    if (Array.isArray(ipStrings)) {
      ipStrings.forEach((ipString) => socketEvents.reloadIP(ipString, true));
    } else {
      socketEvents.reloadIP(ipStrings, true);
    }
  }
}

/**
 * ban
 * @param ipStrings Array of multiple or single ipStrings
 * @param userIds Array of multiple or single user ids
 * @param ipUuids Array of multiple or single ip uuids (IID)
 * @param mute boolean if muting
 * @param ban boolean if banning
 * @param reason reasoning as string
 * @param duration duration in seconds
 * @param muid id of the mod that bans
 */
export async function ban(
  // eslint-disable-next-line no-shadow
  ipStrings, userIds, ipUuids, mute, ban, reason, ...args
) {
  if ((!mute && !ban) || !reason) {
    return false;
  }
  const result = await banQuery(
    ipStrings, userIds, ipUuids, mute, ban, reason, ...args,
  );
  notifyUserIpChanges(...result);
  return result;
}

/**
 * unban
 * @param ipStrings Array of multiple or single ipStrings
 * @param userIds Array of multiple or single user ids
 * @param ipUuids Array of multiple or single ip uuids (IID)
 * @param banUuids Array of multiple or single ban uuids (UID)
 * @param mute boolean if unmuting
 * @param ban boolean if unbanning
 * @param muid id of the mod that bans
 * @return [ ipStrings, userIds ] affected users / ips
 */
export async function unban(
  // eslint-disable-next-line no-shadow
  ipStrings, userIds, ipUuids, banUuids, mute, ban, ...args
) {
  if (!mute && !ban) {
    return [[], []];
  }
  const result = await unbanQuery(
    ipStrings, userIds, ipUuids, banUuids, mute, ban, ...args,
  );
  notifyUserIpChanges(...result);
  return result;
}

/**
 * prolong existing ban if exist, make a new ban if it doesn't
 * @param ipString
 * @param uid
 * @param duration
 * @param reason
 */
export async function upsertBan(ipString, uid, reason, duration) {
  if ((!ipString && !uid) || !reason) {
    return false;
  }
  let success = await prolongExistingBanQuery(ipString, uid, duration, reason);
  if (!success) {
    success = await ban(ipString, uid, null, true, true, reason, duration);
    notifyUserIpChanges(ipString);
  }
  return success;
}

/**
 * whitelist
 * @param ipString ip as string
 * @return boolean
 */
export async function whitelist(ipString) {
  const ret = await whitelistQuery(ipString);
  notifyUserIpChanges(ipString);
  return ret;
}

/**
 * unwhitelist
 * @param ipString ip as string
 * @return boolean
 */
export async function unwhitelist(ipString) {
  const ret = await unwhitelistQuery(ipString);
  notifyUserIpChanges(ipString);
  return ret;
}

/**
 * ban media by id
 * @param mediaId shortId:extension
 * @param reason MEDIA_BAN_REASON
 * @param muid id of the mod that bans
 * @return [amountOfUserIds, amountOfIps, amountOfChannels] or null
 */
export async function banMedia(mediaId, reason, muid = null) {
  const mediaSqlId = await banMediaQuery(mediaId, reason, muid);
  if (!mediaSqlId) {
    return null;
  }
  const [userIds, messagesByChannel, ipStrings] = await Promise.all([
    // users with media as avatar or who uploaded it
    getUsersOfMediaQuery(mediaSqlId),
    // messages with the media attached
    getMessagesOfMediaQuery(mediaSqlId),
    // ipString associated with media
    getIpsOfMediaQuery(mediaSqlId),
  ]);
  if (reason === MEDIA_BAN_REASONS.CSAM && (
    ipStrings.length || userIds.length)
  ) {
    console.log(
      // eslint-disable-next-line max-len
      `Autoban users ${userIds.join(', ')} and ips ${ipStrings.join(', ')} for posting CSAM`,
    );
    await ban(ipStrings, userIds, null, true, true, 'Posting CSAM', null, muid);
  } else if (userIds.length) {
    /*
     * they could have it as avatar
     */
    notifyUserIpChanges(null, userIds);
  }

  await deregisterMediaQuery(...mediaId.split(':'));

  for (const [channelId, messageIds] of messagesByChannel.entries()) {
    if (messageIds.length) {
      // eslint-disable-next-line no-await-in-loop
      await deleteMessagesByIdsQuery(messageIds);
      socketEvents.broadcastMessageDeletion(channelId, messageIds);
    }
  }

  return [userIds.length, ipStrings.length, messagesByChannel.size];
}

/**
 * check if media file is allowed
 * @param hashes sha265 hash of file
 * @param [pHashes] perceptive hash of image
 * @param userId userId that is checking
 * @param ipString ip that is checking
 * @return [[hash, pHash, reason], ...]
 */
export async function checkIfMediaBanned(hash, pHash, userId, ipString) {
  const bans = await hasMediaBanQuery(hash, pHash);
  if (bans.length) {
    console.log(
      `User ${userId} ${ipString} tried to post banned Media`,
    );
    if (bans.some(({ reason }) => reason === MEDIA_BAN_REASONS.CSAM)) {
      console.log(`Autoban user ${userId} ${ipString} for posting CSAM`);
      await upsertBan(ipString, userId, 'Posting CSAM', null);
      /*
      * automatically report to authorities here
      */
    }
  }
  return bans;
}
