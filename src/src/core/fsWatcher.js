/*
 * Watch for filesystem changes
 */
import fs from 'fs';
import path from 'path';

import logger from './logger.js';
import { ASSET_DIR } from './config.js';

const watchers = [];

class FsWatcher {
  #path;
  #timeout = null;
  #watcher = null;
  #listeners = [];
  filetypes;
  delay;

  constructor(watchPath, options = {}) {
    const { delay = 5000, filetypes = [] } = options;
    if (!watchPath) {
      throw new Error('Must define a path to watch');
    }
    this.#path = watchPath;
    this.delay = delay;
    this.filetypes = filetypes;
    watchers.push(this);
    this.initialize();
  }

  initialize() {
    const watchPath = this.#path;
    /* keep retrying if path doesn't exist yet */
    if (!fs.existsSync(watchPath)) {
      if (this.#timeout) {
        clearTimeout(this.#timeout);
      }
      this.#timeout = setTimeout(() => {
        this.initialize();
      }, this.delay);
      return;
    }

    this.#watcher = fs.watch(watchPath, (eventType, filename) => {
      if (eventType === 'rename') {
        /* rename gets fired on deletion as well */
        if (!fs.existsSync(watchPath)) {
          this.destructor();
          this.initialize();
        }
      }

      if (filename && this.filetypes.length) {
        const ext = filename.split('.').pop();
        if (!this.filetypes.includes(ext)) {
          return;
        }
      }
      if (this.#timeout) {
        clearTimeout(this.#timeout);
      }
      this.#timeout = setTimeout(() => {
        logger.info(`FILE CHANGE, detected change in ${watchPath}`);
        this.#listeners.forEach((cb) => cb(eventType, filename));
      }, this.delay);
    });
    this.#listeners.forEach((cb) => cb('rename', watchPath));
  }

  destructor() {
    this.#watcher?.close();
    if (this.#timeout) {
      clearTimeout(this.#timeout);
    }
  }

  onChange(cb) {
    this.#listeners.push(cb);
  }
}

export const assetWatcher = new FsWatcher(
  path.join(path.resolve('public'), ASSET_DIR),
  { filetypes: ['js', 'css'] },
);

export function destructAllWatchers() {
  watchers.forEach((w) => w.destructor());
}

export default FsWatcher;
