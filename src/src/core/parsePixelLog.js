import fs from 'fs';
import path from 'path';
import readline from 'readline';

import { PixelLogger } from './logger.js';
import { getNamesToIds } from '../data/sql/User.js';
import {
  getIIDsOfIPs,
  getIPInfos,
  getIPofIID,
} from '../data/sql/IP.js';

function parseFile(cb) {
  const date = new Date();
  const year = date.getUTCFullYear();
  let month = date.getUTCMonth() + 1;
  let day = date.getUTCDate();
  if (day < 10) day = `0${day}`;
  if (month < 10) month = `0${month}`;
  const filename = path.resolve(
    import.meta.dirname, 'log',
    `${PixelLogger.prefix}${year}-${month}-${day}.log`,
  );

  return new Promise((resolve) => {
    const fileStream = fs.createReadStream(filename);

    const rl = readline.createInterface({
      input: fileStream,
    });

    rl.on('line', (line) => cb(line.split(' ')));

    rl.on('error', (err) => {
      console.error(`Pixellogger read error: ${err.message}`);
    });

    rl.on('close', () => {
      resolve();
    });
  });
}

/*
 * Get summary of pixels per canvas placed by iid
 * @param iid Limit on one user (optional)
 * @param time timestamp of when to start
 * @return array of parsed pixel log lines
 *         string if error
 */
export async function getIIDSummary(
  iid,
  time,
) {
  const filterIP = await getIPofIID(iid);
  if (!filterIP) {
    return 'Could not resolve IID to IP';
  }
  const cids = {};

  try {
    await parseFile((parts) => {
      const [tsStr, ipString,, cid, x, y,, clrStr, retCode] = parts;
      const ts = parseInt(tsStr, 10);
      if (ts >= time) {
        if (ipString === filterIP) {
          const clr = parseInt(clrStr, 10);
          let curVals = cids[cid];
          if (!curVals) {
            curVals = [0, 0, 0, 0, 0];
            cids[cid] = curVals;
          }
          curVals[0] += 1;
          curVals[1] = x;
          curVals[2] = y;
          curVals[3] = clr;
          curVals[4] = retCode;
          curVals[5] = ts;
        }
      }
    });
  } catch (err) {
    return `Could not parse logfile: ${err.message}`;
  }

  const columns = ['rid', '#', 'canvas', 'last', 'clr', 'ret', 'time'];
  const types = ['number', 'number', 'cid', 'coord', 'clr', 'code', 'ts'];
  const rows = [];
  const cidKeys = Object.keys(cids);
  for (let i = 0; i < cidKeys.length; i += 1) {
    const cid = cidKeys[i];
    const [pxls, x, y, clr, retCode, ts] = cids[cid];
    rows.push([
      i,
      pxls,
      cid,
      `${x},${y}`,
      clr,
      retCode,
      ts,
    ]);
  }

  return {
    columns,
    types,
    rows,
  };
}

/*
 * Get pixels by iid
 * @param iid Limit on one user (optional)
 * @param time timestamp of when to start
 * @return array of parsed pixel log lines
 *         string if error
 */
export async function getIIDPixels(
  iid,
  time,
  maxRows,
) {
  const filterIP = await getIPofIID(iid);
  if (!filterIP) {
    return 'Could not resolve IID to IP';
  }
  const pixels = [];

  try {
    await parseFile((parts) => {
      const [tsStr, ipString,, cid, x, y,, clrStr, retCode] = parts;
      const ts = parseInt(tsStr, 10);
      if (ts >= time) {
        if (ipString === filterIP) {
          const clr = parseInt(clrStr, 10);
          pixels.push([
            cid,
            x,
            y,
            clr,
            retCode,
            ts,
          ]);
        }
      }
    });
  } catch (err) {
    return `Could not parse logfile: ${err.message}`;
  }

  const pixelF = (maxRows && pixels.length > maxRows)
    ? pixels.slice(maxRows * -1)
    : pixels;

  const columns = ['rid', 'canvas', 'coord', 'clr', 'ret', 'time'];
  const types = ['number', 'cid', 'coord', 'clr', 'code', 'ts'];
  const rows = [];
  for (let i = 0; i < pixelF.length; i += 1) {
    const [cid, x, y, clr, retCode, ts] = pixelF[i];
    rows.push([
      i,
      cid,
      `${x},${y}`,
      clr,
      retCode,
      ts,
    ]);
  }

  return {
    columns,
    types,
    rows,
  };
}

/**
 * Get summary of users placing in area of current day
 * @param canvasId id of canvas
 * @param clr color
 * @param xUL, yUL, xBR, yBR area of canvas
 * @param time timestamp of when to start
 * @param iid Limit on one user (optional)
 * @return array of parsed pixel log lines
 *         string if error
 */
export async function getSummaryFromArea(
  canvasId,
  clrFilter,
  xUL,
  yUL,
  xBR,
  yBR,
  time,
  iid,
  maxEntities,
) {
  const ips = {};
  let summaryLength = 0;

  let filterIP = null;
  if (iid) {
    filterIP = await getIPofIID(iid);
    if (!filterIP) {
      return 'Could not resolve IID to IP';
    }
  }

  try {
    await parseFile((parts) => {
      /* only allow a limited amount of entries */
      if (summaryLength > maxEntities) {
        return;
      }

      const [tsStr, ipString, uidStr, cid, x, y,, clrStr, retCode] = parts;
      const ts = parseInt(tsStr, 10);
      if (ts >= time
        // eslint-disable-next-line eqeqeq
        && canvasId == cid
        && x >= xUL
        && x <= xBR
        && y >= yUL
        && y <= yBR
      ) {
        if (filterIP && ipString !== filterIP) {
          return;
        }
        const clr = parseInt(clrStr, 10);
        if (clrFilter !== null && clrFilter !== clr) {
          return;
        }
        const uid = parseInt(uidStr, 10);
        let curVals = ips[ipString];
        if (!curVals) {
          curVals = [0, uid, 0, 0, 0, 0];
          ips[ipString] = curVals;
          summaryLength += 1;
        }
        curVals[0] += 1;
        curVals[2] = x;
        curVals[3] = y;
        curVals[4] = clr;
        curVals[5] = retCode;
        curVals[6] = ts;
      }
    });
  } catch (err) {
    return `Could not parse logfile: ${err.message}`;
  }

  const columns = [
    'rid', '#', 'ipString', 'uid', 'last', 'clr', 'ret', 'time',
  ];
  const types = [
    'number', 'number', 'string', 'number', 'coord', 'clr', 'code', 'ts',
  ];

  const rows = [];
  const ipKeys = Object.keys(ips);
  for (let i = 0; i < ipKeys.length; i += 1) {
    const ip = ipKeys[i];
    const [pxls, uid, x, y, clr, retCode, ts] = ips[ip];
    rows.push([i, pxls, ip, uid, `${x},${y}`, clr, retCode, ts]);
  }

  return {
    columns,
    types,
    rows,
  };
}


export async function getPixelsFromArea(
  canvasId,
  clrFilter,
  xUL,
  yUL,
  xBR,
  yBR,
  time,
  iid,
  maxRows,
  maxEntities,
) {
  const pixels = [];
  const ipStrings = new Set();

  let filterIP = null;
  if (iid) {
    filterIP = await getIPofIID(iid);
    if (!filterIP) {
      return 'Could not resolve IID to IP';
    }
  }

  try {
    await parseFile((parts) => {
      /* only allow a limited amount of ipStrings */
      if (ipStrings.size > maxEntities) {
        return;
      }
      if (pixels.length > maxRows) {
        return;
      }

      const [tsStr, ipString, uidStr, cid, x, y,, clrStr, retCode] = parts;
      const ts = parseInt(tsStr, 10);
      if (ts >= time
        // eslint-disable-next-line eqeqeq
        && canvasId == cid
        && x >= xUL
        && x <= xBR
        && y >= yUL
        && y <= yBR
      ) {
        if (filterIP && ipString !== filterIP) {
          return;
        }
        const clr = parseInt(clrStr, 10);
        if (clrFilter !== null && clrFilter !== clr) {
          return;
        }
        const uid = parseInt(uidStr, 10);
        pixels.push([ipString, uid, x, y, clr, retCode, ts]);
        ipStrings.add(ipString);
      }
    });
  } catch (err) {
    return `Could not parse logfile: ${err.message}`;
  }

  const columns = ['rid'];
  const types = ['number'];
  if (!filterIP) {
    columns.push('ip2IID', 'uid');
    types.push('string', 'number');
  }
  columns.push('coord', 'clr', 'ret', 'time');
  types.push('coord', 'clr', 'code', 'ts');

  const rows = [];
  for (let i = 0; i < pixels.length; i += 1) {
    const [ip, uid, x, y, clr, retCode, ts] = pixels[i];
    const row = [i];
    if (!filterIP) {
      row.push(ip, uid);
    }
    row.push(`${x},${y}`, clr, retCode, ts);
    rows.push(row);
  }

  return {
    columns,
    types,
    rows,
  };
}


/**
 * Populate table with user and ip details, checks or 'uid', 'ip2IID' and
 * 'ipString' columns and if they exist, add more columns with additional info
 * to user and ip.
 * Table gets changed in-place.
 * @param table { columns, types, rows }
 */
export async function populateTable(table, reducedInfo = false) {
  const uids = new Set();
  const ipStrings = new Set();
  let uidColumn = table.columns.indexOf('uid');
  /*
   * delete userinfo when reduced
   */
  if (reducedInfo && uidColumn !== -1) {
    table.columns.splice(uidColumn, 1);
    table.types.splice(uidColumn, 1);
    table.rows.forEach((row) => row.splice(uidColumn, 1));
    uidColumn = -1;
  }
  /*
    * whether the column is named ipString or ip2IID decides
    * if we only resolve the iid to the ips or all info
    */
  let getFullIPInfo = true;
  let ipColumn = table.columns.indexOf('ipString');
  if (ipColumn === -1) {
    ipColumn = table.columns.indexOf('ip2IID');
    getFullIPInfo = false;
  }

  if (uidColumn !== -1 || ipColumn !== -1) {
    const { rows } = table;
    for (let i = 0; i < rows.length; i += 1) {
      const row = rows[i];
      if (uidColumn !== -1) {
        uids.add(row[uidColumn]);
      }
      if (ipColumn !== -1) {
        ipStrings.add(row[ipColumn]);
      }
    }

    const promises = [
      (uids.size) ? getNamesToIds([...uids]) : new Map(),
    ];
    if (ipStrings.size) {
      /*
       * only grab 300 at a time and only the minimal info we want
       */
      const ipGrabFunc = (getFullIPInfo) ? getIPInfos : getIIDsOfIPs;
      promises.push((async () => {
        const ipStringsArray = Array.from(ipStrings);
        let ip2Info = new Map();
        let i = 0;
        while (i < ipStringsArray.length) {
          try {
            // eslint-disable-next-line no-await-in-loop
            const partialInfos = await ipGrabFunc(
              ipStringsArray.slice(i, i += 300),
            );
            ip2Info = new Map([...ip2Info, ...partialInfos]);
          } catch {
            break;
          }
        }
        return ip2Info;
      })());
    } else {
      promises.push(new Map());
    }
    const [uid2Name, ip2Info] = await Promise.all(promises);

    if (uid2Name.size || ipColumn !== -1) {
      if (uid2Name.size) {
        table.columns[uidColumn] = 'User';
        table.types[uidColumn] = 'user';
      }
      if (ipColumn !== -1) {
        table.columns[ipColumn] = 'IID';
        table.types[ipColumn] = 'uuid';
        if (getFullIPInfo && ip2Info.size) {
          table.columns.splice(
            ipColumn + 1, 0, 'ct', 'cidr', 'org', 'pc',
          );
          table.types.splice(
            ipColumn + 1, 0, 'flag', 'cidr', 'string', 'string',
          );
        }
      }

      for (let i = 0; i < rows.length; i += 1) {
        const row = rows[i];
        if (uid2Name.size) {
          const uid = row[uidColumn];
          row[uidColumn] = uid2Name.has(uid)
            ? `${uid2Name.get(uid)},${uid}` : 'N/A';
        }
        if (ipColumn !== -1) {
          if (!getFullIPInfo) {
            row[ipColumn] = ip2Info.get(row[ipColumn]) || 'N/A';
          } else {
            const ipInfo = ip2Info.get(row[ipColumn]);
            row[ipColumn] = ipInfo ? ipInfo.iid : 'N/A';
            if (ip2Info.size) {
              if (ipInfo) {
                // eslint-disable-next-line max-len
                row.splice(ipColumn + 1, 0, ipInfo.country, ipInfo.cidr, ipInfo.org || 'N/A', ipInfo.type || 'N/A');
              } else {
                row.splice(ipColumn + 1, 0, 'xx', 'N/A', 'N/A', 'N/A');
              }
            }
          }
        }
      }
    }
  }
}
