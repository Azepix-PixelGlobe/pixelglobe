import { useState, useRef } from 'preact/hooks';
import { memo } from 'preact/compat';

import { stripQuery } from '../../core/utils.js';
import usePostMessage from '../hooks/postMessage.js';

const urlStr = '/status/';

const Twitter = ({ url, fill }) => {
  const [frameHeight, setFrameHeight] = useState(200);
  const [frameWidth, setFrameWidth] = useState(500);
  const iFrameRef = useRef(null);

  usePostMessage(iFrameRef,
    (data) => {
      try {
        if (data['twttr.embed']?.method === 'twttr.private.resize'
          && data['twttr.embed'].params?.[0]?.height
        ) {
          setFrameWidth(data['twttr.embed'].params[0].width);
          setFrameHeight(data['twttr.embed'].params[0].height);
        }
      } catch {
        console.error('Could not read postMessage from frame', data);
      }
    },
  );


  let tid = stripQuery(url);
  tid = tid.substring(tid.indexOf(urlStr) + urlStr.length);
  if (tid.indexOf('/') !== -1) {
    tid = tid.substring(tid.indexOf('/'));
  }

  return (
    <div
      style={{
        textAlign: 'center',
        height: fill && '100%',
        alignContent: fill && 'center',
      }}
    >
      <iframe
        ref={iFrameRef}
        style={{
          width: frameWidth,
          height: frameHeight,
          borderRadius: 12,
        }}
        src={
          `https://platform.twitter.com/embed/Tweet.html?dnt=true&embedId=twitter-widget-&frame=false&hideCard=false&hideThread=true&id=${tid}&theme=light`
        }
        frameBorder="0"
        referrerPolicy="no-referrer"
        allow="autoplay; picture-in-picture"
        scrolling="no"
        // eslint-disable-next-line max-len
        sandbox="allow-scripts allow-modals allow-forms allow-popups allow-same-origin allow-presentation"
        allowFullScreen
        title="Embedded twitter"
      />
    </div>
  );
};

export default [
  memo(Twitter),
  (url) => {
    const statPos = url.indexOf(urlStr);
    if (statPos === -1 || statPos + urlStr.length + 1 >= url.length) {
      return false;
    }
    return true;
  },
  (url) => {
    let title = url.substring(0, url.indexOf(urlStr));
    title = title.substring(title.lastIndexOf('/') + 1);
    return title;
  },
  '/embico/twitter.png',
];
