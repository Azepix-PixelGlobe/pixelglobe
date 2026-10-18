import { memo } from 'preact/compat';

import DirectLinkEmbed from './DirectLinkEmbed.jsx';

function getIdFromURL(url) {
  let vPos = url.indexOf('/videos/');
  if (vPos !== -1) {
    vPos += 8;
  } else {
    vPos = url.indexOf('.tv/') + 4;
  }
  let vEnd;
  for (vEnd = vPos;
    vEnd < url.length && !['&', '?', '/'].includes(url[vEnd]);
    vEnd += 1);
  return url.substring(vPos, vEnd);
}

const TwitchTv = ({ url, fill, maxHeight }) => {
  const id = getIdFromURL(url);
  if (!id) {
    return null;
  }
  let embedUrl = `https://player.twitch.tv/?autoplay=true&parent=${window.location.hostname}`;
  if (url.includes('/videos/')) {
    embedUrl += `&video=${id}`;
  } else {
    embedUrl += `&channel=${id}`;
  }
  const Embed = DirectLinkEmbed[0];
  return (
    <Embed
      url={embedUrl}
      maxHeight={maxHeight}
      fill={fill}
    />
  );
};

export default [
  memo(TwitchTv),
  getIdFromURL,
  getIdFromURL,
  '/embico/twitchtv.png',
];
