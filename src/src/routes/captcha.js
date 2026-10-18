/*
 * route providing captcha
 */
import logger from '../core/logger.js';
import { requestCaptcha } from '../core/captchaserver.js';
import { registerCaptcha } from '../data/sql/Captcha.js';
import netGuard from '../utils/netguard.js';

async function captcha(req, res) {
  /*
   * GÜVENLİK: bu uç oturum gerektirmez ve sunucuda PAHALI iş yapar
   * (SVG üretimi + veritabanına kayıt + IP sorgusu). Bu yüzden hem birim
   * maliyeti yükseltildi (dakikada ~30 istek) hem de ayrı bir kota kondu.
   * Normal oyuncu giriş/doğrulama başına 1-2 kez çağırır.
   */
  req.tickRateLimiter(20000);
  if (!netGuard.quota(`captcha:${req.ip.ipString}`, 120, 10 * 60 * 1000)) {
    res.status(429).json({ error: 'Çok fazla doğrulama isteği. Biraz bekleyip tekrar dene.' });
    return;
  }

  res.set({
    'Access-Control-Expose-Headers': 'captcha-id, challenge-needed',
    'Cache-Control': 'no-cache, no-store, must-revalidate',
  });

  if (req.csrfPossible) {
    res.status(403);
    res.set({ 'Content-Type': 'text/html; charset=utf-8' });
    res.send(
      // eslint-disable-next-line max-len
      '<html><body><h1>Captchaserver: 403 Server Error</h1>Cross-Site request rejected</body></html>',
    );
    return;
  }

  try {
    /* ensures IP table is populated */
    await req.ip.getAllowance();
    const { ipString } = req.ip;
    const { browserHash } = req.device;

    let data;
    let text;
    let id;
    let needChallenge;
    /* eslint-disable no-await-in-loop */
    let retries = 3;
    while (typeof needChallenge !== 'boolean' && retries) {
      /*
       * captcha data could return duplicate ids, so we retry if that is the
       * case
       */
      retries -= 1;
      const captchaData = await new Promise((resolve) => {
        requestCaptcha((...args) => resolve(args));
      });

      // error return
      if (captchaData[0]) {
        throw new Error(captchaData[0]);
      }
      [, text, data, id] = captchaData;

      try {
        needChallenge = await registerCaptcha(id, text, browserHash, ipString);
      } catch (error) {
        if (error.code !== 'ER_DUP_ENTRY') {
          console.error(`SQL Error on registerCaptcha: ${error.message}`);
          throw new Error('SQL Error on registering Captcha');
        }
      }
    }
    /* eslint-enable no-await-in-loop */
    if (typeof needChallenge !== 'boolean') {
      throw new Error('Could not generate unique Captcha');
    }

    res.set({
      'Content-Type': 'image/svg+xml',
      'Captcha-Id': id,
      'Challenge-Needed': needChallenge ? '1' : '0',
    });
    res.end(data);
  } catch (err) {
    if (!res.writableEnded) {
      res.status(503);
      res.set({ 'Content-Type': 'text/html; charset=utf-8' });
      res.send(
        // eslint-disable-next-line max-len
        '<html><body><h1>Captchaserver: 503 Server Error</h1>Maybe try it later again</body></html>',
      );
    }
    logger.warn(err.message);
  }
}

export default captcha;
