import { AuthLogger } from '../../../core/logger.js';
import {
  createNewUser, getUsersByNameOrEmail,
} from '../../../data/sql/User.js';
import { getIIDofIP } from '../../../data/sql/IP.js';
import { addOrReplaceTpid } from '../../../data/sql/ThreePID.js';
import { checkVerificationSolutions } from '../../../data/sql/Captcha.js';
import mailProvider from '../../../core/MailProvider.js';
import getMe from '../../../core/me.js';
import { openSession } from '../../../middleware/session.js';
import { checkMailOverShards } from '../../../utils/intel/index.js';
import {
  validateEMail,
  validateName,
  validatePassword,
  validateUsername,
} from '../../../utils/validation.js';
import { THREEPID_PROVIDERS } from '../../../core/constants.js';
import { isPermanentlyBlockedUser } from '../../../core/config.js';
import netGuard from '../../../utils/netguard.js';
import { canonicalBaseUrl } from '../../../utils/pgHost.js';

async function validate(
  email, name, username, password, captcha, captchaid, t, gettext,
) {
  const errors = [];
  const nameerror = validateName(name);
  if (nameerror) errors.push(nameerror);
  const usernameerror = validateUsername(username);
  if (usernameerror) errors.push(usernameerror);
  const passworderror = gettext(validatePassword(password));
  if (passworderror) errors.push(passworderror);

  if (!captcha || !captchaid) {
    errors.push(t`No Captcha given`);
  }
  const emailerror = gettext(validateEMail(email));
  if (emailerror) errors.push(emailerror);

  return errors;
}

export default async (req, res) => {
  /*
   * GÜVENLİK: aynı IP'den saatte en fazla 5 kayıt denemesi.
   * Toplu sahte hesap açma / DB şişirme denemesini engeller (captcha'ya ek).
   */
  if (!netGuard.quota(`register:${req.ip.ipString}`, 5)) {
    res.status(429).json({
      errors: [
        'Bu bağlantıdan çok fazla kayıt denemesi yapıldı. Lütfen daha sonra tekrar dene.',
      ],
    });
    return;
  }

  const {
    email, name, password, captcha, captchaid, cs: challengeSolution,
  } = req.body;
  const { t, gettext } = req.ttag;
  const username = req.body.username?.toLowerCase();
  const errors = await validate(
    email, name, username, password, captcha, captchaid, t, gettext,
  );
  if (isPermanentlyBlockedUser({ name, username })) {
    errors.push('You are banned.');
  }

  const { ip } = req;
  if (!errors.length) {
    const captchaPass = await checkVerificationSolutions(
      captchaid, captcha, challengeSolution,
      req.device.browserHash, ip.ipString, null, true,
    );
    switch (captchaPass) {
      case 0:
        break;
      case 1:
        errors.push(t`You took too long, try again`);
        break;
      case 2:
        errors.push(t`You failed your captcha`);
        break;
      case 3:
        errors.push('No or invalid captcha text');
        break;
      case 4:
        errors.push(t`Your device looks weird`);
        break;
      case 6:
        errors.push(t`Your Browser looks shady`);
        break;
      default:
        errors.push(t`Unknown Captcha Error`);
        break;
    }
  }

  if (!errors.length) {
    const users = await getUsersByNameOrEmail(name, email, username);
    if (!users) {
      errors.push(t`Please try again.`);
    } else if (users.length) {
      if (users[0].byEMail) {
        errors.push(t`E-Mail already in use.`);
        console.log(`REGISTER: user already exists for ${email}:`, users);
      } else if (users[0].name === name) {
        errors.push(t`Name already in use.`);
        console.log(`REGISTER: user already exists for name ${name}:`, users);
      } else {
        errors.push(t`Username already in use.`);
        console.log(
          `REGISTER: user already exists for ${email}/${name}/${username}:`,
          users,
        );
      }
    }
  }

  if (!errors.length && (await checkMailOverShards(email))) {
    errors.push(t`This email provider is not allowed`);
  }

  if (!errors.length) {
    const { isBanned, isProxy } = await ip.getAllowance();
    if (isProxy) {
      errors.push(t`You can not register an account with a proxy`);
    }
    if (isBanned) {
      errors.push(t`You can not register an account while you are banned`);
    }
  }

  if (errors.length > 0) {
    res.status(400).json({ errors });
    return;
  }

  const user = await createNewUser(name, password, username);
  if (!user) {
    res.status(500);
    res.json({
      errors: [t`Failed to create a new user :(`],
    });
    return;
  }

  /*
   * we could allow registering without email if we change validation and
   * put this under an if
   */
  const [iid] = await Promise.all([
    getIIDofIP(ip.ipString),
    addOrReplaceTpid(user.id, THREEPID_PROVIDERS.EMAIL, email),
  ]);

  AuthLogger.newUser(
    user, email.substring(email.indexOf('@')), iid, ip.country,
  );

  /* session duration, null for permanent */
  let { durationsel: durationHours } = req.body;
  if (durationHours === 'forever') {
    durationHours = null;
  } else {
    durationHours = parseInt(durationHours, 10);
    if (Number.isNaN(durationHours)) {
      // default to 30 days if gibberish
      durationHours = 720;
    }
  }

  await openSession(req, res, user.id, durationHours);
  const me = await getMe(req.user, ip, req.lang);

  /* GÜVENLİK: doğrulama maili kanonik adresten (Host başlığı sahtelenemez) */
  const host = canonicalBaseUrl(req.ip.getHost());
  if (email) {
    mailProvider.sendVerifyMail(email, name, host, req.lang);
  }

  res.status(200);
  res.json({
    success: true,
    me,
  });
};
