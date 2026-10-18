/*
 * Server-side entry gate. The page and all API calls stay unavailable until
 * the visitor completes the one-time CAPTCHA + JavaScript challenge.
 */
import { parse as parseCookie } from 'cookie';

import {
  BLOCK_PROXIES,
  ENTRY_CHECK_ENABLED,
} from '../core/config.js';
import { unsign } from '../utils/hash.js';
import generateEntryCheckPage from '../ssr/EntryCheck.js';

const ENTRY_COOKIE = 'ppfun.entry';

function isEntryCheckRoute(req) {
  return req.path === '/api/entry-check'
    || req.path === '/captcha.svg'
    || req.path === '/challenge.js'
    || req.path === '/test';
}

export function hasValidEntryCookie(req) {
  const cookies = parseCookie(req.headers.cookie || '');
  const value = unsign(cookies[ENTRY_COOKIE]);
  if (!value) {
    return false;
  }

  const [expiresAt, ipHex, ...browserHashParts] = value.split('.');
  const browserHash = browserHashParts.join('.');
  return Number(expiresAt) > Date.now()
    && ipHex === req.ip.ipHex
    && browserHash === req.device.browserHash;
}

function sendBlockedResponse(req, res) {
  const message = 'Bu bağlantı türü kabul edilmiyor. '
    + 'VPN veya proxy kullanmadan tekrar deneyin.';
  if (req.accepts('html')) {
    res.status(403).type('html').send(`<!doctype html>
<html lang="tr">
  <head><meta charset="utf-8"><title>Erişim engellendi</title></head>
  <body><h1>Erişim engellendi</h1><p>${message}</p></body>
</html>`);
    return;
  }
  res.status(403).json({ error: 'proxy_blocked', message });
}

export default async function entryCheck(req, res, next) {
  if (!ENTRY_CHECK_ENABLED || isEntryCheckRoute(req)) {
    next();
    return;
  }

  let allowance;
  try {
    allowance = await req.ip.getAllowance();
  } catch (error) {
    console.error(`Entry check IP lookup failed: ${error.message}`);
    res.status(503).send('Security check temporarily unavailable.');
    return;
  }

  if (BLOCK_PROXIES && allowance.isProxy) {
    sendBlockedResponse(req, res);
    return;
  }

  if (hasValidEntryCookie(req)) {
    next();
    return;
  }

  if (req.path === '/') {
    const { html, csp } = generateEntryCheckPage(req);
    res.set({
      'Cache-Control': 'no-store',
      'Content-Security-Policy': csp,
      'Content-Type': 'text/html; charset=utf-8',
    });
    res.status(403).send(html);
    return;
  }

  res.status(403).json({
    error: 'entry_check_required',
    message: 'Complete the robot check before using PixelPlanet.',
  });
}

export { ENTRY_COOKIE };
