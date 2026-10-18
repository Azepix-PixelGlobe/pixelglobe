/*
 * chat mutes
 */
import client from './client.js';

const MUTEC_PREFIX = 'mutec';

/**
 * check if country is allowed to send message in given channel
 * @param country country code
 * @param channelId channelid
 * @param ipString ip as string
 * @return boolean, true if allowed
 */
export async function isCountryMuted(country, channelId) {
  const countryMute = await client.hGet(
    `${MUTEC_PREFIX}:${channelId}`, country,
  );
  return countryMute !== null;
}

/*
 * mute country from channel
 * @param channelId
 * @param cc country code
 * @returns 1 if muted, 0 if already was muted, null if invalid
 */
export function mutec(channelId, cc) {
  if (!cc || cc.length !== 2) {
    return null;
  }
  const key = `${MUTEC_PREFIX}:${channelId}`;
  return client.hSetNX(key, cc, '');
}

/*
 * unmute country from channel
 * @param channelId
 * @param cc country code
 * @return boolean if unmute successful, null if invalid
 */
export async function unmutec(channelId, cc) {
  if (!cc || cc.length !== 2) {
    return null;
  }
  const key = `${MUTEC_PREFIX}:${channelId}`;
  const ret = await client.hDel(key, cc);
  return ret !== 0;
}

/*
 * unmute all countries from channel
 * @param channelId
 * @return boolean for success
 */
export async function unmutecAll(channelId) {
  const key = `${MUTEC_PREFIX}:${channelId}`;
  const ret = await client.del(key);
  return ret !== 0;
}

/*
 * get list of muted countries
 * @param channelId
 * @return array with country codes that are muted
 */
export async function listMutec(channelId) {
  const key = `${MUTEC_PREFIX}:${channelId}`;
  const ret = await client.hKeys(key);
  return ret;
}
