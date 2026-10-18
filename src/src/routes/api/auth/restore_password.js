/*
 * request password reset mail
 */

import { AuthLogger } from '../../../core/logger.js';
import mailProvider from '../../../core/MailProvider.js';
import { validateEMail } from '../../../utils/validation.js';
import netGuard from '../../../utils/netguard.js';
import { canonicalBaseUrl } from '../../../utils/pgHost.js';

async function validate(email, gettext) {
  const errors = [];
  const emailerror = gettext(validateEMail(email));
  if (emailerror) errors.push(emailerror);

  return errors;
}

export default async (req, res) => {
  const { ip: { ipString }, body: { email }, ttag: { gettext } } = req;

  const errors = validate(email, gettext);
  if (errors.length > 0) {
    res.status(400);
    res.json({
      errors,
    });
    return;
  }

  /*
   * GÜVENLİK: e-posta bombalama koruması.
   * Bir adrese saatte en fazla 3 sıfırlama maili, bir IP'den en fazla 10.
   */
  const mailKey = `pwreset:${String(email).toLowerCase()}`;
  if (!netGuard.quota(mailKey, 3) || !netGuard.quota(`pwresetip:${ipString}`, 10)) {
    res.status(429);
    res.json({
      errors: ['Çok fazla sıfırlama maili istendi. Lütfen 1 saat sonra tekrar dene.'],
    });
    return;
  }

  /*
   * GÜVENLİK: sıfırlama bağlantısı KANONİK adresten üretilir. Aksi halde
   * "Host: saldirgan.com" gönderen biri kurbanın mail kutusuna saldırganın
   * sitesine giden bir sıfırlama bağlantısı düşürebilirdi.
   */
  const host = canonicalBaseUrl(req.ip.getHost());
  const { lang } = req;
  const error = await mailProvider.sendPasswdResetMail(
    email, ipString, host, lang,
  );
  if (error) {
    AuthLogger.resetMailFailure(email, ipString);
    res.status(400);
    res.json({
      errors: [error],
    });
    return;
  }

  AuthLogger.sentResetMail(email, ipString);

  res.status(200);
  res.json({
    success: true,
  });
};
