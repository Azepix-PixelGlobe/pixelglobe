/* eslint-disable jsx-a11y/media-has-caption */

import { splitUrl } from '../../core/utils.js';
import { VIDEO_EXTENSIONS, IMAGE_EXTENSIONS } from '../../core/constants.js';

const DirectLinkMedia = ({
  url, fill, maxHeight, type,
}) => {
  const [, ext] = splitUrl(url);
  if (type === 'video' || VIDEO_EXTENSIONS.includes(ext)) {
    return (
      <div
        style={{
          textAlign: 'center',
          overflow: 'hidden',
          height: fill && '100%',
        }}
      >
        <video
          style={{
            maxWidth: '100%',
            maxHeight: maxHeight || '100%',
            height: fill && '100%',
            width: fill && '100%',
          }}
          controls
          autoPlay
          src={url}
          referrerPolicy="no-referrer"
        />
      </div>
    );
  }

  return (
    <div
      style={{
        textAlign: 'center',
        overflow: 'hidden',
        height: fill && '100%',
        alignContent: fill && 'center',
      }}
    >
      <img
        alt={`${url}`}
        src={url}
        style={{
          maxWidth: '100%',
          maxHeight: maxHeight || '100%',
        }}
        referrerPolicy="no-referrer"
      />
    </div>
  );
};

export default [
  DirectLinkMedia,
  (url) => {
    const [, ext] = splitUrl(url);
    return (VIDEO_EXTENSIONS.includes(ext) || IMAGE_EXTENSIONS.includes(ext));
  },
  null,
  '/embico/direct.png',
];
