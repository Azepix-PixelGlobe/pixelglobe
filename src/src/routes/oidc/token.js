/*
 * token endpoint called by the relying party
 * client authorization only client_secret_basic or client_secret_post
 * grant_type only authorization_code or refresh_token
 */
import {
  getOIDCClient,
  consumeAuthCode,
  createAccessToken,
  consumeRefreshToken,
  createRefreshToken,
} from '../../data/sql/OIDC.js';
import { validatePkceChallenge } from '../../utils/hash.js';
import { generateIdToken } from '../../middleware/oidc.js';

/* eslint-disable camelcase */

export default async (req, res) => {
  req.tickRateLimiter(500);
  res.set({
    'Cache-Control': 'no-cache, no-store, must-revalidate',
    'Access-Control-Allow-Origin': '*',
    Expires: '0',
  });

  try {
    let clientSecret;
    let clientId;

    let { authorization } = req.headers;
    if (authorization) {
      /* client_secret_basic */
      authorization = authorization.trim();
      if (authorization.startsWith('Basic')) {
        let credentials = authorization.substring(6).trim();
        credentials = Buffer.from(credentials, 'base64').toString('ascii');
        [clientId, clientSecret] = credentials.split(':');
      }
    } else {
      /* client_secret_post */
      ({ client_secret: clientSecret, client_id: clientId } = req.body);
    }

    if (!clientId || !clientSecret) {
      const error = new Error(
        'Missing required parameter: client_id or client_secret',
      );
      error.title = 'invalid_client';
      error.status = 401;
      throw error;
    }

    const { grant_type: grantType } = req.body;
    if (!grantType) {
      throw new Error('No grant_type given');
    }

    const clientModel = await getOIDCClient(clientId);
    if (!clientModel || clientModel.secret !== clientSecret) {
      const error = new Error('Client authentication failed');
      error.title = 'invalid_client';
      error.status = 401;
      throw error;
    }

    let returnRefreshToken = false;
    let returnData = false;
    let scope;
    let authAge;
    let nonce;
    /* client id, integer not uuid like clientId */
    let clientIntId;
    /* consent id */
    let consentId;
    /* user id */
    let uid;

    if (grantType === 'refresh_token') {
      /*
      * refresh_token grant only returns a new refresh and access token
      */
      const usedToken = req.body.refresh_token;
      if (!usedToken) {
        throw new Error('Missing required parameter: refresh_token');
      }
      const usedRefreshModel = await consumeRefreshToken(usedToken);
      if (!usedRefreshModel) {
        const error = new Error('Refresh Token invalid or expired');
        error.title = 'invalid_grant';
        throw error;
      }
      ({ scope, cid: consentId, uid, clientIntId } = usedRefreshModel);
      /*
      * grant_type = refresh_token can submit a scope subset
      */
      if (req.body.scope) {
        const reductiveScope = req.body.scope.toLowerCase().split(' ');
        scope = scope.filter((s) => reductiveScope.includes(s));
      }
      returnRefreshToken = true;
    } else if (grantType === 'authorization_code') {
      /*
      * authorization_code grant returns refresh_token if offline_access is in
      * scope and always return access token and and openid id_token
      */
      const authCode = req.body.code;
      if (!authCode) {
        throw new Error('Missing required parameter: code');
      }
      const authCodeModel = await consumeAuthCode(authCode);
      if (!authCodeModel) {
        const error = new Error('Invalid authorization code');
        error.title = 'invalid_grant';
        throw error;
      }
      /*
      * verify optional pkce challenge that came from auth request
      */
      const { pkceChallenge, pkceMethod } = authCodeModel;
      if (pkceChallenge) {
        const pkceVerifier = req.body.code_verifier;
        if (!pkceVerifier) {
          throw new Error('Missing required parameter: code_verifier');
        }
        if (!validatePkceChallenge(pkceVerifier, pkceChallenge, pkceMethod)) {
          const error = new Error('Invalid code_verifier');
          error.title = 'invalid_grant';
          throw error;
        }
      }
      ({
        scope, cid: consentId, uid, clientIntId, authAge, nonce,
      } = authCodeModel);
      returnData = true;
      returnRefreshToken = scope.includes('offline_access');
    } else {
      const error = new Error(`The grant type ${grantType} is not supported`);
      error.title = 'unsupported_grant_type';
      throw error;
    }

    if (clientIntId !== clientModel.id) {
      const error = new Error('Invalid authorization code');
      error.title = 'invalid_grant';
      throw error;
    }
    /*
    * make sure scope mathes what is allowed for the client, not required by
    * spec since client scopes aren't supposed to change, and if they change,
    * there is no requirement to limit already issued tokens
    */
    scope = scope.filter((s) => clientModel.scope.includes(s));
    if (returnRefreshToken && !clientModel.scope.includes('offline_access')) {
      returnRefreshToken = false;
    }

    if (!returnRefreshToken && !returnData) {
      const error = new Error('No scopes to give');
      error.title = 'invalid_grant';
      throw error;
    }

    const accessToken = await createAccessToken(consentId, scope);
    if (!accessToken) {
      const error = new Error('Server experienced an SQL related error');
      error.title = 'server_error';
      error.status = 500;
      throw error;
    }

    const payload = {
      access_token: accessToken,
      token_type: 'Bearer',
      expires_in: 3600,
    };

    if (returnRefreshToken) {
      const refreshToken = await createRefreshToken(consentId, scope);
      if (!refreshToken) {
        const error = new Error('Server experienced an SQL related error');
        error.title = 'server_error';
        error.status = 500;
        throw error;
      }
      payload.refresh_token = refreshToken;
      payload.refresh_expires_in = 90 * 24 * 3600;
    }

    if (returnData && scope.includes('openid')) {
      const idToken = await generateIdToken(
        uid, clientId, scope, payload, authAge, nonce,
      );
      if (!idToken) {
        const error = new Error(
          'Server experienced an error on id_token creation',
        );
        error.title = 'server_error';
        error.status = 500;
        throw error;
      }
      payload.id_token = idToken;
    }
    res.json(payload);
  } catch (err) {
    res.status(err.status || 400).json({
      error: err.title || 'invalid_request',
      error_description: err.message,
    });
  }
};
