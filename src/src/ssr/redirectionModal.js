/*
 * Make basic redirection page
 */

import { getTTag } from '../middleware/ttag.js';
import putHtmlIntoModal from './modalShell.js';

/* eslint-disable max-len */

export default function putHtmlIntoRedirectionModal(
  title, description, htmlString, target, lang,
) {
  const { t } = getTTag(lang);
  return putHtmlIntoModal(title, description,
    `${htmlString}
<p>${t`You will be automatically redirected after 15s`}</p>
<script>window.setTimeout(function(){window.location.href="${target}";},15000)</script>`,
    lang,
  );
}
