/*
 * This script syncs the sql database.
 * This is not suitable for production, unless you make sure you got a backup
 */
import path from 'path';

import pool from '../../src/src/data/sql/mariadb.js';
import { sync as syncSql } from '../../src/src/data/sql/index.js';

const LOG_QUERY = true;

async function initialize() {
  await syncSql(true, path.join(import.meta.dirname, '../workers/sql'));
}

async function destruct() {
  await pool.end();
}

(async () => {
  await initialize();

  await destruct();
})();
