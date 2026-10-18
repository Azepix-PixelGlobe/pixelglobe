/**
 * Authorization request
 * If everything is alright, redirect straight away
 * response_type only 'code'
 */

import {
  hasUserConsent,
  consentUser,
  createAuthCode,
} from '../../data/sql/OIDC.js';
import generatePopUpPage from '../../ssr/PopUp.jsx';

export default async (req, res) => {
  const {
    oidcParams: params,
    oidcUserId: uid,
    oidcClientModel: clientModel,
    oidcAuthTime: sessionAge,
    oidcUserValid: userIsValid,
    oidcNeedReauth: needReAuth,
    oidcRedirectIsLocal: redirectIsLocal,
  } = req;
  const { redirect_uri: redirectUri, prompt } = params;
  let { scope } = params;

  try {
    if (uid && !needReAuth && userIsValid && !redirectIsLocal) {
      /* client.id is a primary key integer client_id in request is an uuid */
      const consentModel = await hasUserConsent(uid, clientModel.id);
      let approvedConsentId;
      if (consentModel) {
        const { scope: consentedScopes } = consentModel;
        /*
         * if we consented to scopes, but not the once the client wants, ask
         * for all again
         */
        let wantNewScopes = false;
        scope.forEach((s) => {
          if (!consentedScopes.includes(s)) {
            consentedScopes.push(s);
            wantNewScopes = true;
          }
        });
        if (wantNewScopes) {
          scope = consentedScopes;
          params.scope = scope;
        } else {
          approvedConsentId = consentModel.id;
        }
      }
      if (!approvedConsentId && clientModel.autoGrant === 1) {
        /* this client is always allowed and wont expire */
        approvedConsentId = await consentUser(
          clientModel.id, uid, scope, null, consentModel,
        );
      }
      if (approvedConsentId) {
        /* consented without user input */
        const code = await createAuthCode(
          approvedConsentId, scope,
          params.code_challenge, params.code_challenge_method,
          sessionAge, params.nonce,
        );
        if (code) {
          let urlParams = { code };
          if (params.state) {
            urlParams.state = params.state;
          }
          urlParams = new URLSearchParams(urlParams);
          res.redirect(`${redirectUri}?${urlParams.toString()}`);
          return;
        }
      }
    }

    if (prompt === 'none') {
      const { t } = req.ttag;
      const error = new Error(t`Login is required`);
      error.title = 'login_required';
      error.status = 401;
      throw error;
    }

    /*
     * Required scopes, if its an openid connect request it does require the
     * 'openid' scope.
     * TODO there are grants where you can set things on required according to
     * specs, we might choose supporting that
     */
    const requiredScopes = [];
    if (scope.includes('openid')) {
      requiredScopes.push('openid');
    }

    /*
     * print consent page
     * it is handled like any other popup, however, its not under
     * AVAILABLE_POPUPS because it is handled here, not by main routes, to do
     * instant redirects.
     * We give window.ssv.params to the popup rather than doing it over path
     * args, since we did server side validation of those.
     */
    const { html, etag: winEtag } = generatePopUpPage(req, {
      ...params,
      scope,
      clientName: clientModel.name,
      needsReauthentication: needReAuth,
      userIsValid,
      requiredScopes,
    });
    res.set({
      'Cache-Control': 'private, no-cache', // seconds
      ETag: winEtag,
    });

    if (!html) {
      res.status(304).end();
      return;
    }
    res.set('Content-Type', 'text/html; charset=utf-8');
    res.status(200).send(html);
  } catch (error) {
    error.title = 'server_error';
    error.redirectUri = redirectUri;
    throw error;
  }
};
