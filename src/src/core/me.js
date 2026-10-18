/**
 *
 * Userdata that gets sent to the client on various api endpoints.
 * This should be the most basic data in order to run the game.
 *
 */
import { getUserRanks } from '../data/redis/ranks.js';
import { USE_MAILER, TIMEBLOCK_USERS, TIMEBLOCK_IPS } from './config.js';
import { CHANNEL_TYPES, USERLVL } from './constants.js';
import { getUserChatData } from '../data/sql/Channel.js';
import chatProvider from './ChatProvider.js';
import { getNameStyle, getActiveItemEffects } from '../data/sql/Coins.js';
import { getChaosEndTs } from './ChaosEvent.js';

export default async function getMe(user, ip, lang) {
  let id;
  let name;
  let username;
  let userlvl;
  let havePassword;
  let blockDm;
  let priv;

  /* [[id, name], ...] */
  let blocked;
  /* { type: [cid, name, lastTs, lastReadTs, muted, avatarId] } */
  let channels = {
    [CHANNEL_TYPES.PUBLIC]: chatProvider.getAccessiblePublicChannels(lang),
  };

  if (user) {
    ({
      id, name, username, userlvl, blockDm,
      isPrivate: priv,
      hasPassword: havePassword,
    } = user);
  } else {
    id = 0;
    name = null;
    username = null;
    userlvl = USERLVL.ANONYM;
    havePassword = false;
    blockDm = false;
    priv = false;
    blocked = [];
  }

  /*
   * make sure ip.getAllowance() if fetched here to make a user.touch() possible
   * later
   */
  const [ranks, chatData] = await Promise.all([
    (user) ? getUserRanks(id) : null,
    (user) ? getUserChatData(id) : null,
    user && ip.getAllowance(),
  ]);

  user?.touch(ip.ipString);
  ip.touch();

  if (chatData) {
    blocked = chatData.blocked;
    channels = {
      ...channels,
      ...chatData.channels,
    };
  }

  const me = {
    id, name, username, userlvl, havePassword, blockDm, priv, channels, blocked,
  };

  if (ranks) {
    const [
      totalPixels,
      dailyTotalPixels,
      ranking,
      dailyRanking,
    ] = ranks;
    me.totalPixels = totalPixels;
    me.dailyTotalPixels = dailyTotalPixels;
    me.ranking = ranking;
    me.dailyRanking = dailyRanking;
  } else {
    me.totalPixels = 0;
    me.dailyTotalPixels = 0;
    me.ranking = 0;
    me.dailyRanking = 0;
  }

  if (user && TIMEBLOCK_USERS) {
    const timeBlockProps = TIMEBLOCK_USERS.get(user.id);
    if (timeBlockProps) {
      [me.replacementInterval, me.replacementMessage] = timeBlockProps;
    }
  }
  if (TIMEBLOCK_IPS && !me.replacementMessage) {
    const timeBlockProps = TIMEBLOCK_IPS.get(ip.ipString);
    if (timeBlockProps) {
      [me.replacementInterval, me.replacementMessage] = timeBlockProps;
    }
  }

  // eslint-disable-next-line max-len
  if (USE_MAILER && userlvl >= USERLVL.REGISTERED && userlvl < USERLVL.VERIFIED) {
    me.messages = ['not_verified'];
  }

  if (user?.id) {
    try {
      me.nameStyle = await getNameStyle(user.id);
      /* kendi profilimde de çerçevem hemen görünsün (diğerleri websocket ile alır) */
      try {
        const effects = await getActiveItemEffects(user.id);
        me.frameStyle = effects.frameEffect || 'none';
      } catch {
        me.frameStyle = 'none';
      }
    } catch {
      me.nameStyle = 'none';
    }
  } else {
    me.nameStyle = 'none';
  }

  // Live chaos event end timestamp (ms) so refresh restores the banner
  me.chaosEnd = getChaosEndTs();

  return me;
}
