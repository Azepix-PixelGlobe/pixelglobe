/*
 * Collect api fetch commands for actions here
 * (chunk and tiles requests in ui/ChunkLoader*.js)
 *
 */

import { t } from 'ttag';

import { dateToString, stringToTime } from '../../core/utils.js';
import { api } from '../../utils/utag.js';

/*
 * Adds customizable timeout to fetch
 * defaults to 8s
 */
export async function fetchWithTimeout(url, options = {}) {
  const { timeout = 30000 } = options;

  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeout);

  const response = await fetch(url, {
    ...options,
    signal: controller.signal,
  });
  clearTimeout(id);

  return response;
}

/*
 * Parse response from API
 * @param response
 * @return Object of response
 */
async function parseAPIresponse(response) {
  const { status: code } = response;

  if (code === 429) {
    let error = t`You made too many requests`;
    const retryAfter = response.headers.get('Retry-After');
    if (!Number.isNaN(Number(retryAfter)) && retryAfter > 0) {
      const ti = Math.floor(retryAfter / 60);
      error += `, ${t`try again after ${ti}min`}`;
    }
    return {
      errors: [error],
    };
  }

  try {
    return await response.json();
  } catch {
    return {
      errors: [t`Connection error ${code} :(`],
    };
  }
}

/*
 * Make API POST Request
 * @param url URL of post api endpoint
 * @param body Body of request
 * @return Object with response or error Array
 */
async function makeAPIPOSTRequest(
  url,
  body,
  credentials = true,
  addShard = true,
) {
  if (addShard) {
    url = api`${url}`;
  }
  try {
    const response = await fetchWithTimeout(url, {
      method: 'POST',
      credentials: (credentials) ? 'include' : 'omit',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    return parseAPIresponse(response);
  } catch {
    return {
      errors: [t`Could not connect to server, please try again later :(`],
    };
  }
}

/*
 * Make API GET Request
 * @param url URL of get api endpoint
 * @return Object with response or error Array
 */
async function makeAPIGETRequest(
  url,
  credentials = true,
  addShard = true,
) {
  if (addShard) {
    url = api`${url}`;
  }
  try {
    const response = await fetchWithTimeout(url, {
      credentials: (credentials) ? 'include' : 'omit',
    });

    return parseAPIresponse(response);
  } catch {
    return {
      errors: [t`Could not connect to server, please try again later :(`],
    };
  }
}

/**
 * block / unblock user
 * @param userId id of user to block
 * @param block true if block, false if unblock
 * @return error string or null if successful
 */
export async function requestBlock(userId, block) {
  const res = await makeAPIPOSTRequest(
    '/api/block',
    { userId, block },
  );
  if (res.errors) {
    return res.errors[0];
  }
  if (res.status === 'ok') {
    return null;
  }
  return t`Unknown Error`;
}

/**
 * mute / unmute channel
 * @param channelId id of user to block
 * @param mute true if mute, false if unmute
 * @return error string or null if successful
 */
export async function requestMute(channelId, mute) {
  const res = await makeAPIPOSTRequest(
    '/api/mute',
    { channelId, mute },
  );
  if (res.errors) {
    return res.errors[0];
  }
  if (res.status === 'ok') {
    return null;
  }
  return t`Unknown Error`;
}

/*
 * start new DM channel with user
 * @param query Object with either userId or userName: string
 * @return channel Array on success, error string if not
 */
export async function requestStartDm(query) {
  const res = await makeAPIPOSTRequest(
    '/api/startdm',
    query,
  );
  if (res.errors) {
    return res.errors[0];
  }
  if (res.channel) {
    return res.channel;
  }
  return t`Unknown Error`;
}

/**
 * change stuff for user
 * @param user {
 *   [priv],
 *   [blockDm]
 * }
 * @return error array or null if successful
 */
export async function requestChangeUser(user) {
  const res = await makeAPIPOSTRequest(
    '/api/userchange',
    user,
  );
  if (res.errors) {
    return res.errors;
  }
  if (res.status === 'ok') {
    return [];
  }
  return [t`Unknown Error`];
}

/**
 * change stuff in profile
 * @param profile {
 *   [avatarId],
 *   [customFlag],
 *   [activeFactionRole],
 * }
 * @return error array or null if successful
 */
export async function requestChangeProfile(profile) {
  const res = await makeAPIPOSTRequest(
    '/api/profilechange',
    profile,
  );
  if (res.errors) {
    return res.errors;
  }
  if (res.status === 'ok') {
    return [];
  }
  return [t`Unknown Error`];
}

/**
 * change stuff in a users faction
 * @param userFaction {
 *   factionName: faction name,
 *   [isHidden],
 * }
 * @return error array or null if successful
 */
export async function requestChangeUserFaction(userFaction) {
  const res = await makeAPIPOSTRequest(
    '/api/userfactionchange',
    userFaction,
  );
  if (res.errors) {
    return res.errors;
  }
  if (res.status === 'ok') {
    return [];
  }
  return [t`Unknown Error`];
}


/**
 * change stuff in a faction
 * @param faction {
 *   name: faction name,
 *   [isPrivate],
 *   [isPublic],
 *   [avatarId],
 *   [name],
 *   [title],
 *   [description],
 * }
 * @return error array or null if successful
 */
export async function requestChangeFaction(faction) {
  const res = await makeAPIPOSTRequest(
    '/api/factionchange',
    faction,
  );
  if (res.errors) {
    return res.errors;
  }
  if (res.status === 'ok') {
    return [];
  }
  return [t`Unknown Error`];
}

/**
 * change stuff in a faction role
 * @param factionRole {
 *   frid: faction role uuid,
 *   [customFlagId],
 *   [factionlvl],
 *   [name],
 * }
 * @return error array or null if successful
 */
export async function requestChangeFactionRole(factionRole) {
  const res = await makeAPIPOSTRequest(
    '/api/factionrolechange',
    factionRole,
  );
  if (res.errors) {
    return res.errors;
  }
  if (res.status === 'ok') {
    return [];
  }
  return [t`Unknown Error`];
}

/*
 * leaving Chat Channel (i.e. DM channel)
 * @param channelId integer id of channel
 * @return error string or null if successful
 */
export async function requestLeaveChan(channelId) {
  const res = await makeAPIPOSTRequest(
    '/api/leavechan',
    { channelId },
  );
  if (res.errors) {
    return res.errors[0];
  }
  if (res.status === 'ok') {
    return null;
  }
  return t`Unknown Error`;
}

export async function requestSolveCaptcha(text, captchaid) {
  const res = await makeAPIPOSTRequest(
    '/api/captcha',
    { text, id: captchaid },
  );
  if (!res.errors && !res.success) {
    return {
      errors: [t`Server answered with gibberish :(`],
    };
  }
  return res;
}

export async function requestHistoricalTimes(day, canvasId, controller) {
  try {
    const date = dateToString(day);
    const response = await fetch(
      api`/history?day=${date}&id=${canvasId}`, {
        credentials: 'omit',
        signal: controller.signal,
      },
    );
    if (response.status !== 200) {
      return [];
    }
    const times = await response.json();
    return times.map(stringToTime);
  } catch {
    return [];
  }
}

export async function requestChatMessages(cid, controller) {
  try {
    const response = await fetch(
      api`/api/chathistory?cid=${cid}&limit=50`, {
        credentials: 'include',
        signal: controller.signal,
      },
    );
    if (response.status === 403) {
      /*
       * in case of requesting a non-existing channel
       */
      return [];
    }
    if (response.ok) {
      const { history } = await response.json();
      return history;
    }
  } catch {
    // nothing
  }
  return null;
}

export function requestPasswordChange(newPassword, password) {
  return makeAPIPOSTRequest(
    '/api/auth/change_passwd',
    { password, newPassword },
  );
}

export async function requestResendVerify() {
  return makeAPIGETRequest(
    '/api/auth/resend_verify',
  );
}

export async function requestLogOut() {
  const ret = await makeAPIGETRequest(
    '/api/auth/logout',
  );
  return !ret.errors;
}

export async function requestConsent(params) {
  return makeAPIPOSTRequest('/oidc/consent', params);
}

export function requestMailChange(email, password) {
  return makeAPIPOSTRequest(
    '/api/auth/change_mail',
    { email, password },
  );
}

export function requestLogin(
  nameoremail, password, durationsel, returnToken,
) {
  const data = { nameoremail, password, durationsel };
  if (returnToken) {
    data.returnToken = true;
  }
  return makeAPIPOSTRequest('/api/auth/local', data);
}

export function requestRegistration(
  name, username, email, password, durationsel,
  captcha, captchaid, challengeSolution,
) {
  const body = {
    name, username, email, password, durationsel,
    captcha, captchaid,
  };
  if (challengeSolution) {
    body.cs = challengeSolution;
  }
  return makeAPIPOSTRequest('/api/auth/register', body);
}

export function requestNewPassword(email) {
  return makeAPIPOSTRequest(
    '/api/auth/restore_password',
    { email },
  );
}

export function requestDeleteAccount(password) {
  return makeAPIPOSTRequest(
    '/api/auth/delete_account',
    { password },
  );
}

export function requestRemoveTpid(id, password) {
  return makeAPIPOSTRequest(
    '/api/auth/remove_tpid',
    { id, password },
  );
}

export function requestCloseSession(id, password) {
  return makeAPIPOSTRequest(
    '/api/auth/close_session',
    { id, password },
  );
}

export function requestRemoveConsent(id) {
  return makeAPIPOSTRequest('/api/auth/revoke_consent', { id });
}

export function requestRankings() {
  return makeAPIGETRequest(
    '/ranking',
    false,
  );
}

export function requestModLogs() {
  return makeAPIGETRequest('/api/modlogs');
}

export function requestSearch(type, term) {
  return makeAPIPOSTRequest(
    '/api/search',
    { type, term },
  );
}

export function requestCreateFaction(
  name, title, description, isPrivate, isPublic, avatarId,
) {
  const body = {
    name, title, description, isPrivate, isPublic, avatarId,
  };
  return makeAPIPOSTRequest('/api/factioncreate', body);
}

export function requestLeaveFaction(name) {
  return makeAPIPOSTRequest('/api/factionleave', { name });
}

export function requestJoinFaction(name) {
  return makeAPIPOSTRequest('/api/factionjoin', { name });
}

export function requestFactionInfo(name) {
  return makeAPIPOSTRequest(
    '/api/factioninfo',
    { name },
  );
}

export function requestUserInfo(uidOrUsername) {
  return makeAPIPOSTRequest(
    '/api/userinfo',
    { uidOrUsername },
  );
}

export function requestFactionMembers(name) {
  return makeAPIPOSTRequest(
    '/api/factionmembers',
    { name },
  );
}

export function requestFactionBans(name) {
  return makeAPIPOSTRequest(
    '/api/factionbans',
    { name },
  );
}

export function requestFactionInvites(name) {
  return makeAPIPOSTRequest(
    '/api/factioninvites',
    { name },
  );
}

export function requestAddFactionRole(uid, frid) {
  return makeAPIPOSTRequest(
    '/api/factionrolejoin',
    { uid, frid },
  );
}

export function requestRemoveFactionRole(uid, frid) {
  return makeAPIPOSTRequest(
    '/api/factionroleleave',
    { uid, frid },
  );
}

export function requestDeleteFaction(name) {
  return makeAPIPOSTRequest(
    '/api/factiondelete',
    { name },
  );
}

export function requestFactionRoleDelete(frid) {
  return makeAPIPOSTRequest(
    '/api/factionroledelete',
    { frid },
  );
}

export function requestFactionInviteDelete(id) {
  return makeAPIPOSTRequest(
    '/api/factioninvitedelete',
    { id },
  );
}

export function requestKickBanFactionMember(
  uid, factionName, isBan, reason = '',
) {
  return makeAPIPOSTRequest(
    '/api/factionkickban',
    { uid, factionName, isBan, reason },
  );
}

export function requestLiftFactionBan(fbid, factionName) {
  return makeAPIPOSTRequest(
    '/api/factionunban',
    { fbid, factionName },
  );
}

export function requestFactionRoleCreate(
  factionName, name, isDefault, customFlagId, factionlvl,
) {
  return makeAPIPOSTRequest(
    '/api/factionrolecreate',
    { factionName, name, isDefault, customFlagId, factionlvl },
  );
}

export function requestFactionInviteCreate(factionName, isOneTime) {
  return makeAPIPOSTRequest(
    '/api/factioninvitecreate',
    { factionName, isOneTime },
  );
}

export function requestInviteData(id) {
  return makeAPIPOSTRequest(
    '/api/factioninvitedata',
    { id },
  );
}

export function requestUseInvite(id) {
  return makeAPIPOSTRequest(
    '/api/factioninviteuse',
    { id },
  );
}

export function requestProfile() {
  return makeAPIGETRequest(
    '/api/profile',
  );
}

export function requestFish(id) {
  return makeAPIPOSTRequest(
    '/api/fish',
    { id },
  );
}

export function requestBadge(id) {
  return makeAPIPOSTRequest(
    '/api/badge',
    { id },
  );
}
export function requestTpids() {
  return makeAPIGETRequest(
    '/api/auth/get_tpids',
  );
}

export function requestBanInfo() {
  return makeAPIGETRequest(
    '/api/baninfo',
  );
}

export async function requestMe() {
  if (window.me) {
    // api/me gets pre-fetched by embedded script in html
    const response = await window.me;
    delete window.me;
    return parseAPIresponse(response);
  }
  return makeAPIGETRequest(
    '/api/me',
  );
}

export function requestIID() {
  return makeAPIGETRequest(
    '/api/getiid',
  );
}

/**
 * file upload api preflight to check which files are available
 * @param files File or FileList
 * @param [controller] AbortController
 * @param [route] which /api/media route to use
 * @return { availableFiles } or null if aborted
 */
export async function requestFileUploadPreflight(
  files, controller, route,
) {
  if (files instanceof File) {
    files = [files];
  }
  if (!files?.length) {
    return {
      errors: [t`No File selected to upload`],
    };
  }
  if (!route) {
    route = 'preflight';
  }

  const formData = new FormData();

  try {
    for (let i = 0; i < files.length; i += 1) {
      /* eslint-disable no-await-in-loop */
      const file = files[i];
      formData.append('mimeType', encodeURIComponent(file.type));
      formData.append('filename', encodeURIComponent(file.name));
      formData.append('size', encodeURIComponent(file.size));
      let hash = '';
      if (crypto.subtle && file.size < 1024 * 1024 * 1024) {
        try {
          const arrayBuffer = await file.arrayBuffer();
          const hashBuffer = await crypto.subtle.digest('SHA-256', arrayBuffer);
          const hashArray = Array.from(new Uint8Array(hashBuffer));
          hash = hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
        } catch {
          // Metadata is still sufficient for preflight if hashing is unavailable.
        }
      }
      formData.append('hash', hash);
      /* eslint-enable no-await-in-loop */
    }
  } catch {
    return {
      errors: [t`Could not process files`],
    };
  }

  const options = {
    method: 'POST',
    credentials: 'include',
    signal: controller.signal,
    body: formData,
  };
  if (controller) {
    options.signal = controller.signal;
  }

  try {
    const timeout = setTimeout(() => {
      if (!controller.signal.aborted) {
        controller.abort();
      }
    }, 120000);
    const response = await fetch(api`/api/media/${route}`, options);
    clearTimeout(timeout);
    return parseAPIresponse(response);
  } catch (error) {
    if (error.name === 'AbortError') {
      return null;
    }
    return {
      errors: [t`Could not connect to server`],
    };
  }
}

/**
 * file upload api
 * @param files File or FileList
 * @param [controller] AbortController
 * @param [onProgress] callback for progress
 * @param [route] which /api/media route to use
 * @return response or null if aborted
 */
export async function requestFileUpload(
  files, controller, onProgress, route,
) {
  if (files instanceof File) {
    files = [files];
  }
  if (!files?.length) {
    return {
      errors: [t`No File selected to upload`],
    };
  }
  if (!route) {
    route = 'upload';
  }

  let request;
  let abort;

  try {
    const formData = new FormData();

    for (let i = 0; i < files.length; i += 1) {
      formData.append('file', files[i]);
    }

    const xhr = new XMLHttpRequest();
    abort = () => { xhr.abort(); };
    if (controller) {
      if (controller.signal.aborted) {
        return null;
      }
      controller.signal.addEventListener('abort', abort);
    }

    request = new Promise((resolve, reject) => {
      xhr.withCredentials = true;

      if (onProgress) {
        xhr.upload.addEventListener('progress', (event) => {
          if (event.lengthComputable) {
            const percentComplete = Math.floor(
              (event.loaded / event.total) * 100,
            );
            onProgress(percentComplete);
          }
        });
      }


      xhr.addEventListener('load', () => {
        if (xhr.status === 429) {
          resolve({ errors: [t`You made too many requests`] });
          return;
        }
        try {
          const response = JSON.parse(xhr.responseText || xhr.response);
          if (xhr.status >= 400 && !response.errors) {
            response.errors = [t`Upload failed (${xhr.status})`];
          }
          resolve(response);
        } catch {
          const status = xhr.status || 0;
          resolve({
            errors: [t`Upload failed (${status})`],
          });
        }
      });

      xhr.addEventListener('error', () => reject(false));
      xhr.addEventListener('abort', () => reject(true));
      xhr.addEventListener('timeout', () => reject(false));


      xhr.open('POST', api`/api/media/${route}`);
      // Image processing and thumbnail generation can take a while on mobile.
      xhr.timeout = 120000;
      xhr.send(formData);
    });
  } catch {
    return {
      errors: [t`Could not process files`],
    };
  }

  try {
    return await request;
  } catch (gotAborted) {
    if (gotAborted) {
      return null;
    }
    return {
      errors: [t`Could not connect to server`],
    };
  } finally {
    if (controller) {
      controller.signal.removeEventListener('abort', abort);
    }
  }
}

let alreadyRequested = false;
export function requestBanMe(code) {
  if (alreadyRequested) {
    return null;
  }
  alreadyRequested = true;
  return makeAPIPOSTRequest(
    '/api/lanme',
    { code },
  );
}
