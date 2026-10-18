/*
 * Global Captcha that is valid sitewide
 * via api/captcha
 * Displayed in an Alert
 */

import { useState } from 'preact/hooks';
import { memo } from 'preact/compat';
import { useDispatch } from '../store/react-redux/index.js';
import { t } from 'ttag';

import Captcha from './Captcha.jsx';
import socketClient from '../socket/SocketClient.js';
import { pRefresh } from '../store/actions/index.js';
import { requestBanMe } from '../store/actions/fetch.js';

const GlobalCaptcha = ({ close }) => {
  const [error, setError] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [legit, setLegit] = useState(false);
  const [ready, setReady] = useState(false);
  // used to be able to force Captcha rerender on error
  const [captKey, setCaptKey] = useState(() => Date.now());
  const dispatch = useDispatch();

  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        const text = e.target.captcha.value.trim();
        if (submitting || !text || !ready) {
          return;
        }
        // detect suspiciously solved captcha
        if (!legit) {
          await requestBanMe(2);
        }
        // ----
        const captchaid = e.target.captchaid.value;
        let challengeSolution = e.target.challengesolution.value;
        if (challengeSolution) {
          challengeSolution = Number(challengeSolution);
        }
        let errorText;
        try {
          setSubmitting(true);
          const retCode = await socketClient
            .sendCaptchaSolution(text, captchaid, challengeSolution);
          switch (retCode) {
            case 0:
              close();
              return;
            case 1:
              errorText = t`You took too long, try again.`;
              break;
            case 2:
              errorText = t`You failed your captcha`;
              break;
            case 3:
              errorText = t`No or invalid captcha text`;
              break;
            case 4:
              errorText = t`Your device looks weird`;
              break;
            case 6:
              errorText = t`Your Browser looks shady`;
              break;
            case 5:
              dispatch(pRefresh());
              // eslint-disable-next-line no-fallthrough
            default:
              errorText = t`Unknown Captcha Error`;
          }
        } catch (err) {
          errorText = `${err.message}`;
        }
        setSubmitting(false);
        setCaptKey(Date.now());
        setError(errorText);
      }}
    >
      {(error) && (
        <p key={error} className="errormessage">
          <span>{t`Error`}</span>:&nbsp;{error}
        </p>
      )}
      <Captcha
        autoload
        key={captKey}
        onReadyStateChange={setReady}
        setLegit={setLegit}
      />
      <p>
        <button
          type="button"
          onClick={close}
        >
          {t`Cancel`}
        </button>
       &nbsp;
        <button
          type="submit"
          disabled={submitting || !ready}
        >
          {(submitting || !ready) ? '...' : t`Send`}
        </button>
      </p>
    </form>
  );
};

export default memo(GlobalCaptcha);
