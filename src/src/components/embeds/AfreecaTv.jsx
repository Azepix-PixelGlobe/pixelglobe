import DirectLinkEmbed from './DirectLinkEmbed.jsx';

function getIdFromURL(url) {
  let searchTerm;
  if (url.includes('play.afreecatv')) {
    searchTerm = '.com/';
  } else {
    searchTerm = '/player/';
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

const AfreecaTv = ({ url, fill, maxHeight }) => {
  const id = getIdFromURL(url);
  if (!id) {
    return null;
  }
  let embedUrl;
  if (url.includes('vod.afreecatv')) {
    embedUrl = `https://vod.afreecatv.com/player/${id}/embed?autoPlay=true&showChat=true`;
  } else {
    embedUrl = `https://play.afreecatv.com/${id}/embed`;
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
  AfreecaTv,
  getIdFromURL,
  getIdFromURL,
  '/embico/afreecatv.png',
];
