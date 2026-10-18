import pool from './mariadb.js';

/**
 * get existing device id or create new one
 * @param device { hash, device, browser, os, headerSignature }
 * @return { id, lastSeen } | null
 */
export async function upsertDevice({
  hash, device, browser, os, headerSignature,
}) {
  let conn;
  try {
    conn = await pool.getConnection();
    const [result] = await pool.query(
      'SELECT id, lastSeen FROM Devices WHERE hash = ?',
      [hash],
    );
    if (result) {
      return result;
    }
    const { insertId } = await conn.query(
      // eslint-disable-next-line max-len
      'INSERT INTO Devices (hash, os, browser, device, headerSig, lastSeen) VALUES (?, ?, ?, ?, ?, NOW())',
      [hash, os, browser, device, headerSignature],
    );
    if (insertId) {
      return { id: insertId, lastSeen: new Date() };
    }
  } catch (error) {
    console.error(`SQL Error on upsertDevice: ${error.message}`);
  } finally {
    if (conn) conn.release();
  }
  return null;
}

/**
 * update lastSeen timestamps of Device
 * @param hash
 * @return sucess boolean
 */
export async function touchDevice(deviceId) {
  try {
    await pool.query(
      'UPDATE Devices SET lastSeen = NOW() WHERE id = ?',
      [deviceId],
    );
    return true;
  } catch (error) {
    console.error(`SQL Error on touchDeviceById: ${error.message}`);
  }
  return false;
}
