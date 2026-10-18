import { memo } from 'preact/compat';

import { stripQuery } from '../../core/utils.js';

function getUserFromUrl(url) {
  let aPos = url.indexOf('/@');
  if (aPos === -1) {
    return url;
  }
  aPos += 1;
  let bPos = url.indexOf('/', aPos);
  if (bPos === -1) {
    bPos = url.length;
  }
  return url.substring(aPos, bPos);
}

const TikTok = ({ url, fill }) => {
  let tid = stripQuery(url);
  tid = tid.substring(tid.lastIndexOf('/') + 1);

  return (
    <div
      style={{
        textAlign: 'center',
        height: fill && '100%',
        alignContent: fill && 'center',
      }}
    >
      <iframe
        style={{
          borderRadius: 5,
          height: 768,
          width: 320,
        }}
        src={

          `https://www.tiktok.com/embed/v2/${tid}`
        }
        frameBorder="0"
        referrerPolicy="no-referrer"
        allow="autoplay"
        scrolling="no"
        // eslint-disable-next-line max-len
        sandbox="allow-scripts allow-modals allow-forms allow-popups allow-same-origin allow-presentation"
        allowFullScreen
        title="Embedded tiktok"
      />
    </div>
  );
};

export default [
  memo(TikTok),
  (url) => url.includes('/video/'),
  (url) => getUserFromUrl(url),
  '/embico/tiktok.png',
];
