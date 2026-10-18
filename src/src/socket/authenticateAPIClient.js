/*
 * used to authenticate websocket session
 */

import express from 'express';

import { parseIP } from '../middleware/ip.js';

const router = express.Router();

router.use(parseIP);

function authenticateClient(req) {
  return new Promise(
    (resolve) => {
      router(req, {}, resolve);
    },
  );
}

export default authenticateClient;
