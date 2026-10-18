/*
 * Çerez bayrakları — "iframe içinde giriş yapılamıyor, yenileyince oturum
 * düşüyor, oyun beni yeni oyuncu sanıyor" sorununun SUNUCU tarafı çözümü.
 *
 * Neden oluyor?
 *   pixelglobee.gt.tc sayfası oyunu bir çerçeve (iframe) içinde gösteriyor.
 *   Tarayıcı için bu, "başka bir siteye ait içerik" demek. Varsayılan çerez
 *   davranışı SameSite=Lax olduğu için oturum çerezi bu bağlamda NE SAKLANIR
 *   NE GÖNDERİLİR → kayıt/giriş başarısız, sayfa yenilenince oturum yok,
 *   hoş geldin mesajları tekrar eder.
 *
 * Çözüm: istek çerçeve içinden geldiyse çerezi üçüncü taraf uyumlu yaz:
 *   SameSite=None   → çerçeve bağlamında da gönderilir/saklanır
 *   Secure          → SameSite=None için zorunlu (HTTPS şart)
 *   Partitioned     → CHIPS: çerez üst-siteye göre bölümlenir (Chrome/Firefox)
 *
 * İstemci tarafındaki tamamlayıcı: utils/pgFrameFix.js (Storage Access API).
 */

export const SESSION_COOKIE_NAME = 'ppfun.session';

/** İstek, başka bir sitenin çerçevesinden mi geliyor? (Sec-Fetch-Site) */
export function isCrossSiteEmbed(headers = {}) {
  const site = String(headers['sec-fetch-site'] || '').toLowerCase();
  if (site === 'cross-site') return true;
  /* bazı eski tarayıcılar/paylaşımlar Sec-Fetch başlığı göndermez */
  const dest = String(headers['sec-fetch-dest'] || '').toLowerCase();
  const origin = String(headers.origin || '');
  return site === '' && dest === 'iframe' && origin !== '';
}

/** İstek HTTPS üzerinden mi geldi? (proxy arkasında x-forwarded-proto) */
export function isSecureRequest(req) {
  const forwarded = String((req && req.headers && req.headers['x-forwarded-proto']) || '');
  const proto = forwarded ? forwarded.split(',')[0].trim() : String((req && req.protocol) || '');
  if (proto) return proto === 'https';
  return !!(req && req.secure);
}

/**
 * Oturum çerezi için ek bayraklar.
 * Çerçeve içi + HTTPS değilse HİÇBİR ŞEY eklemiyoruz: SameSite=None'ı Secure
 * olmadan yazmak çerezi tamamen geçersiz kılardı (tarayıcı reddeder).
 */
export function sessionCookieFlags(headers = {}, secureRequest = false) {
  if (!isCrossSiteEmbed(headers)) return {};
  if (!secureRequest) return {};
  return { sameSite: 'none', secure: true, partitioned: true };
}

/** Temizleme (logout) için de AYNI bayraklar gerekir, yoksa çerez silinmez. */
export function clearCookieFlags(headers = {}, secureRequest = false) {
  return sessionCookieFlags(headers, secureRequest);
}

export default {
  SESSION_COOKIE_NAME, isCrossSiteEmbed, isSecureRequest, sessionCookieFlags, clearCookieFlags,
};
