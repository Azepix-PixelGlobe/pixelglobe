/*
 *
 * This WebSocket is used for connecting
 * to minecraft server.
 * The minecraft server can set pixels and report user logins
 * and more.
 *
 */

import WebSocket from 'ws';

import socketEvents from './socketEvents.js';
import { dehydrateOnlineCounter } from './packets/server.js';
import chatProvider from '../core/ChatProvider.js';
import { setPixelByCoords } from '../core/setPixel.js';
import { APISOCKET_KEY } from '../core/config.js';
import authenticateAPIClient from './authenticateAPIClient.js';
import { getBasicUserInfo, getChatStaff } from '../data/sql/User.js';
import mapFlag from '../utils/flagMapping.js';
import { DailyCron } from '../utils/cron.js';


class APISocketServer {
  wss; // WebSocket.Server
  /*
   * mapping of usernames to limited user information
   * [usernameOrId]: {
   *   id,
   *   name,
   *   flagLegit,
   *   country,
   *   userlvl,
   *   isMuted,
   * },
   */
  static #usernameMapping = new Map();

  static async #getUserData(usernameOrId) {
    let userData = APISocketServer.#usernameMapping.get(usernameOrId);
    if (!userData || Date.now() - userData.fetchedAt > 3600 * 1000) {
      userData = await getBasicUserInfo(usernameOrId);
      if (userData) {
        userData.fetchedAt = Date.now();
        APISocketServer.#usernameMapping.set(usernameOrId, userData);
        [userData.flagLegit, userData.country] = mapFlag(
          userData.customRoleFlagId,
          userData.customFlag,
          userData.userlvl,
          userData.country || 'yy',
        );
        delete userData.customFlag;
        delete userData.customRoleFlagId;
      }
    }
    if (Math.random() < 0.07) {
      /* clear old data */
      const cutOffTime = Date.now() - 90 * 60 * 1000;
      for (const [un, data] of APISocketServer.#usernameMapping.entries()) {
        if (data.fetchedAt < cutOffTime) {
          APISocketServer.#usernameMapping.delete(un);
        }
      }
    }
    return userData;
  }

  static #deleteUserFromMapping(userId) {
    for (const [un, data] of APISocketServer.#usernameMapping.entries()) {
      if (data.uid === userId) {
        APISocketServer.#usernameMapping.delete(un);
      }
    }
  }

  static async getPublicChannelsAndStaff() {
    const chanReply = chatProvider.getPublicChannels();
    const staff = await getChatStaff();
    return ['chans', chanReply, staff];
  }

  initialize() {
    console.info('Starting API websocket server');

    const wss = new WebSocket.Server({
      perMessageDeflate: false,
      clientTracking: true,
      maxPayload: 65536,
      noServer: true,
    });
    this.wss = wss;

    wss.on('error', (e) => {
      console.error(`APIWebSocket Server Error ${e.message}`);
    });

    wss.on('connection', async (ws) => {
      ws.isAlive = true;
      ws.subChat = false;
      ws.subPxl = false;
      ws.subOnline = false;
      ws.subReloadUser = false;
      ws.on('pong', () => {
        ws.isAlive = true;
      });

      ws.on('message', (data, isBinary) => {
        if (!isBinary) {
          const message = data.toString();
          this.onTextMessage(message, ws);
        }
      });
    });

    this.broadcastOnlineCounter = this.broadcastOnlineCounter.bind(this);
    this.broadcastPixelBuffer = this.broadcastPixelBuffer.bind(this);
    this.reloadUser = this.reloadUser.bind(this);
    this.patchUserState = this.patchUserState.bind(this);
    this.ping = this.ping.bind(this);
    this.broadcastChatMessage = this.broadcastChatMessage.bind(this);
    this.refreshChatClients = this.refreshChatClients.bind(this);

    DailyCron.hook(this.refreshChatClients);
    socketEvents.onAsync('onlineCounter', this.broadcastOnlineCounter);
    socketEvents.onAsync('pixelUpdate', this.broadcastPixelBuffer);
    socketEvents.onAsync('chatMessage', this.broadcastChatMessage);
    socketEvents.onAsync(
      'deletePublicUserMessages',
      this.broadcastUserPublicChatMessageDeletion.bind(this),
    );
    socketEvents.onAsync('reloadUser', this.reloadUser.bind(this));
    socketEvents.on('patchState', this.patchUserState);

    setInterval(this.ping, 45 * 1000);
  }

  async handleUpgrade(request, socket, head) {
    await authenticateAPIClient(request);
    const { headers } = request;
    const { ipString: ip } = request.ip;

    if (!headers.authorization
      || !APISOCKET_KEY
      || headers.authorization !== `Bearer ${APISOCKET_KEY}`) {
      console.warn(`API ws request from ${ip} not authenticated`);
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
      socket.destroy();
      return;
    }
    console.warn(`API ws request from ${ip} successfully authenticated`);

    this.wss.handleUpgrade(request, socket, head, (ws) => {
      /* el sıkışma tamam: yavaş-saldırı zamanlayıcısını durdur */
      socket.pgUpgraded = true;
      this.wss.emit('connection', ws, request);
    });
  }

  broadcastChatMessage(
    name,
    msg,
    channelId,
    uid,
    country,
    ts,
    msgId,
    flagLegit,
    avatarId,
    attachments,
    sendapi,
    ws = null,
  ) {
    if (!sendapi) {
      return;
    }
    // send only messages from default and lang channels
    if (!chatProvider.isPublicChannel(channelId)) {
      return;
    }

    const sendmsg = JSON.stringify([
      'msg',
      name,
      parseInt(uid, 10),
      msg,
      country,
      parseInt(channelId, 10),
    ]);
    this.wss.clients.forEach((client) => {
      if (client !== ws
        && client.subChat
        && client.readyState === WebSocket.OPEN) {
        client.send(sendmsg);
      }
    });
  }

  async broadcastUserPublicChatMessageDeletion(uid, sendapi, ws = null) {
    if (!sendapi || uid === chatProvider.apiSocketUserId) {
      return;
    }
    const userData = await APISocketServer.#getUserData(uid);
    if (!userData) {
      return;
    }
    const sendmsg = JSON.stringify(['dpum', userData.username, uid]);
    this.wss.clients.forEach((client) => {
      if (client !== ws
        && client.subChat
        && client.readyState === WebSocket.OPEN) {
        client.send(sendmsg);
      }
    });
  }

  async refreshChatClients() {
    const sendmsg = JSON.stringify(
      await APISocketServer.getPublicChannelsAndStaff(),
    );
    this.wss.clients.forEach((client) => {
      if (client.subChat
        && client.readyState === WebSocket.OPEN) {
        client.send(sendmsg);
      }
    });
  }

  broadcast(data, filter = null) {
    if (typeof data === 'string') {
      this.wss.clients.forEach((ws) => {
        if (ws.readyState === WebSocket.OPEN) {
          if (!filter || filter(ws)) {
            ws.send(data);
          }
        }
      });
    } else {
      const frame = WebSocket.Sender.frame(data, {
        readOnly: true,
        mask: false,
        rsv1: false,
        opcode: 2,
        fin: true,
      });
      this.wss.clients.forEach((ws) => {
        if (ws.readyState === WebSocket.OPEN) {
          if (!filter || filter(ws)) {
            frame.forEach((buffer) => {
              try {
                // eslint-disable-next-line no-underscore-dangle
                ws._socket.write(buffer);
              } catch (error) {
                console.error(`WebSocket broadcast error: ${error.message}`);
              }
            });
          }
        }
      });
    }
  }

  broadcastOnlineCounter(online) {
    const buffer = dehydrateOnlineCounter(online);
    this.broadcast(buffer, (client) => client.subOnline);
  }

  broadcastPixelBuffer(canvasId, chunkid, buffer) {
    // just canvas 0 for now
    if (canvasId !== 0 && canvasId !== '0') {
      return;
    }
    this.broadcast(buffer, (client) => client.subPxl);
  }

  reloadUser(userId) {
    /* delete user from username mapping to force reload */
    APISocketServer.#deleteUserFromMapping(userId);

    this.broadcast(
      JSON.stringify(['reloadUser', userId]),
      (client) => client.subReloadUser,
    );
  }

  patchUserState(userIds, state, patch) {
    if (state !== 'profile' || (
      patch.path !== 'customFlag' && patch.path !== 'avatarId'
      && patch.path !== 'activeFactionRole'
    )) {
      return;
    }

    if (!Array.isArray(userIds)) {
      userIds = [userIds];
    }
    for (let i = 0; i < userIds.length; i += 1) {
      const userId = userIds[i];
      APISocketServer.#deleteUserFromMapping(userId);

      this.broadcast(
        JSON.stringify(['reloadUser', userId]),
        (client) => client.subReloadUser,
      );
    }
  }

  async onTextMessage(message, ws) {
    try {
      const packet = JSON.parse(message);
      const command = packet[0];
      packet.shift();
      if (!command) {
        return;
      }
      if (command === 'sub') {
        const even = packet[0];
        if (even === 'chat') {
          ws.subChat = true;
          ws.send(JSON.stringify(
            await APISocketServer.getPublicChannelsAndStaff(),
          ));
        } else if (even === 'pxl') {
          ws.subPxl = true;
        } else if (even === 'online') {
          ws.subOnline = true;
        } else if (even === 'reloadUser') {
          ws.subReloadUser = true;
        } else {
          console.info(`APISocket wanted to sub to nonexistent  ${even}`);
        }
        console.info(`APISocket client subscribed to ${even}`);
        return;
      }
      if (command === 'setpxl') {
        const [minecraftid, ip, x, y, clr] = packet;
        if (clr < 0 || clr > 32) return;
        // be aware that user null has no cd
        if (!minecraftid && !ip) {
          setPixelByCoords('0', clr, x, y);
          ws.send(JSON.stringify(['retpxl', null, null, true, 0, 0]));
        }
        // minecraftid support got removed
        return;
      }
      if (command === 'mchat') {
        const [username, msg, channelId] = packet;
        let uid;
        let name;
        let country;
        let flagLegit = false;
        let avatarId = null;
        let accepted = true;

        if (username.startsWith('@') && username.indexOf(':') !== -1) {
          /* matrix id in @name:homeserver.tld form */
          uid = chatProvider.apiSocketUserId;
          name = username;
          /* the socket can be muted as well */
          const socketUserData = await APISocketServer.#getUserData(uid);
          if (socketUserData?.isMuted) {
            accepted = false;
          }
        } else {
          /* ordinary user */
          const userData = await APISocketServer.#getUserData(username);
          if (!userData) {
            console.info(`Cound not get data of ${username} for matrix chat`);
            accepted = false;
          } else if (userData.isMuted) {
            accepted = false;
          }
          ({ uid, name, country, avatarId, flagLegit } = userData);
          if (!name || !uid) {
            accepted = false;
          }
        }

        try {
          if (accepted) {
            /*
            * do not send message back up ws that sent it
            */
            const [
              ts, msgId, attachments,
            ] = await chatProvider.broadcastChatMessage(
              name,
              msg,
              channelId,
              uid,
              country,
              flagLegit,
              avatarId,
              false,
            );
            this.broadcastChatMessage(
              name,
              msg,
              channelId,
              uid,
              country,
              ts,
              msgId,
              flagLegit,
              avatarId,
              attachments,
              true,
              ws,
            );
          }
        } catch {
          accepted = false;
        }

        ws.send(JSON.stringify([
          'chatret',
          username,
          uid === chatProvider.apiSocketUserId ? 0 : uid,
          accepted,
        ]));
        return;
      }
      console.info(`Received unknown api-ws message ${message}`);
    } catch (err) {
      console.error(`Got undecipherable api-ws message ${message}, ${err}`);
    }
  }

  ping() {
    this.wss.clients.forEach((ws) => {
      if (!ws.isAlive) {
        return ws.terminate();
      }

      ws.isAlive = false;
      ws.ping(() => {});
      return null;
    });
  }
}

export default APISocketServer;
