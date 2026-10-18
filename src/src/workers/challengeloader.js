/*
 * worker thread for creating JS Challenges
 */

import { randomInt } from 'crypto';
import { compile } from 'watr';
import { isMainThread, parentPort } from 'worker_threads';

import createChallenge from '../funcs/createChallenge.js';

if (isMainThread) {
  throw new Error(
    'ChallengeLoader is run as a worker thread, not as own process',
  );
}

const randomStr = () => `a${Math.random().toString(36).substring(2, 8)}`;

parentPort.on('message', (msg) => {
  try {
    if (msg === 'createChallenge') {
      const challenge = createChallenge(randomInt, randomStr, compile);
      parentPort.postMessage([
        null,
        challenge.solution,
        challenge.data,
      ]);
    }
  } catch (error) {
    console.warn(
      `CHALLENGES: Error on createChallenge: ${error.message}`,
    );
    parentPort.postMessage(['Failure!']);
  }
});
