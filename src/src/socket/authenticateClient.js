/*
 * used to authenticate websocket session
 */

import express from 'express';

import { verifySessionPromisified } from '../middleware/session.js';
import { parseIP, ipAllowancePromisified } from '../middleware/ip.js';
import { parseDevice } from '../middleware/device.js';
import promises from '../middleware/promises.js';
import { expressTTag } from '../middleware/ttag.js';

const router = express.Router();

router.use(parseIP);
router.use(parseDevice);
router.use(verifySessionPromisified);
router.use(ipAllowancePromisified);

router.use(expressTTag);

router.use(promises);

router.use((req, res, next) => {
  const { user, ip } = req;
  user?.touch(ip.ipString);
  ip.touch();
  next();
});

function authenticateClient(req) {
  return new Promise(
    (resolve) => {
      router(req, {}, resolve);
    },
  );
}

export default authenticateClient;
