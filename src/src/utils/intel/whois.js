/*
 * get information from ip
 */

import net from 'net';

import { isIPv6, ipSubnetToHex } from './ip.js';
import { OUTGOING_ADDRESS } from '../../core/config.js';

const WHOIS_PORT = 43;
const QUERY_SUFFIX = '\r\n';
const WHOIS_TIMEOUT = 10000;

/**
 * parse whois return into fields
 */
function parseSimpleWhois(whois) {
  const groups = [];
  const lines = whois.split('\n');

  let lastLabel;
  let group = {};

  for (let i = 0; i < lines.length; i += 1) {
    let line = lines[i].trim();

    if ((!line || line.startsWith('# end') || line.startsWith('% end'))
      && Object.keys(group).length
    ) {
      groups.push(group);
      group = {};
      continue;
    }

    if (!line || line.startsWith('#') || line.startsWith('%')) {
      continue;
    }

    // strip network prefix for rwhois
    if (line.startsWith('network:')) {
      line = line.slice(8);
    }

    const sep = line.indexOf(':');
    let label;
    let value;
    if (sep !== -1) {
      label = line.substring(0, sep).toLowerCase();
      lastLabel = label;
      value = line.substring(sep + 1).trim();
    } else {
      label = lastLabel;
      value = line;
    }

    if (!value || value.includes('---')) {
      continue;
    }

    if (group[label]) {
      if (Array.isArray(group[label])) {
        group[label].push(value);
      } else {
        group[label] = [group[label], value];
      }
    } else {
      group[label] = value;
    }
  }

  return groups;
}

/**
 * parse whois return
 * @param ip ip string
 * @param whois whois return
 * @return object with whois data
 */
function parseWhois(ip, whoisReturn) {
  const data = {};
  if (!whoisReturn) {
    return data;
  }
  const whoisGroups = parseSimpleWhois(whoisReturn);
  let whoisData = {};
  whoisGroups.forEach((g) => {
    whoisData = { ...whoisData, ...g };
  });

  let range = whoisData.inetnum || whoisData.inet6num || whoisData.cidr
    || whoisData.netrange || whoisData.route || whoisData.route6
    || whoisData['ip-network'] || whoisData['auth-area'];
  range = ipSubnetToHex(range, ip);
  if (range) data.range = range;

  let org = whoisData['org-name']
    || whoisData.organization
    || whoisData.orgname
    || whoisData.descr
    || whoisData['mnt-by']
    || whoisData.person
    || whoisData.owner
    || whoisData.address;
  if (Array.isArray(org)) [org] = org;
  if (org?.endsWith('-MNT')) org = org.slice(0, -4);
  if (org) data.org = org;

  let descr = whoisData.netname || whoisData.descr;
  if (Array.isArray(descr)) [descr] = descr;
  if (descr) data.descr = descr;

  let asn = whoisData.asn
    || whoisData.origin
    || whoisData.originas
    || whoisData['aut-num'];
  if (asn) {
    // use only first ASN from possible list
    if (Array.isArray(asn)) {
      [asn] = asn;
    }
    asn = asn.split(',')[0].split('\n')[0];
    // only number
    if (asn.startsWith('AS')) {
      asn = asn.slice(2);
    }
    const dotIndex = asn.indexOf('.');
    if (dotIndex === -1) {
      // asplain
      asn = parseInt(asn, 10);
      if (!Number.isNaN(asn)) {
        data.asn = asn;
      }
    } else {
      // asdot
      const p1 = parseInt(asn.slice(0, dotIndex), 10);
      const p2 = parseInt(asn.slice(dotIndex + 1), 10);
      if (!Number.isNaN(p1) && !Number.isNaN(p2)) {
        data.asn = (p1 << 16) | p2;
      }
    }
  }

  let country = whoisData.country || whoisData['country-code'];
  if (Array.isArray(country)) [country] = country;
  if (country) {
    data.country = country.slice(0, 2).toLowerCase();
  }

  return data;
}

/**
 * send a raw whois query to server
 * @param query
 * @param hostInput host with or without port
 */
function singleWhoisQuery(
  query,
  hostInput,
) {
  const options = {
    timeout: WHOIS_TIMEOUT,
  };

  const pos = hostInput.indexOf(':');
  if (~pos) {
    // split port if neccessary
    options.host = hostInput.slice(0, pos);
    options.port = hostInput.slice(pos + 1);
  } else {
    options.host = hostInput;
    options.port = WHOIS_PORT;
  }
  if (OUTGOING_ADDRESS) {
    options.localAddress = OUTGOING_ADDRESS;
    options.family = isIPv6(OUTGOING_ADDRESS) ? 6 : 4;
  }

  return new Promise((resolve, reject) => {
    let data = '';
    const socket = net.createConnection(
      options,
      () => socket.write(query + QUERY_SUFFIX),
    );
    socket.on('data', (chunk) => { data += chunk; });
    socket.on('close', () => resolve(data));
    socket.on('timeout', () => socket.destroy(new Error('Timeout')));
    socket.on('error', reject);
  });
}

/*
 * check if whois result is referring us to
 * a different whois server
 */
const referralKeys = [
  'whois:',
  'refer:',
  'ReferralServer:',
];
function checkForReferral(whoisResult, host) {
  for (let u = 0; u < referralKeys.length; u += 1) {
    const key = referralKeys[u];
    const pos = whoisResult.indexOf(key);
    if (~pos) {
      const line = whoisResult.slice(
        whoisResult.lastIndexOf('\n', pos) + 1,
        whoisResult.indexOf('\n', pos),
      ).trim();
      if (!line.startsWith(key)) {
        continue;
      }
      let value = line.slice(line.indexOf(':') + 1).trim();
      const prot = value.indexOf('://');
      if (~prot) {
        value = value.slice(prot + 3);
      }
      return value;
    }
  }
  /*
   * lacninc can be weird sometimes and return false requested
   * arin responses
   */
  if (host === 'whois.lacnic.net'
    && whoisResult.indexOf('ARIN WHOIS data') !== -1
    && whoisResult.indexOf('Query terms are ambiguous.') !== -1
  ) {
    return 'whois.arin.net';
  }
  return null;
}

/**
 * whois ip
 * @param ip ip as string
 * @param host whois host (optional)
 * @returns null | {
 *   range as [start: hex, end: hex, mask: number],
 *   org as string,
 *   descr as string,
 *   asn as unsigned 32bit integer,
 *   country as two letter lowercase code,
 *   referralHost as string,
 *   referralRange as [start: hex, end: hex, mask: number],
 *   originHost
 * }
 */
export default async function whoisIp(ip, options) {
  let host = options?.host || 'whois.iana.org';
  const originHost = host;
  const logger = options?.logger || console;

  try {
    let whoisResult;
    let prevResult;
    let prevHost;
    let refCnt = 0;
    while (refCnt < 5) {
      let queryPrefix = '';
      if (host === 'whois.arin.net') {
        queryPrefix = '+ n';
      } else if (host === 'whois.ripe.net') {
        /*
        * flag to not return personal information, otherwise
        * RIPE is gonna rate limit and ban
        */
        queryPrefix = '-r';
      }

      try {
        // eslint-disable-next-line no-await-in-loop
        whoisResult = await singleWhoisQuery(`${queryPrefix} ${ip}`, host);
        const ref = checkForReferral(whoisResult, host);
        if (!ref) {
          break;
        }
        prevResult = whoisResult;
        prevHost = host;
        host = ref;
      } catch (err) {
        logger.error(`WHOIS Error ${ip} ${host}: ${err.message}`);
        host = prevHost;
        break;
      }
      refCnt += 1;
    }

    let result = parseWhois(ip, whoisResult);
    if (!result.range) {
      logger.error(
        `WHOIS Error ${ip} ${host}: This host gives incomplete results.`,
      );
      host = prevHost;
    }
    if (prevResult) {
      const pastWhois = parseWhois(ip, prevResult);
      if (host && host !== originHost && pastWhois.range) {
        result.referralHost = host;
        result.referralRange = pastWhois.range;
      }
      result = { ...pastWhois, ...result };
    }

    if (!result.asn && host !== 'whois.ripe.net') {
      /*
      * if we don't have any asn, query ripe once,
      * this is sometimes needed for afrnic
      */
      const asnQResult = parseWhois(ip,
        await singleWhoisQuery(`-r ${ip}`, 'whois.ripe.net'),
      );
      if (asnQResult.asn) result.asn = asnQResult.asn;
    }

    if (!result.range) {
      throw new Error('Got no results');
    }

    return result;
  } catch (error) {
    logger.error(`WHOIS Error: ${ip} - ${error.message}`);
    return null;
  }
}
