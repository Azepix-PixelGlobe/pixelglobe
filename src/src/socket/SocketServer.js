/*
 * main websocket server
 */
import WebSocket from 'ws';

import canvases from '../core/canvases.js';
import MassRateLimiter from '../utils/MassRateLimiter.js';
import ddosGuard from '../utils/DDoSGuard.js';
import netGuard from '../utils/netguard.js';
import Counter from '../utils/Counter.js';
import {
  REG_CANVAS_OP,
  PIXEL_UPDATE_OP,
  REG_CHUNK_OP,
  REG_MCHUNKS_OP,
  DEREG_CHUNK_OP,
  DEREG_MCHUNKS_OP,
  FISH_CATCHED_OP,
} from './packets/op.js';
import {
  hydrateRegCanvas,
  hydrateRegChunk,
  hydrateDeRegChunk,
  hydrateRegMChunks,
  hydrateDeRegMChunks,
  hydratePixelUpdate,
  dehydrateChangeMe,
  dehydrateRefresh,
  dehydrateOnlineCounter,
  dehydrateCoolDown,
  dehydratePixelReturn,
  dehydrateCaptchaReturn,
  dehydrateFishAppears,
  dehydrateFishCatched,
} from './packets/server.js';
import socketEvents from './socketEvents.js';
import chatProvider from '../core/ChatProvider.js';
import authenticateClient from './authenticateClient.js';
import drawByOffsets from '../core/draw.js';
import { getCoolDown } from '../data/redis/cooldown.js';
import { markChannelsRead } from '../data/sql/Channel.js';
import { checkVerificationSolutions } from '../data/sql/Captcha.js';
import { isCORSAllowed } from '../middleware/cors.js';
import evaluateMalware from '../core/malwareEvaluation.js';
import {
  applyMemberState, joinedNotice, memberSummary, roomFlags, targetedNotice, targetUid,
} from './callSignaling.js';


const ipCounter = new Counter();
/*
 * Kontrol/sinyal çerçeveleri limiteri: 10 dakikalık bütçe (~60 çerçeve/dk),
 * tetiklenince 2 dakika mola. Tekrar eden saldırganda NetGuard kademesi
 * cezayı 1dk → 5dk → 30dk → 2sa'ya kadar uzatır.
 */
const rateLimiter = new MassRateLimiter(2 * 60 * 1000, 10 * 60 * 1000);
/*
 * Aynı IP'den en fazla kaç eşzamanlı websocket: okul/işyeri/mobil NAT
 * arkasında onlarca oyuncu olabilir → bu sınır BAN değil, sadece ret.
 */
const MAX_SOCKETS_PER_IP = 30;
/* Toplam websocket tavanı: bellek tükenmesini engeller */
const MAX_WS_CLIENTS = 5000;
/* Metin çerçevesi üst sınırı (SDP/ICE mesajları bunun çok altında kalır) */
const MAX_TEXT_FRAME = 32768;
/*
 * KAOS KAPASİTESİ (ürün kuralı): kaos başladığında 100+ oyuncu 10x10 fırçayla
 * "hayvan gibi" pixel yağdırabilir. Bu tavanlar oyunu ÇÖKERTMEK için değil,
 * kötü niyetli sınırsız kuyruğu kesmek için var. Kaos trafiğinin tamamı rahat
 * sığsın diye ölçüldü ve büyütüldü:
 *   - 100 oyuncu × 10x10 fırça × 5 tık/sn = 5.000 piksel/sn (≈50 istek/sn)
 *   - kuyruk 256 istek/oyuncu, toplam 4096 istek, eşzamanlı Redis işi 64
 * Sınır aşılırsa soket KAPATILMAZ; isteğe "birazdan tekrar dene" (retCode 13)
 * cevabı verilir ve istemci 20-3000 ms sonra yeniden dener.
 */
const pixelRequestQueues = new Map();
const MAX_PIXEL_REQUESTS_PER_KEY = 256;
const MAX_PIXEL_REQUESTS_TOTAL = 4096;
const MAX_ACTIVE_PIXEL_REQUESTS = 64;
const MAX_PIXEL_CLIENT_BUFFERED_BYTES = 4 * 1024 * 1024;
let pendingPixelRequests = 0;
let activePixelRequests = 0;
const pixelSchedulerWaiters = [];

/*
 * Serialize pixel placement per user (or guest IP) and cap the total work
 * admitted to Redis. WebSocket message handlers are invoked concurrently; an
 * unbounded promise chain lets a chaos burst turn into a memory leak.
 */
function acquirePixelSlot() {
  if (activePixelRequests < MAX_ACTIVE_PIXEL_REQUESTS) {
    activePixelRequests += 1;
    return Promise.resolve();
  }

  return new Promise((resolve) => {
    pixelSchedulerWaiters.push(resolve);
  });
}

function releasePixelSlot() {
  const next = pixelSchedulerWaiters.shift();
  if (next) {
    next();
  } else {
    activePixelRequests -= 1;
  }
}

function enqueuePixelRequest(queueKey, request) {
  let queue = pixelRequestQueues.get(queueKey);
  if (!queue) {
    queue = {
      tail: Promise.resolve(),
      pending: 0,
    };
    pixelRequestQueues.set(queueKey, queue);
  }

  if (
    queue.pending >= MAX_PIXEL_REQUESTS_PER_KEY
    || pendingPixelRequests >= MAX_PIXEL_REQUESTS_TOTAL
  ) {
    return null;
  }

  queue.pending += 1;
  pendingPixelRequests += 1;
  const previous = queue.tail;
  const current = previous
    .catch(() => {})
    .then(async () => {
      await acquirePixelSlot();
      try {
        return await request();
      } finally {
        releasePixelSlot();
      }
    });
  queue.tail = current;

  const cleanup = () => {
    queue.pending -= 1;
    pendingPixelRequests -= 1;
    if (queue.pending === 0 && pixelRequestQueues.get(queueKey) === queue) {
      pixelRequestQueues.delete(queueKey);
    }
  };
  current.then(cleanup, cleanup);
  return current;
}

/*
 * Voice room tracking for WebRTC signaling
 * channelId -> Set<{ ws, userId, name, video, share }>
 */
const VOICE_ROOMS = new Map();

/* initialize() sırasında doldurulur: belirli bir oyuncuya mesaj yollamak için */
let WSS = null;

/**
 * Bir oyuncunun TÜM sekmelerine metin mesajı yolla.
 * Çalan telefon (ring) ve arama sonu bildirimleri oda üyeliği gerektirmez;
 * bu yüzden hedef oyuncuyu açık soketler arasında ararız.
 * @return kaç sokete ulaşıldı
 */
function sendToUser(userId, text) {
  if (!WSS || !userId) return 0;
  let sent = 0;
  WSS.clients.forEach((client) => {
    if (client.user && client.user.id === userId && client.readyState === 1) {
      try {
        client.send(text);
        sent += 1;
      } catch (e) { /* istemci koptu */ }
    }
  });
  return sent;
}

/** Odadaki diğer üyelere (gönderen hariç) mesaj yolla. */
function sendToRoomOthers(room, senderWs, obj) {
  if (!room) return;
  const text = `wr,${JSON.stringify(obj)}`;
  room.forEach((member) => {
    if (member.ws === senderWs) return;
    try { member.ws.send(text); } catch (e) { /* istemci koptu */ }
  });
}

function voiceRoomCleanup(ws) {
  for (const [channelId, room] of VOICE_ROOMS) {
    for (const member of room) {
      if (member.ws === ws) {
        room.delete(member);
        const msg = `wr,${JSON.stringify({ type: 'left', channelId, userId: member.userId })}`;
        room.forEach((m) => { try { m.ws.send(msg); } catch (e) { /* ignore */ } });
        break;
      }
    }
    if (room.size === 0) {
      VOICE_ROOMS.delete(channelId);
    }
  }
}

class SocketServer {
  // WebSocket.Server
  wss;
  // Map<number, Array>
  CHUNK_CLIENTS;

  constructor() {
    this.CHUNK_CLIENTS = new Map();

    this.broadcastPixelBuffer = this.broadcastPixelBuffer.bind(this);
    this.reloadUser = this.reloadUser.bind(this);
    this.reloadIP = this.reloadIP.bind(this);
    this.patchUserState = this.patchUserState.bind(this);
    this.getOnlineUsers = this.getOnlineUsers.bind(this);
    this.checkHealth = this.checkHealth.bind(this);
  }

  initialize() {
    console.info('Starting websocket server');

    const wss = new WebSocket.Server({
      perMessageDeflate: false,
      clientTracking: true,
      maxPayload: 65536,
      noServer: true,
    });
    this.wss = wss;
    WSS = wss;

    wss.on('error', (e) => {
      console.error(`WebSocket Server Error ${e.message}`);
    });

    wss.on('connection', (ws, req) => {
      ws.timeLastMsg = Date.now();
      ws.connectedTs = ws.timeLastMsg;
      ws.canvasId = null;
      ws.chunkCnt = 0;
      ws.openChatChannels = new Set();
      /* populate data from request */
      const { user, ip, lang, device, ttag } = req;
      ws.user = user;
      ws.ip = ip;
      ws.browserHash = device.browserHash;
      ws.lang = lang;
      ws.ttag = ttag;
      ipCounter.add(ip.ipString);

      ws.send(dehydrateOnlineCounter(socketEvents.onlineCounter));

      ws.on('error', (e) => {
        // eslint-disable-next-line max-len
        console.error(`WebSocket Client Error for ${ws.user?.data.name}: ${e.message}`);
      });

      ws.on('close', () => {
        ipCounter.delete(ip.ipString);
        this.deleteAllChunks(ws);
        voiceRoomCleanup(ws);
      });

      ws.on('message', (data, isBinary) => {
        ws.timeLastMsg = Date.now();
        if (isBinary) {
          this.onBinaryMessage(data, ws);
        } else {
          const message = data.toString();
          SocketServer.onTextMessage(message, ws);
        }
      });
    });

    socketEvents.on('pixelUpdate', this.broadcastPixelBuffer);
    socketEvents.on('nameStyleUpdate', (uid, nameStyle) => {
      const text = `ns,${JSON.stringify([uid, nameStyle || 'none'])}`;
      this.wss.clients.forEach((ws) => {
        if (ws.readyState === 1) {
          try { ws.send(text); } catch { /* disconnected client */ }
        }
      });
    });
    /* aktif avatar çerçevesi: 'fs' çerçevesi ile yayınlanır (ns ile aynı desen) */
    socketEvents.on('frameStyleUpdate', (uid, frame) => {
      const text = `fs,${JSON.stringify([uid, frame || 'none'])}`;
      this.wss.clients.forEach((ws) => {
        if (ws.readyState === 1) {
          try { ws.send(text); } catch { /* disconnected client */ }
        }
      });
    });
    socketEvents.on('reloadUser', this.reloadUser);
    socketEvents.on('reloadIP', this.reloadIP);
    socketEvents.on('patchState', this.patchUserState);

    socketEvents.on('resetAllCaptchas', () => {
      this.wss.clients.forEach((ws) => {
        ws.ip.verificationRecheckTs = 0;
      });
    });

    socketEvents.on('onlineCounter', (online) => {
      this.broadcast(dehydrateOnlineCounter(online));
    });

    socketEvents.on('announcement', (text) => {
      this.broadcast(`an,${JSON.stringify(text)}`);
    });

    socketEvents.on('chaos', (endTs) => {
      this.broadcast(`chaos,${JSON.stringify({ endTs })}`);
    });

    socketEvents.on('suChatMessage', (
      userId,
      name,
      message,
      channelId,
      id,
      country,
    ) => {
      const ts = Math.floor(Date.now() / 1000);
      const text = `ck,${JSON.stringify(
        [channelId, false, name, message, country, id, ts,
          ts, false, null, []],
      )}`;
      this.findAllWsByUerId(userId).forEach((ws) => {
        ws.send(text);
      });
    });

    socketEvents.on('chatMessage', (
      name,
      message,
      channelId,
      userId,
      flag,
      ts,
      msgId,
      flagLegit,
      avatarId,
      attachments,
      _sendapi,
      nameStyle = 'none',
    ) => {
      const isPublicChannel = chatProvider.isPublicChannel(channelId);
      // ws objects
      const viewingClientArray = [];
      const viewingClientArrayNotify = [];
      // user ids
      const readMarkingArray = [];

      this.wss.clients.forEach((ws) => {
        const hasChannelOpen = ws.openChatChannels.has(channelId);

        if (isPublicChannel) {
          if (hasChannelOpen) {
            viewingClientArray.push(ws);
          }
          return;
        }
        if (ws.user?.hasChannel(channelId)) {
          if (ws.user?.hasChannelMuted(channelId) || hasChannelOpen) {
            viewingClientArray.push(ws);
          } else {
            viewingClientArrayNotify.push(ws);
          }
          if (hasChannelOpen) {
            readMarkingArray.push(ws.user.id);
          }
        }
      });

      if (viewingClientArray.length) {
        const text = `ck,${JSON.stringify(
          [channelId, false, name, message, flag, userId, ts,
            msgId, flagLegit, avatarId, attachments, nameStyle || 'none'],
        )}`;
        SocketServer.broadcastSelected(viewingClientArray, text);
      }

      if (viewingClientArrayNotify.length) {
        const text = `ck,${JSON.stringify(
          [channelId, true, name, message, flag, userId, ts,
            msgId, flagLegit, avatarId, attachments, nameStyle || 'none'],
        )}`;
        SocketServer.broadcastSelected(viewingClientArrayNotify, text);
      }

      if (readMarkingArray.length) {
        markChannelsRead(channelId, readMarkingArray);
      }
    });

    socketEvents.on('deletePublicUserMessages', (userId) => {
      this.broadcast(`dpum,${JSON.stringify(userId)}`);
    });

    socketEvents.on('deleteUserChannelMessages', (userId, channelId) => {
      const text = `dmc,${JSON.stringify([userId, channelId])}`;
      const clientArray = [];
      const isPublicChannel = chatProvider.isPublicChannel(channelId);
      this.wss.clients.forEach((ws) => {
        const hasChannelOpen = ws.openChatChannels.has(channelId);
        if (hasChannelOpen && (
          isPublicChannel || ws.user?.hasChannel(channelId)
        )) {
          clientArray.push(ws);
        }
      });
      SocketServer.broadcastSelected(clientArray, text);
    });

    socketEvents.on('deleteMessages', (channelId, messageIds) => {
      const text = `dmm,${JSON.stringify([channelId, messageIds])}`;
      const clientArray = [];
      const isPublicChannel = chatProvider.isPublicChannel(channelId);
      this.wss.clients.forEach((ws) => {
        const hasChannelOpen = ws.openChatChannels.has(channelId);
        if (hasChannelOpen && (
          isPublicChannel || ws.user?.hasChannel(channelId)
        )) {
          clientArray.push(ws);
        }
      });
      SocketServer.broadcastSelected(clientArray, text);
    });

    socketEvents.on('rateLimitTrigger', (ip, blockTime) => {
      rateLimiter.forceTrigger(ip, blockTime);
      const amount = this.killAllWsByUerIp(ip);
      if (amount) {
        console.warn(`Killed ${amount} connections for RateLimit`);
      }
    });

    /*
     * chose a random connection of ip to send a fish to
     */
    socketEvents.on('sendFish', (ip, type, size) => {
      let connectionIndex = Math.floor(Math.random() * ipCounter.get(ip));
      let chosenWs;
      const it = this.wss.clients.keys();
      let client = it.next();
      while (!client.done) {
        const ws = client.value;
        if (ws.readyState === WebSocket.OPEN
          && ws.ip.ipString === ip && ws.chunkCnt > 1
        ) {
          chosenWs = ws;
          if (connectionIndex <= 0) {
            break;
          }
          connectionIndex -= 1;
        }
        client = it.next();
      }
      if (chosenWs) {
        chosenWs.sentFish = [Date.now(), type, size];
        chosenWs.send(dehydrateFishAppears(type, size));
      }
    });

    // when changing interval, remember that online counter gets used as ping
    // for binary sharded channels in MessageBroker.js
    setInterval(this.getOnlineUsers, 20 * 1000);
    setInterval(this.checkHealth, 15 * 1000);
  }

  static async onRateLimitTrigger(ip, blockTime, reason) {
    /*
     * Kademeli ceza: ilk ihlal kısa (en az 60 sn), tekrarında süre katlanır.
     * Sabit 1 saat ban, NAT arkasındaki masum oyuncuları da vuruyordu.
     */
    const ms = netGuard.penalize(
      ip, `ws:${reason}`, Math.max(blockTime || 0, 60 * 1000),
    );
    console.warn(
      `Client ${ip} triggered Socket-RateLimit by ${reason}. (${Math.round(ms / 1000)}s)`,
    );
    ddosGuard.ban(ip, ms, `ws:${reason}`);
    socketEvents.broadcastRateLimitTrigger(ip, ms);
  }

  async handleUpgrade(request, socket, head) {
    await authenticateClient(request);
    const { ip: { ipString } } = request;
    /*
     * DDoS hard-ban check
     */
    if (ddosGuard.banRemaining(ipString) > 0) {
      socket.write('HTTP/1.1 429 Too Many Requests\r\n\r\n');
      socket.destroy();
      return;
    }
    /*
     * GÜVENLİK: toplam websocket tavanı (bellek tükenmesi koruması)
     */
    if (this.wss.clients.size >= MAX_WS_CLIENTS) {
      console.warn(`Websocket tavani doldu, ${ipString} reddedildi.`);
      socket.write('HTTP/1.1 503 Service Unavailable\r\n\r\n');
      socket.destroy();
      return;
    }
    /*
     * Bağlantı seli kontrolü: kayan pencere ile sayılır. Normal yeniden
     * bağlanmalar serbest; saniyede onlarca el sıkışma denemesi kademeli
     * cezaya yol açar (eskiden 15 denemede 1 SAAT ban geliyordu).
     */
    if (netGuard.hit(ipString, 'ws_up', 1).penalized) {
      socket.write('HTTP/1.1 429 Too Many Requests\r\n\r\n');
      socket.destroy();
      return;
    }
    /*
     * enforce CORS
     */
    if (!isCORSAllowed(request)) {
      // eslint-disable-next-line max-len
      console.info(`Rejected CORS request on websocket from ${ipString} via ${request.headers.origin}, expected ${request.ip.getHost(false, true)}`);
      socket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
      socket.destroy();
      return;
    }
    /*
     * Limiting socket connections per ip
     */
    if (ipCounter.get(ipString) >= MAX_SOCKETS_PER_IP) {
      /* ban yok: aynı NAT'taki diğer oyuncuları cezalandırmıyoruz */
      console.warn(`IP ${ipString} es zamanli soket sinirinda, ret edildi.`);
      socket.write('HTTP/1.1 429 Too Many Requests\r\n\r\n');
      socket.destroy();
      return;
    }

    this.wss.handleUpgrade(request, socket, head, (ws) => {
      /* el sıkışma tamam: server.js'teki yavaş-saldırı zamanlayıcısını durdur */
      socket.pgUpgraded = true;
      this.wss.emit('connection', ws, request);
    });
  }

  /**
   * https://github.com/websockets/ws/issues/617
   * @param data
   */
  static broadcastSelected(clients, data, options = {}) {
    let frames;

    if (typeof data === 'string') {
      frames = WebSocket.Sender.frame(Buffer.from(data), {
        readOnly: false,
        mask: false,
        rsv1: false,
        opcode: 1,
        fin: true,
      });
    } else {
      frames = WebSocket.Sender.frame(data, {
        readOnly: false,
        mask: false,
        rsv1: false,
        opcode: 2,
        fin: true,
      });
    }

    return clients.map((ws) => new Promise((resolve) => {
      if (ws.readyState === WebSocket.OPEN) {
        if (
          options.dropSlow
          && ws.bufferedAmount > MAX_PIXEL_CLIENT_BUFFERED_BYTES
        ) {
          // A client that cannot keep up will otherwise retain every pixel
          // frame in ws' send buffer. Reconnects resync the affected chunks.
          ws.terminate();
          resolve();
          return;
        }
        // eslint-disable-next-line no-underscore-dangle
        ws._sender.sendFrame(frames, (err) => {
          if (err) {
            console.error(

              `WebSocket broadcast error on ${ws.ip.ipString} : ${err.message}`,
            );
          }
        });
      }
      resolve();
    }));
  }

  broadcast(data) {
    const clientArray = [];
    this.wss.clients.forEach((ws) => {
      clientArray.push(ws);
    });
    SocketServer.broadcastSelected(clientArray, data);
  }

  findAllWsByUerId(userId) {
    const clients = [];
    const it = this.wss.clients.keys();
    let client = it.next();
    while (!client.done) {
      const ws = client.value;
      if (ws.readyState === WebSocket.OPEN
        && ws.user?.id === userId
      ) {
        clients.push(ws);
      }
      client = it.next();
    }
    return clients;
  }

  killAllWsByUerIp(ip) {
    let amount = ipCounter.get(ip);
    if (!amount) {
      return 0;
    }
    for (const [chunkid, clients] of this.CHUNK_CLIENTS.entries()) {
      const newClients = clients.filter((ws) => ws.ip.ipString !== ip);
      if (clients.length !== newClients.length) {
        this.CHUNK_CLIENTS.set(chunkid, newClients);
      }
    }

    const it = this.wss.clients.keys();
    amount = 0;
    let client = it.next();
    while (!client.done) {
      const ws = client.value;
      if (ws.readyState === WebSocket.OPEN
        && ws.ip.ipString === ip
      ) {
        /*
         * we deleted all registered chunks above
         * have to reset it to avoid onClose to
         * do it again.
         */
        ws.chunkCnt = 0;
        ws.terminate();
        amount += 1;
      }
      client = it.next();
    }
    return amount;
  }

  broadcastPixelBuffer(canvasId, chunkid, data) {
    if (this.CHUNK_CLIENTS.has(chunkid)) {
      const clients = this.CHUNK_CLIENTS.get(chunkid)
        .filter((ws) => ws.canvasId === canvasId);
      SocketServer.broadcastSelected(clients, data, { dropSlow: true });
    }
  }

  reloadUser(userId, local) {
    const buffer = dehydrateChangeMe();
    this.wss.clients.forEach(async (ws) => {
      if (ws.readyState === WebSocket.OPEN
        && ws.user?.id === userId
      ) {
        const { loggedOut } = await ws.user.refresh();
        if (loggedOut) {
          delete ws.user;
        }
        if (!local) {
          ws.send(buffer);
        }
      }
    });
  }

  reloadIP(ipString, local) {
    const buffer = dehydrateChangeMe();
    this.wss.clients.forEach(async (ws) => {
      if (ws.readyState === WebSocket.OPEN
        && ws.ip.ipString === ipString
      ) {
        await ws.ip.refresh();
        if (!local) {
          ws.send(buffer);
        }
      }
    });
  }

  patchUserState(userIds, state, patch) {
    const text = `ps,${JSON.stringify([
      state, patch.op, patch.path, patch.value,
    ])}`;

    const clientArray = [];
    if (Array.isArray(userIds)) {
      this.wss.clients.forEach((ws) => {
        if (ws.readyState === WebSocket.OPEN
          && ws.user && userIds.includes(ws.user.id)
        ) {
          ws.user.patchUserState(state, patch);
          clientArray.push(ws);
        }
      });
    } else {
      this.wss.clients.forEach((ws) => {
        if (ws.readyState === WebSocket.OPEN
          && ws.user?.id === userIds
        ) {
          ws.user.patchUserState(state, patch);
          clientArray.push(ws);
        }
      });
    }

    SocketServer.broadcastSelected(clientArray, text);
  }

  checkHealth() {
    const ts = Date.now() - 120 * 1000;
    const promises = [];
    this.wss.clients.forEach((ws) => {
      promises.push(new Promise((resolve) => {
        if (
          ws.readyState === WebSocket.OPEN
          && ts > ws.timeLastMsg
        ) {
          console.info(`Killing dead websocket from ${ws.ip.ipString}`);
          ws.terminate();
          resolve();
        }
      }),
      );
    });
    return promises;
  }

  /*
   * Create object with informations of online users and give it
   * to socketEvents.
   * Is run periodically to update online counters. We have to send lists of
   * IPs around to filter out duplicates. The public counter uses account
   * identities so multiple users behind one IP are not collapsed together.
   */
  getOnlineUsers() {
    try {
      /*
       * {
       *   canvasId: [127.0.0.1, 127.0.0.2, ...],
       *   ...
       * }
       */
      const online = {};
      const onlineUserData = {};
      const ipUsers = {};
      const it = this.wss.clients.keys();
      let client = it.next();
      while (!client.done) {
        const ws = client.value;
        if (ws.readyState === WebSocket.OPEN && ws.canvasId !== null) {
          const { canvasId, ip: { ipString }, user } = ws;
          // ip to user mapping, not logged in = 0
          const uid = user?.id || 0;
          const identity = uid ? `u:${uid}` : `i:${ipString}`;
          if (!onlineUserData[canvasId]) {
            onlineUserData[canvasId] = [identity];
          } else if (!onlineUserData[canvasId].includes(identity)) {
            onlineUserData[canvasId].push(identity);
          }
          if (!ipUsers[ipString]) {
            ipUsers[ipString] = [uid];
          } else if (!ipUsers[ipString].includes(uid)) {
            ipUsers[ipString].push(uid);
          }
          // Keep unique IPs per canvas for anti-abuse and gameplay systems.
          if (!online[canvasId]) {
            online[canvasId] = [ipString];
          } else if (!online[canvasId].includes(ipString)) {
            online[canvasId].push(ipString);
          }
        }
        client = it.next();
      }
      socketEvents.setOnlineUsers(online, ipUsers, onlineUserData);
    } catch (err) {
      console.error(`WebSocket online broadcast error: ${err.message}`);
    }
  }

  static async onTextMessage(text, ws) {
    /*
     * GÜVENLİK: metin çerçevesi seli (JSON ayrıştırma maliyeti yüksek) ve
     * aşırı büyük çerçeve. Pixel çizimi BURADAN geçmez — pixel istekleri
     * binary kanaldadır, o yüzden ardı ardına pixel atmak bu sayaca hiç
     * dokunmaz ve asla ceza almaz.
     */
    if (typeof text !== 'string' || text.length > MAX_TEXT_FRAME) {
      console.warn('Cok buyuk/gecersiz metin cercevesi, soket kapatiliyor.');
      ws.close(1009, 'too large');
      return;
    }
    if (netGuard.isPenalized(ws.ip.ipString) > 0
      || netGuard.hit(ws.ip.ipString, 'ws_msg', 1).penalized) {
      /*
       * Ceza altındaki soketten gelen çerçeveler sessizce düşürülür ve soket
       * YALNIZCA BİR KEZ kapatılır (log/kapatma seli de bir DoS yüzeyidir).
       */
      if (!ws.pgRateClosed) {
        ws.pgRateClosed = true;
        console.warn(`Metin cercevesi seli: ${ws.ip.ipString} kapatiliyor.`);
        try {
          ws.close(1008, 'rate');
        } catch (e) { /* soket zaten kapali */ }
      }
      return;
    }
    const { ipString } = ws.ip;
    // rate limit
    const isLimited = rateLimiter.tick(
      ipString,
      1000,
      'text message spam',
      SocketServer.onRateLimitTrigger,
    );
    if (isLimited) {
      return;
    }
    // ---
    try {
      const comma = text.indexOf(',');
      if (comma === -1) {
        throw new Error('No comma');
      }
      const key = text.slice(0, comma);
      const val = JSON.parse(text.slice(comma + 1));
      const { user } = ws;
      switch (key) {
        case 'ck': {
          // chat message
          const message = val[0].trim();
          if (!user || !message) {
            return;
          }
          socketEvents.recvChatMessage(
            user, ws.ip, message, val[1], ws.lang, ws.ttag,
          );
          break;
        }
        case 'cv': {
          ws.openChatChannels = new Set(val[1].slice(0, 50));
          markChannelsRead(
            chatProvider.filterPublicChannels([...ws.openChatChannels]),
            ws.user?.id,
          );
          break;
        }
        case 'cs': {
          // captcha solution
          const [solution, captchaid, challengeSolution] = val;
          const ret = await checkVerificationSolutions(
            captchaid, solution, challengeSolution,
            ws.browserHash, ipString, user?.id, false,
          );
          ws.send(dehydrateCaptchaReturn(ret));
          break;
        }
        case 'mr': {
          // malware evaluation
          await evaluateMalware(user, ws.ip, ...val);
          break;
        }
        case 'cm': {
          /*
           * TODO only temporary for update notifications
           */
          ws.send(dehydrateRefresh());
          break;
        }
        case 'wr': {
          /* WebRTC voice room signaling */
          if (!user) break;
          const {
            type, channelId, to, data,
          } = val;
          switch (type) {
            case 'join': {
              let room = VOICE_ROOMS.get(channelId);
              if (!room) {
                room = new Set();
                VOICE_ROOMS.set(channelId, room);
              }
              const flags = roomFlags(val.data);
              const peers = [];
              room.forEach((member) => {
                peers.push(memberSummary(member));
                try {
                  member.ws.send(`wr,${JSON.stringify(joinedNotice(user, channelId, flags))}`);
                } catch (e) { /* ignore */ }
              });
              room.add({
                ws,
                userId: user.id,
                name: user.name,
                video: flags.video,
                share: flags.share,
              });
              ws.send(`wr,${JSON.stringify({ type: 'room', channelId, peers })}`);
              break;
            }
            case 'leave': {
              const room = VOICE_ROOMS.get(channelId);
              if (!room) break;
              for (const member of room) {
                if (member.ws === ws) {
                  room.delete(member);
                  break;
                }
              }
              const leftMsg = `wr,${JSON.stringify({
                type: 'left', channelId, userId: user.id,
              })}`;
              room.forEach((member) => {
                try { member.ws.send(leftMsg); } catch (e) { /* ignore */ }
              });
              if (room.size === 0) VOICE_ROOMS.delete(channelId);
              break;
            }
            case 'signal': {
              const room = VOICE_ROOMS.get(channelId);
              if (!room) break;
              const signalMsg = `wr,${JSON.stringify({
                type: 'signal', channelId, from: user.id, data,
              })}`;
              for (const member of room) {
                if (member.userId === to) {
                  try { member.ws.send(signalMsg); } catch (e) { /* ignore */ }
                  break;
                }
              }
              break;
            }
            case 'ring':
            case 'reject':
            case 'cancel':
            case 'end': {
              /* hedefli bildirimler: oyuncu odada olmasa da ulaşır */
              const body = targetedNotice(type, user, val);
              const target = targetUid(type, val);
              if (body && target) sendToUser(target, `wr,${JSON.stringify(body)}`);
              break;
            }
            case 'state': {
              /* kamera / ekran / mikrofon durumu odadaki herkese */
              const room = VOICE_ROOMS.get(channelId);
              applyMemberState(room, ws, data);
              sendToRoomOthers(room, ws, {
                type: 'state', channelId, from: user.id, data: data || {},
              });
              break;
            }
            default:
              break;
          }
          break;
        }
        default:
          throw new Error('Unknown key');
      }
    } catch (err) {
      // eslint-disable-next-line max-len
      console.error(`Got invalid ws text message ${text} from ${ipString}, with error: ${err.message}`);
    }
  }

  async onBinaryMessage(buffer, ws) {
    try {
      const { ipString } = ws.ip;
      const opcode = buffer[0];

      /*
       * PIXEL İSTEKLERİ MUAF (ürün kuralı): ardı ardına pixel atmak normal
       * oyundur, DDoS değildir. PIXEL_UPDATE_OP hiçbir hız sınırına tabi
       * değil; yalnızca kuyruk tavanı ve canvas bekleme süresi geçerli.
       */
      // Pixel placements are already governed by canvas cooldowns and their
      // own sequential queue. Keep rate limiting for socket/chunk spam only.
      if (opcode !== PIXEL_UPDATE_OP) {
        let limiterDeltaTime = 200;
        let reason = 'socket spam';
        if (opcode === REG_CHUNK_OP) {
          limiterDeltaTime = 40;
          reason = 'register chunk spam';
        } else if (opcode === DEREG_CHUNK_OP) {
          limiterDeltaTime = 10;
          reason = 'deregister chunk spam';
        }
        const isLimited = rateLimiter.tick(
          ipString,
          limiterDeltaTime,
          reason,
          SocketServer.onRateLimitTrigger,
        );
        if (isLimited) {
          return;
        }
      }
      // ----

      switch (opcode) {
        case PIXEL_UPDATE_OP: {
          const { canvasId, connectedTs } = ws;

          if (canvasId === null) {
            console.info(`Closing websocket without canvas from ${ipString}`);
            ws.close();
            return;
          }

          const {
            i, j, pixels,
          } = hydratePixelUpdate(buffer);
          const queueKey = ws.user?.id
            ? `user:${ws.user.id}`
            : `ip:${ipString}`;
          const pixelRequest = enqueuePixelRequest(
            queueKey,
            () => drawByOffsets(
              ws.user,
              ws.ip,
              canvasId,
              i, j,
              pixels,
              connectedTs,
            ),
          );
          if (!pixelRequest) {
            // Tell the client to retry later instead of retaining unbounded
            // work in memory during a chaos burst.
            ws.send(dehydratePixelReturn(13, 250, 0, 0, 0));
            return;
          }
          const {
            wait,
            coolDown,
            pxlCnt,
            rankedPxlCnt,
            retCode,
          } = await pixelRequest;

          /*
           * Do not rate-limit normal pixel responses. Yalnızca çok hatalı VE
           * absürt büyük paketler (400+ piksel; meşru fırça en fazla 10x10=100
           * ve protokol paket başına 500'e izin veriyor) şüpheli sayılır;
           * kaos fırtınasındaki normal çizim asla buraya takılmaz.
           */
          if (retCode > 9 && retCode !== 13 && retCode !== 16 && pixels.length > 400) {
            rateLimiter.add(ipString, 50);
          }

          ws.send(dehydratePixelReturn(
            retCode,
            wait,
            coolDown,
            pxlCnt,
            rankedPxlCnt,
          ));
          break;
        }
        case REG_CANVAS_OP: {
          const canvasId = hydrateRegCanvas(buffer);
          if (!canvases[canvasId]) return;
          if (ws.canvasId !== canvasId) {
            this.deleteAllChunks(ws);
          }
          ws.canvasId = canvasId;
          if (canvases[canvasId].ed) return;
          const wait = await getCoolDown(ipString, ws.user?.id, canvasId);
          ws.send(dehydrateCoolDown(wait));
          break;
        }
        case REG_CHUNK_OP: {
          const chunkid = hydrateRegChunk(buffer);
          this.pushChunk(chunkid, ws);
          break;
        }
        case REG_MCHUNKS_OP: {
          this.deleteAllChunks(ws);
          hydrateRegMChunks(buffer, (chunkid) => {
            this.pushChunk(chunkid, ws);
          });
          break;
        }
        case DEREG_CHUNK_OP: {
          const chunkid = hydrateDeRegChunk(buffer);
          this.deleteChunk(chunkid, ws);
          break;
        }
        case DEREG_MCHUNKS_OP: {
          hydrateDeRegMChunks(buffer, (chunkid) => {
            this.deleteChunk(chunkid, ws);
          });
          break;
        }
        case FISH_CATCHED_OP: {
          const { sentFish } = ws;
          if (sentFish) {
            delete ws.sentFish;
            const [timeSent, type, size] = sentFish;
            if (timeSent > Date.now() - 18000) {
              ws.send(dehydrateFishCatched(true, type, size));
              // register ourselves to store it in database
              socketEvents.registerCatchedFish(ws.user, ipString, type, size);
              break;
            }
          }
          ws.send(dehydrateFishCatched(false, 0, 0));
          break;
        }
        default:
          break;
      }
    } catch (e) {
      console.error(`WebSocket Client Binary Message Error: ${e.message}`);
    }
  }

  pushChunk(chunkid, ws) {
    if (ws.chunkCnt === 20000) {
      const { ipString } = ws.ip;
      /* 20bin chunk aboneliği bariz kötüye kullanım: en az 5 dk, tekrarında artar */
      SocketServer.onRateLimitTrigger(ipString, 5 * 60 * 1000, 'too much subscribed');
      return;
    }
    ws.chunkCnt += 1;
    let clients = this.CHUNK_CLIENTS.get(chunkid);
    if (!clients) {
      clients = [];
      this.CHUNK_CLIENTS.set(chunkid, clients);
    } else if (clients.includes(ws)) {
      return;
    }
    clients.push(ws);
  }

  deleteChunk(chunkid, ws) {
    const clients = this.CHUNK_CLIENTS.get(chunkid);
    if (!clients) {
      return;
    }
    const pos = clients.indexOf(ws);
    if (pos === -1) {
      return;
    }
    ws.chunkCnt -= 1;
    clients.splice(pos, 1);
  }

  deleteAllChunks(ws) {
    if (!ws.chunkCnt) {
      return;
    }
    for (const client of this.CHUNK_CLIENTS.values()) {
      const pos = client.indexOf(ws);
      if (pos !== -1) {
        client.splice(pos, 1);
        ws.chunkCnt -= 1;
        if (!ws.chunkCnt) {
          return;
        }
      }
    }
  }
}

export default SocketServer;
