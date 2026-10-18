/*
 * exporess middlewares for handling device information
 */
import { getDeviceInfo, getBrowserHash } from '../utils/intel/device.js';
import { upsertDevice, touchDevice } from '../data/sql/Device.js';

export class Device {
  /* expressjs request object */
  #req;
  /* num | undefined | null */
  #deviceId;
  /* Date | undefined */
  #lastSeen;

  constructor(req) {
    this.#req = req;
  }

  /**
   * @return deviceData {
   *   hash, device, browser, os, headerSignature
   * }
   */
  get deviceData() {
    const deviceData = getDeviceInfo(this.#req);
    Object.defineProperty(this, 'deviceData', { value: deviceData });
    return deviceData;
  }

  /**
   * @return hash fingerprint
   */
  get hash() {
    return this.deviceData.hash;
  }

  /**
   * @return hash of the specific browser which only fits temporary
   */
  get browserHash() {
    const browserHash = getBrowserHash(this.#req);
    Object.defineProperty(this, 'browserHash', { value: browserHash });
    return browserHash;
  }

  /**
   * @return mobile or desktop
   */
  get device() {
    return this.deviceData.device;
  }

  /**
   * @return browser brand
   */
  get browser() {
    return this.deviceData.browser;
  }

  /**
   * @return operating system
   */
  get os() {
    return this.deviceData.os;
  }

  /**
   * @return descriptive string of header order
   */
  get headerSignature() {
    return this.deviceData.headerSignature;
  }

  /**
   * update lastSeen timestamps of Device
   * @return Promise<boolean>
   */
  touch() {
    if (!this.#deviceId
      || this.#lastSeen.getTime() > Date.now() - 10 * 60 * 1000
    ) {
      return false;
    }
    return touchDevice(this.#deviceId);
  }

  /**
   * get id of stored device, store device first if needed
   * @return deviceId number | null
   */
  async getDeviceId() {
    if (!this.#deviceId) {
      const result = await upsertDevice(this.deviceData);
      if (!result) {
        return null;
      }
      ({ id: this.#deviceId, lastSeen: this.#lastSeen } = result);
    }
    return this.#deviceId;
  }
}

/*
 * express middleware to parse device informations like browser, fingerprint,
 * os, etc.
 */
export function parseDevice(req, res, next) {
  req.device = new Device(req);
  next();
}


/*
 * express middleware to resolve device in a promise under req.promise,
 * must be called after parseIP.
 * Promise can be resolved by './promises.js' middleware.
 * This has the purpose to allow other actions to happen while we wait.
 */
export async function ensureDeviceExistencePromisified(req, res, next) {
  if (!req.promise) {
    req.promise = [];
  }
  req.promise.push(req.device.getDeviceId());
  next();
}
