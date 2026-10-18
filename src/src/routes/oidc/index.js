/*
 * OpenID Connect specs:
 *   https://openid.net/specs/openid-connect-core-1_0.html#Authentication
 */
import express from 'express';

import urlEncoded from '../../middleware/formData.js';
import errorPage from '../../middleware/errorPage.js';
import errorJson from '../../middleware/errorJson.js';
import { validateAuthRequest, requireOidc } from '../../middleware/oidc.js';
import auth from './auth.js';
import consent from './consent.js';
import token from './token.js';
import userinfo from './userinfo.js';
import register from './register.js';

const router = express.Router();

/*
 * user giving consent and getting the auth code to return to relying party in
 * a redirect
 */
router.post('/consent', express.json(), validateAuthRequest, consent,
  errorJson,
);

router.use('/register', register);

router.use(urlEncoded);

/**
 * authorization request made by redirected user
 */
router.use('/auth', validateAuthRequest, auth, errorPage);

/*
 * relying party token requests
 */
router.post('/token', token);

/*
 * relying party userinfo requests
 */
router.use('/userinfo', requireOidc(), userinfo);

export default router;
