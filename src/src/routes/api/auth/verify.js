/*
 * verify mail address
 */

import socketEvents from '../../../socket/socketEvents.js';
import putHtmlIntoRedirectionModal from '../../../ssr/redirectionModal.js';
import { MailProvider } from '../../../core/MailProvider.js';
import { validateEMail } from '../../../utils/validation.js';
import { canonicalBaseUrl } from '../../../utils/pgHost.js';

export default async (req, res) => {
  const { email, token } = req.query;
  const { lang, ttag: { t } } = req;

  /* GÜVENLİK: doğrulama sonrası yönlendirme kanonik adrese yapılır */
  const host = canonicalBaseUrl(req.ip.getHost());
  const title = t`Mail verification`;
  const error = validateEMail(email);
  if (!error) {
    const userId = await MailProvider.verify(email, token);
    if (userId) {
      socketEvents.reloadUser(userId);
      const html = putHtmlIntoRedirectionModal(
        title, title,
        `<h1>${t`Mail verification`}</h1><p>${t`You are now verified :)`}</p>`,
        host, lang,
      );
      res.status(200).send(html);
      return;
    }
  }
  const html = putHtmlIntoRedirectionModal(
    title, title,
    // eslint-disable-next-line max-len
    `<h1>${t`Mail verification`}</h1><p>${t`Your mail verification code is invalid or already expired :(, please request a new one.`}</p>`,
    host, lang,
  );
  res.status(400).send(html);
};
