import pool from './mariadb.js';
import {
  generateLargeToken, generateUUID, generateToken, bufferToUUID,
} from '../../utils/hash.js';

/* ============================ Access Token ==================================
 * Tokens with which the relying party (client) can request actual use data,
 * they are short-lived
 */

/**
 * create new Access Token
 * @param consentId OIDCConsent id
 * @param scope array of scopes
 * @return token
 */
export async function createAccessToken(consentId, scope) {
  try {
    const token = generateLargeToken();
    await pool.query(
      // eslint-disable-next-line max-len
      'INSERT INTO OIDCAccessTokens (cid, token, scope, expires, createdAt) VALUES (?, ?, ?, NOW() + INTERVAL 1 HOUR, NOW())',
      [consentId, token, scope.sort().join(' ')],
    );
    return token;
  } catch (error) {
    console.error(`SQL Error on createAccessToken: ${error.message}`);
  }
  return null;
}


/**
 * get scope and uid of access token
 * @param cid client id
 * @param uid user id
 * @return {
 *   uid,
 *   scope,
 *   clientId,
 *   clientIntId,
 * }
 */
export async function getAccessToken(token) {
  if (!token) {
    return null;
  }
  try {
    const [accessModel] = await pool.query(
      // eslint-disable-next-line max-len
      `SELECT t.scope, co.uid, co.cid AS clientIntId, BIN_TO_UUID(cl.uuid) AS clientId FROM OIDCAccessTokens t
  INNER JOIN OIDCConsents co ON co.id = t.cid
  INNER JOIN OIDCClients cl ON co.cid = cl.id
WHERE t.token = ? AND t.expires > NOW()`,
      [token],
    );
    if (accessModel) {
      accessModel.scope = accessModel.scope.split(' ');
      return accessModel;
    }
  } catch (error) {
    console.error(`SQL Error on getAccessToken: ${error.message}`);
  }
  return null;
}

/* ============================ Authorization Codes ===========================
 * Codes given to the user on the login page, that he transfers to the replying
 * party (client), which the client then uses to request tokens.
 * They are single-time use.
 */

/**
 * create new Auth Code
 * @param consentId OIDCConsent id
 * @param scope array of scopes
 * @param pkceChallenge | null
 * @param pkceMethod | null
 * @param authAge age of session
 * @param nonce
 * @return code Authorization Code
 */
export async function createAuthCode(
  consentId, scope,
  pkceChallenge = null, pkceMethod = null, authAge = null, nonce = null,
) {
  try {
    const code = generateLargeToken();
    await pool.query(
      /*
       * minimum 10 minues expiration time is OIDC recommendation
       */
      // eslint-disable-next-line max-len
      'INSERT INTO OIDCAuthCodes (cid, code, scope, pkceChallenge, pkceMethod, authAge, nonce, expires, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?, NOW() + INTERVAL 12 MINUTE, NOW())',
      [
        consentId, code, scope.sort().join(' '),
        pkceChallenge, pkceMethod, authAge, nonce,
      ],
    );
    return code;
  } catch (error) {
    console.error(`SQL Error on createAuthCode: ${error.message}`);
  }
  return null;
}

/**
 * consume auth code
 * @param cid client id
 * @param uid user id
 * @return {
 *   cid,
 *   uid,
 *   pkceChallenge,
 *   pkceMethod,
 *   scope,
 * }
 */
export async function consumeAuthCode(code) {
  if (!code) {
    return null;
  }

  let conn;
  try {
    conn = await pool.getConnection();
    const [authCodeModel] = await conn.query(
      // eslint-disable-next-line max-len
      `SELECT ac.id, ac.scope, ac.pkceChallenge, ac.pkceMethod, ac.nonce, co.scope AS consentedScope, ac.authAge, co.uid, ac.cid, co.cid AS clientIntId FROM OIDCAuthCodes ac
  INNER JOIN OIDCConsents co ON co.id = ac.cid
WHERE ac.code = ? AND ac.expires > NOW()`,
      [code],
    );
    if (authCodeModel) {
      /*
       * code is single-use
       */
      await conn.query(
        'DELETE ac FROM OIDCAuthCodes ac WHERE id = ?', [authCodeModel.id],
      );
      delete authCodeModel.id;
      /*
       * make sure consent to scope is still given, afaik not required by spec
       */
      let { consentedScope } = authCodeModel;
      consentedScope = consentedScope.split(' ');
      authCodeModel.scope = authCodeModel.scope.split(' ').filter(
        (s) => consentedScope.includes(s),
      );
      delete authCodeModel.consentedScope;

      return authCodeModel;
    }
  } catch (error) {
    console.error(`SQL Error on consumeAuthCode: ${error.message}`);
  } finally {
    if (conn) conn.release();
  }
  return null;
}

/* ================================= Client ===================================
 * OIDC Relying Parties aka Clients aka other websites using us for login
 */

/**
 * get OIDC client
 * @param uuid client uuid, named client_id in auth requests
 * @return clientModel {
 *   id,
 *   name,
 *   secret,
 *   scope: array of allowed scopes,
 *   defaultScope: array of default scopes,
 *   redirectUris: array of allowed redirect uris,
 *   autoGrant,
 * }
 */
export async function getOIDCClient(uuid) {
  if (!uuid) {
    return null;
  }
  try {
    const [clientModel] = await pool.query(
      // eslint-disable-next-line max-len
      'SELECT id, name, secret, redirectUris, scope, defaultScope, autoGrant FROM OIDCClients WHERE uuid = UUID_TO_BIN(?)',
      [uuid],
    );
    if (clientModel) {
      clientModel.scope = clientModel.scope.split(' ');
      if (clientModel.defaultScope) {
        clientModel.defaultScope = clientModel.defaultScope.split(' ');
      }
      clientModel.redirectUris = clientModel.redirectUris.split(' ');
      return clientModel;
    }
  } catch (error) {
    console.error(`SQL Error on getOIDCClient: ${error.message}`);
  }
  return null;
}

/**
 * update the last used time of a client
 * @param id integer id of the client
 */
export async function touchOIDCClient(id) {
  try {
    await pool.query(
      'UPDATE OIDCClients SET lastUsed = NOW() WHERE id = ?', [id],
    );
  } catch (error) {
    console.error(`SQL Error on touchOIDCClient: ${error.message}`);
  }
}

/**
 * get all OIDC clients of user
 * @param userId user id
 */
export async function getAllClientsOfUser(userId) {
  try {
    const oidcClients = await pool.query(
      // eslint-disable-next-line max-len
      'SELECT id, name, secret, redirectUris, scope, defaultScope, BIN_TO_UUID(uuid) AS uuid FROM OIDCClients WHERE uid = ?',
      [userId],
    );
    return oidcClients;
  } catch (error) {
    console.error(`SQL Error on getAllClientsOfUser: ${error.message}`);
  }
  return [];
}

/**
 * delete a client of a user
 * @param userId user id
 * @param uuid uuid of client
 */
export async function deleteClient(userId, uuid) {
  if (!userId || !uuid) {
    return false;
  }
  try {
    await pool.query(
      'DELETE FROM OIDCClients WHERE uid = ? AND uuid = UUID_TO_BIN(?)',
      [userId, uuid],
    );
    return true;
  } catch (error) {
    console.error(`SQL Error on getAllClientsOfUser: ${error.message}`);
  }
  return false;
}

/**
 * create new OIDC client
 * @param uid userId of whoever registers the client
 * @param scope Array of wanted scopes
 * @param redirectUris Array of accepted redirect urls
 * @param rerollSecret whether or not we generate a new secret on client change
 * Throws an error if something is wrong
 * @return {
 *   clientSecret,
 *   clientId: the uuid for the client, not the integer id,
 * }
 */
export async function createOIDCClient(
  uid, name, scope, redirectUris, image = null, defaultScope = null,
  uuid = null, rerollSecret = false,
) {
  if (!uid) {
    throw new Error('You are not logged in');
  }
  scope = scope.sort().join(' ');
  if (defaultScope) {
    defaultScope = defaultScope.sort().join(' ');
  }
  redirectUris = redirectUris.join(' ');

  let conn;
  try {
    conn = await pool.getConnection();

    const existingClients = await conn.query(
      // eslint-disable-next-line max-len
      'SELECT name, id, secret, BIN_TO_UUID(uuid) AS uuid FROM OIDCClients WHERE uid = ?',
      [uid],
    );
    if (uuid) {
      for (let i = 0; i < existingClients.length; i += 1) {
        const client = existingClients[i];
        if (client.uuid === uuid) {
          if (client.name !== name) {
            // eslint-disable-next-line no-await-in-loop
            const [nameCheck] = await conn.query(
              'SELECT id FROM OIDCClients WHERE name = ?', [name],
            );
            if (nameCheck) {
              throw new Error('This name is already taken');
            }
          }
          /* user already has this client registered */
          const secret = (rerollSecret) ? generateToken() : client.secret;
          // eslint-disable-next-line no-await-in-loop
          await conn.query(
            // eslint-disable-next-line max-len
            'UPDATE OIDCClients SET name = ?, image = ?, redirectUris = ?, scope = ?, defaultScope = ?, secret = ? WHERE id = ?',
            [
              name, image, redirectUris, scope, defaultScope, secret,
              client.id,
            ],
          );
          return {
            clientSecret: secret,
            clientId: client.uuid,
          };
        }
      }
      throw new Error('No such client exists or you do not have access to it');
    }
    if (existingClients.length >= 5) {
      throw new Error('You can only register 5 clients max');
    }

    const secret = generateToken();

    while (!uuid) {
      uuid = bufferToUUID(generateUUID());
      // eslint-disable-next-line no-await-in-loop
      const [existingClient] = await conn.query(
        // eslint-disable-next-line max-len
        'SELECT name, BIN_TO_UUID(uuid) AS uuid FROM OIDCClients WHERE uuid = UUID_TO_BIN(?) OR name = ?',
        [uuid, name],
      );
      if (existingClient && existingClient.uuid === uuid) {
        uuid = null;
      }
      if (existingClient && existingClient.name === name) {
        throw new Error('This name is already taken');
      }
    }

    await conn.query(
      // eslint-disable-next-line max-len
      'INSERT INTO OIDCClients (uid, name, image, uuid, secret, redirectUris, scope, defaultScope, autoGrant, createdAt) VALUES (?, ?, ?, UUID_TO_BIN(?), ?, ?, ?, ?, ?, NOW())',
      [
        uid, name, image, uuid, secret, redirectUris, scope, null, false,
      ],
    );
    return { clientSecret: secret, clientId: uuid };
  } finally {
    if (conn) conn.release();
  }
}

/* =================================== Consent ================================
 * Given User Consent, remembered to silently approve of previous alloweances
 */

/**
 * check if user consented
 * @param cid client id
 * @param uid user id
 * @return consentModel {
 *   id,
 *   cid,
 *   uid,
 *   scope: array of consented scopes, which could be more than client allows,
 *   consentedAt,
 *   expires,
 * }
 */
export async function hasUserConsent(uid, cid) {
  if (!cid || !uid) {
    return null;
  }
  try {
    const [consentModel] = await pool.query(
      // eslint-disable-next-line max-len
      'SELECT * FROM OIDCConsents WHERE cid = ? AND uid = ? AND (expires > NOW() OR expires IS NULL)',
      [cid, uid],
    );
    if (consentModel) {
      consentModel.scope = consentModel.scope.split(' ');
      return consentModel;
    }
  } catch (error) {
    console.error(`SQL Error on hasUserConsent: ${error.message}`);
  }
  return null;
}

/**
 * get all consents a user has given
 * @param uid user id
 * @return [{
 *   id
 *   name,
 *   image | null,
 *   domain,
 *   expiresTs,
 * }, ...]
 */
export async function getAllConsentsOfUser(userId) {
  if (userId) {
    try {
      const consentModels = await pool.query(
        // eslint-disable-next-line max-len
        `SELECT co.id, c.name, c.image, c.redirectUris, co.expires FROM OIDCConsents co
    LEFT JOIN OIDCClients c ON c.id = co.cid
  WHERE co.uid = ? AND (co.expires > NOW() OR co.expires IS NULL)`,
        [userId],
      );
      if (consentModels) {
        for (let i = 0; i < consentModels.length; i += 1) {
          const model = consentModels[i];
          model.expiresTs = model.expires?.getTime();
          delete model.expires;

          let domain = model.redirectUris.split(' ')[0];
          const start = domain.indexOf('://') + 3;
          const end = domain.indexOf('/', start);
          if (end !== -1) {
            domain = domain.substring(start, end);
          } else {
            domain = domain.substring(start);
          }
          model.domain = domain;
          delete model.redirectUris;
        }
        return consentModels;
      }
    } catch (error) {
      console.error(`SQL Error on getAllConsentsOfUser: ${error.message}`);
    }
  }
  return [];
}

/**
 * remove consent by id
 * @param id consent id
 * @param uid user id
 * @return boolean success
 */
export async function removeConsentById(id, uid) {
  if (!id) {
    return false;
  }
  try {
    const { affectedRows } = await pool.query(
      'DELETE FROM OIDCConsents WHERE id = ? AND uid = ?', [id, uid],
    );
    return affectedRows > 0;
  } catch (error) {
    console.error(`SQL Error on removeConsentById: ${error.message}`);
  }
  return false;
}

/**
 * user consents to oidc client
 * @param cid client id integer
 * @param uid user id
 * @param scope array of scopes
 * @param expiresTs | null timestampe when consent expires
 * @param existingConsent | null model of existing consent if we only add scope
 * @return id | null consent id
 */
export async function consentUser(
  cid, uid, scope, expiresTs, existingConsent = null,
) {
  let conn;
  try {
    conn = await pool.getConnection();

    const expires = expiresTs && new Date(Date.now() + expiresTs);

    /* if consent already exists, update existing consent */
    if (existingConsent
      && existingConsent.uid === uid && existingConsent.cid === cid
    ) {
      let modified = false;
      for (let i = 0; i < scope.length; i += 1) {
        if (!existingConsent.scope.has(scope[i])) {
          existingConsent.scope.push(scope[i]);
        }
        modified = true;
      }
      const { id } = existingConsent;
      if (modified) {
        const scopeString = scope.sort().join(' ');
        await conn.query(
          'UPDATE OIDCConsents SET scope = ?, expires = ? WHERE id = ?',
          [scopeString, expires, id],
        );
      }
      return id;
    }

    const scopeString = scope.sort().join(' ');
    const { insertId } = await conn.query(
      // eslint-disable-next-line max-len
      'INSERT INTO OIDCConsents (cid, uid, scope, expires, consentedAt) VALUES (?, ?, ?, ?, NOW()) ON DUPLICATE KEY UPDATE scope = VALUES(scope), expires = VALUES(expires), consentedAt = VALUES(consentedAt)',
      [cid, uid, scopeString, expires],
    );
    if (insertId) {
      return insertId;
    }
  } catch (error) {
    console.error(`SQL Error on consent: ${error.message}`);
  } finally {
    if (conn) conn.release();
  }
  return null;
}

/* ================================ Refresh Token =============================
 * Tokens used to get new access token, they are single-use and grant a new
 * refresh token each time
 */

/**
 * consume refresh token
 * @param cid client id
 * @param uid user id
 * @return {
 *   cid,
 *   uid,
 *   scope,
 * }
 */
export async function consumeRefreshToken(token) {
  if (!token) {
    return null;
  }

  let conn;
  try {
    conn = await pool.getConnection();

    const [refreshModel] = await conn.query(
      // eslint-disable-next-line max-len
      `SELECT rt.id, rt.scope, co.scope AS consentedScope, co.uid, rt.cid, co.cid AS clientIntId FROM OIDCRefreshTokens rt
  INNER JOIN OIDCConsents co ON co.id = rt.cid
WHERE rt.token = ? AND rt.expires > NOW()`,
      [token],
    );
    if (refreshModel) {
      /*
       * token is single-use
       */
      await conn.query(
        'DELETE rt FROM OIDCRefreshTokens rt WHERE id = ?', [refreshModel.id],
      );
      delete refreshModel.id;
      /*
       * make sure consent to scope is still given, afaik not required by spec
       */
      let { consentedScope } = refreshModel;
      consentedScope = consentedScope.split(' ');
      refreshModel.scope = refreshModel.scope.split(' ').filter(
        (s) => consentedScope.includes(s),
      );
      delete refreshModel.consentedScope;

      return refreshModel;
    }
  } catch (error) {
    console.error(`SQL Error on consumeRefreshToken: ${error.message}`);
  } finally {
    if (conn) conn.release();
  }
  return null;
}

/**
 * create new Refresh Token
 * @param consentId OIDCConsent id
 * @param scope array of scopes
 * @return token
 */
export async function createRefreshToken(consentId, scope) {
  try {
    const token = generateLargeToken();
    await pool.query(
      /*
       * reminder that if you change epiration time, to change it in token.js
       * for payload.refresh_expires_in as well
       */
      // eslint-disable-next-line max-len
      'INSERT INTO OIDCRefreshTokens (cid, token, scope, expires, createdAt) VALUES (?, ?, ?, NOW() + INTERVAL 90 DAY, NOW())',
      [consentId, token, scope.sort().join(' ')],
    );
    return token;
  } catch (error) {
    console.error(`SQL Error on createRefreshToken: ${error.message}`);
  }
  return null;
}
