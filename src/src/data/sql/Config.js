import pool from './mariadb.js';

/**
 * get config
 * @param key
 * @return object or null
 */
export async function getState(key) {
  if (!key) {
    return null;
  }
  try {
    const [model] = await pool.query(
      'SELECT value FROM Configs WHERE `key` = ?', [key],
    );
    const value = model?.value;
    if (value) {
      return JSON.parse(value);
    }
  } catch (error) {
    console.error(`SQL Error on getState: ${error.message}`);
  }
  return null;
}

/**
 * update config
 * @param key
 * @param [value] serializable object to store
 * @return success boolean
 */
export async function setState(key, value) {
  if (!key) {
    return false;
  }
  try {
    if (value) {
      value = JSON.stringify(value);
      await pool.query(
        // eslint-disable-next-line
        'INSERT INTO Configs (`key`, value) VALUES (?, ?) ON DUPLICATE KEY UPDATE value = VALUES(value)',
        [key, value],
      );
    } else {
      await pool.query('DELETE FROM Configs WHERE `key` = ?', [key]);
    }
    return true;
  } catch (error) {
    console.error(`SQL Error on setState: ${error.message}`);
  }
  return false;
}

/**
 * log what a mod did
 * @param type number indicating what is done
 * @param params any array of values
 * @param muid user id of the mod doing it
 * @param accessUserlvl what userlvl can see the logs
 */
export async function logModAction(
  type, params, muid = null, accessUserlvl = 0,
) {
  try {
    await pool.query(
      // eslint-disable-next-line
      'INSERT INTO ModLogs (type, params, muid, accessUserlvl) VALUES (?, ?, ?, ?)',
      [type, JSON.stringify(params), muid, accessUserlvl],
    );
  } catch (error) {
    console.error(`SQL Error on logModAction: ${error.message}`);
  }
}

/**
 * log what a mod did on the canvas
 * @param type number indicating what is done
 * affected canvas area
 * @param canvasIdent
 * @param x
 * @param y
 * @param width
 * @param height
 * @param params any array of values
 * @param muid user id of the mod doing it
 * @param accessUserlvl what userlvl can see the logs
 */
export async function logCanvasModAction(
  type, canvasIdent, x, y, width, height, params,
  muid = null, accessUserlvl = 0,
) {
  try {
    await pool.query(
      // eslint-disable-next-line
      'INSERT INTO CanvasModLogs (type, params, muid, accessUserlvl, canvasIdent, x, y, width, height) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [
        type, JSON.stringify(params), muid, accessUserlvl,
        canvasIdent, x, y, width, height,
      ],
    );
  } catch (error) {
    console.error(`SQL Error on logCanvasModAction: ${error.message}`);
  }
}

/**
 * log what a mod did
 * @param type number indicating what is done
 * @param params any array of values
 * @param uid user id of the mod doing it
 */
export async function logAuthAction(type, params, uid = null) {
  try {
    await pool.query(

      'INSERT INTO AuthLogs (type, params, uid) VALUES (?, ?, ?)',
      [type, JSON.stringify(params), uid],
    );
  } catch (error) {
    console.error(`SQL Error on logAuthAction: ${error.message}`);
  }
}

/**
 * get most recent moderation logs
 * @return [
 *   [type, params, muid, name, createdAtTs], ...
 * ]
 */
export async function getRecentModLogs(accessUserlvl = 0) {
  try {
    const [logs, canvasLogs] = await Promise.all([
      pool.query(

        `SELECT ml.type, ml.params, ml.muid, mu.name, mu.username,
ROUND(UNIX_TIMESTAMP(ml.createdAt) * 1000) AS createdAtTs FROM (
    SELECT * FROM ModLogs ORDER BY id DESC LIMIT 500
  ) ml
    LEFT JOIN Users mu ON mu.id = ml.muid
  WHERE ml.createdAt > NOW() - INTERVAL 2 WEEK AND accessUserlvl <= ?`,
        [accessUserlvl],
      ),
      pool.query(
        // eslint-disable-next-line
        `SELECT ml.type, ml.params, ml.muid, mu.name, mu.username, ml.canvasIdent, ml.x, ml.y, ml.width, ml.height,
ROUND(UNIX_TIMESTAMP(ml.createdAt) * 1000) AS createdAtTs FROM (
    SELECT * FROM CanvasModLogs ORDER BY id DESC LIMIT 1000
  ) ml
    LEFT JOIN Users mu ON mu.id = ml.muid
  WHERE ml.createdAt > NOW() - INTERVAL 2 WEEK AND ml.accessUserlvl <= ?`,
        [accessUserlvl],
      ),
    ]);
    for (const log of logs) {
      log.createdAtTs = Number(log.createdAtTs);
      log.params = JSON.parse(log.params);
    }
    for (const log of canvasLogs) {
      const { canvasIdent, x, y, width, height } = log;
      log.params = [canvasIdent, x, y, width, height].concat(
        JSON.parse(log.params),
      );
      log.createdAtTs = Number(log.createdAtTs);
      delete log.canvasIdent;
      delete log.x;
      delete log.y;
      delete log.width;
      delete log.height;
      logs.push(log);
    }
    return logs.sort((a, b) => a.createdAtTs - b.createdAtTs);
  } catch (error) {
    console.error(`SQL Error on getRecentModLogs: ${error.message}`);
    return [];
  }
}


/**
 * get most recent authentification logs
 * @return [
 *   { type, params, uid, name, createdAtTs }, ...
 * ]
 */
export async function getRecentAuthLogs(lastTs = 0) {
  try {
    const cutoffDate = (lastTs)
      ? new Date(lastTs) : new Date(Date.now() - 2 * 24 * 3600 * 1000);
    const logs = await pool.query(
      `SELECT al.type, al.params, al.uid, u.name,
ROUND(UNIX_TIMESTAMP(al.createdAt) * 1000) AS createdAtTs FROM (
  SELECT * FROM AuthLogs ORDER BY id DESC LIMIT 200
) al
  LEFT JOIN Users u ON u.id = al.uid
WHERE al.createdAt > ? ORDER BY al.createdAt DESC`,
      [cutoffDate],
    );
    for (const log of logs) {
      log.createdAtTs = Number(log.createdAtTs);
      log.params = JSON.parse(log.params);
    }
    return logs;
  } catch (error) {
    console.error(`SQL Error on getRecentModLogs: ${error.message}`);
    return [];
  }
}
