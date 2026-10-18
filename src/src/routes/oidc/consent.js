/*
 * User gives consent in a json request done by client script on authorization
 * page
 */

import {
  touchOIDCClient,
  consentUser,
  createAuthCode,
} from '../../data/sql/OIDC.js';
import { resolveSessionUidAndAge } from '../../data/sql/Session.js';

export default async (req, res) => {
  res.set({
    'Cache-Control': 'no-cache, no-store, must-revalidate',
    Expires: '0',
  });
  const { t } = req.ttag;
  /*
   * req.bdoy {
   *   ...params from auth request,
   *   clientName,
   *   expirationHours: String 'forever' or 0 or amount hours,
   *   reauthToken: session token, only set in case of reauthentification,
   * }
   */
  const {
    oidcClientModel: clientModel,
    oidcParams: params,
  } = req;
  let {
    oidcUserId: uid,
    oidcAuthTime: sessionAge,
    oidcNeedReauth: needReAuth,
    oidcUserValid: userIsValid,
  } = req;

  if (params.reauthToken) {
    /*
     * reauthorization speciffcally for this request happened, which returns
     * a 1 hour lived session token
     */
    [
      uid, sessionAge, userIsValid,
    ] = await resolveSessionUidAndAge(params.reauthToken);
    needReAuth = Number(params.max_age) < sessionAge;
  }

  if (!uid || needReAuth) {
    const error = new Error(t`Login is required`);
    error.title = 'login_required';
    error.status = 401;
    throw error;
  }

  if (!userIsValid) {
    const error = new Error('User must set a username before proceeding');
    error.title = 'interaction_required';
    error.status = 400;
    throw error;
  }

  let { expirationHours: expiration } = params;
  if (expiration === 'forever') {
    expiration = null;
  } else {
    expiration = parseInt(expiration, 10);
    if (Number.isNaN(expiration) || !expiration) {
      // default to 1 hour
      expiration = 1;
    }
    /* from hours to ts */
    expiration = expiration * 1000 * 3600;
  }

  const { scope } = params;
  const approvedConsentId = await consentUser(
    clientModel.id, uid, scope, expiration,
  );
  if (!approvedConsentId) {
    throw new Error('Could not store Consent');
  }

  /* touch OIDCClient */
  touchOIDCClient(clientModel.id);

  const code = await createAuthCode(
    approvedConsentId, scope,
    params.code_challenge, params.code_challenge_method,
    sessionAge, params.nonce,
  );
  if (!code) {
    throw new Error('Could not store AuthCode');
  }
  res.json({ code });
};
