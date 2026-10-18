import express from 'express';

import { ensureLoggedIn } from '../../../middleware/session.js';
import { validatePasswordCompareReturn } from '../../../utils/validation.js';

import register from './register.js';
import verify from './verify.js';
import local from './local.js';
import logout from './logout.js';
// eslint-disable-next-line camelcase
import get_tpids from './get_tpids.js';
// eslint-disable-next-line camelcase
import remove_tpid from './remove_tpid.js';
// eslint-disable-next-line camelcase
import close_session from './close_session.js';
// eslint-disable-next-line camelcase
import revoke_consent from './revoke_consent.js';
// eslint-disable-next-line camelcase
import resend_verify from './resend_verify.js';
// eslint-disable-next-line camelcase
import change_passwd from './change_passwd.js';
// eslint-disable-next-line camelcase
import delete_account from './delete_account.js';
// eslint-disable-next-line camelcase
import change_mail from './change_mail.js';
// eslint-disable-next-line camelcase
import restore_password from './restore_password.js';

const router = express.Router();

/*
 * JSON APIs
 */

router.use((req, res, next) => {
  req.tickRateLimiter(3000);
  next();
});

router.get('/verify', verify);

router.post('/restore_password', restore_password);

router.post('/register', register);

router.post('/local', local);

router.use(ensureLoggedIn);

/*
 * require registered user after this point
 */

router.get('/logout', logout);

router.get('/get_tpids', get_tpids);

router.get('/resend_verify', resend_verify);

router.post('/revoke_consent', revoke_consent);

/*
 * require given password
 */

router.use((req, res, next) => {
  const passReturnCode = req.user.checkPassword(req.body?.password);
  if (passReturnCode !== 1) {
    /* remember that we do allow users to not have a password set */
    const errorString = validatePasswordCompareReturn(passReturnCode);
    if (errorString !== null) {
      res.status(401).json({ errors: [req.ttag.gettext(errorString)] });
      return;
    }
  }
  next();
});

router.post('/remove_tpid', remove_tpid);

router.post('/close_session', close_session);

router.post('/change_passwd', change_passwd);

router.post('/change_mail', change_mail);

router.post('/delete_account', delete_account);



export default router;
