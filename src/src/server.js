/*
 * Entrypoint for main server script
 */

import url from 'url';
import compression from 'compression';
import express from 'express';
import http from 'http';

import forceGC from './core/forceGC.js';
import rankings, { Ranks } from './core/Ranks.js';
import { sync as syncSql, cleanUp as cleanUpSql } from './data/sql/index.js';
import pool from './data/sql/mariadb.js';
import { sync as syncAssets } from './core/assets.js';
import { connect as connectRedis } from './data/redis/client.js';
import routes from './routes/index.js';
import chatProvider from './core/ChatProvider.js';
import { loadCaptchaFontsFromDb } from './core/captchaserver.js';
import rpgEvent from './core/RpgEvent.js';
import chaosEvent from './core/ChaosEvent.js';
import { initialize as initializeFishing } from './core/Fishing.js';
import canvasCleaner from './core/CanvasCleaner.js';
import mailProvider from './core/MailProvider.js';
import { ModtoolsLogger, PixelLogger } from './core/logger.js';
import { User } from './middleware/session.js';
import { HourlyCron, DailyCron } from './utils/cron.js';
import netGuard from './utils/netguard.js';
import securityHeaders from './middleware/securityHeaders.js';

import socketEvents from './socket/socketEvents.js';
import SocketServer from './socket/SocketServer.js';
import APISocketServer from './socket/APISocketServer.js';

import {
  PORT, HOST, HOURLY_EVENT, FISHING, BASENAME,
} from './core/config.js';
import { SECOND } from './core/constants.js';

import startAllCanvasLoops from './core/tileserver.js';

/*
 * in final bundle make sure to cd to dir of script, just because
 */
if (process.env.NODE_ENV && __dirname) {
  process.chdir(__dirname);
}

const app = express();
app.disable('x-powered-by');

/*
 * GÜVENLİK KATMANI 1 — NetGuard (DDoS/DoS sel kalkanı)
 * Gövde ayrıştırıcıdan ÖNCE çalışır: sel geldiğinde JSON okumadan, oturum
 * çözmeden hızlıca reddeder, böylece sunucu çökmez.
 * Pixel çizimi websocket ikili (binary) kanalından geçer ve bu katman o
 * istekleri hiç saymaz → ardı ardına pixel atmak asla DDoS sayılmaz.
 */
app.use(netGuard.middleware());

/* GÜVENLİK KATMANI 2 — güvenlik başlıkları (iframe'i bozmadan) */
app.use(securityHeaders());


// Call Garbage Collector every 30 seconds
setInterval(forceGC, 10 * 60 * SECOND);

// create http server
const server = http.createServer(app);

/*
 * Yavaş saldırı (slowloris) koruması: başlığı bir türlü göndermeyen
 * soketler erken kesilir; ayrıca kaynak tavanları sınırlanır.
 */
server.headersTimeout = 20 * 1000;
server.requestTimeout = 120 * 1000;
server.keepAliveTimeout = 15 * 1000;
server.maxHeadersCount = 100;
server.on('clientError', (err, socket) => {
  try {
    socket.destroy();
  } catch (e) { /* soket zaten kapanmis */ }
});

//
// websockets
// -----------------------------------------------------------------------------
const usersocket = new SocketServer();
const apisocket = new APISocketServer();
const wsUrl = `${BASENAME}/ws`;
const apiWsUrl = `${BASENAME}/mcws`;
async function wsupgrade(request, socket, head) {
  const { pathname } = url.parse(request.url);
  const ipString = netGuard.ipOf(request);

  /*
   * El sıkışmayı 15 saniyede tamamlamayan soket kapatılır: binlerce yarım
   * websocket açıp belleği şişirme denemesi böylece çöker.
   */
  const upgradeTimer = setTimeout(() => {
    if (!socket.pgUpgraded) {
      try {
        socket.destroy();
      } catch (e) { /* soket kapali */ }
    }
  }, 15 * 1000);
  if (upgradeTimer.unref) {
    upgradeTimer.unref();
  }
  socket.once('close', () => clearTimeout(upgradeTimer));

  /* cezalı IP el sıkışamaz */
  if (netGuard.isPenalized(ipString) > 0) {
    socket.write('HTTP/1.1 429 Too Many Requests\r\n\r\n');
    socket.destroy();
    return;
  }
  /*
   * Kayan pencere: normal yeniden bağlanmalar serbest, sel halinde
   * kademeli ceza (15s → 1dk → 5dk → 30dk → 2sa) devreye girer.
   */
  if (netGuard.hit(ipString, 'ws_up', 1).penalized) {
    socket.write('HTTP/1.1 429 Too Many Requests\r\n\r\n');
    socket.destroy();
    return;
  }

  try {
    if (pathname === wsUrl) {
      await usersocket.handleUpgrade(request, socket, head);
    } else if (pathname === apiWsUrl) {
      await apisocket.handleUpgrade(request, socket, head);
    } else {
      socket.write('HTTP/1.1 404 Not found\r\n\r\n');
      socket.destroy();
    }
  } catch (err) {
    console.error(`WebSocket upgrade error: ${err.message}`);
    socket.write('HTTP/1.1 503 Service Unavailable\r\n\r\n');
    socket.destroy();
  }
}
server.on('upgrade', wsupgrade);

/*
 * These are the owner accounts for this imported PixelPlanet instance.
 * Run this only after syncSql(), because a fresh runtime has no Users table
 * until the schema synchronization has completed.
 */
async function ensureOwnerAdmins() {
  const result = await pool.query(
    `UPDATE Users
     SET userlvl = 100
     WHERE id IN (7, 8)
        OR LOWER(username) IN ('azepix', 'elyvora')`,
  );
  if (result.affectedRows > 0) {
    console.log(`Owner admin accounts ensured (${result.affectedRows} updated).`);
  }
}

/*
 * use gzip compression for following calls
 * level from -1 (default, 6) to 0 (no) from 1 (fastest) to 9 (best)
 *
 * Set custom filter to make sure that .bmp files get compressed
 */
app.use(compression({
  level: 3,
  filter: (req, res) => {
    const contentType = res.getHeader('Content-Type');
    if (contentType === 'application/octet-stream') {
      return true;
    }
    return compression.filter(req, res);
  },
}));

app.use(routes);

/*
 * Beklenmeyen hatalarda yığın izi / iç detay sızdırılmaz.
 */
app.use((err, req, res, next) => {
  if (res.headersSent) {
    next(err);
    return;
  }
  const status = err.status || err.statusCode || 500;
  console.error(`Sunucu hatasi (${req.method} ${req.originalUrl}): ${err.message}`);
  const tooBig = status === 413 || err.type === 'entity.too.large';
  const msg = tooBig
    ? 'Gönderilen veri çok büyük.'
    : 'Bir hata oluştu, lütfen tekrar dene.';
  if (req.path && req.path.startsWith('/api/')) {
    res.status(status).json({ errors: [msg] });
    return;
  }
  res.status(status).type('text/plain').send(msg);
});

//
// ip config
// -----------------------------------------------------------------------------
// sync sql models
syncSql()
  .then(ensureOwnerAdmins)
  // connect to redis
  .then(connectRedis)
  .then(syncAssets)
  .then(async () => {
    User.setMailProvider(mailProvider);

    /*
     * First make sure chatProvider is ready, then tell logger where it is.
     * Logger needs it for printing to chat.
     */
    await chatProvider.initialize();
    ModtoolsLogger.chatProvider = chatProvider;

    startAllCanvasLoops();
    loadCaptchaFontsFromDb();
    usersocket.initialize();
    apisocket.initialize();
    canvasCleaner.initialize();

    // start http server
    const startServer = () => {
      server.listen(PORT, HOST, () => {
        console.info(`HTTP Server listening on port ${PORT}`);
      });
    };
    startServer();
    // catch errors of server
    server.on('error', (e) => {
      console.error(
        `HTTP Server Error ${e.code} occurred, trying again in 5s...`,
      );
      setTimeout(() => {
        server.close();
        startServer();
      }, 5000);
    });

    await socketEvents.initialize();

    /*
     * initializers that rely on the cluster being fully established
     * i.e. to know if it is the shard that runs the event
     */
    if (socketEvents.isCluster && socketEvents.important) {
      console.info('I am the main shard');
    }

    await rankings.initialize();
    HourlyCron.hook(Ranks.setHourlyRanking);
    DailyCron.hook(Ranks.setDailyRanking);
    DailyCron.hook(PixelLogger.prepareLogFile);

    HourlyCron.hook(async () => {
      if (!socketEvents.important) {
        return;
      }
      await cleanUpSql();
    });

    if (HOURLY_EVENT) {
      /*
       * give us 10s extra of negotating shards,
       * TODO: initialize RpgEvent either in a redis lua function or in a
       * single transaction, so we can not clash with other shards
       */
      setTimeout(() => {
        rpgEvent.initialize();
      }, 10000);
    }
    if (FISHING) {
      initializeFishing();
    }

    // Chaos Event: every 1 hour, 0.5s cooldown for 30 minutes
    chaosEvent.initialize();

  });
