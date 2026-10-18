/**
 * basic mod api
 * is used by ../components/Modtools
 *
 */

import express from 'express';
import fileUpload from 'express-fileupload';

import urlEncoded from '../../middleware/formData.js';
import { requireOidc } from '../../middleware/oidc.js';
import CanvasCleaner from '../../core/CanvasCleaner.js';
import logger, { AuthLogger } from '../../core/logger.js';
import {
  executeTextAction,
  executeIIDAction,
  executeImageAction,
  executeProtAction,
  executeRollback,
  executeCleanerAction,
  executeWatchAction,
  demoteUser,
  promoteUser,
  executeQuickAction,
  executeMediaAction,
} from '../../core/adminfunctions.js';
import { getMultipleStates } from '../../core/SharedState.js';
import { getHighUserLvlUsers, findUserById } from '../../data/sql/User.js';
import { USERLVL } from '../../core/constants.js';


const router = express.Router();

/*
 * parse multipart/form-data
 * ordinary fields will be under req.body[name]
 * files will be under req.files[name]
 */
router.use(urlEncoded, fileUpload({
  limits: {
    fileSize: 5 * 1024 * 1024,
    fields: 50,
    files: 1,
  },
}));

router.use(requireOidc('modtools', true));

/*
 * make sure User is logged in and at least Mod
 */
router.use(async (req, res, next) => {
  req.tickRateLimiter(1000);
  /*
   * special case for oauth, this user object has only a subset of values
   */
  if (!req.user && req.oidcUserId) {
    req.user = await findUserById(req.oidcUserId);
  }

  if (!req.user) {
    logger.warn(
      `MODTOOLS> ${req.ip.ipString} tried to access modtools without login`,
    );
    req.tickRateLimiter(3000);
    const { t } = req.ttag;
    next(new Error(t`You are not logged in`));
    return;
  }
  const { userlvl } = req.user;
  if (!userlvl || userlvl < USERLVL.CHATMOD) {
    logger.warn(
      `MODTOOLS: ${req.ip.ipString} / ${req.user.id} tried to access modtools`,
    );
    req.tickRateLimiter(3000);
    const { t } = req.ttag;
    next(new Error(t`You are not allowed to access this page`));
    return;
  }

  if (!req.body?.cleanerstat && !req.body?.livelog) {
    logger.info(
      `MODTOOLS> access ${req.user.name}[${req.user.id}] -  ${req.ip.ipString}`,
    );
  }
  next();
});

/*
 * Post for chatmod + cleaner + janny + mod + admin
 */
router.post('/', async (req, res, next) => {
  try {
    if (req.body.livelog) {
      const ret = await AuthLogger.printLogs(
        req.user.userlvl, parseInt(req.body.lastts, 10) || 0,
      );
      res.json(ret);
      return;
    }
    if (req.body.mediaaction) {
      const { mediaidormbid, mediaaction, reason } = req.body;
      const msg = await executeMediaAction(
        mediaaction, mediaidormbid, reason, req.user,
      );
      res.send(msg);
      return;
    }
    next();
  } catch (err) {
    next(err);
  }
});

/*
 * just janny + mod + admin past here, no chatmods
 */
router.use(async (req, res, next) => {
  if (req.user.userlvl < USERLVL.JANNY) {
    const { t } = req.ttag;
    res.status(403).send(t`Just janny, mod or admin can do that`);
    return;
  }
  next();
});

/*
 * Post for janny + mod + admin
 */
router.post('/', async (req, res, next) => {
  try {
    if (req.body.protaction) {
      const {
        protaction, ulcoor, brcoor, canvasid,
      } = req.body;
      const [ret, msg] = await executeProtAction(
        protaction,
        ulcoor,
        brcoor,
        canvasid,
        req.user,
      );
      res.status(ret).send(msg);
      return;
    }
    if (req.body.rollbackdate) {
      // rollbackdate is date as YYYYMMdd
      // rollbacktime is time as hhmm
      const {
        rollbackdate, rollbacktime, ulcoor, brcoor, canvasid,
      } = req.body;
      if (req.user.userlvl < USERLVL.MOD) {
        /*
         * jannies can only rollback to yesterday max
         */
        let yesterday = new Date(Date.now() - 24 * 3600 * 1000);
        let yesterdayDay = yesterday.getUTCDate();
        let yesterdayMonth = yesterday.getUTCMonth() + 1;
        if (yesterdayDay < 10) yesterdayDay = `0${String(yesterdayDay)}`;
        if (yesterdayMonth < 10) yesterdayMonth = `0${String(yesterdayMonth)}`;
        // eslint-disable-next-line max-len
        yesterday = `${yesterday.getUTCFullYear()}${yesterdayMonth}${yesterdayDay}`;
        if (parseInt(rollbackdate, 10) < parseInt(yesterday, 10)) {
          res.status(403).send('You can not rollback further than yesterday');
          return;
        }
        let today = new Date();
        let todayDay = today.getUTCDate();
        let todayMonth = today.getUTCMonth() + 1;
        if (todayDay < 10) todayDay = `0${String(todayDay)}`;
        if (todayMonth < 10) todayMonth = `0${String(todayMonth)}`;
        today = `${today.getUTCFullYear()}${todayMonth}${todayDay}`;
        if (parseInt(rollbackdate, 10) > parseInt(today, 10)
          || (rollbackdate === today && today.getUTCHours() < 1)
        ) {
          res.status(403).send('You can not rollback to this time');
          return;
        }
      }
      const [ret, msg] = await executeRollback(
        rollbackdate,
        rollbacktime,
        ulcoor,
        brcoor,
        canvasid,
        req.user,
      );
      res.status(ret).send(msg);
      return;
    }
    next();
  } catch (err) {
    next(err);
  }
});

/*
 * just mods + admins past here, no Jannies
 */
router.use(async (req, res, next) => {
  if (req.user.userlvl < USERLVL.MOD) {
    const { t } = req.ttag;
    res.status(403).send(t`Just mods and admins can do that`);
    return;
  }
  next();
});

/*
 * post just for admin + mod
 */
router.post('/', async (req, res, next) => {
  try {
    if (req.body.cleanerstat) {
      const ret = CanvasCleaner.reportStatus();
      res.json(ret);
      return;
    }
    if (req.body.cleanercancel) {
      const ret = CanvasCleaner.stop();
      res.send(ret);
      return;
    }
    if (req.body.watchaction) {
      const {
        watchaction, ulcoor, brcoor, time, iid, canvasid, clr,
        maxrows, maxentities,
      } = req.body;
      // eslint-disable-next-line max-len
      logger.info(`MODTOOLS>WATCH>${req.user.name}[${req.user.id}]> ${watchaction} ${ulcoor} ${brcoor} ${time} ${iid}`);
      const ret = await executeWatchAction(
        watchaction,
        ulcoor,
        brcoor,
        /* time is interval in ms */
        time,
        iid,
        canvasid,
        clr,
        maxrows,
        maxentities,
      );
      res.json(ret);
      return;
    }
    if (req.body.iidaction) {
      const {
        iidaction, iid, bid, iidoruser,
        identifiers, reason, time, username,
      } = req.body;
      // eslint-disable-next-line max-len
      logger.info(`MODTOOLS>IID>${req.user.name}[${req.user.id}]> ${iidaction} ${iid} ${bid} ${iidoruser} ${identifiers}`);
      const ret = await executeIIDAction(
        iidaction,
        iid,
        bid,
        iidoruser,
        identifiers,
        reason,
        time,
        username,
        req.user,
      );
      res.send(ret);
      return;
    }
    if (req.body.cleaneraction) {
      const {
        cleaneraction, ulcoor, brcoor, canvasid,
      } = req.body;
      const [ret, msg] = await executeCleanerAction(
        cleaneraction,
        ulcoor,
        brcoor,
        canvasid,
        req.user,
      );
      res.status(ret).send(msg);
      return;
    }
    if (req.body.imageaction) {
      const { imageaction, coords, canvasid } = req.body;
      const [ret, msg] = await executeImageAction(
        imageaction,
        req.files?.image?.data,
        coords,
        canvasid,
        req.user,
      );
      res.status(ret).send(msg);
      return;
    }
    next();
  } catch (err) {
    next(err);
  }
});


/*
 * just admins past here, no Mods
 */
router.use(async (req, res, next) => {
  if (req.user.userlvl < USERLVL.ADMIN) {
    const { t } = req.ttag;
    res.status(403).send(t`Just admins can do that`);
    return;
  }
  next();
});

/*
 * Post just for admin
 */
router.post('/', async (req, res, next) => {
  try {
    if (req.body.textaction) {
      /*
       * it can also be used for resetting users that got hacked, the naming
       * is old
       */
      const ret = await executeTextAction(
        req.body.textaction,
        req.body.text,
        req.user,
      );
      res.send(ret);
      return;
    }
    if (req.body.modlist) {
      const ret = await getHighUserLvlUsers();
      res.json(ret);
      return;
    }
    if (req.body.gamestate) {
      const ret = await getMultipleStates([
        'needVerification', 'malwareCheck',
      ]);
      res.json(ret);
      return;
    }
    if (req.body.remmod) {
      const ret = await demoteUser(req.body.remmod);
      res.send(ret);
      return;
    }
    if (req.body.makemod) {
      const ret = await promoteUser(
        req.body.makemod, parseInt(req.body.userlvl, 10),
      );
      res.json(ret);
      return;
    }
    if (req.body.quickaction) {
      const ret = await executeQuickAction(req.body.quickaction, req.user);
      res.send(ret);
      return;
    }
    next();
  } catch (err) {
    next(err);
  }
});

router.use(async (req, res, next) => {
  next(new Error('Invalid request'));
});


router.use((err, req, res, next) => {
  if (res.headersSent) {
    next(err);
    return;
  }
  res.status(400).send(err.message);
  logger.error(
    // eslint-disable-next-line max-len
    `MODTOOLS> ${req.ip.ipString} / ${req.user.id} encountered error on using modtools: ${err.message}`,
  );
});

export default router;
