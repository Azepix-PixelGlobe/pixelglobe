/**
 * Community shared templates — store metadata + image (base64) in SQL
 */
import pool from '../data/sql/mariadb.js';
import { USERLVL } from './constants.js';

const MAX_TITLE = 48;
const MAX_B64_LEN = 12_000_000; // ~9MB image payload

let tablesReady = false;

async function ensureTables() {
  if (tablesReady) return;
  await pool.query(`
 CREATE TABLE IF NOT EXISTS SharedTemplates (
   id INT UNSIGNED NOT NULL AUTO_INCREMENT,
   uid INT UNSIGNED NOT NULL,
   authorName VARCHAR(32) NOT NULL,
   title VARCHAR(64) NOT NULL,
   canvasId SMALLINT NOT NULL DEFAULT 0,
   x INT NOT NULL,
   y INT NOT NULL,
   width SMALLINT UNSIGNED NOT NULL,
   height SMALLINT UNSIGNED NOT NULL,
   mime VARCHAR(32) NOT NULL DEFAULT 'image/png',
   imageData MEDIUMTEXT NOT NULL,
   createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
   PRIMARY KEY (id),
   KEY (createdAt),
   KEY (uid)
 ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
  tablesReady = true;
}

function sanitizeTitle(title) {
  return String(title || '')
    .replace(/[<>]/g, '')
    .trim()
    .slice(0, MAX_TITLE) || 'Şablon';
}

export async function listTemplates(limit = 40, offset = 0) {
  await ensureTables();
  const lim = Math.min(Math.max(parseInt(limit, 10) || 40, 1), 100);
  const off = Math.max(parseInt(offset, 10) || 0, 0);
  const rows = await pool.query(
    `SELECT id, uid, authorName, title, canvasId, x, y, width, height, mime, createdAt
     FROM SharedTemplates ORDER BY id DESC LIMIT ? OFFSET ?`,
    [lim, off],
  );
  return Array.isArray(rows) ? rows : [];
}

export async function getTemplate(id) {
  await ensureTables();
  const [row] = await pool.query(
    'SELECT * FROM SharedTemplates WHERE id = ?',
    [id],
  );
  return row || null;
}

export async function createTemplate(user, body) {
  if (!user?.id) return { ok: false, error: 'login_required' };
  await ensureTables();

  const title = sanitizeTitle(body.title);
  const canvasId = parseInt(body.canvasId, 10) || 0;
  const x = parseInt(body.x, 10);
  const y = parseInt(body.y, 10);
  const width = parseInt(body.width, 10) || 0;
  const height = parseInt(body.height, 10) || 0;
  const mime = (body.mime || 'image/png').slice(0, 32);
  const imageData = body.imageData || body.image || '';

  if (typeof imageData !== 'string' || !imageData.startsWith('data:')) {
    return { ok: false, error: 'invalid_image' };
  }
  if (imageData.length > MAX_B64_LEN) {
    return { ok: false, error: 'image_too_large' };
  }
  if (Number.isNaN(x) || Number.isNaN(y)) {
    return { ok: false, error: 'invalid_coords' };
  }
  if (width < 1 || height < 1) {
    return { ok: false, error: 'invalid_size' };
  }

  // rate: max 20 templates per user
  const [{ cnt }] = await pool.query(
    'SELECT COUNT(*) AS cnt FROM SharedTemplates WHERE uid = ?',
    [user.id],
  );
  if (cnt >= 20 && user.userlvl < USERLVL.MOD) {
    return { ok: false, error: 'limit_reached' };
  }

  const authorName = (user.name || user.username || 'User').slice(0, 32);
  const result = await pool.query(
    `INSERT INTO SharedTemplates
      (uid, authorName, title, canvasId, x, y, width, height, mime, imageData)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [user.id, authorName, title, canvasId, x, y, width, height, mime, imageData],
  );
  const id = result?.insertId;
  return { ok: true, id };
}

export async function deleteTemplate(user, id) {
  if (!user?.id) return { ok: false, error: 'login_required' };
  await ensureTables();
  const row = await getTemplate(id);
  if (!row) return { ok: false, error: 'not_found' };
  const isStaff = user.userlvl >= USERLVL.MOD;
  if (row.uid !== user.id && !isStaff) {
    return { ok: false, error: 'forbidden' };
  }
  await pool.query('DELETE FROM SharedTemplates WHERE id = ?', [id]);
  return { ok: true };
}

export default {
  listTemplates,
  getTemplate,
  createTemplate,
  deleteTemplate,
};