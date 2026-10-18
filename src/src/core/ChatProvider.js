/*
 * class for chat communications
 */
import RateLimiter from '../utils/RateLimiter.js';
import { updateChatGoal, getNameStyle } from '../data/sql/Coins.js';
import {
  findIdByNameOrId, getDummyUser, getLastIPOfUser,
} from '../data/sql/User.js';
import { getDefaultChannel } from '../data/sql/Channel.js';
import ChatMessageBuffer from './ChatMessageBuffer.js';
import socketEvents from '../socket/socketEvents.js';
import { ban, unban } from './ban.js';
import {
  mutec, unmutec,
  unmutecAll, listMutec,
  isCountryMuted,
} from '../data/redis/chat.js';
import { escapeMd } from './utils.js';
import mapFlag from '../utils/flagMapping.js';
import ttags from '../middleware/ttag.js';

import { USE_MAILER } from './config.js';
import { getState } from './SharedState.js';
import {
  CHAT_CHANNELS,
  EVENT_USER_NAME,
  INFO_USER_NAME,
  APISOCKET_USER_NAME,
  USERLVL,
  CHANNEL_TYPES,
} from './constants.js';

function getUserFromMd(mdUserLink) {
  let mdUser = mdUserLink.trim();
  if (mdUser[0] === '@') {
    mdUser = mdUser.substring(1);
    if (mdUser[0] === '[' && mdUser[mdUser.length - 1] === ')') {
      // if mdUser ping, select Id
      mdUser = mdUser.substring(
        mdUser.lastIndexOf('(') + 1, mdUser.length - 1,
      ).trim();
    }
  }
  return mdUser;
}

export class ChatProvider {
  constructor() {
    /*
     * array of default channels (NOT including language channels)
     */
    this.defaultChannels = [];
    /*
     * map of lang channels to lang code
     */
    this.langChannels = new Map();
    /*
     * map of all public channels (default channel + lang channels) to id
     */
    this.publicChannels = new Map();
    /*
     * ids of default channels
     */
    this.defaultChannelIds = new Set();
    this.enChannelId = 0;
    this.infoUserId = 1;
    this.eventUserId = 1;
    this.apiSocketUserId = 1;
    this.caseCheck = /^[A-Z !.]*$/;
    this.cyrillic = /[\u0436-\u043B]'/;
    // unused as of 2026-03-03
    this.substitutes = [];
    this.chatMessageBuffer = new ChatMessageBuffer(socketEvents);

    /**
     * when a chat message gets sent by a user on this shard
     * @param user user object
     * @param ip ip object
     * @param message text message
     * @param channelId channel id
     * @param lang language code
     * @param ttag ttag instance
     */
    socketEvents.on('recvChatMessage', async (
      user, ip, message, channelId, lang, ttag,
    ) => {
      const errorMsg = await this.sendMessage(
        user, ip, message, channelId, lang, ttag,
      );
      if (errorMsg) {
        socketEvents.broadcastSUChatMessage(
          user.id,
          'info',
          errorMsg,
          channelId,
          this.infoUserId,
          'il',
        );
      }
    });
  }

  async initialize() {
    // find or create default channels
    for (let i = 0; i < CHAT_CHANNELS.length; i += 1) {
      const { name } = CHAT_CHANNELS[i];
      // eslint-disable-next-line no-await-in-loop
      const channel = await getDefaultChannel(name);
      const { id, lastTs } = channel;
      if (name === 'en') {
        this.enChannelId = id;
      }
      const channelArray = [id, name, lastTs, null, true, null];
      this.defaultChannels.push(channelArray);
      this.publicChannels.set(id, channelArray);
      this.defaultChannelIds.add(id);
    }
    // find or create non-english lang channels
    const langs = Object.keys(ttags);
    for (let i = 0; i < langs.length; i += 1) {
      const name = langs[i];
      if (name === 'default') {
        continue;
      }
      // eslint-disable-next-line no-await-in-loop
      const channel = await getDefaultChannel(name);
      const { id, lastTs } = channel;
      const channelArray = [id, name, lastTs, null, true, null];
      this.langChannels.set(name, channelArray);
      this.publicChannels.set(id, channelArray);
    }
    // find or create default users
    this.infoUserId = await getDummyUser(INFO_USER_NAME);
    this.eventUserId = await getDummyUser(EVENT_USER_NAME);
    this.apiSocketUserId = await getDummyUser(APISOCKET_USER_NAME);
  }

  /**
   * return all the public channels someone has access to, given a language
   * code
   * @return [
   *   [cid, name, lastTs, null (lastReadTs), true (muted), null (avatarId)],
   * ...]
   */
  getAccessiblePublicChannels(lang) {
    const ret = [...this.defaultChannels];
    if (lang && lang !== 'en') {
      const langChannel = this.langChannels.get(lang);
      if (langChannel) {
        ret.push(langChannel);
      }
    }
    return ret;
  }

  /**
   * get all public channels with names
   * @return [[cid, name], ...]
   */
  getPublicChannels() {
    return [...this.publicChannels.values()].map(([cid, name]) => [cid, name]);
  }

  /**
   * check if chanenl is public
   * @param channelid
   * @return boolean
   */
  isPublicChannel(cid) {
    return this.publicChannels.has(cid);
  }


  /**
   * filter private channels from channel list
   * @param channelIds list of channel ids
   * @return challelIds list of channel ids, but without public channels
   */
  filterPublicChannels(channelIds) {
    return channelIds.filter((cid) => !this.publicChannels.has(cid));
  }

  getHistory(cid, limit = 30) {
    return this.chatMessageBuffer.getMessages(cid, limit);
  }

  async adminCommands(message, channelId, user) {
    // admin commands
    const cmdArr = message.split(' ');
    const cmd = cmdArr[0].substring(1);
    const args = cmdArr.slice(1);
    const initiator = `@[${escapeMd(user.name)}](${user.id})`;

    try {
      switch (cmd) {
        case 'mute': {
          const timeMin = Number(args.slice(-1));
          if (args.length < 2 || Number.isNaN(timeMin)) {
            return this.mute(
              getUserFromMd(args.join(' ')),
              {
                printChannel: channelId,
                initiator,
                muid: user.id,
              },
            );
          }
          return this.mute(
            getUserFromMd(args.slice(0, -1).join(' ')),
            {
              printChannel: channelId,
              initiator,
              duration: timeMin,
              muid: user.id,
            },
          );
        }

        case 'unmute':
          return this.unmute(
            getUserFromMd(args.join(' ')),
            {
              printChannel: channelId,
              initiator,
              muid: user.id,
            },
          );

        case 'purge':
          return this.purge(
            getUserFromMd(args.join(' ')),
            {
              printChannel: channelId,
              initiator,
              muid: user.id,
            },
          );

        case 'mutec': {
          if (args[0]) {
            const cc = args[0].toLowerCase();
            const ret = await mutec(channelId, cc);
            if (ret === null) {
              return 'No legit country defined';
            }
            if (!ret) {
              return `Country ${cc} is already muted`;
            }
            if (ret) {
              await this.broadcastChatMessage(
                'info',
                // eslint-disable-next-line max-len
                `Country ${cc} has been muted from this channel by ${initiator}`,
                channelId,
                this.infoUserId,
              );
            }
            return null;
          }
          return 'No country defined for mutec';
        }

        case 'unmutec': {
          if (args[0]) {
            const cc = args[0].toLowerCase();
            const ret = await unmutec(channelId, cc);
            if (ret === null) {
              return 'No legit country defined';
            }
            if (!ret) {
              return `Country ${cc} is not muted`;
            }
            await this.broadcastChatMessage(
              'info',
              // eslint-disable-next-line max-len
              `Country ${cc} has been unmuted from this channel by ${initiator}`,
              channelId,
              this.infoUserId,
            );
            return null;
          }
          const ret = await unmutecAll(channelId);
          if (ret) {
            await this.broadcastChatMessage(
              'info',
              `All countries unmuted from this channel by ${initiator}`,
              channelId,
              this.infoUserId,
            );
            return null;
          }
          return 'No country is currently muted from this channel';
        }

        case 'listmc': {
          const ccArr = await listMutec(channelId);
          if (ccArr.length) {
            return `Muted countries: ${ccArr}`;
          }
          return 'No country is currently muted from this channel';
        }

        default:
          return `Couldn't parse command ${cmd}`;
      }
    } catch (error) {
      console.error(`Error on Chat Mod command ${error.message}`);
      return 'Error on parsing command';
    }
  }

  /**
   * user sending a chat message
   * @param user User object
   * @param ip ip object
   * @param message string of message
   * @param channelId integer of channel
   * @param lang language code
   * @param ttag ttag instance for localized errors
   * @return error message if unsuccessful, otherwise null
   */
  async sendMessage(user, ip, message, channelId, lang, ttag) {
    const { id } = user;
    const { t } = ttag;
    const { name, customRoleFlagId, customFlag, avatarId } = user.nameData;
    const { country } = ip;

    if (!user.rateLimiter) {
      user.rateLimiter = new RateLimiter(20, 15, true);
    }
    const waitLeft = user.rateLimiter.tick();
    if (waitLeft) {
      const waitTime = Math.floor(waitLeft / 1000);
      // eslint-disable-next-line max-len
      return t`You are sending messages too fast, you have to wait ${waitTime}s :(`;
    }

    if (!this.publicChannels.has(channelId) && !user?.hasChannel(channelId)) {
      return t`You don\'t have access to this channel`;
    }

    if (user.userlvl < USERLVL.CHATMOD) {
      if (await isCountryMuted(country, channelId)) {
        return t`Your country is temporary muted from this chat channel`;
      }
    } else if (message.charAt(0) === '/') {
      return this.adminCommands(message, channelId, user);
    }


    let { isBanned, isMuted, isProxy } = await ip.getAllowance();
    if (!isBanned && !isMuted && !isProxy) {
      ({ isBanned, isMuted } = await user.getAllowance());
    }
    if (isProxy) {
      return t`You can not send chat messages while using a proxy`;
    }
    if (isBanned) {
      return t`Can not chat while being banned`;
    }
    if (isMuted) {
      if (isMuted === true) {
        // eslint-disable-next-line max-len
        return t`You are permanently muted, join our guilded to appeal the mute`;
      }
      const ttl = Math.ceil((isMuted - Date.now()) / 1000);
      if (ttl > 120) {
        const timeMin = Math.round(ttl / 60);
        return t`You are muted for another ${timeMin} minutes`;
      }
      return t`You are muted for another ${ttl} seconds`;
    }

    if (name.trim() === '') {
      return 'nope';
    }
    const [flagLegit, displayCountry] = mapFlag(
      customRoleFlagId, customFlag, user.userlvl, country,
    );

    if (USE_MAILER && user.userlvl < USERLVL.VERIFIED) {
      return t`Your mail has to be verified in order to chat`;
    }

    for (let i = 0; i < this.substitutes.length; i += 1) {
      const substitute = this.substitutes[i];
      message = message.replace(substitute.regexp, substitute.replace);
    }

    if (message.match(this.cyrillic) && channelId === this.enChannelId) {
      return t`Please use int channel`;
    }

    if (user.lastMessage && user.lastMessage === message) {
      user.messageRepeat += 1;
      if (user.messageRepeat >= 4) {
        this.mute(id, { duration: 60, printChannel: channelId });
        user.messageRepeat = 0;
        return t`Stop flooding.`;
      }
    } else {
      user.messageRepeat = 0;
      user.lastMessage = message;
    }

    if (message.trim() === '!void') {
      const voidState = await getState('void');
      let reply;
      if (!voidState || !voidState.eventTimestamp) {
        reply = 'Void is not scheduled.';
      } else {
        const secondsLeft = Math.floor(
          (voidState.eventTimestamp - Date.now()) / 1000,
        );
        // Void lasts 8 minutes (STEPS[5] = -8)
        const VOID_DURATION_SECS = 8 * 60;
        if (secondsLeft <= 0 && secondsLeft >= -VOID_DURATION_SECS && !voidState.voidEnded) {
          // Void is actively happening right now
          let coordInfo = '';
          if (voidState.cx != null && voidState.cy != null) {
            coordInfo = ` — koordinatlar: #d,${voidState.cx},${voidState.cy},30`;
          }
          reply = `The Void is happening right now!${coordInfo}`;
        } else if (secondsLeft < -VOID_DURATION_SECS || voidState.voidEnded) {
          // Event ended, new one not yet scheduled
          reply = 'No active Void. Next one will be scheduled soon.';
        } else {
          const mins = Math.floor(secondsLeft / 60);
          const secs = secondsLeft % 60;
          reply = mins > 0
            ? `Next Void in ${mins}m ${secs}s`
            : `Next Void in ${secs}s`;
        }
      }
      await this.broadcastChatMessage(
        EVENT_USER_NAME,
        reply,
        channelId,
        this.eventUserId,
      );
      return null;
    }

    if (message.trim().toLowerCase() === '!chaos') {
      const chaosEnd = await getState('chaosEnd');
      const now = Date.now();
      let reply;
      if (typeof chaosEnd === 'number' && chaosEnd > now) {
        const left = Math.max(0, Math.floor((chaosEnd - now) / 1000));
        const mins = Math.floor(left / 60);
        const secs = left % 60;
        reply = mins > 0
          // eslint-disable-next-line max-len
          ? `🔥 Chaos is ACTIVE! Ends in ${mins}m ${secs}s (frenzy ~15ms/px)`
          : `🔥 Chaos is ACTIVE! Ends in ${secs}s (frenzy ~15ms/px)`;
      } else {
        // HourlyCron: next full UTC hour
        const next = new Date(now);
        next.setUTCMinutes(0, 0, 0);
        next.setUTCHours(next.getUTCHours() + 1);
        const left = Math.max(0, Math.floor((next.getTime() - now) / 1000));
        const mins = Math.floor(left / 60);
        const secs = left % 60;
        reply = mins > 0
          ? `Next Chaos in ${mins}m ${secs}s`
          : `Next Chaos in ${secs}s`;
      }
      await this.broadcastChatMessage(
        EVENT_USER_NAME,
        reply,
        channelId,
        this.eventUserId,
      );
      return null;
    }

    console.info(
      `Received chat message ${message} from ${name} / ${ip.ipString}`,
    );
    try {
      updateChatGoal(id).catch(() => {});
      const nameStyle = await getNameStyle(id).catch(() => 'none');
      await this.broadcastChatMessage(
        name,
        message,
        channelId,
        id,
        displayCountry,
        flagLegit,
        avatarId,
        nameStyle,
      );
    } catch (error) {
      switch (error.message) {
        case 'too_long':
          return t`You can\'t send a message this long :(`;
        case 'too_many_files':
          return t`You attached too many files`;
        case 'no_such_channel': {
          /*
           * channel is deleted, remove it from user,
           * assume its DM, because that is what we clear regularly,
           * the patch doesn't matter if its not
           */
          socketEvents.patchUserState(id, 'chat', {
            op: 'del',
            path: `channels.${CHANNEL_TYPES.DM}[0:${channelId}]`,
          });
          return null;
        }
        default:
          return 'Server Error';
      }
    }
    return null;
  }

  broadcastChatMessage(...args) {
    /*
     * update cache public channel lastTs
     */
    const publicChannel = this.publicChannels.get(args[2]);
    if (publicChannel) {
      publicChannel[2] = Date.now();
    }

    return this.chatMessageBuffer.broadcastChatMessage(...args);
  }

  async mute(nameOrId, opts) {
    const timeMin = opts.duration || null;
    const initiator = opts.initiator || null;
    const printChannel = opts.printChannel || null;
    const muid = opts.muid || null;

    const searchResult = await findIdByNameOrId(nameOrId);
    if (!searchResult) {
      return `Couldn't find user ${nameOrId}`;
    }
    const { name, id } = searchResult;
    const userPing = `@[${escapeMd(name)}](${id})`;
    const ipStrings = socketEvents.getIPsOfOnlineUser(id);
    const lastOnlineIPString = await getLastIPOfUser(id);
    if (lastOnlineIPString && !ipStrings.includes(lastOnlineIPString)) {
      ipStrings.push(lastOnlineIPString);
    }

    ban(
      ipStrings, id, null, true, false, 'mute', timeMin && timeMin * 60, muid,
    );

    try {
      if (printChannel) {
        if (timeMin) {
          await this.broadcastChatMessage(
            'info',
            (initiator)
              ? `${userPing} has been muted for ${timeMin}min by ${initiator}`
              : `${userPing} has been muted for ${timeMin}min`,
            printChannel,
            this.infoUserId,
          );
        } else {
          await this.broadcastChatMessage(
            'info',
            (initiator)
              ? `${userPing} has been muted forever by ${initiator}`
              : `${userPing} has been muted forever`,
            printChannel,
            this.infoUserId,
          );
        }
      }
    } catch {
      // nothing
    }
    console.info(`${initiator} muted user ${userPing}`);
    return null;
  }

  async unmute(nameOrId, opts) {
    const initiator = opts.initiator || null;
    const printChannel = opts.printChannel || null;
    const muid = opts.muid || null;

    const searchResult = await findIdByNameOrId(nameOrId);
    if (!searchResult) {
      return `Couldn't find user ${nameOrId}`;
    }
    const { name, id } = searchResult;
    const userPing = `@[${escapeMd(name)}](${id})`;
    const ipStrings = socketEvents.getIPsOfOnlineUser(id);
    const lastOnlineIPString = await getLastIPOfUser(id);
    if (lastOnlineIPString && !ipStrings.includes(lastOnlineIPString)) {
      ipStrings.push(lastOnlineIPString);
    }

    const succ = await unban(ipStrings, id, null, null, true, false, muid);
    if (!succ[0].length && !succ[1].length) {
      return `User ${userPing} is not muted`;
    }
    if (printChannel) {
      try {
        await this.broadcastChatMessage(
          'info',
          (initiator)
            ? `${userPing} has been unmuted by ${initiator}`
            : `${userPing} has been unmuted`,
          printChannel,
          this.infoUserId,
        );
      } catch {
        // nothing
      }
    }
    console.info(`Unmuted user ${userPing}`);
    return null;
  }

  async purge(nameOrId, opts) {
    const initiator = opts.initiator || null;
    const printChannel = opts.printChannel || null;

    const searchResult = await findIdByNameOrId(nameOrId);
    if (!searchResult) {
      return `Couldn't find user ${nameOrId}`;
    }
    const { name, id } = searchResult;
    const userPing = `@[${escapeMd(name)}](${id})`;

    this.chatMessageBuffer.broadcastUserPublicChatMessageDeletion(id);
    if (printChannel) {
      try {
        await this.broadcastChatMessage(
          'info',
          (initiator)
            ? `Messages of ${userPing} purged by ${initiator}`
            : `Messages of ${userPing} purged`,
          printChannel,
          this.infoUserId,
        );
      } catch {
        // nothing
      }
    }
    console.info(`Purging public messages of user ${userPing}`);
    return null;
  }
}

export default new ChatProvider();
