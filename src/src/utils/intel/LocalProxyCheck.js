/*
 * Conservative local fallback for proxy/VPN detection.
 *
 * This is intentionally limited to explicit network-provider labels returned
 * by WHOIS. Generic hosting/cloud/VPS labels are not enough to block a user:
 * many legitimate users access the site from those networks.
 */
import { PROXY_FLAGS } from '../../core/constants.js';

const LOCAL_SIGNALS = [
  {
    flag: PROXY_FLAGS.TOR,
    type: 'Tor',
    patterns: [
      /\btor\b/i,
      /\btor[- ]?exit\b/i,
    ],
  },
  {
    flag: PROXY_FLAGS.VPN,
    type: 'VPN',
    patterns: [
      /\bvpn\b/i,
      /\bopenvpn\b/i,
      /\bwireguard\b/i,
      /\bexit[- ]?node\b/i,
    ],
  },
  {
    flag: PROXY_FLAGS.PROXY,
    type: 'Proxy',
    patterns: [
      /\bproxy\b/i,
      /\bsocks(?:4|5)?\b/i,
      /\bhttp[- ]proxy\b/i,
    ],
  },
  {
    flag: PROXY_FLAGS.ANONYMOUS,
    type: 'Anonymous',
    patterns: [
      /\banonymous\b/i,
      /\bprivacy[- ]relay\b/i,
    ],
  },
];

/**
 * Detect only explicit proxy/VPN labels from WHOIS data.
 *
 * @param whoisData the result of the existing WHOIS lookup
 * @return null | proxy-check shaped object
 */
export default function detectLocalProxy(whoisData) {
  if (!whoisData) {
    return null;
  }

  const subject = `${whoisData.org || ''} ${whoisData.descr || ''}`.trim();
  if (!subject) {
    return null;
  }

  const signal = LOCAL_SIGNALS.find(({ patterns }) => (
    patterns.some((pattern) => pattern.test(subject))
  ));
  if (!signal) {
    return null;
  }

  return {
    isProxy: 1 << signal.flag,
    type: signal.type,
    operator: (whoisData.org || whoisData.descr).slice(0, 60),
    risk: 70,
    confidence: 65,
    localDetection: true,
  };
}
