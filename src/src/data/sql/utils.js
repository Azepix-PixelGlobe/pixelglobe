import fs from 'fs';

/**
 * execute an .sql file
 * @param filepath
 * @param conn mariadb connection
 * @param isTransactional if run as transaction
 */
export async function executeSqlFile(filepath, pool, isTransactional) {
  const DELIMITER_STRING = 'DELIMITER';
  const script = fs.readFileSync(filepath, 'utf8');

  let conn;
  try {
    conn = await pool.getConnection();
    if (isTransactional) {
      await conn.beginTransaction();
    }

    /* we care about delimiters */
    let currentDelimiter = ';';
    let queryBegin = 0;
    let delimiterPos = script.indexOf(currentDelimiter);
    let delimiterCmdPos = script.indexOf(DELIMITER_STRING);

    while (delimiterPos !== -1 || delimiterCmdPos !== -1) {
      let query;
      if (delimiterCmdPos !== -1 && (
        delimiterPos === -1 || delimiterCmdPos < delimiterPos
      )) {
        query = script.substring(queryBegin, delimiterCmdPos).trim();
        currentDelimiter = null;
        for (let i = delimiterCmdPos + 9; i < script.length; i += 1) {
          const chr = script.charAt(i);
          if (chr !== ' ' && chr !== '\t' && chr !== '\n') {
            /* first char of delimiter */
            for (let u = i; u < script.length; u += 1) {
              const uchr = script.charAt(u);
              if (uchr === ' ' || uchr === '\t' || uchr === '\n') {
                /* last char of delimiter */
                currentDelimiter = script.substring(i, u);
                queryBegin = u;
                break;
              }
            }
            break;
          }
        }
        if (!currentDelimiter) {
          queryBegin = script.length;
        }
      } else {
        query = script.substring(queryBegin, delimiterPos).trim();
        queryBegin = delimiterPos + currentDelimiter.length;
      }

      if (query) {
        // eslint-disable-next-line no-await-in-loop
        await conn.query(query);
      }

      delimiterPos = script.indexOf(currentDelimiter, queryBegin);
      if (delimiterCmdPos !== -1 && delimiterCmdPos < queryBegin) {
        delimiterCmdPos = script.indexOf(DELIMITER_STRING, queryBegin);
      }
    }

    if (queryBegin < script.length) {
      const query = script.substring(queryBegin).trim();
      if (query) {
        await conn.query(query);
      }
    }

    if (isTransactional) {
      await conn.commit();
    }
  } finally {
    if (conn) conn.release();
  }
}

/**
 * nest raw queries
 * Sequelize raw: true queries return association as table.column names,
 * and if we make sure that we only do this form on M:N associations, we can
 * nest the results
 * @param query query return object, which is an array
 * @param primaryKey any key that is unique to nest for, if null, nest all and
 *   return only one object
 * @return nested query
 */
export function nestQuery(query, primaryKey) {
  if (!query?.length) {
    if (primaryKey) {
      return [];
    }
    return null;
  }
  const ret = [];

  const mainColumns = [];
  const nestedColumns = [];
  const columns = Object.keys(query[0]);
  let i = columns.length;
  while (i > 0) {
    i -= 1;
    const k = columns[i];
    const seperator = k.indexOf('.');
    if (seperator === -1) {
      mainColumns.push(k);
    } else {
      nestedColumns.push(
        [k.substring(0, seperator), k.substring(seperator + 1)],
      );
    }
  }

  i = query.length;
  while (i > 0) {
    i -= 1;
    const row = query[i];

    let target;
    if (primaryKey) {
      const primary = row[primaryKey];
      target = ret.find(
        (r) => r[primaryKey].toString() === primary.toString(),
      );
    } else {
      target = ret[0];
    }

    if (!target) {
      target = {};
      mainColumns.forEach((k) => {
        target[k] = row[k];
      });
      nestedColumns.forEach(([k]) => {
        target[k] = [];
      });
      ret.push(target);
    }

    const nestedObj = {};
    const notNullObj = {};
    let u = nestedColumns.length;
    while (u > 0) {
      u -= 1;
      const [k, v] = nestedColumns[u];
      if (!nestedObj[k]) {
        nestedObj[k] = {};
      }
      const value = row[`${k}.${v}`];
      const obj = nestedObj[k];
      obj[v] = value;
      if (value !== null) {
        notNullObj[k] = obj;
      }
    }

    const notNullKeys = Object.keys(notNullObj);
    u = notNullKeys.length;
    while (u > 0) {
      u -= 1;
      const k = notNullKeys[u];
      target[k].push(nestedObj[k]);
    }
  }

  return (primaryKey) ? ret : ret[0];
}

