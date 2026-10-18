/*
 * captcha and js challenge
 */
import pool from './mariadb.js';

import anyAscii from '../../utils/asciimap/index.js';
import { giveBadgeToUserNX } from './Goodies.js';
import {
  CAPTCHA_TIME, TRUSTED_TIME,
} from '../../core/config.js';

/**
 * store captcha and its solution in database, may throw
 * @param captchaId id of captcha (11 char string)
 * @param captchaSolution solution of captcha (4 char string)
 * @param browserHash hash string of browser
 * @param ipString
 * @return needChallenge boolean whether challenge is also needed
 */
export async function registerCaptcha(
  captchaId, captchSolution, browserHash, ipString,
) {
  const [[{ needChallenge }]] = await pool.query(
    'CALL REGISTER_CAPTCHA(?, ?, ?, ?)', [
      captchaId, captchSolution, browserHash, ipString,
    ],
  );
  return needChallenge !== 0;
}

/**
 * store captcha and its solution in database, may throw
 * @param challengeSolution solution of challenge (32 bit signed int)
 * @param browserHash hash string of browser
 * @param ipString
 * @return needCaptcha boolean whether captcha is also needed
 */
export async function registerChallenge(
  challengeSolution, browserHash, ipString,
) {
  const [[{ needCaptcha }]] = await pool.query(
    'CALL REGISTER_CHALLENGE(?, ?, ?)', [
      challengeSolution, browserHash, ipString,
    ],
  );
  return needCaptcha !== 0;
}

/**
 * get captcha and js challenge status for ip
 * @param ipString ip as string
 * @return {
 *   challengeExpiresTs, captchaExpiresTs
 * } expiration timestamps are null if it never expires
 */
export async function getIPVerification(ipString) {
  if (CAPTCHA_TIME < 0) {
    const futureTs = Date.now() + 3600 * 1000;
    return {
      challengeExpiresTs: futureTs,
      captchaExpiresTs: futureTs,
    };
  }
  try {
    const [ipVerification] = await pool.query(
      `SELECT
IF(t.ip IS NOT NULL, UNIX_TIMESTAMP(t.expires) * 1000, 0) AS challengeExpiresTs,
IF(h.ip IS NOT NULL, UNIX_TIMESTAMP(h.expires) * 1000, 0) AS captchaExpiresTs
FROM (SELECT IP_TO_BIN(?) AS ip ) AS dummy
  LEFT JOIN IPHumans h ON h.ip = dummy.ip
  LEFT JOIN IPTrusts t ON t.ip = dummy.ip`,
      [ipString],
    );

    return ipVerification;
  } catch (error) {
    console.error(`SQL Error on getIPVerification: ${error.message}`);
  }
  return { challengeExpiresTs: 0, captchaExpiresTs: 0 };
}

/**
 * force a captcha on a ip (needs a socket reload as well)
 * @param ipString
 */
export async function forceCaptcha(ipString) {
  try {
    await pool.query(
      'DELETE FROM IPHumans WHERE ip = IP_TO_BIN(?)', [ipString],
    );
  } catch (error) {
    console.error(`SQL Error on forceCaptcha: ${error.message}`);
  }
}

/**
 * force captchas on all
 */
export async function resetAllCaptchas() {
  try {
    await pool.query('DELETE FROM IPHumans');
    await pool.query('DELETE FROM IPTrusts');
  } catch (error) {
    console.error(`SQL Error on resetAllCaptchas: ${error.message}`);
  }
}

/**
 * resolve solutions of challenge and/or captcha
 * @param captchaId 11 char captcha id | null
 * @param captchaSolution four character string | null
 * @param challengeSolution solution of challenge (32 bit signed int) | null
 * @param browserHash hash string of browser
 * @param ipStrings
 * @param userId optional user id
 * @param isOneTime if captcha is only one time, or should be cached for ip
 * @return number
 *   0 success
 *   1 timed out
 *   2 user failed the captcha
 *   3 something invalid
 *   4 device error
 *   5 unused [would trigger refresh on client]
 *   6 challenge failed
 */
export async function checkVerificationSolutions(
  captchaId, captchaSolutionInput, challengeSolution,
  browserHash, ipString, userId,
  isOneTime,
) {
  let emojiOnly = false;
  let captchaSolution;

  if (captchaId || captchaSolutionInput) {
    if (typeof captchaSolutionInput !== 'string'
      || typeof captchaId !== 'string'
    ) {
      return 3;
    }
    captchaSolutionInput = captchaSolutionInput.trim();
    captchaId = captchaId.trim();
    /*
     * remember that the length of a string is not the amount of characters,
     * if there is UTF-8 involved
     */
    if (captchaSolutionInput.length > 16 || captchaSolutionInput.length < 4) {
      return 3;
    }
    /*
     * converts funny characters to similar looking ascii
     */
    [captchaSolution, emojiOnly] = anyAscii(captchaSolutionInput);
    if (captchaSolution.length > 4) {
      captchaSolution = captchaSolution.substring(0, 4);
    }
  }
  if (typeof challengeSolution === 'undefined') {
    challengeSolution = null;
  } else if (challengeSolution !== null
    && typeof challengeSolution !== 'number'
  ) {
    challengeSolution = Number(challengeSolution);
    if (!challengeSolution && challengeSolution !== 0) {
      return 3;
    }
  }
  /*
   * one-time needs both captcha and challenge
   */
  if (isOneTime && (!captchaId || !challengeSolution)) {
    return 3;
  }

  try {
    const [[{
      captchaReturn,
      challengeReturn,
      captchaExpiresTs,
      challengeExpiresTs,
      captchaBrowserHash,
      challengeBrowserHash,
    }]] = await pool.query(
      'CALL CHECK_VERIFICATION_SOLUTIONS(?, ?, ?, ?, ?, ?, ?, ?)', [
        captchaId, captchaSolution, challengeSolution, browserHash, ipString,
        isOneTime ? 1 : 0, CAPTCHA_TIME, TRUSTED_TIME,
      ],
    );

    if (captchaReturn === 4) {
      console.log(
        // eslint-disable-next-line max-len
        `CAPTCHAS: hash mismatch ${browserHash} ${captchaBrowserHash} ${challengeBrowserHash} ${userId} ${ipString} ${isOneTime}`,
      );
    }

    if (isOneTime) {
      if (captchaReturn === 0 && challengeReturn === 0) {
        return 0;
      }
    } else {
      const currentTs = Date.now();
      if ((captchaExpiresTs === null || captchaExpiresTs > currentTs)
        && (challengeExpiresTs === null || challengeExpiresTs > currentTs)
      ) {
        if (emojiOnly && userId) {
          giveBadgeToUserNX('Emoji Enjoyer', captchaSolutionInput, userId);
        }
        return 0;
      }
    }
    if (captchaReturn === 3 || challengeReturn === 3) {
      return 1;
    }
    if (captchaReturn === 4 || challengeReturn === 4) {
      return 4;
    }
    if (challengeReturn === 2) {
      return 6;
    }
    if (captchaReturn === 5) {
      return 2;
    }
  } catch (error) {
    console.error(`SQL Error on checkVerificationSolutions: ${error.message}`);
  }
  return 3;
}
