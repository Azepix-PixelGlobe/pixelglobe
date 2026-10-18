/*
 * Creates regular backups of the canvas in png tiles
 * In order to run huge redis operations, you have to allow redis to use
 * more virtual memory, with:
 * vm.overcommit_memory = 1
 * in /etc/sysctl.conf and `sysctl vm.overcommit_memory=1`
 * also:
 * echo never > /sys/kernel/mm/transparent_hugepage/enabled
 *
 */

import fs from 'fs';
import os from 'os';
import { spawn } from 'child_process';
import path from 'path';
import { createClient } from 'redis';

import {
  REDIS_URL,
  BACKUP_REDIS_URL,
  BACKUP_DIR,
  BACKUP_INTERVAL,
  BACKUP_CMD,
} from './core/config.js';
import {
  createPngBackup,
  incrementalBackupRedis,
  updateBackupRedis,
} from './core/tilesBackup.js';
import canvases from './core/canvases.js';

/*
 * use low cpu priority
 */
const PRIORITY = 15;
console.log(`Setting priority for the current process to ${PRIORITY}`);
try {
  os.setPriority(PRIORITY);
} catch (err) {
  console.log(`: error occurred${err}`);
}

if (!REDIS_URL || !BACKUP_REDIS_URL || !BACKUP_DIR) {
  console.error(
    'Usage: node backup.js original_canvas backup_canvas backup_directory',
  );
  process.exit(1);
}

const canvasRedis = createClient(REDIS_URL
  .startsWith('redis://')
  ? {
      url: REDIS_URL,
    }
  : {
      socket: {
        path: REDIS_URL,
      },
    },
);
const backupRedis = createClient(BACKUP_REDIS_URL
  .startsWith('redis://')
  ? {
      url: BACKUP_REDIS_URL,
    }
  : {
      socket: {
        path: BACKUP_REDIS_URL,
      },
    },
);
//
canvasRedis.on('error', () => {
  console.error('Could not connect to canvas redis');
  process.exit(1);
});
backupRedis.on('error', () => {
  console.error('Could not connect to backup redis');
  process.exit(1);
});


function runCmd(cmd) {
  const startTime = Date.now();
  console.log(`Executing ${cmd}`);
  const cmdproc = spawn(cmd);
  cmdproc.on('exit', (code) => {
    if (code !== 0) {
      console.log(`${cmd} failed with code ${code}`);
    }
    const time = Date.now() - startTime;
    console.log(`${cmd} done in ${time}ms`);
  });
  cmdproc.stdout.on('data', (data) => {
    console.log(`${cmd}: ${data}`);
  });
  cmdproc.stderr.on('data', (data) => {
    console.log(`${cmd} error: ${data}`);
  });
}


function getDateFolder() {
  const dir = path.resolve(__dirname, BACKUP_DIR);
  if (!fs.existsSync(dir)) {
    // eslint-disable-next-line max-len
    console.info(`Backup directory ${BACKUP_DIR} does not exist! Trying to create it`);
    try {
      fs.mkdirSync(dir);
    } catch {
      console.error('Couldn\'t create backup dir');
      process.exit(1);
    }
  }
  const date = new Date();
  let month = date.getUTCMonth() + 1;
  let day = date.getUTCDate();
  if (month < 10) month = `0${month}`;
  if (day < 10) day = `0${day}`;
  const dayDir = `${date.getUTCFullYear()}/${month}/${day}`;
  return `${dir}/${dayDir}`;
}

async function dailyBackup() {
  const backupDir = getDateFolder();
  if (!fs.existsSync(backupDir)) {
    fs.mkdirSync(backupDir, { recursive: true });
  }

  try {
    await backupRedis.flushAll('ASYNC');
    await updateBackupRedis(canvasRedis, backupRedis, canvases);
    await createPngBackup(backupRedis, canvases, backupDir);
  } catch (e) {
    fs.rmSync(backupDir, { recursive: true });
    console.log('Error occurred during daily backup', e);
  }
  console.log('Daily full backup done');
}

async function incrementalBackup() {
  const backupDir = getDateFolder();
  if (!fs.existsSync(backupDir)) {
    fs.mkdirSync(backupDir, { recursive: true });
  }
  try {
    await incrementalBackupRedis(
      canvasRedis,
      backupRedis,
      canvases,
      backupDir,
    );
  } catch (e) {
    console.log('Error occurred during incremental backup', e);
  }
}

async function trigger() {
  const backupDir = getDateFolder();
  if (!fs.existsSync(backupDir)) {
    await dailyBackup();
  } else {
    await incrementalBackup();
  }
  if (BACKUP_CMD) {
    runCmd(BACKUP_CMD);
  }
  if (!BACKUP_INTERVAL) {
    process.exit(0);
  }
  console.log(`Creating next backup in ${BACKUP_INTERVAL} minutes`);
  setTimeout(trigger, BACKUP_INTERVAL * 60 * 1000);
}

console.log('Starting backup...');
canvasRedis.connect()
  .then(() => backupRedis.connect())
  .then(() => trigger());
