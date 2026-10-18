import { memo } from 'preact/compat';

import DirectLinkEmbed from './DirectLinkEmbed.jsx';

function getIdFromURL(url) {
  let searchTerm;
  if (url.includes('youtube')) {
    if (url.includes('/shorts/')) {
      searchTerm = '/shorts/';
    } else {
      searchTerm = 'v=';
    }
  } else {
    searchTerm = 'e/';
  }
  let vPos = url.indexOf(searchTerm);
  if (vPos === -1) {
    return null;
  }
  vPos += searchTerm.length;
  let vEnd;
  for (vEnd = vPos;
    vEnd < url.length && !['&', '?', '/'].includes(url[vEnd]);
    vEnd += 1);
  return url.substring(vPos, vEnd);
}

const YouTube = ({ url, fill, maxHeight }) => {
  const id = getIdFromURL(url);
  if (!id) {
    return null;
  }
  const Embed = DirectLinkEmbed[0];
  return (
    <Embed
      url={`https://www.youtube.com/embed/${id}?autoplay=1`}
      maxHeight={maxHeight}
      fill={fill}
      aspectRatio={url.includes('/shorts/') ? 177.77 : undefined}
      strictReferrer
    />
  );
};

export default [
  memo(YouTube),
  getIdFromURL,
  getIdFromURL,
  '/embico/youtube.png',
];
