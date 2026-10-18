/*
 * request resend of verification mail
 */

import mailProvider from '../../../core/MailProvider.js';
import { getEmailOfUser } from '../../../data/sql/ThreePID.js';
import { USERLVL } from '../../../core/constants.js';
import netGuard from '../../../utils/netguard.js';
import { canonicalBaseUrl } from '../../../utils/pgHost.js';

export default async (req, res) => {
  const { user, lang, ttag: { t } } = req;

  const { name, userlvl } = user;
  if (userlvl >= USERLVL.VERIFIED) {
    throw new Error(t`You are already verified.`);
  }

  const email = await getEmailOfUser(user.id);
  if (email === false) {
    throw new Error(
      // eslint-disable-next-line max-len
      t`You do not have any email adress set. Please add one under "Login Methods".`,
    );
  }
  if (!email) {
    throw new Error(t`An error occured. Please try again later.`);
  }

  /*
   * GÜVENLİK: aynı hesaba saatte en fazla 3 doğrulama maili (mail bombası önlemi).
   */
  if (!netGuard.quota(`resendverify:${req.user.id}`, 3)) {
    throw new Error(
      t`Too many mails requested, please try again in an hour.`,
    );
  }

  /* GÜVENLİK: bağlantı kanonik adresten üretilir */
  const host = canonicalBaseUrl(req.ip.getHost());
  const error = await mailProvider.sendVerifyMail(email, name, host, lang);
  if (error) {
    throw new Error(error);
  }
  res.json({
    success: true,
  });
};
