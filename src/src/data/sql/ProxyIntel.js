/*
 * ProxyIntel — bir IP'nin proxy/VPN/Tor profilini çözer.
 * ------------------------------------------------------
 * `middleware/ip.js` sadece "proxy mi" (boolean) bilgisini dışarı verir.
 * Güvenlik ekranında ise "VPN mü, proxy mi, Tor mu?" ayrımı gerekiyor. Bu modül
 * `Proxies` tablosundaki bit maskesini (`isProxy`) ve proxycheck.io'nun
 * `type` alanını okur, insan okur bir kademe adı üretir.
 *
 * Not: Verinin kendisi mevcut altyapıdan (proxycheck.io + Proxies tablosu)
 * gelir; burada yeni bir dış servis çağrısı yapılmaz, sadece okuma yapılır.
 */
import pool from './mariadb.js';
import { PROXY_FLAGS } from '../../core/constants.js';

/** Bit maskesindeki kademeler, öncelik sırası ile (en ağır olan önce). */
const KIND_PRIORITY = [
  ['tor', PROXY_FLAGS.TOR],
  ['vpn', PROXY_FLAGS.VPN],
  ['proxy', PROXY_FLAGS.PROXY],
  ['proxy', PROXY_FLAGS.ANONYMOUS],
  ['hosting', PROXY_FLAGS.HOSTING],
  ['hosting', PROXY_FLAGS.SCRAPER],
  ['proxy', PROXY_FLAGS.COMPROMISED],
  ['proxy', PROXY_FLAGS.INVALID],
];

const KIND_LABELS = {
  tor: 'Tor exit node',
  vpn: 'VPN',
  proxy: 'Proxy / anonymizer',
  hosting: 'Datacenter / hosting IP',
};

export function kindFromMask(mask) {
  const value = Number(mask) || 0;
  if (!value) return null;
  for (let i = 0; i < KIND_PRIORITY.length; i += 1) {
    const [kind, flag] = KIND_PRIORITY[i];
    // eslint-disable-next-line no-bitwise
    if (value & (0x01 << flag)) return kind;
  }
  return 'proxy';
}

export function kindFromType(typeString) {
  const type = String(typeString || '').toLowerCase();
  if (!type) return null;
  if (type.includes('tor')) return 'tor';
  if (type.includes('vpn')) return 'vpn';
  if (type.includes('hosting') || type.includes('server') || type.includes('datacenter')) return 'hosting';
  if (type.includes('scraper')) return 'hosting';
  if (type.includes('proxy') || type.includes('socks') || type.includes('anonymous')) return 'proxy';
  return null;
}

export function labelOf(kind) {
  return KIND_LABELS[kind] || 'Unknown';
}

/**
 * IP için proxy profili.
 * @return null | {
 *   isProxy: boolean, kind: null|'vpn'|'proxy'|'tor'|'hosting',
 *   kindLabel, type, operator, city, risk, confidence, devices, expiresTs,
 * }
 */
export async function getProxyProfile(ipString) {
  if (!ipString) return null;
  try {
    const rows = await pool.query(
      `SELECT isProxy, type, operator, city, risk, confidence, devices,
COALESCE(UNIX_TIMESTAMP(expires) * 1000, 0) AS expiresTs
FROM Proxies WHERE ip = IP_TO_BIN(?) AND expires > NOW() LIMIT 1`,
      [ipString],
    );
    const row = Array.isArray(rows) ? rows[0] : null;
    if (!row) return null;
    const mask = Number(row.isProxy) || 0;
    const kind = kindFromMask(mask) || kindFromType(row.type);
    return {
      isProxy: mask > 0,
      kind: mask > 0 ? (kind || 'proxy') : null,
      kindLabel: mask > 0 ? labelOf(kind || 'proxy') : null,
      type: row.type || null,
      operator: row.operator || null,
      city: row.city || null,
      risk: Number(row.risk) || 0,
      confidence: Number(row.confidence) || 0,
      devices: Number(row.devices) || 0,
      host: null,
      expiresTs: Number(row.expiresTs) || 0,
    };
  } catch (error) {
    console.error(`SQL Error on getProxyProfile: ${error.message}`);
    return null;
  }
}

export default { getProxyProfile, kindFromMask, kindFromType, labelOf };
