/*
 * create html for popup page
 */

import { getJsAssets } from '../core/assets.js';
import generateMainHTML from './mainHTML.js';

/**
 * Generates string with html of popup pages
 * @param req express request, populated with ttag and ip
 * @param params additional parameters we give to the client in window.ssv
 * @return {html, csp, etab} html, content-security-policy and etag for mainpage
 */
export default function generateMainPage(req, params) {
  /*
   * TODO:
   * if the window needs a lazy loaded chunk, include it with
   * <link rel="preload" href="/modtools.abc123.js" as="script">
   * to make it download immediately
   */
  const scripts = getJsAssets('popup', req.lang);
  return generateMainHTML(req, 'ppfun', scripts, 'popup', params);
}
