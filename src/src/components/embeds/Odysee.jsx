/*
 * Odysee oembed API does not allow CORS request,
 * therefore we can't use it right now.
 * Still keeping this here in case that the policy changes in the future
 */
import { memo } from 'preact/compat';

import { stripQuery } from '../../core/utils.js';
import DirectLinkEmbed from './DirectLinkEmbed.jsx';

function stripCol(str) {
  const posCol = str.lastIndexOf(':');
  if (posCol !== -1) {
    return str.substring(0, posCol);
  }
  return str;
}

const urlStr = '/@';

const Odysee = ({ url, fill, maxHeight }) => {
  let oid;
  let posA = url.indexOf(urlStr);
  if (posA !== -1) {
    oid = url.substring(url.indexOf('/', posA + urlStr.length) + 1);
  } else {
    posA = url.indexOf('//');
    if (posA === -1) {
      posA = 0;
    }
    oid = url.substring(url.indexOf('/', posA + 2) + 1);
  }
  oid = stripCol(stripQuery(oid));

  const Embed = DirectLinkEmbed[0];
  return (
    <Embed
      url={`https://odysee.com/$/embed/${oid}`}
      fill={fill}
      maxHeight={maxHeight}
    />
  );
};

export default [
  memo(Odysee),
  (url) => {
    const urlPart = stripQuery(url);
    let posA = urlPart.indexOf(urlStr);
    if (posA !== -1) {
      // https://odysee.com/@user:1/video:1
      if (posA === -1 || posA + 4 >= urlPart.length) {
        return false;
      }
      posA = urlPart.indexOf('/', posA + urlStr.length);
      return !(posA === -1 || posA + 2 >= urlPart.length);
    }
    // https://odysee.com/video:6bd300b38bf1b30fa56e53c191b0652682c2ae6f
    posA = urlPart.indexOf('//');
    if (posA === -1) {
      posA = 0;
    }
    posA = urlPart.indexOf('/', posA + 2);
    return !(posA === -1 || posA + 2 >= urlPart.length);
  },
  (url) => {
    let urlPart = stripQuery(url);
    let posA = urlPart.indexOf(urlStr);
    if (posA !== -1) {
      urlPart = urlPart.substring(posA + urlStr.length);
      let name = urlPart.substring(0, urlPart.indexOf('/'));
      urlPart = stripCol(urlPart.substring(name.length + 1));
      name = stripCol(name);
      return `${name} | ${urlPart}`;
    }
    posA = urlPart.indexOf('//');
    if (posA === -1) {
      posA = 0;
    }
    urlPart = urlPart.substring(urlPart.indexOf('/', posA + 2) + 1);
    urlPart = stripCol(stripQuery(urlPart));
    return urlPart;
  },
  '/embico/odysee.png',
];
