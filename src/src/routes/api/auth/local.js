/*
 * local login with mail / name and password
 */
import { AuthLogger } from '../../../core/logger.js';
import { getUsersByNameOrEmail } from '../../../data/sql/User.js';
import { getIIDofIP } from '../../../data/sql/IP.js';
import { compareToHash } from '../../../utils/hash.js';
import socketEvents from '../../../socket/socketEvents.js';

import getMe from '../../../core/me.js';
import netGuard from '../../../utils/netguard.js';
import { isPermanentlyBlockedUser } from '../../../core/config.js';
import { openSession } from '../../../middleware/session.js';

export default async (req, res) => {
  req.tickRateLimiter(3000);
  const { ttag: { t }, body: { nameoremail, password }, ip } = req;

  /*
   * GÜVENLİK: kaba kuvvet (brute force) koruması.
   * IP bazlı: 8 hatalı deneme → 1 dk, 20 hatalı deneme → 15 dk kilit.
   * Hesap bazlı: 15 hatalı deneme → 10 dk kilit (dağıtık denemeye karşı).
   */
  const authState = netGuard.authCheck(ip.ipString, nameoremail);
  if (authState.locked) {
    res.status(429).json({
      errors: [
        'Çok fazla hatalı deneme yapıldı. Lütfen birkaç dakika sonra tekrar dene.',
      ],
    });
    return;
  }

  const users = await getUsersByNameOrEmail(nameoremail, null);

  try {
    if (!users || !users.length) {
      throw new Error(t`Name or Email does not exist!`);
    }
    if (users.some(isPermanentlyBlockedUser)) {
      throw new Error('You are banned.');
    }
    const user = users.find((u) => compareToHash(password, u.password));
    if (!user) {
      if (users.find((u) => u.password === 'hacked')) {
        throw new Error(
          // eslint-disable-next-line max-len
          t`This email / password combination got hacked and leaked. To protect this account, the password has been reset. Please use the "Forgot my password" function below to set a new password. In the future, consider not installing malware, Thank You.`,
        );
      }
      throw new Error('Incorrect password!');
    }

    /*
     * durationsel: session duration, null for permanent
     * returnToken: if set, we do not set cookie and return the token instead,
     *   this is used for reauthentification
     *
     */
    const { returnToken } = req.body;
    let { durationsel: durationHours } = req.body;
    if (returnToken) {
      /* only allow 15min for returned tokens */
      durationHours = 0.25;
    } else if (durationHours === 'forever') {
      durationHours = null;
    } else {
      durationHours = parseInt(durationHours, 10);
      if (Number.isNaN(durationHours)) {
        // default to 30 days if gibberish
        durationHours = 720;
      }
    }

    /* basarili giris: brute-force sayaclarini sifirla */
    netGuard.authOk(ip.ipString, nameoremail);

    const [token, iid] = await Promise.all([
      openSession(
        req, res, user.id, durationHours, returnToken,
      ),
      getIIDofIP(ip.ipString),
    ]);

    AuthLogger.login(req.user, iid, ip.country);

    const responseData = {
      success: true,
      me: await getMe(req.user, ip, req.lang),
    };
    if (returnToken) {
      responseData.token = token;
    } else {
      /* tell all clients of this ip to reload */
      res.on('finish', () => socketEvents.reloadIP(ip.ipString));
    }
    res.json(responseData);
  } catch (error) {
    /* GÜVENLİK: başarısız denemeyi kaydet (kademeli kilit) */
    netGuard.authFail(ip.ipString, nameoremail);
    res.status(401).json({
      errors: [error.message],
    });
  }
};
