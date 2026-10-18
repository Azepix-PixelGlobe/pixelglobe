import DirectLinkEmbed from './DirectLinkEmbed.jsx';

function getIdFromURL(url) {
  let vPos = url.indexOf('/video/');
  if (vPos === -1) {
    return null;
  }
  vPos += 7;
  let vEnd;
  for (vEnd = vPos;
    vEnd < url.length && !['&', '?', '/'].includes(url[vEnd]);
    vEnd += 1);
  return url.substring(vPos, vEnd);
}

const BitChute = ({ url, fill, maxHeight }) => {
  const id = getIdFromURL(url);
  if (!id) {
    return null;
  }
  const Embed = DirectLinkEmbed[0];
  return (
    <Embed
      url={`https://www.bitchute.com/embed/${id}`}
      maxHeight={maxHeight}
      fill={fill}
    />
  );
};

export default [
  BitChute,
  getIdFromURL,
  getIdFromURL,
  '/embico/bitchute.png',
];
