/*
 * Güvenlik başlıkları (helmet bağımlılığı olmadan, elle)
 *
 * ÖNEMLİ: Site, pixelglobee.gt.tc adresindeki sayfa içinde IFRAME olarak
 * çalışıyor. Bu yüzden X-Frame-Options ve CSP frame-ancestors BİLEREK
 * gönderilmiyor; gönderilirse oyun iframe içinde açılmaz.
 *
 * Mikrofon/kamera/ekran paylaşımı (R6 sesli-görüntülü arama) iframe'e
 * allow="..." ile devrediliyor; Permissions-Policy bu devri bozmayacak
 * şekilde "self" + domain olarak yazılıyor.
 */

const HSTS_VALUE = 'max-age=15552000; includeSubDomains';
const GT_DOMAIN = 'https://pixelglobee.gt.tc';

const PERMISSIONS = [
  'geolocation=()',
  'payment=()',
  'usb=()',
  'serial=()',
  'midi=()',
  'hid=()',
  'idle-detection=()',
  `microphone=(self "${GT_DOMAIN}")`,
  `camera=(self "${GT_DOMAIN}")`,
  `display-capture=(self "${GT_DOMAIN}")`,
].join(', ');

function isHttps(req) {
  if (req.secure) {
    return true;
  }
  const proto = req.headers['x-forwarded-proto'];
  if (typeof proto === 'string') {
    return proto.split(',')[0].trim() === 'https';
  }
  if (req.socket && req.socket.encrypted) {
    return true;
  }
  return false;
}

export default function securityHeaders() {
  return (req, res, next) => {
    res.set({
      /* MIME sniffing kapalı: yüklenen içerik türü değiştirilemez */
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'strict-origin-when-cross-origin',
      'X-DNS-Prefetch-Control': 'off',
      'X-Permitted-Cross-Domain-Policies': 'none',
      'X-XSS-Protection': '0',
      'Origin-Agent-Cluster': '?1',
      'Permissions-Policy': PERMISSIONS,
      'Cross-Origin-Resource-Policy': 'cross-origin',
    });
    if (isHttps(req)) {
      res.set('Strict-Transport-Security', HSTS_VALUE);
    }
    next();
  };
}
