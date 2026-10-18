import path from 'path';
import fs from 'fs';

import pool from './mariadb.js';
import { executeSqlFile } from './utils.js';
import { cleanMedia } from './Media.js';

/* eslint-disable max-len */
/* eslint-disable no-await-in-loop */

/*
 * clean up database
 */
export async function cleanUp() {
  const sqlRootDirectory = path.join(import.meta.dirname,
    // webpack will bundle with the workers directory
    (process.env.NODE_ENV) ? 'workers/sql' : '.',
  );

  try {
    const cleanupFiles = fs.readdirSync(path.join(sqlRootDirectory, 'cleanup'))
      .filter((e) => e.endsWith('.sql'));

    for (const file of cleanupFiles) {
      const seperator = file.indexOf('-');
      if (seperator !== -1) {
        const chance = Number(file.substring(0, seperator)) / 100;
        if (Math.random() > chance) {
          continue;
        }
      }

      try {
        await executeSqlFile(
          path.join(sqlRootDirectory, 'cleanup', file), pool,
        );
      } catch (error) {
        console.error(`SQL Error on cleanup/${file}: ${error.sqlMessage || error.message}`);
      }
    }

    for (const cleanupFunction of [cleanMedia]) {
      try {
        await cleanupFunction();
      } catch (error) {
        console.error(
          `SQL Error on clean-up job ${cleanupFunction.name}: ${error.sqlMessage || error.message}`,
        );
      }
    }
  } catch (error) {
    console.error(`SQL Error on cleanUp: ${error.sqlMessage || error.message}`);
  }
}

/**
 * handle sql table, function, procedures,... creation and migrations
 * @param force boolean, force a table sync (does not change columns, but runs
 * CREATE TABLE IF NOT EXISTS commands)
 */
export async function sync(force = false, sqlRootDirectory = null) {
  if (!sqlRootDirectory) {
    sqlRootDirectory = path.join(import.meta.dirname,
      // webpack will bundle with the workers directory
      (process.env.NODE_ENV) ? 'workers/sql' : '.',
    );
  }

  const currentSchemeVersion = Number(
    fs.readFileSync(
      path.join(sqlRootDirectory, 'scheme/version.txt'), 'utf8',
    ).trim(),
  );
  const currentFunctionVersion = Number(
    fs.readFileSync(
      path.join(sqlRootDirectory, 'functions/version.txt'), 'utf8',
    ).trim(),
  );
  const currentProcedureVersion = Number(
    fs.readFileSync(
      path.join(sqlRootDirectory, 'procedures/version.txt'), 'utf8',
    ).trim(),
  );

  const schemeVersionKey = 'schema_version';
  let schemeVersion = 0;
  try {
    const res = await pool.query(
      'SELECT value FROM Configs WHERE `key`= ?', [schemeVersionKey],
    );
    schemeVersion = Number(res[0]?.value || 0);
  } catch (error) {
    if (error.code !== 'ER_NO_SUCH_TABLE') {
      throw error;
    }
  }

  if (schemeVersion <= 0 || force) {
    /*
     * recreate tables
     */
    const schemeFiles = fs.readFileSync(
      path.join(sqlRootDirectory, 'scheme/order.txt'), 'utf8',
    ).trim().split('\n').map((l) => l.trim())
      .filter((l) => l.length && !l.startsWith('#'));

    console.log('SQL syncing tables.');
    for (const file of schemeFiles) {
      try {
        await executeSqlFile(path.join(sqlRootDirectory, 'scheme', file), pool);
      } catch (error) {
        console.error(
          `SQL Error on scheme/${file}: ${error.sqlMessage || error.message}`,
        );
        throw error;
      }
    }
    await pool.query(
      'INSERT INTO Configs (`key`, value) VALUES (?, ?) ON DUPLICATE KEY UPDATE value = VALUES(value)',
      [schemeVersionKey, String(currentSchemeVersion)],
    );
    if (schemeVersion <= 0) {
      schemeVersion = currentSchemeVersion;
    }
  }

  /*
   * migrate tables
   */
  while (schemeVersion < currentSchemeVersion) {
    const migrationFileName = `${schemeVersion}-${schemeVersion + 1}.sql`;
    schemeVersion += 1;
    console.log(`SQL migrating tables to version ${schemeVersion}`);

    try {
      await executeSqlFile(
        path.join(sqlRootDirectory, 'migrations', migrationFileName), pool,
      );
    } catch (error) {
      console.error(
        `SQL Error on migration ${migrationFileName}: ${error.sqlMessage || error.message}`,
      );
      throw error;
    }

    await pool.query(
      'INSERT INTO Configs (`key`, value) VALUES (?, ?) ON DUPLICATE KEY UPDATE value = VALUES(value)',
      [schemeVersionKey, String(schemeVersion)],
    );
  }

  /*
   * functions and procedures
   */
  const functionsVersionKey = 'functions_version';
  const proceduresVersionKey = 'procedures_version';
  let [functionsVersion, proceduresVersion] = await Promise.all([
    pool.query(
      'SELECT value FROM Configs WHERE `key`= ?', [functionsVersionKey],
    ),
    pool.query(
      'SELECT value FROM Configs WHERE `key`= ?', [proceduresVersionKey],
    ),
  ]);
  functionsVersion = Number(functionsVersion[0]?.value || 0);
  proceduresVersion = Number(proceduresVersion[0]?.value || 0);

  if (functionsVersion !== currentFunctionVersion) {
    console.log('SQL syncing functions.');
    const functionFiles = ['drop.sql'].concat(
      fs.readdirSync(path.join(sqlRootDirectory, 'functions'))
        .filter((e) => e !== 'drop.sql' && e.endsWith('.sql')),
    );

    for (const file of functionFiles) {
      try {
        await executeSqlFile(
          path.join(sqlRootDirectory, 'functions', file), pool,
        );
      } catch (error) {
        console.error(
          `SQL Error on functions/${file}: ${error.sqlMessage || error.message}`,
        );
        throw error;
      }
    }

    await pool.query(
      'INSERT INTO Configs (`key`, value) VALUES (?, ?) ON DUPLICATE KEY UPDATE value = VALUES(value)',
      [functionsVersionKey, String(currentFunctionVersion)],
    );
  }

  if (proceduresVersion !== currentProcedureVersion) {
    console.log('SQL syncing procedures.');
    const procedureFiles = ['drop.sql'].concat(
      fs.readdirSync(path.join(sqlRootDirectory, 'procedures'))
        .filter((e) => e !== 'drop.sql' && e.endsWith('.sql')),
    );

    for (const file of procedureFiles) {
      try {
        await executeSqlFile(
          path.join(sqlRootDirectory, 'procedures', file), pool,
        );
      } catch (error) {
        console.error(
          `SQL Error on procedures/${file}: ${error.sqlMessage || error.message}`,
        );
        throw error;
      }
    }

    await pool.query(
      'INSERT INTO Configs (`key`, value) VALUES (?, ?) ON DUPLICATE KEY UPDATE value = VALUES(value)',
      [proceduresVersionKey, String(currentProcedureVersion)],
    );
  }
}

/**
 * close mariadb connections
 */
export function close() {
  return pool.end();
}
