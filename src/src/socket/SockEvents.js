/*
 * Events for WebSockets
 */
import EventEmitter from 'events';

import {
  dehydratePixelUpdate,
} from './packets/server.js';
import { DO_NOTHING } from '../core/constants.js';

const MAX_PIXEL_BROADCAST_BYTES = 32 * 1024;

/*
 * Build the user-facing online counter from stable identities.
 * Authenticated users are counted by uid, while guests fall back to IP.
 * The IP lists used for rate limiting and moderation stay separate.
 */
export function createOnlineCounter(onlineUserData) {
  const onlineCounter = {};
  const allUsers = new Set();

  for (const [canvasId, identities] of Object.entries(onlineUserData || {})) {
    const uniqueUsers = new Set(identities);
    onlineCounter[canvasId] = uniqueUsers.size;
    uniqueUsers.forEach((identity) => allUsers.add(identity));
  }
  onlineCounter.total = allUsers.size;
  return onlineCounter;
}

class SocketEvents extends EventEmitter {
  isCluster = false;
  // object with amount of online users
  // in total and per canvas
  onlineCounter;

  constructor() {
    super();
    /*
     * {
     *   total: totalUsersOnline,
     *  canvasId: onlineUsers,
     *  ...
     *  }
     */
    this.onlineCounter = {
      total: 0,
    };
    // array of IPs that are online
    this.onlineIPs = [];
    /*
     * {
     *   ipString: [uid1, uid2,...],
     *   ...
     * }
     */
    this.onlineIPUsers = {};
  }

  // eslint-disable-next-line class-methods-use-this
  get important() {
    return true;
  }

  // eslint-disable-next-line class-methods-use-this
  get lowestActiveShard() {
    return null;
  }

  // eslint-disable-next-line class-methods-use-this
  async initialize() {
    // nothing, only for child classes
  }

  /*
   * async event
   */
  onAsync(evtString, cb) {
    this.on(evtString, (...args) => {
      setImmediate(() => {
        cb(...args);
      });
    });
  }

  /**
   * requests that expect a response
   * req(type, args) can be awaited
   * it will return a response from whatever listens on onReq(type, cb(args))
   * Keep the arguments serializable for shard support
   */
  req(type, ...args) {
    return new Promise((resolve, reject) => {
      const chan = Math.floor(Math.random() * 100000).toString()
        + Math.floor(Math.random() * 100000).toString();
      const chankey = `res:${chan}`;
      let id;
      const callback = (ret) => {
        clearTimeout(id);
        resolve(ret);
      };
      id = setTimeout(() => {
        this.off(chankey, callback);
        reject(new Error(`Timeout on req ${type}`));
      }, 45000);
      this.once(chankey, callback);
      this.emit(`req:${type}`, chan, ...args);
    });
  }

  /**
   * request for all shards that expect a response,
   * since we don't have shards here, it's the same as this.req()
   */
  reqAll(...args) {
    return this.req(...args);
  }

  onReq(type, cb) {
    this.on(`req:${type}`, async (chan, ...args) => {
      const ret = await cb(...args);
      if (ret === DO_NOTHING) {
        return;
      }
      this.emit(`res:${chan}`, ret);
    });
  }

  /**
   * broadcast pixel message via websocket
   * @param canvasId number ident of canvas
   * @param chunkid number id consisting of i,j chunk coordinates
   * @param pxls buffer with offset and color of one or more pixels
   */
  broadcastPixels(
    canvasId,
    chunkId,
    pixels,
  ) {
    const i = chunkId >> 8;
    const j = chunkId & 0xFF;
    for (
      let offset = 0;
      offset < pixels.length;
      offset += MAX_PIXEL_BROADCAST_BYTES
    ) {
      const batch = pixels.subarray(
        offset,
        Math.min(offset + MAX_PIXEL_BROADCAST_BYTES, pixels.length),
      );
      const buffer = dehydratePixelUpdate(i, j, batch);
      this.emit('pixelUpdate', canvasId, chunkId, buffer);
    }
    this.emit('chunkUpdate', canvasId, [i, j]);
  }

  /**
   * chunk updates from event, image upload, etc.
   * everything that's not a pixelUpdate and changes chunks
   * @param canvasId
   * @param chunk [i,j] chunk coordinates
   */
  broadcastChunkUpdate(
    canvasId,
    chunk,
  ) {
    this.emit('chunkUpdate', canvasId, chunk);
  }

  /**
   * broadcast fetched IpInfo of user,
   * used to spread flag informations of users
   * to shards
   * @param userIpInfo object {
   *   userId, // 0 if not logged in
   *   status, // proxycheck and ban status (see core/isAllowed)
   *   ip,
   *   cidr,
   *   org,
   *   country,
   *   asn,
   *   descr,
   * }
   */
  gotUserIpInfo(userIpInfo) {
    this.emit('useripinfo', userIpInfo);
  }

  /**
   * ask other shards to send email for us,
   * only used when USE_MAILER is false
   * @param type type of mail to send
   * @param args
   */
  sendMail(...args) {
    this.emit('mail', ...args);
  }

  /**
   * received Chat message on own websocket, will be consumed by chatProvider
   * and then send by sendMessage
   * @param user user object
   * @param ip ip object
   * @param message text message
   * @param channelId numerical channel id
   * @param lang language code
   * @param ttag ttag instance to be able to send localized error messages
   */
  recvChatMessage(user, ip, message, channelId, lang, ttag) {
    this.emit('recvChatMessage', user, ip, message, channelId, lang, ttag);
  }

  /**
   * set cooldownfactor
   * (used by RpgEvent)
   * @param fac factor by which cooldown changes globally
   */
  setCoolDownFactor(fac) {
    this.emit('setCoolDownFactor', fac);
  }

  /**
   * set per-event cooldown overrides for bcd and pcd independently
   * pass null to reset to canvas defaults
   * @param {Object} param0 { bcd, pcd } in milliseconds (null = use canvas default)
   */
  setEventCooldowns({ bcd, pcd }) {
    this.emit('setEventCooldowns', { bcd, pcd });
  }

  /**
   * Set the extra cooldown owned by the Chaos event (additive, not override).
   * This is separate from regular event overrides so RPG events cannot
   * accidentally cancel Chaos' +0.5s extra cooldown while it is active.
   *
   * @param {Object} param0 { bcd, pcd, mode } cooldown values (null = inactive)
   */
  setChaosCooldowns({ bcd, pcd, mode }) {
    this.emit('setChaosCooldowns', { bcd, pcd, mode });
  }

  /**
   * Broadcast chaos status to all connected clients.
   * @param {number|null} endTs unix ms when chaos ends, or null when inactive
   */
  broadcastChaos(endTs) {
    this.emit('chaos', endTs);
  }

  /**
   * broadcast chat message to all users in channel
   * @param name chatname
   * @param message Message to send
   * @param sendapi If chat message should get broadcasted to api websockets
   *   (useful if the api is supposed to not answer to its own messages)
   */
  broadcastChatMessage(
    name,
    message,
    channelId,
    uid,
    country,
    ts,
    msgId,
    flagLegit,
    avatarId,
    attachments,
    sendapi = true,
    nameStyle = 'none',
  ) {
    this.emit(
      'chatMessage',
      name,
      message,
      channelId,
      uid,
      country,
      ts,
      msgId,
      flagLegit,
      avatarId,
      attachments,
      sendapi,
      nameStyle,
    );
  }

  broadcastNameStyle(uid, nameStyle) {
    this.emit('nameStyleUpdate', uid, nameStyle || 'none');
  }

  /**
   * Aktif avatar çerçevesini (hareketli kozmetik) tüm bağlı istemcilere yayınlar.
   * Sohbet penceresindeki avatarlar ve profiller anında güncellenir.
   * @param uid
   * @param frame efekt anahtarı ('flame', 'glitch', ...) ya da 'none'
   */
  broadcastFrameStyle(uid, frame) {
    this.emit('frameStyleUpdate', uid, frame || 'none');
  }

  /**
   * broadcast chat deletion of a users messages to all users
   * @param name chatname
   * @param userId user id
   * @param sendapi If chat message should get broadcasted to api websockets
   *   (useful if the api is supposed to not answer to its own messages)
   */
  broadcastUserPublicChatMessageDeletion(userId, sendapi = true) {
    this.emit('deletePublicUserMessages', userId, sendapi);
  }

  /**
   * broadcast deletion of user messages within a channel
   * @param userId user id
   * @param channelId channel id
   */
  broadcastUserChannelMessageDeletion(userId, channelId) {
    this.emit('deleteUserChannelMessages', userId, channelId);
  }

  /**
   * broadcast deletion of chat messages
   * @param channelId
   * @param messageIds array of message is
   * TODO: Does not arrive at API socket currently, since it isn't aware of
   * message ids in the first place
   */
  broadcastMessageDeletion(channelId, messageIds) {
    this.emit('deleteMessages', channelId, messageIds);
  }

  /**
   * send an announcmeent to all players
   * @param text can be markdown text
   */
  broadcastAnnouncement(text) {
    this.emit('announcement', text);
  }

  /**
   * send chat message to a single user in channel
   */
  broadcastSUChatMessage(
    targetUserId,
    name,
    message,
    channelId,
    id,
    country = 'xx',
  ) {
    this.emit(
      'suChatMessage',
      targetUserId,
      name,
      message,
      channelId,
      id,
      country || 'xx',
    );
  }

  /**
   * broadcast change of fonts used by captcha
   * @param fontFilenames Array of filenams
   */
  broadcastCaptchaFonts(fontFilenames) {
    this.emit('setCaptchaFonts', fontFilenames);
  }

  /**
   * trigger rate limit of ip
   * @param ip
   * @param blockTime in ms
   */
  broadcastRateLimitTrigger(ip, blockTime) {
    this.emit('rateLimitTrigger', ip, blockTime);
  }

  /**
   * broadcast ranking list updates
   * @param rankings {
   *   dailyRanking?: daily pixel raking top 100,
   *   ranking?: total pixel ranking top 100,
   *   prevTop?: top 10 of the previous day,
   * }
   */
  rankingListUpdate(rankings) {
    this.emit('rankingListUpdate', rankings);
  }

  /**
   * reload user / ip on websocket to get changes
   * @param local whether we only update server side, or if we tell the client
   *   to update es well
   */
  reloadUser(userId, local) {
    this.emit('reloadUser', userId, local);
  }

  reloadIP(ipString, local) {
    this.emit('reloadIP', ipString, local);
  }

  /**
   * reset all captchas and challenges
   */
  resetAllCaptchas() {
    this.emit('resetAllCaptchas');
  }

  /**
   * change a users profile,
   * @param userId userId or Array of userIds
   * @param patch object describing the profile state
   */
  patchUserState(userId, state, patch) {
    this.emit('patchState', userId, state, patch);
  }

  /**
   * receive information about online users
   * @param online {
   *     canvasId1: [IP1, IP2, IP2, ...],
   *     ...
   *   }
   * @param ipUsers {
   *     ipString: [userId1, userId2,...],
   *     ...
   *   }
   */
  setOnlineUsers(onlineData, ipUsers, onlineUserData = null) {
    const newOnlineCounter = {};
    const newOnlineIPs = [];
    for (const [canvasId, ipList] of Object.entries(onlineData)) {
      newOnlineCounter[canvasId] = ipList.length;
      for (const ip of ipList) {
        if (!newOnlineIPs.includes(ip)) {
          newOnlineIPs.push(ip);
        }
      }
    }
    if (onlineUserData) {
      this.onlineCounter = createOnlineCounter(onlineUserData);
    } else {
      newOnlineCounter.total = newOnlineIPs.length;
      this.onlineCounter = newOnlineCounter;
    }
    this.onlineIPs = newOnlineIPs;
    this.onlineIPUsers = ipUsers;

    this.broadcastOnlineCounter();
  }

  /**
   * get used ips of online user
   * @param uid
   * @return ipStrings array of ipStrings
   */
  getIPsOfOnlineUser(uid) {
    const ipStrings = [];
    for (const [ipString, uidList] of Object.entries(this.onlineIPUsers)) {
      if (uidList.includes(uid)) {
        ipStrings.push(ipString);
      }
    }
    return ipStrings;
  }

  /*
   * broadcast online counter
   */
  broadcastOnlineCounter() {
    this.emit('onlineCounter', this.onlineCounter);
  }

  /**
   * change cooldown of specific ip temporary
   * @param ip ip string
   * @param factor factor to multiple cooldown with
   * @param endTime timestamp until which the modifier applies
   */
  broadcastIPCooldownModifier(ip, factor, endTime) {
    this.emit('ipCooldownModifier', ip, factor, endTime);
  }

  /**
   * update shared state (see core/SharedState.js), this can
   * @param key string
   * @param value any serializable object
   */
  updateSharedState(key, value) {
    this.emit('sharedstate', key, value);
  }

  /**
   * make fish appear for a user of specific IP
   * @param ip ip as a string
   * @param type number of fish type
   * @param size size of fish in kg
   */
  sendFish(ip, type, size) {
    this.emit('sendFish', ip, type, size);
  }

  /**
   * register caught fish for storing in database and cooldown modifier
   */
  registerCatchedFish(user, ip, type, size) {
    this.emit('registerCatchedFish', user, ip, type, size);
  }
}

export default SocketEvents;
