/*
 * Form to ask for captcha.
 * Offers input for captchas, parent needs to provide a form and
 * get "captcha" and "captchaid" values
 */

/* eslint-disable jsx-a11y/no-autofocus */

import { useState, useEffect, useCallback, useRef } from 'preact/hooks';
import { memo } from 'preact/compat';
import { t } from 'ttag';
import IoReloadCircleSharp from '../icons/IoReloadCircleSharp.svg';

import useInterval from './hooks/interval.js';
import { api } from '../utils/utag.js';
import { getRandomString } from '../core/utils.js';

async function getUrlAndId() {
  const url = api`/captcha.svg`;
  try {
    const resp = await fetch(url, {
      cache: 'no-cache',
    });
    if (resp.ok) {
      const captchaid = resp.headers.get('captcha-id');
      const challengeNeeded = resp.headers.get('challenge-needed') === '1';
      const svg = await resp.text();
      return [svg, captchaid, challengeNeeded];
    }
  } catch {
    // nothing
  }
  return null;
}

/*
 * autoload: Load captcha immediately and autofocus input textbox
 * width: width of the captcha image
 * isOneTime: if its used one single time for a specific action, rather than
 *   cached sitewide
 */
const Captcha = ({
  autoload, width, setLegit, onReadyStateChange, isOneTime,
}) => {
  const [captchaData, setCaptchaData] = useState({});
  const [challengeSolution, setChallengeSolution] = useState(null);
  const [animationProgress, setAnimationProgress] = useState(0);
  const [animationRunning, setAnimationRunning] = useState(false);
  const [loading, setLoading] = useState(false);
  const [errors, setErrors] = useState([]);

  const svgContainerRef = useRef();

  const reloadCaptcha = useCallback(async () => {
    /*
     * load Cahptcha
     */
    if (loading) {
      return;
    }
    setLoading(true);
    setCaptchaData({});
    setAnimationRunning(false);
    const captchaResponse = await getUrlAndId(isOneTime);
    setLoading(false);
    if (!captchaResponse) {
      setErrors([t`Could not load captcha`]);
      return;
    }
    const [svg, captchaid, challengeNeeded] = captchaResponse;

    /*
     * solve JS Challenge in Worker on first load
     */
    if ((challengeNeeded || isOneTime) && challengeSolution === null) {
      const worker = new Worker(`/challenge.js?cb=${getRandomString()}`);
      // TODO Timeout
      worker.onmessage = (e) => {
        setChallengeSolution(e.data);
        worker.terminate();
      };
      // empty string for waiting
      setChallengeSolution('');
    }

    setCaptchaData({ svg, id: captchaid });
    setErrors([]);
  }, [challengeSolution, loading, isOneTime]);

  useEffect(() => {
    /*
     * prepare svg for animated elements
     */
    if (captchaData.svg) {
      const svgElement = svgContainerRef.current.firstChild;
      svgElement.style.width = '100%';
      svgElement.style.height = '100%';
      let cnt = 0;
      const transforms = {};
      svgElement.childNodes.forEach((c) => {
        if (c.tagName === 'path') {
          const tr = c.getAttribute('transform');
          if (tr) {
            /*
            * heavily assume 'rotate(a, x, y)',
            * will break otherwise.
            */
            const [angle, x, y] = tr.slice(7, -1).split(',').map(
              (z) => Number(z),
            );
            let id;
            do {
              id = `ap${cnt}`;
              cnt += 1;
            } while (document.getElementById(id));
            c.id = id;
            transforms[id] = {
              x,
              y,
              clockwise: angle >= 0,
            };
          }
        }
      });
      if (Object.keys(transforms).length > 0) {
        setCaptchaData({ ...captchaData, transforms });
        setAnimationRunning(true);
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [captchaData.svg]);

  const stopAnimation = useCallback(() => {
    if (!animationRunning) {
      return;
    }
    setAnimationRunning(false);
    for (const id of Object.keys(captchaData.transforms)) {
      /*
       * heavily assume that first child is trnsformAnimate
       */
      document.getElementById(id).firstChild?.remove();
    }
  }, [animationRunning, captchaData.transforms]);

  const checkAnimationProgress = useCallback(() => {
    if (animationRunning && captchaData.transforms) {
      const firstId = Object.keys(captchaData.transforms)[0];
      const firstAnimatedPathElement = document.getElementById(firstId);
      if (!firstAnimatedPathElement) {
        return;
      }
      const firstPathAnimation = firstAnimatedPathElement.transform.animVal;
      if (firstPathAnimation.length) {
        const angle = Math.round(firstPathAnimation.getItem(0).angle);
        setAnimationProgress(angle);
      }
    }
  }, [animationRunning, captchaData.transforms]);

  useInterval(checkAnimationProgress, 25);

  useEffect(() => {
    if (autoload) {
      reloadCaptcha();
    }
  // intentionally only executed on first render
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (onReadyStateChange) {
      onReadyStateChange(challengeSolution !== '' && !!captchaData.id);
    }
  }, [challengeSolution, captchaData.id, onReadyStateChange]);

  const contWidth = width || 100;

  return (
    <>
      <p>
        {t`Type the characters from the following image:`}
        &nbsp;
        <span style={{ fontSize: 11 }}>
          ({t`Tip: Not case-sensitive; I and l are the same`})
        </span>
      </p>
      {errors.map((error) => (
        <p key={error} className="errormessage">
          <span>{t`Error`}</span>:&nbsp;{error}
        </p>
      ))}
      <div
        style={{
          width: `${contWidth}%`,
          paddingTop: `${Math.floor(contWidth * 0.6)}%`,
          position: 'relative',
          display: 'inline-block',
          backgroundColor: '#e0e0e0',
        }}
      >
        {(captchaData.svg) ? (
          <div
            style={{
              position: 'absolute',
              width: '100%',
              heigth: '100%',
              top: '0',
              left: '0',
            }}

            dangerouslySetInnerHTML={{ __html: captchaData.svg }}
            title="CAPTCHA"
            ref={svgContainerRef}
            key="svgc"
          />
        )
          : (
              <span
                style={{
                  width: '100%',
                  position: 'absolute',
                  top: '50%',
                  left: '50%',
                  transform: 'translate(-50%,-50%)',
                }}
                role="button"
                tabIndex={0}
                title={t`Load Captcha`}
                className="modallink"
                onClick={reloadCaptcha}
                onKeyPress={reloadCaptcha}
                key="caplt"
              >
                {t`Click to Load Captcha`}
              </span>
            )}
        {captchaData.transforms && (
          <input
            style={{
              position: 'absolute',
              bottom: 0,
              left: 5,
              right: 5,
            }}
            type="range"
            min="0"
            max="360"
            value={animationProgress}
            onMouseDown={stopAnimation}
            onTouchStart={stopAnimation}
            onChange={(evt) => {
              const { value } = evt.target;
              for (const [id, vals] of Object.entries(captchaData.transforms)) {
                document.getElementById(id).transform.baseVal.getItem(0)
                  .setRotate((vals.clockwise) ? value : -value, vals.x, vals.y);
              }
              setAnimationProgress(value);
            }}
          />
        )}
      </div>
      <p>
        {t`Can't read? Reload:`}&nbsp;
        <span
          role="button"
          tabIndex={-1}
          title={t`Reload`}
          className="modallink"
          style={{ fontSize: 28 }}
          onClick={reloadCaptcha}
        >
          <IoReloadCircleSharp />
        </span>
      </p>
      <input
        name="captcha"
        placeholder={t`Enter Characters`}
        type="text"
        autoComplete="off"
        autoCorrect="off"
        autoCapitalize="off"
        spellCheck="false"
        onChange={() => setLegit && setLegit(true)}
        autoFocus={autoload}
        style={{
          width: '6em',
          fontSize: 21,
          margin: 5,
        }}
      />
      <input type="hidden" name="captchaid" value={captchaData.id || '0'} />
      <input
        type="hidden"
        name="challengesolution"
        value={challengeSolution || ''}
      />
    </>
  );
};

export default memo(Captcha);
