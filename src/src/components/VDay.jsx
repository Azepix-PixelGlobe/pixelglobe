/* vday banner */
import { useState, useRef } from 'preact/hooks';
import { cdn } from '../utils/utag.js';

/* eslint-disable jsx-a11y/no-noninteractive-element-interactions */

const VDay = () => {
  const [isPlaying, setIsPlaying] = useState(false);
  const audioRef = useRef(null);

  const togglePlayPause = () => {
    if (isPlaying) {
      audioRef.current.pause();
    } else {
      audioRef.current.play();
    }
    setIsPlaying(!isPlaying);
  };

  return (
    <>
      <img
        style={{
          position: 'absolute',
          bottom: 0,
          left: '50%',
          transform: 'translateX(-50%)',
          width: '10vw',
          cursor: 'pointer',
        }}
        alt="butthurt belters"
        src={cdn`/special/butthurt.png`}
        onClick={togglePlayPause}
      />
      <div
        style={{
          position: 'absolute',
          top: 0,
          right: 0,
          height: '5%',
          width: '100vh',
          backgroundImage: 'url(\'special/russia-flag.png\')',
          backgroundSize: 'contain',
          transform: 'rotate(45deg) translateX(30%) translateY(60%)',
          transformOrigin: 'right top',
          cursor: 'pointer',
          boxShadow: isPlaying && '0 0 18px 4px #e0ac48',
        }}
        role="button"
        title="День Победы"
        tabIndex={-1}
        onClick={togglePlayPause}
      >
        { /* eslint-disable-next-line jsx-a11y/media-has-caption */ }
        <audio
          ref={audioRef}
          src={cdn`/special/russia-8bit-anthem.opus`}
          onEnded={() => setIsPlaying(false)}
        />
      </div>
      <link rel="stylesheet" type="text/css" href={cdn`/special/vday.css`} />
    </>
  );
};

export default VDay;
