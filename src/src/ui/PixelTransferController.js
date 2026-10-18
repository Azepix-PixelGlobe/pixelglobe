/*
 * Control incoming and outgoing pixels,
 * do client prediction, send to draw on renderer
 *
 * Performance notes (10x10 / chaos spam):
 * - Never drop queued jobs or revert them on release (pixels stay until server answers)
 * - Coalesce same-chunk pixels into large batches (fewer WS round-trips)
 * - Only one in-flight request (server IP lock); minimize artificial delays
 * - On partial accept, requeue remainder immediately after server wait
 */
import { t } from 'ttag';
import { pAlert } from '../store/actions/index.js';
import {
  setPixelsFetching,
  receivePlacePixels,
} from '../store/actions/socket.js';
import {
  notify,
} from '../store/actions/thunks.js';

/**
 * Bir websocket paketinde en fazla kaç piksel (aynı chunk).
 * 10x10 fırça = 100 piksel; tam fırça TEK pakette gitsin diye 128.
 * Sunucu tarafı paket başına 500 piksele kadar okuyabiliyor; 128 güvenli.
 */
const MAX_BATCH = 128;

class PixelTransferController {
  constructor() {
    this.requestFromQueue = this.requestFromQueue.bind(this);
    this.scheduleRequest = this.scheduleRequest.bind(this);
    this.pixelQueue = [];
    this._queueRunning = false;
    this._queueStartScheduled = false;
    this.clientPredictions = [];
    this.extension = null;
    window.registerPixelUpdates = (cb) => {
      this.extension = cb;
    };
  }

  initialize(store, socketClient, getRenderer) {
    this.store = store;
    this.socketClient = socketClient;
    this.getRenderer = getRenderer;
  }

  /**
   * Merge all jobs that share the same chunk (i,j) into fewer batches.
   */
  coalesceQueue() {
    if (this.pixelQueue.length < 2) return;
    const map = new Map();
    const order = [];
    for (const job of this.pixelQueue) {
      const key = `${job.i},${job.j}`;
      if (!map.has(key)) {
        map.set(key, { i: job.i, j: job.j, pixels: [] });
        order.push(key);
      }
      const target = map.get(key);
      for (const p of job.pixels) {
        target.pixels.push(p);
      }
    }
    const next = [];
    for (const key of order) {
      const { i, j, pixels } = map.get(key);
      for (let s = 0; s < pixels.length; s += MAX_BATCH) {
        next.push({
          i,
          j,
          pixels: pixels.slice(s, s + MAX_BATCH),
        });
      }
    }
    this.pixelQueue = next;
  }

  /**
   * Start after the current synchronous paint burst has finished.
   *
   * A brush calls tryPlacePixel repeatedly in one stack. Starting the
   * network request on the first pixel removes that first job from the
   * queue before the rest of the brush arrives, turning a 10x10 brush into
   * 100 one-pixel requests. A microtask keeps single-pixel placement fast
   * while allowing the whole brush stroke to be coalesced first.
   */
  scheduleRequest() {
    if (this._queueRunning || this._queueStartScheduled) return;
    this._queueStartScheduled = true;
    queueMicrotask(() => {
      this._queueStartScheduled = false;
      this.requestFromQueue();
    });
  }

  async requestFromQueue() {
    const { store } = this;
    if (this._queueRunning) return;
    this._queueRunning = true;
    store.dispatch(setPixelsFetching(true));

    try {
      this.coalesceQueue();

      while (this.pixelQueue.length) {
        // New pixels can arrive while the previous request is in flight.
        // Merge them before taking the next request off the queue.
        this.coalesceQueue();
        const job = this.pixelQueue.shift();
        let { i, j, pixels } = job;

        if (pixels.length > MAX_BATCH) {
          const rest = pixels.slice(MAX_BATCH);
          pixels = pixels.slice(0, MAX_BATCH);
          this.pixelQueue.unshift({ i, j, pixels: rest });
        }

        let ret = null;
        let attempt = 0;
        while (!ret || ret.retCode === 13 || ret.retCode === 16) {
          try {
            // eslint-disable-next-line no-await-in-loop
            ret = await this.socketClient.sendPixelUpdate(i, j, pixels);
            if (ret && (ret.retCode === 13 || ret.retCode === 16)) {
              // eslint-disable-next-line no-await-in-loop
              await new Promise((r) => setTimeout(
                r,
                Math.min(1000, 20 + attempt * 25),
              ));
            }
          } catch {
            // eslint-disable-next-line no-await-in-loop
            await new Promise((r) => setTimeout(
              r,
              Math.min(2000, 100 + (attempt * 100)),
            ));
          }
          attempt += 1;
        }

        const {
          retCode,
          coolDownSeconds,
          pxlCnt,
          wait,
        } = ret;

        if (coolDownSeconds) {
          const label = Number.isInteger(coolDownSeconds)
            ? coolDownSeconds
            : coolDownSeconds.toFixed(1);
          store.dispatch(notify(label));
        }

        if (typeof pxlCnt === 'number' && pxlCnt < pixels.length) {
          const remaining = pixels.slice(pxlCnt);
          if (remaining.length) {
            this.pixelQueue.unshift({ i, j, pixels: remaining });
          }
          if (pxlCnt < pixels.length) {
            const [offset] = pixels[pxlCnt] || pixels[0];
            this.revertPredictionsAt(i, j, offset);
          }
        }

        let errorTitle = null;
        let msg = null;
        let type = 'error';
        switch (retCode) {
          case 0:
            break;
          case 1:
            errorTitle = t`Invalid Canvas`;
            msg = t`This canvas doesn't exist`;
            break;
          case 2:
            errorTitle = t`Invalid Coordinates`;
            msg = t`x out of bounds`;
            break;
          case 3:
            errorTitle = t`Invalid Coordinates`;
            msg = t`y out of bounds`;
            break;
          case 4:
            errorTitle = t`Invalid Coordinates`;
            msg = t`z out of bounds`;
            break;
          case 5:
            errorTitle = t`Wrong Color`;
            msg = t`Invalid color selected`;
            break;
          case 6:
            errorTitle = t`Just for registered Users`;
            msg = t`You have to be logged in to place on this canvas`;
            break;
          case 7:
            errorTitle = t`Not allowed`;
            msg = t`You can not access this canvas yet, because your pixel score is too low`;
            break;
          case 8:
            store.dispatch(notify(t`Pixel protected`));
            break;
          case 9:
            break;
          case 10:
            errorTitle = 'Captcha';
            msg = t`Please prove that you are human`;
            type = 'captcha';
            break;
          case 11:
            errorTitle = t`Not allowed`;
            msg = t`You are using a Proxy.`;
            break;
          case 12:
            errorTitle = t`Not allowed`;
            msg = t`Just the Top10 of yesterday can place here`;
            break;
          case 13:
          case 16:
            break;
          case 14:
            errorTitle = t`Banned`;
            type = 'ban';
            break;
          case 15:
            errorTitle = t`Range Banned`;
            msg = t`Your Internet Provider is banned from this game`;
            break;
          case 17:
            errorTitle = t`Just for verified Users`;
            msg = t`Only verified Users are currently allowed to play.`;
            break;
          case 18:
            errorTitle = t`Blocked`;
            msg = t`You are currently not allowed to access this game.`;
            break;
          default:
            break;
        }

        if (msg || errorTitle) {
          store.dispatch(pAlert(
            (errorTitle || t`Error ${retCode}`),
            msg,
            type,
          ));
        }

        store.dispatch(receivePlacePixels(ret));

        /*
         * Kaos kuralı: sunucu "şu an olmaz, bekle" derse bile bekleme süresi
         * 3 saniyeyle sınırlanır. Böylece yoğun kaos anında tek bir istemci
         * dakikalarca uyutulup "sunucu kabul etmiyor" hissi yaşanmaz; kısa
         * bekleyip yeniden dener.
         */
        let delay = 0;
        if (typeof wait === 'number' && wait > 0) {
          delay = Math.min(3000, Math.max(0, wait));
        } else if (retCode === 8) {
          delay = 80;
        } else if (retCode === 9 && pxlCnt < pixels.length) {
          /*
           * A stack-exhaustion response should include a positive wait. Keep
           * a small backoff if an expiry race returns zero, otherwise the
           * same batch can spin at full speed and never reach the next
           * accepted request.
           */
          delay = 250;
        }
        /*
         * `wait` is the accumulated cooldown for the next pixel. It is not
         * a reason to pause after a fully accepted batch: the canvas keeps a
         * cooldown stack, so the next queued batch can be accepted at once.
         * Only wait when pixels from this request still need retrying.
         */
        if (delay > 0 && pxlCnt < pixels.length) {
          // eslint-disable-next-line no-await-in-loop
          await new Promise((r) => setTimeout(r, delay));
        }
      }
    } finally {
      this._queueRunning = false;
      if (this.pixelQueue.length) {
        this.scheduleRequest();
      } else {
        store.dispatch(setPixelsFetching(false));
      }
    }
  }

  revertPredictionsAt(sI, sJ, sOffset) {
    const renderer = this.getRenderer();
    const { clientPredictions } = this;
    let p = 0;
    while (p < clientPredictions.length) {
      const predPxl = clientPredictions[p];
      if (predPxl[0] === sI
        && predPxl[1] === sJ
        && predPxl[2] === sOffset
      ) {
        break;
      }
      p += 1;
    }

    const spliceIndex = p;
    while (p < clientPredictions.length) {
      const [i, j, offset, color] = clientPredictions[p];
      try {
        renderer.renderPixel(i, j, offset, color, false);
      } catch { /* ignore */ }
      p += 1;
    }

    this.clientPredictions.splice(spliceIndex);
  }

  receivePixelUpdate({
    i,
    j,
    pixels,
  }) {
    if (this.extension) {
      this.extension(i, j, pixels);
    }
    pixels.forEach((pxl) => {
      const [offset, color] = pxl;
      const { clientPredictions } = this;
      for (let p = 0; p < clientPredictions.length; p += 1) {
        const predPxl = clientPredictions[p];
        if (predPxl[0] === i
          && predPxl[1] === j
          && predPxl[2] === offset
        ) {
          if (predPxl[4] === color) {
            clientPredictions.splice(p, 1);
          } else {
            predPxl[3] = color;
          }
          return;
        }
      }
      this.getRenderer().renderPixel(i, j, offset, color, true);
    });
  }

  tryPlacePixel(
    i,
    j,
    offset,
    color,
    curColor,
  ) {
    this.getRenderer().renderPixel(i, j, offset, color, false);
    this.clientPredictions.push([i, j, offset, curColor, color]);

    const { pixelQueue } = this;

    for (let q = pixelQueue.length - 1; q >= 0; q -= 1) {
      const job = pixelQueue[q];
      if (job.i === i && job.j === j && job.pixels.length < MAX_BATCH) {
        job.pixels.push([offset, color]);
        this.scheduleRequest();
        return;
      }
    }

    pixelQueue.push({
      i,
      j,
      pixels: [[offset, color]],
    });

    this.scheduleRequest();
  }
}

export default new PixelTransferController();
