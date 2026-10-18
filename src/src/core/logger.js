/**
 * logging facilities
 * Pixels log into plain text files, mod and auth logs into sql, anything else
 * on console
 */
import path from 'path';
import fs from 'fs';

import {
  logModAction, logCanvasModAction, logAuthAction,
  getRecentModLogs, getRecentAuthLogs,
} from '../data/sql/Config.js';
import { escapeMd } from './utils.js';
import { PORT } from './config.js';
import { USERLVL } from './constants.js';

export default console;

const MODLOG_TYPE = {
  'ROLLBACK': 0x01,
  'PROTECT': 0x02,
  'UNPROTECT': 0x03,
  'CCLEANER': 0x04,
  'UIMAGE': 0x05,
  'ADMIN_TEXT': 0x21,
  'ADMIN_QUICK': 0x22,
  'BAN_MEDIA': 0x31,
  'UNBAN_MEDIA': 0x32,
  'IID_ACTION': 0x33,
  'VIEW_ACTION': 0x33,
};

/*
 * convert logged params of type to a text describing the action
 */
const parseModLogs = {
  [MODLOG_TYPE.ROLLBACK]: (
    canvasIdent, x, y, width, height, date, time, pxlCount,
  ) => {
    // eslint-disable-next-line max-len
    return `rolled back to *${date}* for *${width}*x*${height}* area at #${canvasIdent},${x},${y} with *${pxlCount}*pxls (+*${x}*+\\_+*${y}*+ - +*${x + width - 1}*+\\_+*${y + height - 1}*+)`;
  },

  [MODLOG_TYPE.PROTECT]: (
    canvasIdent, x, y, width, height, pxlCount,
  ) => {
    // eslint-disable-next-line max-len
    return `protected *${width}*x*${height}* area at #${canvasIdent},${x},${y} with *${pxlCount}*pxls (+*${x}*+\\_+*${y}*+ - +*${x + width - 1}*+\\_+*${y + height - 1}*+)`;
  },

  [MODLOG_TYPE.UNPROTECT]: (
    canvasIdent, x, y, width, height, pxlCount,
  ) => {
    // eslint-disable-next-line max-len
    return `unprotected *${width}*x*${height}* area at #${canvasIdent},${x},${y} with *${pxlCount}*pxls (+*${x}*+\\_+*${y}*+ - +*${x + width - 1}*+\\_+*${y + height - 1}*+)`;
  },

  [MODLOG_TYPE.CCLEANER]: (
    canvasIdent, x, y, width, height, action,
  ) => {
    // eslint-disable-next-line max-len
    return `set Canvas Cleaner to *"${action}"* from #${canvasIdent},${x},${y} to #${canvasIdent},${x + width - 1},${y + height - 1}`;
  },

  [MODLOG_TYPE.UIMAGE]: (
    canvasIdent, x, y, width, height, pxlCount,
  ) => {
    // eslint-disable-next-line max-len
    return `loaded image with *${pxlCount}*pxls to #${canvasIdent},${x},${y} (+*${x}*+\\_+*${y}*+ - +*${x + width - 1}*+\\_+*${y + height - 1}*+)`;
  },

  [MODLOG_TYPE.ADMIN_TEXT]: (action, value) => `${action} ${value}`,

  [MODLOG_TYPE.ADMIN_QUICK]: (action) => action,

  // eslint-disable-next-line max-len
  [MODLOG_TYPE.BAN_MEDIA]: (mediaIdOrMbid, reason) => `banned media ${mediaIdOrMbid}, reason: ${reason}`,

  // eslint-disable-next-line max-len
  [MODLOG_TYPE.UNBAN_MEDIA]: (mediaIdOrMbid) => `unbanned media ${mediaIdOrMbid}`,

  [MODLOG_TYPE.IID_ACTION]: (...params) => params.join(' '),

  [MODLOG_TYPE.VIEW_ACTION]: (...params) => params.join(' '),
};

export class ModtoolsLogger {
  static chatProvider;

  static #sendPublicMessage(text) {
    if (!ModtoolsLogger.chatProvider) {
      return;
    }
    const { enChannelId, infoUserId } = ModtoolsLogger.chatProvider;
    ModtoolsLogger.chatProvider.broadcastChatMessage(
      'info', text, enChannelId, infoUserId,
    );
  }

  /**
   * print an array of recent moderation actions
   * @return [[moduser, action, timestamp], ...]
   */
  static async printLogs(accessUserlvl) {
    const logs = await getRecentModLogs(accessUserlvl);
    return logs.map(
      ({ type, params, name, username, createdAtTs }) => [
        createdAtTs,
        (username) ? `${name},${username}` : 'N/A',
        parseModLogs[type](...params),
        type,
      ],
    );
  }

  static async rollback(
    modUser, canvasIdent, x, y, width, height, ...params
  ) {
    await logCanvasModAction(
      MODLOG_TYPE.ROLLBACK,
      canvasIdent, x, y, width, height, params,
      modUser.id, USERLVL.ANONYM,
    );
    ModtoolsLogger.#sendPublicMessage(
      // eslint-disable-next-line max-len
      `@[${escapeMd(modUser.name)}](${modUser.id}) ${parseModLogs[MODLOG_TYPE.ROLLBACK](canvasIdent, x, y, width, height, ...params)}`,
    );
  }

  static async protect(
    modUser, canvasIdent, x, y, width, height, ...params
  ) {
    await logCanvasModAction(
      MODLOG_TYPE.PROTECT,
      canvasIdent, x, y, width, height, params,
      modUser.id, USERLVL.ANONYM,
    );
    ModtoolsLogger.#sendPublicMessage(
      // eslint-disable-next-line max-len
      `@[${escapeMd(modUser.name)}](${modUser.id}) ${parseModLogs[MODLOG_TYPE.PROTECT](canvasIdent, x, y, width, height, ...params)}`,
    );
  }

  static async unprotect(
    modUser, canvasIdent, x, y, width, height, ...params
  ) {
    await logCanvasModAction(
      MODLOG_TYPE.UNPROTECT,
      canvasIdent, x, y, width, height, params,
      modUser.id, USERLVL.ANONYM,
    );
    ModtoolsLogger.#sendPublicMessage(
      // eslint-disable-next-line max-len
      `@[${escapeMd(modUser.name)}](${modUser.id}) ${parseModLogs[MODLOG_TYPE.UNPROTECT](canvasIdent, x, y, width, height, ...params)}`,
    );
  }

  static async setCanvasCleaner(
    modUser, canvasIdent, x, y, width, height, ...params
  ) {
    await logCanvasModAction(
      MODLOG_TYPE.CCLEANER,
      canvasIdent, x, y, width, height, params,
      modUser.id, USERLVL.ANONYM,
    );
    ModtoolsLogger.#sendPublicMessage(
      // eslint-disable-next-line max-len
      `@[${escapeMd(modUser.name)}](${modUser.id}) ${parseModLogs[MODLOG_TYPE.CCLEANER](canvasIdent, x, y, width, height, ...params)}`,
    );
  }

  static async uploadImage(
    modUser, canvasIdent, x, y, width, height, ...params
  ) {
    await logCanvasModAction(
      MODLOG_TYPE.UIMAGE,
      canvasIdent, x, y, width, height, params,
      modUser.id, USERLVL.ANONYM,
    );
    ModtoolsLogger.#sendPublicMessage(
      // eslint-disable-next-line max-len
      `@[${escapeMd(modUser.name)}](${modUser.id}) ${parseModLogs[MODLOG_TYPE.UIMAGE](canvasIdent, x, y, width, height, ...params)}`,
    );
  }

  static adminTextAction(adminUser, ...params) {
    logModAction(MODLOG_TYPE.ADMIN_TEXT, params, adminUser.id, USERLVL.ADMIN);
  }

  static adminQuickAction(adminUser, ...params) {
    logModAction(MODLOG_TYPE.ADMIN_QUICK, params, adminUser.id, USERLVL.ADMIN);
  }

  static banMedia(modUser, ...params) {
    logModAction(MODLOG_TYPE.BAN_MEDIA, params, modUser.id, USERLVL.CHATMOD);
  }

  static modIIDAction(modUser, ...params) {
    logModAction(MODLOG_TYPE.IID_ACTION, params, modUser.id, USERLVL.ADMIN);
  }

  static modViewAction(modUser, ...params) {
    logModAction(MODLOG_TYPE.VIEW_ACTION, params, modUser.id, USERLVL.ADMIN);
  }
}

const AUTHLOG_TYPE = {
  'NEW_USER': 0x01,
  'NEW_OAUTH_USER': 0x02,
  'OAUTH_LOGIN': 0x03,
  'LOGIN': 0x04,
  'DELETE_USER': 0x05,
  'ADD_EMAIL': 0x06,
  'CHANGE_PASSWORD': 0x07,
  'LOGOUT': 0x08,
  'RESET_MAIL_FAILURE': 0x09,
  'SENT_RESET_MAIL': 0x0A,
  'BANME': 0x0B,
  'MALWARE_BAN': 0x0C,
};

const AUTHLOG_DESCRIPTIONS = {
  [AUTHLOG_TYPE.NEW_USER]: 'Created Account',
  [AUTHLOG_TYPE.NEW_OAUTH_USER]: 'Created Account via Third Party',
  [AUTHLOG_TYPE.OAUTH_LOGIN]: 'Third party login',
  [AUTHLOG_TYPE.LOGIN]: 'Logged in',
  [AUTHLOG_TYPE.DELETE_USER]: 'Deleted user',
  [AUTHLOG_TYPE.ADD_EMAIL]: 'Added email',
  [AUTHLOG_TYPE.CHANGE_PASSWORD]: 'Changed password',
  [AUTHLOG_TYPE.LOGOUT]: 'Logged out',
  [AUTHLOG_TYPE.RESET_MAIL_FAILURE]: 'Could not send password reset mail',
  [AUTHLOG_TYPE.SENT_RESET_MAIL]: 'Sent password reset mail',
  [AUTHLOG_TYPE.BANME]: 'Autobanned',
  [AUTHLOG_TYPE.MALWARE_BAN]: 'Malware banned',
};

const AUTHLOG_PERMISSION = {
  [AUTHLOG_TYPE.NEW_USER]: USERLVL.CHATMOD,
  [AUTHLOG_TYPE.NEW_OAUTH_USER]: USERLVL.CHATMOD,
  [AUTHLOG_TYPE.OAUTH_LOGIN]: USERLVL.ADMIN,
  [AUTHLOG_TYPE.LOGIN]: USERLVL.ADMIN,
  [AUTHLOG_TYPE.DELETE_USER]: USERLVL.CHATMOD,
  [AUTHLOG_TYPE.ADD_EMAIL]: USERLVL.MOD,
  [AUTHLOG_TYPE.CHANGE_PASSWORD]: USERLVL.MOD,
  [AUTHLOG_TYPE.LOGOUT]: USERLVL.ADMIN,
  [AUTHLOG_TYPE.RESET_MAIL_FAILURE]: USERLVL.ADMIN,
  [AUTHLOG_TYPE.SENT_RESET_MAIL]: USERLVL.ADMIN,
  [AUTHLOG_TYPE.BANME]: USERLVL.ADMIN,
  [AUTHLOG_TYPE.MALWARE_BAN]: USERLVL.ADMIN,
};

export class AuthLogger {
  /**
   * print an array of recent moderation actions
   * @return [[moduser, action, timestamp], ...]
   */
  static async printLogs(accessUserlvl = 0, lastTs = 0) {
    const logs = await getRecentAuthLogs(lastTs);
    return logs.filter(
      ({ type }) => AUTHLOG_PERMISSION[type] <= accessUserlvl,
    ).map(({
      type, params, uid, name, createdAtTs,
    }) => [
      createdAtTs, type, AUTHLOG_DESCRIPTIONS[type], params, uid, name,
    ]);
  }

  static newUser(user, ...params) {
    logAuthAction(AUTHLOG_TYPE.NEW_USER, params, user.id);
  }

  static newOAuthUser(user, ...params) {
    logAuthAction(AUTHLOG_TYPE.NEW_OAUTH_USER, params, user.id);
  }

  static oAuthLogin(user, ...params) {
    logAuthAction(AUTHLOG_TYPE.OAUTH_LOGIN, params, user.id);
  }

  static login(user, ...params) {
    logAuthAction(AUTHLOG_TYPE.LOGIN, params, user.id);
  }

  static deleteUser(user, ...params) {
    logAuthAction(AUTHLOG_TYPE.DELETE_USER, params, user.id);
  }

  static addEmail(user, ...params) {
    logAuthAction(AUTHLOG_TYPE.ADD_EMAIL, params, user.id);
  }

  static changePassword(user) {
    logAuthAction(AUTHLOG_TYPE.CHANGE_PASSWORD, [], user.id);
  }

  static logout(user) {
    logAuthAction(AUTHLOG_TYPE.LOGOUT, [], user.id);
  }

  static resetMailFailure(...params) {
    logAuthAction(AUTHLOG_TYPE.RESET_MAIL_FAILURE, params, null);
  }

  static sentResetMail(...params) {
    logAuthAction(AUTHLOG_TYPE.SENT_RESET_MAIL, params, null);
  }

  static banme(userId, ...params) {
    logAuthAction(AUTHLOG_TYPE.BANME, params, userId);
  }

  static malwareBan(userId, ...params) {
    logAuthAction(AUTHLOG_TYPE.MALWARE_BAN, params, userId);
  }
}


export class PixelLogger {
  static fileStream;
  static filePath;
  static prefix = `pixels-${PORT}-`;
  static #writeQueue = [];
  static #writeTimeout = null;
  static #pauseTill = null;

  static prepareLogFile() {
    try {
      const logdir = path.resolve(import.meta.dirname, 'log');
      if (!fs.existsSync(logdir)) {
        fs.mkdirSync(logdir);
      }
      /*
      * also deletes old logfiles and prepares a new one if day passed
      */
      const cutoffTime = Date.now() - (14 * 24 * 60 * 60 * 1000);
      fs.readdirSync(logdir).forEach((file) => {
        if (file.startsWith(PixelLogger.prefix)
          && !file.endsWith('.log') && !file.endsWith('.log.gz')
        ) {
          return;
        };
        const filePath = path.join(logdir, file);
        try {
          const stats = fs.statSync(filePath);
          if (stats.mtimeMs < cutoffTime) {
            fs.rmSync(filePath);
          }
        } catch {
          /* may be reached if a different process removed the file already */
        }
      });

      const date = new Date();
      const year = date.getUTCFullYear();
      const month = String(date.getUTCMonth() + 1).padStart(2, '0');
      const day = String(date.getUTCDate()).padStart(2, '0');
      const newFilePath = path.resolve(
        import.meta.dirname, 'log',
        `${PixelLogger.prefix}${year}-${month}-${day}.log`,
      );

      const oldStream = PixelLogger.fileStream;
      if (PixelLogger.filePath === newFilePath
        && PixelLogger.fileStream && !PixelLogger.fileStream.destroyed
      ) {
        return;
      }

      PixelLogger.filePath = newFilePath;
      const newFileStream = fs.createWriteStream(PixelLogger.filePath, {
        flags: 'a',
        encoding: 'utf8',
      });
      newFileStream.on('error', (error) => {
        console.error(`Pixellog Error: ${error.message}`);
        PixelLogger.#pauseTill = Date.now() + 30000;
      });
      PixelLogger.fileStream = newFileStream;

      if (oldStream && !oldStream.destroyed) {
        oldStream.end();
      }
    } catch (error) {
      console.error(`Pixellog Error: ${error.message}`);
      PixelLogger.#pauseTill = Date.now() + 10000;
    }
  }

  static async processQueue() {
    const writeQueue = PixelLogger.#writeQueue;
    if (writeQueue.length === 0) {
      return;
    }
    let fileStream = PixelLogger.fileStream;

    const lines = writeQueue.join('\n') + '\n';
    writeQueue.length = 0;
    PixelLogger.#writeTimeout = null;

    /*
     * losing some pixel logs is fine
     */
    if (PixelLogger.#pauseTill) {
      if (PixelLogger.#pauseTill > Date.now()) {
        return;
      } else {
        PixelLogger.#pauseTill = null;
      }
    }
    if (!fileStream || fileStream.destroyed) {
      PixelLogger.prepareLogFile();
      fileStream = PixelLogger.fileStream;
      if (!fileStream || fileStream.destroyed) {
        return;
      }
    }

    const canWrite = fileStream.write(lines);
    /* handle backpressure */
    if (!canWrite) {
      PixelLogger.#pauseTill = Date.now() + 300000;
      fileStream.once('drain', () => {
        PixelLogger.#pauseTill = null;
      });
    }
  }

  static log(message) {
    PixelLogger.#writeQueue.push(message);
    if (!PixelLogger.#writeTimeout) {
      PixelLogger.#writeTimeout = setTimeout(PixelLogger.processQueue, 100);
    }
  }

  static close() {
    if (PixelLogger.#writeTimeout) {
      clearTimeout(PixelLogger.#writeTimeout);
    }
    if (PixelLogger.fileStream && !PixelLogger.fileStream.destroyed) {
      PixelLogger.fileStream.end();
    }
  }
}
