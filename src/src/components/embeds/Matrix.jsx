

import { memo } from 'preact/compat';

import DirectLinkMedia from './DirectLinkMedia.jsx';

const Matrix = ({ url, fill, maxHeight }) => {
  const cleanUrl = url.substring(0, url.indexOf('?type='));
  const type = (url.includes('?type=video')) ? 'video' : 'image';
  const Embed = DirectLinkMedia[0];
  return (
    <Embed
      url={cleanUrl}
      fill={fill}
      type={type}
      maxHeight={maxHeight}
    />
  );
};

export default [
  memo(Matrix),
  (url) => url.includes('?type=video') || url.includes('?type=image'),
  null,
  '/embico/matrix.png',
];
