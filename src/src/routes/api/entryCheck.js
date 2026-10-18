import { checkVerificationSolutions } from '../../data/sql/Captcha.js';
import {
  BLOCK_PROXIES,
  ENTRY_CHECK_TIME,
} from '../../core/config.js';
import { sign } from '../../utils/hash.js';
import { ENTRY_COOKIE } from '../../middleware/entryCheck.js';
import { sessionCookieFlags, isSecureRequest } from '../../utils/pgCookie.js';

const HOUR = 60 * 60 * 1000;

const errorMessages = {
  1: 'Güvenlik testi zaman aşımına uğradı. Yeniden deneyin.',
  2: 'CAPTCHA yanıtı hatalı.',
  3: 'Geçersiz güvenlik testi.',
  4: 'Cihaz doğrulanamadı.',
  6: 'Tarayıcı doğrulanamadı.',
};

export default async function entryCheck(req, res) {
  req.tickRateLimiter(3000);

  const allowance = await req.ip.getAllowance();
  if (BLOCK_PROXIES && allowance.isProxy) {
    res.status(403).json({
      success: false,
      message: 'VPN veya proxy bağlantıları kabul edilmiyor.',
    });
    return;
  }

  const {
    captcha, captchaid, cs: challengeSolution,
  } = req.body || {};
  const result = await checkVerificationSolutions(
    captchaid,
    captcha,
    challengeSolution,
    req.device.browserHash,
    req.ip.ipString,
    null,
    true,
  );

  if (result !== 0) {
    res.status(result === 4 || result === 6 ? 403 : 400).json({
      success: false,
      message: errorMessages[result] || 'Robot doğrulaması başarısız.',
    });
    return;
  }

  const expiresAt = Date.now() + ENTRY_CHECK_TIME * HOUR;
  const value = [
    expiresAt,
    req.ip.ipHex,
    req.device.browserHash,
  ].join('.');
  /*
   * GÜVENLİK + ÇERÇEVE UYUMU: doğrulama çerezi, oturum çereziyle aynı
   * mantığı kullanır. Çerçeve içinden geliyorsa SameSite=None + Secure +
   * Partitioned yazılır (yoksa çerez saklanmaz ve kullanıcı her seferinde
   * robot testi görür). Normal ziyarette Lax kalır; HTTPS'te Secure olur
   * (eskiden her koşulda secure:false idi).
   */
  res.cookie(ENTRY_COOKIE, sign(value), {
    httpOnly: true,
    maxAge: ENTRY_CHECK_TIME * HOUR,
    path: '/',
    sameSite: 'lax',
    secure: isSecureRequest(req),
    ...sessionCookieFlags(req.headers, isSecureRequest(req)),
  });
  res.json({ success: true });
}
