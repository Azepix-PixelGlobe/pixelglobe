/*
 * route providing javascript challenge
 */
import logger from '../core/logger.js';
import requestChallenge from '../core/challengeserver.js';
import { registerChallenge } from '../data/sql/Captcha.js';
import netGuard from '../utils/netguard.js';

async function challenge(req, res) {
  /*
   * GÜVENLİK: captcha ile aynı gerekçe — oturumsuz ve CPU/Db maliyetli uç.
   */
  req.tickRateLimiter(20000);
  if (!netGuard.quota(`challenge:${req.ip.ipString}`, 120, 10 * 60 * 1000)) {
    res.status(429).type('application/javascript')
      .send("console.log('Çok fazla doğrulama isteği');");
    return;
  }

  res.set({
    'Cache-Control': 'no-cache, no-store, must-revalidate',
    'Content-Type': 'application/javascript; charset=UTF-8',
  });

  if (req.csrfPossible) {
    res.status(403);
    res.send(

      'console.log(\'JS Challenge experienced an server error 403\');',
    );
    return;
  }

  try {
    /* ensures IP table is populated */
    await req.ip.getAllowance();
    const { ipString } = req.ip;
    const { browserHash } = req.device;

    let solution;
    let data;
    let needCaptcha;
    /* eslint-disable no-await-in-loop */
    let retries = 3;
    while (typeof needCaptcha !== 'boolean' && retries) {
      /*
       * challenge data could return duplicate solution, so we retry
       */
      retries -= 1;
      const challengeData = await new Promise((resolve) => {
        requestChallenge((...args) => resolve(args));
      });

      // error return
      if (challengeData[0]) {
        throw new Error(challengeData[0]);
      }
      [, solution, data] = challengeData;

      try {
        needCaptcha = await registerChallenge(solution, browserHash, ipString);
      } catch (error) {
        if (error.code !== 'ER_DUP_ENTRY') {
          console.error(`SQL Error on registerChallenge: ${error.message}`);
          throw new Error('SQL Error on registering Challenge');
        }
      }
    }
    /* eslint-enable no-await-in-loop */
    if (typeof needCaptcha !== 'boolean') {
      throw new Error('Could not generate unique Challenge');
    }

    logger.info(
      `CHALLENGE ${ipString} got challenge with solution: ${solution}`,
    );

    res.end(data);
  } catch (err) {
    if (!res.writableEnded) {
      res.status(503);
      res.send(

        'console.log(\'JS Challenge experienced an server error 503\');',
      );
    }
    logger.warn(err.message);
  }
}

export default challenge;
