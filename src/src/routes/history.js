import http from 'http';
import https from 'https';

import logger from '../core/logger.js';
import { BACKUP_URL } from '../core/config.js';

const TIME_CACHE = new Map();

/*
 * parse nginx index page and return file and directory names
 * @param html html string
 * @return Array of files
 */
function getFilesFromHtml(html) {
  const links = [];
  let l = html.indexOf('href="');
  while (l !== -1) {
    const m = html.indexOf('"', l + 6);
    if (m !== -1) {
      let link = html.substring(l + 6, m);
      if (link.endsWith('/')) link = link.slice(0, -1);
      while (link.startsWith('.') || link.startsWith('/')) {
        link = link.substring(1);
      }
      if (link === 'tiles') links.unshift('0000');
      else if (link) links.push(link);
    }
    l = html.indexOf('href="', l + 7);
  }
  return links;
}

/*
 * fetch available times of day from backup server
 * @param yyyy, mm, dd date
 * @param id canvasId
 * @param cacheTime how long to cache in seconds
 * @return Array of available backup times as HHMM strings or promise to it
 */
function fetchTimesOfDay(yyyy, mm, dd, id, cacheTime, url) {
  const key = `${yyyy}/${mm}/${dd}/${id}`;
  const cache = TIME_CACHE.get(key);
  if (cache) {
    const threshold = Date.now() - cacheTime * 1000;
    if (cache[1] < threshold) {
      TIME_CACHE.delete(key);
      if (TIME_CACHE.size > 1000) {
        // clear all outdated entries when large
        TIME_CACHE.forEach(([, time], dkey) => {
          if (time < threshold) TIME_CACHE.delete(dkey);
        });
      }
    } else {
      return cache[0];
    }
  }

  const reqUrl = url || `${BACKUP_URL}/${key}/`;
  const protocol = (reqUrl.startsWith('http:')) ? http : https;

  return new Promise((resolve, reject) => {
    protocol.get(reqUrl, (res) => {
      switch (res.statusCode) {
        case 200: {
          res.setEncoding('utf8');
          const data = [];
          res.on('data', (chunk) => {
            data.push(chunk);
          });

          res.on('end', () => {
            try {
              const result = getFilesFromHtml(data.join(''))
                .filter((n) => !Number.isNaN(parseInt(n, 10)));
              TIME_CACHE.set(key, [result, Date.now()]);
              resolve(result);
            } catch (err) {
              reject(new Error(
                `Error ${err.message} on parse index for ${yyyy}/${mm}/${dd}`,
              ));
            }
          });
          break;
        }
        case 404:
          resolve([]);
          break;
        case 301: {
          // only allow one redirection
          if (res.headers.location && !url) {
            resolve(fetchTimesOfDay(
              yyyy, mm, dd, id,
              cacheTime, res.headers.location,
            ));
            break;
          }
        }
        // eslint-disable-next-line no-fallthrough
        default: {
          reject(new Error(
            `HTTP Error ${res.statusCode} on index for ${yyyy}/${mm}/${dd}`,
          ));
        }
      }
    }).on('error', (err) => {
      reject(new Error(
        `Error ${err.message} on index for ${yyyy}/${mm}/${dd}`,
      ));
    });
  });
}

async function history(req, res) {
  /* GÜVENLİK: her istek yedek sunucuya dış çağrı yapar → maliyet yükseltildi */
  req.tickRateLimiter(5000);

  const { day, id } = req.query;
  /*
   * GÜVENLİK: id yalnızca rakamlardan oluşan canvas id olabilir; aksi halde
   * yedek sunucuya giden yol (`/../..` gibi) manipüle edilebilirdi.
   */
  if (!BACKUP_URL || !day || !id
    || day.includes('/') || day.includes('\\') || day.length !== 8
    || !/^\d{1,4}$/.test(String(id))
  ) {
    res.status(404).end();
    return;
  }
  const yyyy = day.slice(0, 4);
  const mm = day.slice(4, 6);
  const dd = day.slice(6);

  // 30 minutes cache time if today or yesterday, otherwise 5 hours
  const parsedTs = new Date(`${yyyy}-${mm}-${dd}`).getTime();
  let cacheTime = (Date.now() - parsedTs < 48 * 3600 * 1000)
    ? 30 * 60 : 300 * 60;

  try {
    const filteredDir = await fetchTimesOfDay(yyyy, mm, dd, id, cacheTime);
    if (!filteredDir.length) {
      cacheTime = 3600;
    }
    res.set({
      'Cache-Control': `public, max-age=${cacheTime}`,
    });
    res.json(filteredDir);
  } catch (err) {
    logger.warn(err.message);
    res.status(400).end();
  }
}

export default history;
