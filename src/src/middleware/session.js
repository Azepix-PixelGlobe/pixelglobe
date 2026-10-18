/*
 * express middlewares for handling user sessions
 */
import { parse as parseCookie } from 'cookie';

import { canonicalBaseUrl } from '../utils/pgHost.js';
import { HOUR } from '../core/constants.js';
import { TIMEBLOCK_USERS } from '../core/config.js';
import {
  resolveSession, createSession, removeSession, resolveSessionUid,
  resolveSessionUidAndAge,
} from '../data/sql/Session.js';
import { parseListOfBans } from '../data/sql/Ban.js';
import { touchUser } from '../data/sql/User.js';
import { patchState } from '../store/index.js';
import { sign, unsign, compareToHash } from '../utils/hash.js';
import {
  SESSION_COOKIE_NAME, clearCookieFlags, isSecureRequest, sessionCookieFlags,
} from '../utils/pgCookie.js';


export class User {
  id;
  userlvl;
  /*
   * {
   *   id,
   *   name,
   *   username,
   *   password,
   *   userlvl,
   *   blockDm,
   *   priv,
   *   lastSeen,
   *   createdAt,
   *   avatarId,
   *   customFlag,
   *   activeFactionId,
   *   customRoleFlagId,
   *   bans: [ { expires, flags }, ... ],
   *   userChannels: [ [cid, muted], ...],
   * }
   */
  #data;
  /* session token */
  #token;
  /* null | boolean */
  isBanned = null;
  /* null | boolean */
  isMuted = null;
  /*
   * map of available channel Ids and whether or not they are muted, populated
   * by session data for quick resolve
   */
  channelIds = new Map();
  /*
   * Blocked users can not see the canvas during defined daytimes, but see a
   * message instead and can interact with chat
   * null | string HHmm-HHmm
   */
  blockedInterval = null;
  /*
   * timestamp when ban should be rechecked,
   * null means to never recheck (so if not banned or perma banned)
   */
  banRecheckTs = null;

  constructor(data, token) {
    this.#token = token;

    this.populateFromData(data);
    if (TIMEBLOCK_USERS) {
      const timeBlockProps = TIMEBLOCK_USERS.get(this.id);
      if (timeBlockProps) {
        [this.blockedInterval] = timeBlockProps;
      }
    }
  }

  populateFromData(data) {
    this.#data = data;
    this.id = data.id;
    this.userlvl = data.userlvl;

    const [isBanned, isMuted, banRecheckTs] = parseListOfBans(data.bans);
    this.isBanned = isBanned;
    this.isMuted = isMuted;
    this.banRecheckTs = banRecheckTs;

    this.channelIds.clear();
    for (let i = 0; i < data.userChannels.length; i += 1) {
      const [cid, muted] = data.userChannels[i];
      this.channelIds.set(cid, muted);
    }
  }

  static mailProvider;

  static setMailProvider(mailProvider) {
    User.mailProvider = mailProvider;
  }

  get name() {
    return this.#data.name;
  }

  get username() {
    return this.#data.username;
  }

  get blockDm() {
    return this.#data.blockDm;
  }

  get isPrivate() {
    return this.#data.priv;
  }

  get activeFactionId() {
    return this.#data.activeFactionId;
  }

  get token() {
    return this.#token;
  }

  get nameData() {
    return {
      name: this.#data.name,
      customRoleFlagId: this.#data.customRoleFlagId,
      customFlag: this.#data.customFlag,
      avatarId: this.#data.avatarId,
    };
  }

  get hasPassword() {
    return this.#data.password !== null;
  }

  touch(ipString) {
    if (this.#data.lastSeen.getTime() > Date.now() - 10 * 60 * 1000) {
      return false;
    }
    return touchUser(this.id, ipString);
  }

  /*
   * compare a password to the stored hash,
   * return number
   *   0: success
   *   1: no password set
   *   2: account marked as hacked
   *   3: password wrong
   */
  checkPassword(password) {
    const passwordHash = this.#data.password;
    if (!passwordHash) {
      return 1;
    }
    if (passwordHash === 'hacked') {
      return 2;
    }
    if (compareToHash(password, passwordHash)) {
      return 0;
    }
    return 3;
  }

  hasChannel(cid) {
    return this.channelIds.has(cid);
  }

  hasChannelMuted(cid) {
    return this.channelIds.get(cid);
  }

  refresh() {
    return this.getAllowance(true);
  }

  patchUserState(state, patch) {
    if (state === 'profile' || state === 'user') {
      if (patch.path === 'activeFactionRole') {
        this.refresh();
        return;
      }

      const [newState,, hasChanged] = patchState(this.#data, patch);
      if (!hasChanged) {
        return;
      }
      this.populateFromData(newState);
    } else if (state === 'chat' && patch.path.startsWith('channels.')) {
      /*
       * parse the patch partially to check if channel got added or removed
       */
      const { path, op } = patch;
      const targetCid = Number(path.substring(
        path.indexOf('[0:') + 3, path.indexOf(']'),
      ));
      const channelIndex = this.#data.userChannels.findIndex(
        ([cid]) => cid === targetCid,
      );
      if (op === 'addnx') {
        if (channelIndex === -1) {
          this.#data.userChannels.push([targetCid, false]);
          this.populateFromData(this.#data);
        }
      } else if (op === 'del') {
        if (channelIndex !== -1) {
          this.#data.userChannels.splice(channelIndex, 1);
          this.populateFromData(this.#data);
        }
      }
    }
  }

  /**
   * fetch allowance data of user
   * @param refresh whether we should refetch it, weven if we have it already
   * @return { isBanned, isMuted }
   */
  async getAllowance(refresh = false) {
    if (refresh
      || (this.banRecheckTs !== null && this.banRecheckTs < Date.now())
    ) {
      const data = await resolveSession(this.#token);
      if (data) {
        this.populateFromData(data);
      } else {
        return {
          isBanned: this.isBanned, isMuted: this.isMuted, loggedOut: true,
        };
      }
    }
    return { isBanned: this.isBanned, isMuted: this.isMuted };
  }
}

/**
 * resolve session of request by session cookie and add user object if possible
 * @param req express request
 */
async function resolveSessionOfRequest(req) {
  const cookies = parseCookie(req.headers.cookie || '');
  const token = unsign(cookies[SESSION_COOKIE_NAME]);
  const userData = await resolveSession(token);
  if (!userData) {
    delete req.user;
  } else {
    req.user = new User(userData, token);
  }
}

/**
 * resolve only user id of session if possible
 * @param req express request
 * @return uid
 */
export async function resolveSessionUidOfRequest(req) {
  const cookies = parseCookie(req.headers.cookie || '');
  const token = unsign(cookies[SESSION_COOKIE_NAME]);
  return resolveSessionUid(token);
}

/**
 * resolve age of session
 * @param req express request
 * @return [uid, age in seconds, boolean if user is valid for oauth]
 */
export async function resolveSessionUidAndAgeOfRequest(req) {
  const cookies = parseCookie(req.headers.cookie || '');
  const token = unsign(cookies[SESSION_COOKIE_NAME]);
  return resolveSessionUidAndAge(token);
}

/*
 * express middleware to parse session cookie and add user,
 * if session can not be verified, continue without setting user
 */
export async function verifySession(req, res, next) {
  await resolveSessionOfRequest(req);
  next();
}

/*
 * express middleware to verify session in a promise under req.promise,
 * Promise can be resolved by './promises.js' middleware.
 * This has the purpose to allow other actions to happen while we wait for SQL.
 */
export async function verifySessionPromisified(req, res, next) {
  if (!req.promise) {
    req.promise = [];
  }
  req.promise.push(resolveSessionOfRequest(req));
  next();
}

/*
 * express middleware that cancels if not logged in
 */
export function ensureLoggedIn(req, res, next) {
  if (!req.user) {
    let errorMessage;
    if (req.ttag) {
      const { t } = req.ttag;
      errorMessage = t`You are not logged in`;
    } else {
      errorMessage = 'You are not logged in';
    }
    const error = new Error(errorMessage);
    error.status = 401;
    next(error);
  }
  next();
}

/**
 * Open a new session, set cookie and store it, NOT a middleware
 * @param req express request object
 * @param res express response object
 * @param userId user id
 * @param durationHours how long session is valid in hours or null for permanent
 * @param noCookie skip setting cookies, in case we are only interested in
 *   the token
 * @return token | null
 */
export async function openSession(
  req, res, userId, durationHours = 720, noCookie = false,
) {
  const { ip, lang } = req;
  let domain = ip.getHost(false, true);
  const portSeperator = domain.lastIndexOf(':');
  if (portSeperator !== -1) {
    domain = domain.substring(0, portSeperator);
  }

  const [token, newLocation] = await createSession(
    userId, durationHours, ip, req.device,
  );
  if (!token) {
    return null;
  }

  const userData = await resolveSession(token);
  if (!userData) {
    delete req.user;
    return null;
  }
  req.user = new User(userData, token);

  req.user.touch(ip.ipString);
  if (newLocation) {
    User.mailProvider?.sendNewLocationMail(
      req.user.id, canonicalBaseUrl(req.ip.getHost()), lang, ip.ipString,
    );
  }

  /*
   * Çerçeve (iframe) içinden gelen istekte SameSite=None+Secure+Partitioned
   * yazılır; aksi halde tarayıcı oturum çerezini bu bağlamda saklamaz ve
   * oyuncu her yenilemede "yeni oyuncu" olur. Bkz. utils/pgCookie.js
   */
  const cookieOptions = {
    domain,
    httpOnly: true,
    secure: false,
    ...sessionCookieFlags(req.headers, isSecureRequest(req)),
  };

  if (!noCookie) {
    if (durationHours === null) {
      /* a permanent cookie is just a cookie that expires really late */
      durationHours = 24 * 365 * 15;
    }
    /*
    * if durationHours is 0, we don't set expire, which makes it expire on
    * closing the browser
    */
    if (durationHours) {
      cookieOptions.expires = new Date(Date.now() + durationHours * HOUR);
    }
    res.cookie(SESSION_COOKIE_NAME, sign(token), cookieOptions);
  }
  return token;
}

export function clearCookie(req, res) {
  let domain = req.ip.getHost(false, true);
  const portSeperator = domain.lastIndexOf(':');
  if (portSeperator !== -1) {
    domain = domain.substring(0, portSeperator);
  }

  res.clearCookie(SESSION_COOKIE_NAME, {
    domain,
    httpOnly: true,
    secure: false,
    ...clearCookieFlags(req.headers, isSecureRequest(req)),
  });
}

/**
 * Close a session and remove cookie, NOT a middleware
 * @param req express request object
 * @param res express response object
 * @return boolean if successful
 */
export async function closeSession(req, res) {
  const cookies = parseCookie(req.headers.cookie || '');
  const token = unsign(cookies[SESSION_COOKIE_NAME]);
  const success = await removeSession(token);
  clearCookie(req, res);
  delete req.user;
  return success;
}
