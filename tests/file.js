/*
 * test media files
 */
import fs from 'fs';
import path from 'path';
import express from 'express';
import http from 'http';

import { sequelize, sync as syncSql } from '../src/data/sql/index.js';
import { DailyCron, HourlyCron } from '../src/utils/cron.js';
import { storeMediaStream, destruct as killExiftool } from '../src/urils/media/index.js';
import errorJson from '../src/middleware/errorJson.js';
import media from '../src/routes/api/media.js';

const LOG_QUERY = false;
const SYNC_MARIADB = false;

function title(title, spacer = '=') {
  const spacerAmount = Math.floor((80 - title.length - 2) / 2);
  let out = spacer.repeat(spacerAmount) + ' ' + title + ' ' + spacer.repeat(spacerAmount);
  if ((80 - title.length - 2) % 2) out += spacer;
  console.log(out);
}

function fail(message, value) {
  console.log(value);
  throw new Error(message);
}

function getMemoryUsage() {
  const memory = process.memoryUsage();
  console.log({
    rss: Math.round(memory.rss / 1024) + ' kB',
    heapTotal: Math.round(memory.heapTotal / 1024) + ' kB',
    heapUsed: Math.round(memory.heapUsed / 1024) + ' kB',
    external: Math.round(memory.external / 1024) + ' kB',
    arrayBuffers: Math.round(memory.arrayBuffers / 1024) + ' kB'
  });
}

function requestBodyByteLogger(req, res, next) {
  let bytesReceived = 0;
  const startTime = Date.now();

  // Store original methods
  const originalPush = req.push;
  const originalEmit = req.emit;

  // Track data events
  req.on('data', (chunk) => {
    bytesReceived += chunk.length;
  });

  req.on('close', () => {
    console.log(`Request: ${bytesReceived} bytes (${Math.round(bytesReceived/1024)} kB)`);
  });
  next();
}

async function initialize() {
  await syncSql(SYNC_MARIADB);
}

async function destruct() {
  await sequelize.close();
  DailyCron.destructor();
  HourlyCron.destructor();
  killExiftool();

  const handles = process._getActiveHandles();
  const requests = process._getActiveRequests();
  console.log( {
    handles: handles.length,
    requests: requests.length,
    handlesInfo: handles.map(h => ({
      type: h.constructor.name,
      destroyed: h.destroyed,
      readable: h.readable,
      writable: h.writable
    })), // First 10 handles
    memoryUsage: process.memoryUsage()
  });
}

async function testFile(filePath) {
  const stats = fs.statSync(filePath);
  const filename = path.basename(filePath);
  const ext = path.extname(filename).toLowerCase().slice(1);

  const mimeTypes = {
    'jpg': 'image/jpeg',
    'jpeg': 'image/jpeg',
    'png': 'image/png',
    'gif': 'image/gif',
    'webp': 'image/webp',
    'mp4': 'video/mp4',
  };
  const info = {
    filename: filename,
    mimetype: mimeTypes[ext],
    encoding: '7bit'
  };

  console.log('Starting file processing...');
  console.log(' - Filename:', info.filename);
  console.log(' - Mimetype:', info.mimetype);
  console.log(' - File size:', (stats.size / 1024 / 1024).toFixed(2), 'MB');

  const startTime = Date.now();

  const fileStream = fs.createReadStream(filePath);
  try {
    const result = await storeMediaStream(fileStream, info);
    await killExiftool()
    console.log(result);
  } catch (error) {
    console.log('ERROR: ', error.message);
  }
  fileStream.on('close', () => console.log('read stream closed'));

  const endTime = Date.now();
}

(async () => {
  await initialize();

  let lsql;
  sequelize.options.logging = (sql, timing) => {
    if (LOG_QUERY) {
      console.log(sql);
    }
    lsql = sql;
  };

  title('launch expressjs app on localhost:33333');
  const app = express();
  const server = http.createServer(app);

  app.get('/end', (req, res) => {
    res.send('ok');
    console.log('Stopping');
    server.close();
    destruct();
  });

  app.use('/', requestBodyByteLogger, (req, res, next) => {
    req.ttag = { t: function t(strings, ...values) {
      let result = '';
      for (let i = 0; i < strings.length; i++) {
        result += strings[i];
        if (i < values.length) {
          result += values[i];
        }
      }
      return result;
    }, }
    console.log('got request');
    next();
  }, media);
  // await testFile('test.png');

  server.listen(33333, 'localhost', () => {
    console.log('Server listening on http://localhost:33333');
  });
})();
