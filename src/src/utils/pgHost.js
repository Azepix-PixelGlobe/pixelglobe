/*
 * pgHost — güvenli adres (host) çözümlemesi
 * ----------------------------------------
 * Neden gerekli?
 *   Host / x-forwarded-host başlıkları SALDIRGAN TARAFINDAN yazılabilir.
 *   Eski kod bu değeri doğrudan e-postalardaki bağlantılara koyuyordu:
 *     "Host: saldirgan.com" ile şifre sıfırlama maili gönderilirse, kurbanın
 *     aldığı bağlantı saldırganın sitesine gider ve sıfırlama kodu çalınır
 *     (CWE-640, reset-link poisoning). Aynı değer sayfaya gömülen
 *     window.ssv JSON'una da giriyordu.
 *
 * Çözüm:
 *   1) Biçim doğrulaması: sadece gerçek bir host adı geçebilir (harf, rakam,
 *      tire, nokta, isteğe bağlı port). "<", ">", "'", boşluk, "
", "/" gibi
 *      karakterler reddedilir.
 *   2) Bağlantılar için kanonik adres: MAIL_LINK_HOST (ayar) → Replit ortam
 *      değişkenleri (REPLIT_DOMAINS / REPLIT_DEV_DOMAIN) → UNSHARDED_HOST →
 *      isteğin doğrulanmış adresi. Replit değişkenleri kullanıcı girdisi
 *      olmadığı için sahtelenemez.
 */
import { MAIL_LINK_HOST, UNSHARDED_HOST } from '../core/config.js';

const HOST_PATTERN = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*(:\d{1,5})?$/i;

/** Tek bir host parçasını doğrular; geçersizse null döner. */
export function sanitizeHost(value) {
  if (typeof value !== 'string') return null;
  const host = value.trim().toLowerCase();
  if (!host || host.length > 253) return null;
  if (!HOST_PATTERN.test(host)) return null;
  /* port sınırı */
  const portMatch = host.match(/:(\d{1,5})$/);
  if (portMatch) {
    const port = Number(portMatch[1]);
    if (port < 1 || port > 65535) return null;
  }
  return host;
}

/** "https://x/path" → { proto, host } (geçersizse host null). */
export function splitBase(value) {
  const text = String(value || '');
  const match = text.match(/^([a-z][a-z0-9+.-]*):\/\/(.+)$/i);
  const proto = (match && match[1]) ? match[1].toLowerCase() : 'https';
  const raw = match ? match[2] : text;
  const host = sanitizeHost(raw.split('/')[0]);
  return { proto, host };
}

/** Replit'in kendi ortam değişkenlerinden adres (sahtelenemez). */
function envHost() {
  const domains = process.env.REPLIT_DOMAINS || process.env.REPLIT_DEV_DOMAIN || '';
  const first = String(domains).split(',')[0].trim();
  const clean = sanitizeHost(first);
  return clean || null;
}

/**
 * E-posta/bağlantı üretimi için güvenli taban adres ("https://host").
 * @param requestBase req.ip.getHost() çıktısı (proto + host)
 */
export function canonicalBaseUrl(requestBase) {
  const { proto, host } = splitBase(requestBase);
  const fromConfig = splitBase(MAIL_LINK_HOST || '').host
    || sanitizeHost(String(MAIL_LINK_HOST || ''));
  if (fromConfig) {
    return `https://${fromConfig}`;
  }
  const fromEnv = envHost();
  if (fromEnv) {
    return `https://${fromEnv}`;
  }
  const fromUnsharded = splitBase(UNSHARDED_HOST || '').host
    || sanitizeHost(String(UNSHARDED_HOST || ''));
  if (fromUnsharded) {
    return `https://${fromUnsharded}`;
  }
  /* isteğin kendi adresi: yalnızca biçimi geçerliyse kullanılır */
  if (host) {
    const safeProto = (proto === 'http') ? 'http' : 'https';
    return `${safeProto}://${host}`;
  }
  return 'http://localhost';
}

/** Sayfaya gömülecek JSON'u script etiketi içinde güvenli hale getirir. */
export function jsonForScript(value) {
  return JSON.stringify(value)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}

export default {
  sanitizeHost, splitBase, canonicalBaseUrl, jsonForScript,
};
