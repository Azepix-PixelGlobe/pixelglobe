/*
 * error handling middleware that prints error html page
 */

import putHtmlIntoModal from '../ssr/modalShell.js';


export default (err, req, res, next) => {
  if (res.headersSent) {
    next(err);
    return;
  }
  res.set({
    'Cache-Control': 'no-cache, no-store, must-revalidate',
    'Content-Type': 'text/html; charset=utf-8',
    Expires: '0',
  });
  const { lang, ttag: { t } } = req;
  const title = err.title || t`Error`;
  const { message: description } = err;
  if (err.redirectUri) {
    const responseParams = new URLSearchParams({
      error: title.toLowerCase(),
      // eslint-disable-next-line camelcase
      error_description: description,
    });
    res.redirect(`${err.redirectUri}?${responseParams.toString()}`);
    return;
  }
  const innerHtml = `<h1>${title}</h1><p>${description}</p>`;
  const html = putHtmlIntoModal(title, title, innerHtml, lang);
  const status = err.status || 400;
  res.status(status).send(html);
};
