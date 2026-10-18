/*
 * request mail change
 */

import mailProvider from '../../../core/MailProvider.js';

import { AuthLogger } from '../../../core/logger.js';
import { validateEMail } from '../../../utils/validation.js';
import { canonicalBaseUrl } from '../../../utils/pgHost.js';
import { checkMailOverShards } from '../../../utils/intel/index.js';
import { setEmail, getTPIDsOfUser } from '../../../data/sql/ThreePID.js';
import { setUserProperty } from '../../../data/sql/User.js';
import { USERLVL } from '../../../core/constants.js';
import socketEvents from '../../../socket/socketEvents.js';

export default async (req, res) => {
  const { body: { email }, ttag: { t, gettext } } = req;

  const errors = [];
  const validationError = validateEMail(email);
  if (validationError) {
    errors.push(gettext(validationError));
  } else if (await checkMailOverShards(email)) {
    errors.push(t`This email provider is not allowed`);
  }
  if (errors.length > 0) {
    res.status(400).json({ errors });
    return;
  }

  const { user, lang } = req;

  const ret = await setEmail(user.id, email, false);
  if (!ret) {
    throw new Error(t`Mail is already in use!`);
  }

  /*
   * this actually just adds a mail address, rather than removing an existing
   * one, so double-checking userlvl is kinda pointless here
   */
  const tpids = await getTPIDsOfUser(req.user.id);
  const { userlvl } = user;
  const hasVerified = tpids.some(({ verified }) => verified);
  /* make sure userlvl matches tpids */
  if (!hasVerified && userlvl <= USERLVL.VERIFIED
    && userlvl > USERLVL.REGISTERED
  ) {
    await setUserProperty(user.id, 'userlvl', USERLVL.REGISTERED);
    socketEvents.patchUserState(user.id, 'user', {
      op: 'setex',
      path: 'userlvl',
      value: USERLVL.REGISTERED,
    });
  } else if (hasVerified && userlvl === USERLVL.REGISTERED) {
    await setUserProperty(user.id, 'userlvl', USERLVL.VERIFIED);
    socketEvents.patchUserState(user.id, 'user', {
      op: 'setex',
      path: 'userlvl',
      value: USERLVL.VERIFIED,
    });
  }

  AuthLogger.addEmail(
    req.user, req.ip.country, email.substring(email.indexOf('@')),
  );

  /* GÜVENLİK: bağlantı kanonik adresten (Host başlığı sahtelenemez) */
  mailProvider.sendVerifyMail(email, user.name, canonicalBaseUrl(req.ip.getHost()), lang);

  res.json({
    success: true,
  });
};
