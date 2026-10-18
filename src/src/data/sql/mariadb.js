/**
 * MariaDB
 */

import { createPool } from 'mariadb';

import {
  MARIADB_HOST, MARIADB_DATABASE, MARIADB_USER, MARIADB_PW, LOG_MARIADB,
} from '../../core/config.js';

const pool = createPool({
  host: MARIADB_HOST,
  user: MARIADB_USER,
  password: MARIADB_PW,
  database: MARIADB_DATABASE,
  collation: 'utf8mb4_unicode_ci',
  logger: {
    query: (LOG_MARIADB) ? console.info : undefined,
    warning: (msg) => {
      console.warn(`SQL Error: ${msg}`);
    },
  },
  /*
   * return large integers as Number rather than BigInt
   */
  insertIdAsNumber: true,
  bigIntAsNumber: true,
  /*
   * default is 256, which is too high if we run with shards
   */
  prepareCacheLength: 80,
});

export default pool;
