
import {
  hydratePixelUpdate,
  hydratePixelReturn,
  hydrateOnlineCounter,
  hydrateCoolDown,
  hydrateCaptchaReturn,
  hydrateFishAppears,
  hydrateFishCatched,
  dehydrateRegCanvas,
  dehydrateRegChunk,
  dehydrateRegMChunks,
  dehydrateDeRegMChunks,
  dehydratePixelUpdate,
  dehydratePing,
  dehydrateCatchFish,
} from './packets/client.js';
import {
  PIXEL_UPDATE_OP,
  PIXEL_RETURN_OP,
  ONLINE_COUNTER_OP,
  COOLDOWN_OP,
  CHANGE_ME_OP,
  CAPTCHA_RETURN_OP,
  REFRESH_OP,
  FISH_APPEARS_OP,
  FISH_CATCHED_OP,
} from './packets/op.js';
import {
  socketOpen,
  longTimeout,
  socketClose,
  receiveOnline,
  receiveCoolDown,
  receiveChatMessage,
  deletePublicUserMessages,
  deleteUserChannelMessages,
  deleteMessages,
} from '../store/actions/socket.js';
import {
  pRefresh, fishAppears, catchedFish, pAlert, patchState,
} from '../store/actions/index.js';
import { fetchMe } from '../store/actions/thunks.js';
import { receiveChaos } from '../store/actions/index.js';
// import detectMalware from '../core/malwareDetection.js';

/** Pixel requests can wait behind a burst without being discarded. */
const PIXEL_REQUEST_TIMEOUT = 120000;

class SocketClient {
  store = null;
  pixelTransferController = null;
  ws = null;
  /*
    * properties set in connect and open:
    * this.timeLastConnecting
    * this.timeLastPing
    * this.timeLastSent
    */
  readyState = WebSocket.CLOSED;
  /* set by initialization */
  getRenderer;
  /* queues */
  #msgQueue = [];
  #reqQueue = [];
  /* chat channels we listen to, with ref counters */
  openChatChannels = new Map();

  constructor() {
    console.log('Creating WebSocketClient');
    this.checkHealth = this.checkHealth.bind(this);
    setInterval(this.checkHealth, 2000);
  }

  initialize(store, pixelTransferController, getRenderer) {
    this.store = store;
    if (pixelTransferController) {
      this.pixelTransferController = pixelTransferController;
    }
    if (getRenderer) {
      this.getRenderer = getRenderer;
    }
    return this.connect();
  }

  connect() {
    this.readyState = WebSocket.CONNECTING;
    if (this.ws) {
      console.log('WebSocket already open, not starting');
    }
    this.timeLastConnecting = Date.now();
    const url = `${
      window.location.protocol === 'https:' ? 'wss:' : 'ws:'
    }//${
      // eslint-disable-next-line max-len
      (window.ssv?.apiUrl) ? window.ssv.apiUrl.substring(window.ssv.apiUrl.indexOf('//') + 2) : window.location.host + (window.ssv?.basename || '')
    }/ws`;
    this.ws = new WebSocket(url);
    this.ws.binaryType = 'arraybuffer';
    this.ws.onopen = this.onOpen.bind(this);
    this.ws.onmessage = this.onMessage.bind(this);
    this.ws.onclose = this.onClose.bind(this);
    this.ws.onerror = (err) => {
      console.error('Socket encountered error, closing socket', err);
    };
  }

  checkHealth() {
    if (this.readyState === WebSocket.OPEN) {
      const now = Date.now();
      if (now - 30000 > this.timeLastPing) {
        // server didn't send anything, probably dead
        console.log('Server is silent, killing websocket');
        this.readyState = WebSocket.CLOSING;
        this.ws.close();
      }
      if (now - 23000 > this.timeLastSent) {
        // make sure we send something at least all 25s
        this.send(dehydratePing());
        this.timeLastSent = now;
      }
    }
  }

  sendWhenReady(msg) {
    /*
     * if websocket is closed, store messages and send
     * them later, once connection is established again.
     * Do NOT use this method for things that wouldn't be useful after reconnect
     */
    this.timeLastSent = Date.now();
    if (this.readyState === WebSocket.OPEN) {
      this.ws.send(msg);
    } else {
      console.log('Tried sending message when websocket was closed!');
      this.#msgQueue.push(msg);
    }
  }

  send(msg) {
    if (this.readyState === WebSocket.OPEN) {
      this.ws.send(msg);
    }
  }

  processMsgQueue() {
    while (this.#msgQueue.length > 0) {
      this.sendWhenReady(this.#msgQueue.shift());
    }
  }

  onOpen() {
    const now = Date.now();
    if (this.timeLastPing && now - 1000 * 60 * 15 > this.timeLastPing) {
      /* if we were disconnected for more than 15 minutes, reload chunks */
      this.store.dispatch(longTimeout());
      console.log('Experience timeout longer than 15min on websocket.');
    }
    this.timeLastPing = now;
    this.timeLastSent = now;

    this.store.dispatch(socketOpen());
    this.readyState = WebSocket.OPEN;
    // register canvas
    this.send(dehydrateRegCanvas(
      this.store.getState().canvas.canvasId,
    ));
    // register chunks
    const chunkids = this.getRenderer?.().recChunkIds;
    if (chunkids?.length) {
      console.log(`Register ${chunkids.length} chunks`);
      this.send(dehydrateRegMChunks(chunkids));
    }
    // register chat channels
    this.sendChatView();
    // flush queue
    this.processMsgQueue();

    /*
     * Chromium doesn't like this now and displays a scarry warning
    detectMalware(this);
    */
  }

  setCanvas(canvasId) {
    if (canvasId === null) {
      return;
    }
    console.log(
      `Notify websocket server that we changed canvas to ${canvasId}`,
    );
    this.send(dehydrateRegCanvas(canvasId));
  }

  registerChunk(chunkid) {
    const buffer = dehydrateRegChunk(chunkid);
    if (this.readyState === WebSocket.OPEN) {
      this.send(buffer);
    }
  }

  deRegisterChunks(chunkids) {
    const buffer = dehydrateDeRegMChunks(chunkids);
    if (this.readyState === WebSocket.OPEN) {
      this.send(buffer);
    }
  }

  sendChatView() {
    const { channelViews } = this.store.getState().chat;
    if (this.readyState === WebSocket.OPEN) {
      this.send(`cv,${JSON.stringify([
        Date.now(), Object.keys(channelViews).map(Number),
      ])}`);
    }
  }

  isChatChannelRegistered(channelId) {
    return this.openChatChannels.has(channelId);
  }

  /*
   * send captcha solution
   * @param solution text
   * @return promise that resolves when response arrives
   */
  sendCaptchaSolution(solution, captchaid, challengeSolution) {
    return new Promise((resolve, reject) => {
      let id;
      const queueObj = ['cs', (arg) => {
        resolve(arg);
        clearTimeout(id);
      }, reject];
      this.#reqQueue.push(queueObj);
      id = setTimeout(() => {
        const pos = this.#reqQueue.indexOf(queueObj);
        if (~pos) this.#reqQueue.splice(pos, 1);
        reject(new Error('Timeout'));
      }, 300000);
      const args = [solution, captchaid];
      if (challengeSolution) {
        args.push(challengeSolution);
      }
      this.sendWhenReady(
        `cs,${JSON.stringify(args)}`,
      );
    });
  }

  /*
   * Send pixel request
   * @param i, j chunk coordinates
   * @param pixel Array of [[offset, color],...]  pixels within chunk
   */
  sendPixelUpdate(i, j, pixels) {
    return new Promise((resolve, reject) => {
      let id;
      const queueObj = ['pu', (arg) => {
        resolve(arg);
        clearTimeout(id);
      }, reject];
      this.#reqQueue.push(queueObj);
      id = setTimeout(() => {
        /*
         * Keep the queue slot until the server answers. Removing it here
         * lets a late response resolve the next pixel request instead.
         * The pixel controller will retry the same batch, but the response
         * order must remain intact.
         */
        reject(new Error('Pixel request timed out'));
      }, PIXEL_REQUEST_TIMEOUT);
      this.sendWhenReady(dehydratePixelUpdate(i, j, pixels));
    });
  }

  /*
   * send attempt to catch fish
   */
  sendCatchFish() {
    this.sendWhenReady(dehydrateCatchFish());
  }

  sendChatMessage(message, channelId) {
    this.sendWhenReady(
      `ck,${JSON.stringify([message, channelId])}`,
    );
  }

  #voiceHandlers = new Set();

  addVoiceHandler(handler) {
    this.#voiceHandlers.add(handler);
    return () => this.#voiceHandlers.delete(handler);
  }

  sendVoiceSignal(channelId, type, to, data) {
    this.sendWhenReady(
      `wr,${JSON.stringify({
        type, channelId, to, data,
      })}`,
    );
  }

  onMessage({ data: message }) {
    try {
      if (typeof message === 'string') {
        this.onTextMessage(message);
      } else {
        this.onBinaryMessage(message);
      }
    } catch (err) {
      console.log(
        `An error occurred while parsing websocket message ${message}`,
        err,
      );
    }
  }

  onTextMessage(message) {
    const comma = message.indexOf(',');
    if (comma === -1) {
      return;
    }
    const key = message.slice(0, comma);
    const val = JSON.parse(message.slice(comma + 1));
    switch (key) {
      case 'ck':
        this.store.dispatch(receiveChatMessage(...val));
        break;
      case 'ns': {
        const [uid, style] = Array.isArray(val) ? val : [];
        if (uid != null) {
          window.__pgNameStyles = window.__pgNameStyles || {};
          window.__pgNameStyles[uid] = style || 'none';
          window.dispatchEvent(new CustomEvent('pg-namestyle'));
        }
        break;
      }
      case 'fs': {
        /* aktif avatar çerçevesi: herkesin ekranında anında değişir */
        const [fuid, frame] = Array.isArray(val) ? val : [];
        if (fuid != null) {
          window.__pgFrameStyles = window.__pgFrameStyles || {};
          window.__pgFrameStyles[fuid] = frame || 'none';
          window.dispatchEvent(new CustomEvent('pg-framestyle'));
        }
        break;
      }
      case 'ps':
        /*
         * patch profile, an object that describes changes of the profile state
         */
        this.store.dispatch(patchState(...val));
        break;
      case 'dpum':
        this.store.dispatch(deletePublicUserMessages(val));
        break;
      case 'dmc':
        this.store.dispatch(deleteUserChannelMessages(...val));
        break;
      case 'dmm':
        this.store.dispatch(deleteMessages(...val));
        break;
      case 'an':
        this.store.dispatch(pAlert('Announcement', val, 'info'));
        break;
      case 'chaos':
        this.store.dispatch(receiveChaos(val && val.endTs != null ? val.endTs : null));
        break;
      case 'wr':
        this.#voiceHandlers.forEach((handler) => handler(val));
        break;
      default:
        // nothing
    }
  }

  onBinaryMessage(buffer) {
    if (buffer.byteLength === 0) return;
    const data = new DataView(buffer);
    const opcode = data.getUint8(0);

    this.timeLastPing = Date.now();

    switch (opcode) {
      case PIXEL_UPDATE_OP:
        if (this.pixelTransferController) {
          this.pixelTransferController.receivePixelUpdate(
            hydratePixelUpdate(data),
          );
        }
        break;
      case PIXEL_RETURN_OP: {
        const pos = this.#reqQueue.findIndex((q) => q[0] === 'pu');
        if (~pos) {
          this.#reqQueue.splice(pos, 1)[0][1](hydratePixelReturn(data));
        }
        break;
      }
      case ONLINE_COUNTER_OP:
        this.store.dispatch(receiveOnline(hydrateOnlineCounter(data)));
        break;
      case COOLDOWN_OP:
        this.store.dispatch(receiveCoolDown(hydrateCoolDown(data)));
        break;
      case CHANGE_ME_OP:
        console.log('Websocket requested api/me reload');
        this.store.dispatch(fetchMe());
        this.reconnect();
        break;
      case CAPTCHA_RETURN_OP: {
        const pos = this.#reqQueue.findIndex((q) => q[0] === 'cs');
        if (~pos) {
          this.#reqQueue.splice(pos, 1)[0][1](hydrateCaptchaReturn(data));
        }
        break;
      }
      case REFRESH_OP: {
        this.store.dispatch(pRefresh());
        break;
      }
      case FISH_APPEARS_OP: {
        this.store.dispatch(fishAppears(...hydrateFishAppears(data)));
        break;
      }
      case FISH_CATCHED_OP: {
        this.store.dispatch(catchedFish(...hydrateFishCatched(data)));
        break;
      }
      default:
        console.error(`Unknown op_code ${opcode} received`);
        break;
    }
  }

  onClose(e) {
    const pending = this.#reqQueue.splice(0);
    pending.forEach((queueObj) => {
      if (queueObj[2]) {
        queueObj[2](new Error('WebSocket closed'));
      }
    });
    this.store.dispatch(socketClose());
    this.ws = null;
    this.readyState = WebSocket.CONNECTING;
    // reconnect in 1s if last connect was longer than 7s ago, else 5s
    const timeout = this.timeLastConnecting < Date.now() - 7000 ? 1000 : 5000;
    console.warn(
      `Socket is closed. Reconnect will be attempted in ${timeout} ms.`,
      e.reason,
    );
    setTimeout(() => this.connect(), timeout);
  }

  reconnect() {
    if (this.readyState === WebSocket.OPEN) {
      this.readyState = WebSocket.CLOSING;
      console.log('Restarting WebSocket');
      this.ws.onclose = null;
      this.ws.onmessage = null;
      this.ws.close();
      this.ws = null;
      this.connect();
    }
  }
}

export default new SocketClient();
