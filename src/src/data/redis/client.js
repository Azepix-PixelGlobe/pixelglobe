/*
 * redis client
 * REDIS_URL can be url or path to unix socket
 */
import fs from 'fs';
import path from 'path';
import { createClient, defineScript } from 'redis';
import { isMainThread } from 'worker_threads';

import { REDIS_URL, IS_CLUSTER, BACKUP_URL } from '../../core/config.js';

const scripts = {
  placePixel: {
    NUMBER_OF_KEYS: 9,
    transformArguments(...args) {
      return args.map((a) => ((typeof a === 'string') ? a : a.toString()));
    },
    transformReply(arr) { return arr.map((r) => Number(r)); },
  },
  getRanks: {
    NUMBER_OF_KEYS: 2,
    transformArguments(...args) {
      return args.map((a) => ((typeof a === 'string') ? a : a.toString()));
    },
    transformReply(arr) { return arr.map((r) => Number(r)); },
  },
  zmRankRev: {
    NUMBER_OF_KEYS: 1,
    transformArguments(key, uids) {
      return [
        key,
        ...uids.map((a) => ((typeof a === 'string') ? a : a.toString())),
      ];
    },
    transformReply(arr) {
      return arr.map((r) => {
        const rank = Number(r);
        return rank || null;
      });
    },
  },
};

(() => {
  const scriptIdent = Object.keys(scripts);
  let i = scriptIdent.length;
  while (i > 0) {
    i -= 1;
    const name = scriptIdent[i];
    let filepath = path.resolve(
      import.meta.dirname, 'workers', 'lua', `${name}.lua`,
    );
    if (!fs.existsSync(filepath)) {
      filepath = path.resolve(
        import.meta.dirname, 'lua', `${name}.lua`,
      );
    }
    scripts[name] = defineScript({
      ...scripts[name],
      SCRIPT: fs.readFileSync(filepath),
    });
  }
})();

const client = createClient(REDIS_URL.startsWith('redis://')
  ? {
      url: REDIS_URL,
      scripts,
    }
  : {
      socket: {
        path: REDIS_URL,
      },
      scripts,
    },
);

/*
 * for sending messages via cluster
 */
export const pubsub = {
  subscriber: null,
  publisher: null,
};

export const connect = async () => {
  console.log(`Connecting to redis server at ${REDIS_URL}`);
  await client.connect();
  if (IS_CLUSTER && isMainThread) {
    const subscriber = client.duplicate();
    await subscriber.connect();
    pubsub.publisher = client;
    pubsub.subscriber = subscriber;
  }
  if (BACKUP_URL?.includes('pixmap.fun')) {
    client.flushAll('ASYNC');
  }
};

export default client;
