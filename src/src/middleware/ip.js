/*
 * express middlewares for handling ip information
 */
import { USE_XREALIP, TIMEBLOCK_IPS } from '../core/config.js';
import { isTrustedPeer, looksLikeIp as isValidIpHeader } from '../utils/netguard.js';
import {
  sanitizeIPString, ipToHex, getHostFromRequest,
} from '../utils/intel/ip.js';
import { getIPIntelOverShards } from '../utils/intel/index.js';
import { queue } from '../utils/queue.js';
import { getIPAllowance, touchIP } from '../data/sql/IP.js';
import { getIPVerification } from '../data/sql/Captcha.js';
import { parseListOfBans } from '../data/sql/Ban.js';

const getIPAllowanceQueued = queue(getIPAllowance);

/*
 * Başlık biçimi doğrulaması ortak yardımcıdan gelir (utils/netguard.js →
 * looksLikeIp). Aksi halde saldırgan x-real-ip'ye istediği metni yazıp hem
 * ban'dan kaçar hem de veritabanına çöp IP satırı yazdırabilirdi.
 */

export class IP {
  /* expressjs request object */
  #req;
  /*
   * {
   *   lastSeen,
   *   isWhitelisted,
   *   isBanned,
   *   isProxy,
   *   country: two letter country code,
   *   whoisExpires: Date object for when whois expires,
   *   proxyCheckExpires: Date object for when proxycheck expires,
   * }
   */
  #allowance;
  /* null | boolean */
  isProxy = null;
  /* null | boolean */
  isBanned = null;
  /* null | boolean */
  isMuted = null;
  /* null | boolean */
  isWhitelisted = null;
  /*
   * timestamp when ban should be rechecked,
   * null means to never recheck (so if not banned or perma banned)
   */
  banRecheckTs = null;
  /*
   * if we need a captcha or challenge
   */
  captchaNeeded = true;
  challengeNeeded = true;
  /*
   * when to recheck for needed captcha or challenge
   */
  verificationRecheckTs = 0;

  constructor(req) {
    this.#req = req;
  }

  /**
   * @return ip as string, IPv6 cut to 64bit block
   */
  get ipString() {
    const req = this.#req;
    let ipString;
    /*
     * GÜVENLİK: x-real-ip başlığına sadece bağlantı gerçekten yerel/özel
     * ağdan gelen bir ters proxyden geliyorsa güvenilir; başlığın biçimi de
     * doğrulanır. Aksi halde TCP eş adresi kullanılır (başlık sahtelemesi).
     */
    const peer = req.connection?.remoteAddress || '';
    const header = req.headers['x-real-ip'];
    if (USE_XREALIP && isTrustedPeer(peer)
      && typeof header === 'string' && isValidIpHeader(header)) {
      ipString = header.trim();
    } else if (USE_XREALIP && typeof header === 'string' && !isTrustedPeer(peer)) {
      console.warn(`Süpheli x-real-ip başlığı yok sayıldı (eş: ${peer || 'yok'})`);
    }
    if (!ipString) {
      ipString = peer || '0.0.0.0';
    }
    ipString = sanitizeIPString(ipString);
    Object.defineProperty(this, 'ipString', { value: ipString });
    return ipString;
  }

  /**
   * @return null | string blockedInterval, blocked users can not see the
   * canvas during defined daytime, but see a message instead and can interact
   * with chat
   */
  get blockedInterval() {
    let blockedInterval;
    if (TIMEBLOCK_IPS) {
      const timeBlockProps = TIMEBLOCK_IPS.get(this.ipString);
      if (timeBlockProps) {
        [blockedInterval] = timeBlockProps;
      }
    } else {
      blockedInterval = null;
    }
    Object.defineProperty(this, 'blockedInterval', { value: blockedInterval });
    return blockedInterval;
  }

  /**
   * @return ip as hex string, IPv6 cut to 64bit block
   */
  get ipHex() {
    return ipToHex(this.ipString);
  }

  /**
   * @return ip as Number (IPv4) or BigInt (IPv6)
   */
  get ipNum() {
    const ipHex = `0x${this.ipHex}`;
    return (ipHex.lengh > 10) ? BigInt(ipHex) : Number(ipHex);
  }

  /**
   * @return lower case two letter country code of ip if given by header
   */
  get country() {
    const cc = this.#req.headers['cf-ipcountry'];
    if (cc) {
      return cc.toLowerCase();
    }
    /*
     * in case ttag middleware is loaded, get country of language
     */
    return this.#req.langCountry || 'xx';
  }

  toString() {
    return this.ipString;
  }

  toHex() {
    return this.ipHex;
  }

  toNum() {
    return this.ipNum;
  }

  /**
   * get host
   * @param includeProto include the http:// part (default true)
   * @param stripSub strip subdomains and heep the dot (default: false)
   * @return host from request
   */
  getHost(includeProto, stripSub) {
    return getHostFromRequest(this.#req, includeProto, stripSub);
  }

  /**
   * update lastSeen timestamps of IP
   * @return Promise<boolean>
   */
  touch() {
    if (!this.#allowance
      || this.#allowance.lastSeen.getTime() > Date.now() - 10 * 60 * 1000
    ) {
      return false;
    }
    return touchIP(this.ipString);
  }

  refresh() {
    this.verificationRecheckTs = 0;
    return this.getAllowance(true);
  }

  /**
   * fetch verification status (captcha, js challenge) of ip
   * @return { captchaNeeded, challengeNeeded }
   */
  async getVerification() {
    const currentTs = Date.now();
    if (this.verificationRecheckTs !== null
      && this.verificationRecheckTs < currentTs
    ) {
      const { ipString } = this;
      const {
        captchaExpiresTs, challengeExpiresTs,
      } = await getIPVerification(ipString);

      this.verificationRecheckTs = captchaExpiresTs;
      if (challengeExpiresTs !== null
        && challengeExpiresTs < this.verificationRecheckTs
      ) {
        this.verificationRecheckTs = challengeExpiresTs;
      }

      this.challengeNeeded = (
        challengeExpiresTs !== null && challengeExpiresTs < currentTs
      );
      this.captchaNeeded = (
        captchaExpiresTs !== null && captchaExpiresTs < currentTs
      );

      if (this.verificationRecheckTs !== null
        && this.verificationRecheckTs < currentTs
      ) {
        /* limit recheck time */
        this.verificationRecheckTs = currentTs + 3000;
      }
    }
    return {
      captchaNeeded: this.captchaNeeded,
      challengeNeeded: this.challengeNeeded,
    };
  }

  /**
   * fetch allowance data of ip
   * @param refresh whether we should refetch it, even if we have it already
   * @return { isBanned, isProxy, isMuted, isWhitelisted }
   */
  async getAllowance(refresh = false) {
    const currentTs = Date.now();

    if (!this.#allowance || refresh
      || this.#allowance.whoisExpiresTs < currentTs
      || this.#allowance.proxyCheckExpiresTs < currentTs
      || (this.banRecheckTs !== null && this.banRecheckTs < currentTs)
    ) {
      const { ipString } = this;
      const allowance = await getIPAllowanceQueued(ipString);

      /* fetch whois and proxycheck if needed */
      const needWhois = allowance.whoisExpiresTs < currentTs;
      const needProxyCheck = allowance.proxyCheckExpiresTs < currentTs;
      if (needWhois || needProxyCheck) {
        try {
          const [
            whoisData, proxyCheckData,
          ] = await getIPIntelOverShards(ipString, needWhois, needProxyCheck);

          if (whoisData) {
            allowance.whoisExpiresTs = whoisData.expiresTs;
            allowance.country = whoisData.country || 'xx';
          }

          if (proxyCheckData) {
            allowance.proxyCheckExpiresTs = proxyCheckData.expiresTs;
            allowance.isProxy = proxyCheckData.isProxy;
          }
        } catch (error) {
          console.error(`IP Error on getIPAllowance: ${error.message}`);
        }
      }

      /* prefer whois for country code over headers: overwrite getter */
      if (allowance.country) {
        Object.defineProperty(this, 'country', { value: allowance.country });
      }

      const [isBanned, isMuted, banRecheckTs] = parseListOfBans(allowance.bans);
      this.isBanned = isBanned;
      this.isMuted = isMuted;
      this.isWhitelisted = allowance.isWhitelisted;
      this.banRecheckTs = banRecheckTs;
      this.isProxy = !allowance.isWhitelisted && allowance.isProxy;
      this.#allowance = allowance;
    }
    return {
      isBanned: this.isBanned,
      isProxy: this.isProxy,
      isMuted: this.isMuted,
      isWhitelisted: this.isWhitelisted,
    };
  }
}

/*
 * express middleware to add IP object to request
 */
export function parseIP(req, res, next) {
  Object.defineProperty(req, 'ip', { value: new IP(req) });
  next();
}

/*
 * express middleware to resolve IP allowance in a promise under req.promise,
 * must be called after parseIP.
 * Promise can be resolved by './promises.js' middleware.
 * This has the purpose to allow other actions to happen while we wait.
 */
export async function ipAllowancePromisified(req, res, next) {
  if (!req.promise) {
    req.promise = [];
  }
  req.promise.push(req.ip.getAllowance());
  next();
}
