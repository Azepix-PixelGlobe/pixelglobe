export const KEY_PREFIX = 'persist:';

/* eslint-disable no-underscore-dangle */

class StateStorage {
  storageKey;
  version;
  whitelist;
  /*
   * per deault, reset state on version mismatch
   */
  migrate;
  /*
   * members used for updates
   */
  #lastState = {};
  #serializedValues = {};
  #isFlushing = false;
  #needFlush = false;

  constructor(config) {
    const { key, version, migrate, whitelist } = config;
    this.storageKey = `${KEY_PREFIX}${key}`;
    this.version = version || -1;
    if (migrate) {
      this.migrate = migrate;
    }
    if (whitelist) {
      this.whitelist = whitelist;
    }
    this.flushState = this.flushState.bind(this);
  }

  update(state) {
    let keysNeedingUpdate = 0;
    let keys = Object.keys(state);
    for (let i = 0; i < keys.length; i += 1) {
      const key = keys[i];
      const value = state[key];
      if (state[key] !== this.#lastState[key]
        && (!this.whitelist
          || this.whitelist.indexOf(key) !== -1 || key === '_persist'
        )
      ) {
        this.#serializedValues[key] = JSON.stringify(value);
        keysNeedingUpdate += 1;
      }
    }

    /*
     * We usually never delete or rename values, this is just for reference
     *
    keys = Object.keys(this.#lastState);
    for (let i = 0; i < keys.length; i += 1) {
      const key = this.#lastState[i];
      if (state[key] === undefined
        && (!this.whitelist
          || this.whitelist.indexOf(key) !== -1 || key === '_persist'
        )
        && this.#lastState[key] !== undefined
      ) {
        delete this.#serializedValues[key];
        needUpdate = true;
      }
    }
    */

    this.#lastState = state;
    if (keysNeedingUpdate > 0) {
      this.flushState();
    }
  }

  async flushState() {
    if (this.#isFlushing) {
      this.#needFlush = true;
      return;
    }
    this.#isFlushing = true;

    try {
      this.#needFlush = true;
      while (this.#needFlush) {
        this.#needFlush = false;
        // eslint-disable-next-line no-await-in-loop
        await StateStorage.setItem(
          this.storageKey, JSON.stringify(this.#serializedValues),
        );
      }
    } catch (error) {
      console.error(
        // eslint-disable-next-line max-len
        `redux-persist: ${this.storageKey} could not be flushed: ${error.message}`,
      );
    }

    this.#isFlushing = false;
  }

  async getStoredState() {
    try {
      const rawState = await StateStorage.getItem(this.storageKey);
      if (!rawState) {
        return undefined;
      }
      const state = {};
      Object.keys(rawState).forEach((key) => {
        state[key] = JSON.parse(rawState[key]);
      });
      if (state._persist?.version !== this.version) {
        if (this.migrate) {
          return this.migrate(
            state, this.version, state._persist?.version || -1,
          );
        } else {
          return {};
        }
      }
      return state;
    } catch (error) {
      throw new Error(
        `${this.storageKey} could not be recovered: ${error.message}`,
      );
    }
  }

  async purgeStoredState() {
    try {
      await StateStorage.removeItem(this.storageKey);
      return true;
    } catch (error) {
      console.error(
        `redux-persist: Error purging data stored state ${error.message}`,
      );
    }
    return false;
  }

  static getItem(key) {
    const serializedItem = window.localStorage.getItem(key);
    if (serializedItem) {
      return JSON.parse(serializedItem);
    }
    return undefined;
  }

  static setItem(key, item) {
    try {
      window.localStorage.setItem(key, item);
      return true;
    } catch {
      return false;
    }
  }

  static removeItem(key) {
    try {
      window.localStorage.removeItem(key);
      return true;
    } catch {
      return false;
    }
  }
}

export default StateStorage;
