/**
 *
 * Storing third party IDs for oauth login
 */

import pool from './mariadb.js';

import { THREEPID_PROVIDERS } from '../../core/constants.js';

/**
 * upsert a tpid
 * @param uid user id
 * @param provider THREEPID_PROVIDERS
 * @param tpid threepid string
 * @param verified whether or not verified
 * @return boolean success
 */
export async function addOrReplaceTpid(uid, provider, tpid, verified) {
  try {
    await pool.query(
      `INSERT INTO ThreePIDs (uid, provider, tpid, verified) VALUES (?, ?, ?, ?)
ON DUPLICATE KEY UPDATE
  uid = VALUES(uid),
  verified = VALUES(verified),
  lastSeen = VALUES(lastSeen)`,
      [uid, provider, tpid, verified ? 1 : 0],
    );
  } catch (error) {
    console.error(`SQL Error on addOrReplaceTpid: ${error.message}`);
    return false;
  }
  return true;
}

/**
 * remove a tpid from a user
 * @param uid user id
 * @param id tpid id
 * @param hasPassword if the user has a password set
 * @return [returnCode, newUserlvl]
 *   0: success
 *   1: user doesn't exist
 *   2: no such tpid
 *   3: would make user incapable of logging in
 *   -1: error
 */
export async function removeTpidFromUser(uid, id, hasPassword) {
  try {
    const [model] = await pool.query(
      'CALL REMOVE_THREEPID_FROM_USER(?, ?, ?)',
      [uid, id, hasPassword ? 1 : 0],
    );
    if (model.length) {
      const { result, userlvl = null } = model[0];
      return [result, userlvl];
    }
  } catch (error) {
    console.error(`SQL Error on removeTpidFromUser: ${error.message}`);
  }
  return [-1, null];
}

/**
 * get email of a user, it will only return one, even if there could
 * be multiple
 * @param uid
 * @return false if none exists | null if error | email otherwise
 */
export async function getEmailOfUser(uid) {
  try {
    const [model] = await pool.query(
      'SELECT tpid FROM ThreePIDs WHERE uid = ? AND provider = ? LIMIT 1',
      [uid, THREEPID_PROVIDERS.EMAIL],
    );
    if (model) {
      return model.tpid;
    }
    return false;
  } catch (error) {
    console.error(`SQL Error on getEmailOfUser: ${error.message}`);
    return null;
  }
}

/**
 * get all ThreePIDs of user
 * @param uid user id
 * @return Promise<[{
 *   id, tpid, provider, verified },
 *   ...
 * ]>
 */
export function getTPIDsOfUser(uid) {
  return pool.query(
    'SELECT id, tpid, provider, verified FROM ThreePIDs WHERE uid = ?', [uid],
  );
}

/**
 * get histry of ThreePIDs of user
 * @param uid user id
 * @return Promise<[{
 *   tpid, normalizedTpid, provider, verified, lastSeen, createdAt },
 *   ...
 * ]>
 */
export function getTPIDHistoryOfUser(uid) {
  return pool.query(
    // eslint-disable-next-line max-len
    'SELECT id, tpid, provider, verified, lastSeen FROM ThreePIDHistories WHERE uid = ?',
    [uid],
  );
}

/**
 * add email to user
 * @param uid user id
 * @param email email string
 * @param verified whether or not the email got verified
 * @param return boolean if email got set, false if email already exists for
 *   different user, null if error
 */
export async function setEmail(uid, email, verified) {
  if (!uid || !email) {
    return null;
  }

  try {
    const [model] = await pool.query(
      'CALL ADD_THREEPID_TO_USER(?, ?, ?, ?)',
      [uid, email, THREEPID_PROVIDERS.EMAIL, verified ? 1 : 0],
    );
    if (model?.length) {
      const { result } = model[0];
      return !!((result === 0 || result === 1));
    }
  } catch (error) {
    console.error(`SQL Error on setEmail: ${error.message}`);
    throw error;
  }
  return null;
}
