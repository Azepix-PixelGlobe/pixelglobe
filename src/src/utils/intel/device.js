import crypto from 'crypto';

/**
 * analyse device of request
 * @param req expressjs request
 * @return {
 *   hash,
 *   browser,
 *   device,
 *   os,
 *   headerSignature,
 * }
 */
export function getDeviceInfo(req) {
  const { headers, rawHeaders } = req;
  let browser = 'Unknown';
  let os = 'Unknown';
  let device = 'Desktop';

  const uaPlatformCH = req.headers['sec-ch-ua-platform'];
  if (uaPlatformCH) {
    os = uaPlatformCH;
    if (os.startsWith('"')) {
      os = os.substring(1, os.length - 1);
    }
  }

  const uaMobileCH = req.headers['sec-ch-ua-mobile'];
  if (uaMobileCH === '?1') {
    device = 'Mobile';
  }

  let userAgent = req.headers['user-agent'];
  if (!userAgent) {
    userAgent = req.headers['sec-ch-ua'];
  }
  if (userAgent) {
    userAgent = userAgent.toLowerCase();

    if (userAgent.includes('opera')) {
      browser = 'Opera';
    } else if (userAgent.includes('brave')) {
      browser = 'Brave';
    } else if (userAgent.includes('edge') || userAgent.includes('edg/')) {
      browser = 'Edge';
    } else if (userAgent.includes('firefox')) {
      browser = 'Firefox';
    } else if (userAgent.includes('chrome') || userAgent.includes('chromium')) {
      browser = 'Chrome';
    } else if (userAgent.includes('safari')) {
      browser = 'Safari';
    }

    if (!uaMobileCH || !uaPlatformCH) {
      if (userAgent.includes('android')) {
        os = 'Android';
        device = 'Mobile';
      } else if (userAgent.includes('linux')) {
        os = 'Linux';
      } else if (userAgent.includes('Windows')) {
        os = 'Windows';
      } else if (userAgent.includes('macintosh')) {
        os = 'macOS';
        // eslint-disable-next-line max-len
      } else if (userAgent.includes('iphone') || userAgent.includes('ios') || userAgent.includes('ipad')) {
        os = 'iOS';
        device = 'Mobile';
      }
    }
  }

  let headerSignature = '';
  for (let i = 0; i < rawHeaders.length; i += 2) {
    const header = rawHeaders[i].toLowerCase();
    if (header.startsWith('sec')
      || header === 'connection' || header === 'accept'
    ) {
      headerSignature += rawHeaders[i].charAt(0);
    } else if (header === 'accept-language') {
      headerSignature += rawHeaders[i].charAt(7);
    }
  }

  if (headerSignature.length > 12) {
    headerSignature = headerSignature.substring(0, 12);
  }
  if (browser.length > 20) {
    browser = browser.substring(0, 20);
  }
  if (device.length > 20) {
    device = device.substring(0, 20);
  }
  if (os.length > 20) {
    os = os.substring(0, 20);
  }

  const hash = crypto.createHash('sha224')
    // eslint-disable-next-line max-len
    .update(headerSignature + browser + os + device + headers.accept + headers['accept-language'])
    .digest('base64url')
    .substring(0, 15);

  return { hash, device, browser, os, headerSignature };
}

/**
 * get a hash that is supposed to map to a session
 * @param req expressjs request
 * @return hash 15 characters long
 */
export function getBrowserHash(req) {
  const { headers } = req;

  let browserHash = crypto.createHash('sha224')
    .update(`${headers['user-agent']}${headers['host']}`);

  /*
    * some browsers deny br and zstd on websocket
    */
  let encoding = headers['accept-encoding'];
  if (encoding) {
    encoding = encoding.split(',').map((e) => e.trim())
      .filter(
        (e) => (e === 'gzip' || e === 'deflate' || e === 'compress'),
      ).join(',');
    browserHash.update(encoding);
  }

  /*
   * browsers scramble and change the quality values of languages for
   * fingerprint detection, but they will keep the order the same, to not have
   * the user be served a false language
   */
  let language = headers['accept-language'];
  if (language) {
    let separator = language.indexOf(',');
    if (separator !== -1) {
      language = language.substring(0, separator);
    }
    separator = language.indexOf(';');
    if (separator !== -1) {
      language = language.substring(0, separator);
    }
    browserHash.update(language);
  }

  browserHash = browserHash.digest('base64url').substring(0, 15);

  /*
  console.log('BROWSER HASH', browserHash, headers['user-agent'], headers.host,
    headers['accept-language'], headers['accept-encoding'],
  );
  */

  return browserHash;
}
