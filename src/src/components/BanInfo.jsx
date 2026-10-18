/*
 * get information about ban
 */

import { useState, useCallback } from 'preact/hooks';
import { Fragment } from 'preact';
import { memo } from 'preact/compat';
import { jt, t } from 'ttag';

import useInterval from './hooks/interval.js';
import useLink from './hooks/link.js';
import ClipboardCopyField from './ClipboardCopyField.jsx';
import {
  largeDurationToString,
} from '../core/utils.js';
import { requestBanInfo } from '../store/actions/fetch.js';


const BanInfo = ({ close }) => {
  const [errors, setErrors] = useState([]);
  const [bans, setBans] = useState([]);
  const [submitting, setSubmitting] = useState(false);

  const link = useLink();

  const handleSubmit = useCallback(async () => {
    if (submitting) {
      return;
    }
    setSubmitting(true);
    setErrors([]);
    const infos = await requestBanInfo();
    setSubmitting(false);
    if (infos.errors) {
      setErrors(infos.errors);
      return;
    }
    let i = infos.length;
    while (i > 0) {
      i -= 1;
      const ban = infos[i];
      ban.expires = ban.sleft && new Date(
        Date.now() + ban.sleft * 1000,
      ).toLocaleString();
    }
    setBans(infos);
  }, [submitting]);

  const countDown = useCallback(() => {
    setBans((oldBans) => {
      if (bans.length) {
        const newBans = [];
        for (let i = 0; i < oldBans.length; i += 1) {
          let ban = oldBans[i];
          if (ban.sleft) {
            const sleft = ban.sleft - 1;
            if (sleft <= 0) {
              continue;
            }
            ban = {
              ...ban,
              sleft,
            };
          }
          newBans.push(ban);
        }
        if (!newBans.length) {
          close();
        }
        return newBans;
      }
      return oldBans;
    });
  }, [bans, close]);

  useInterval(countDown, 1000);

  const helpButton = (
    <span
      role="button"
      tabIndex={0}
      className="modallink"
      onClick={() => {
        link('HELP', { target: 'parent' });
        close();
      }}
    >{t`Help`}</span>
  );

  /* eslint-disable max-len */
  return (
    <div style={{ userSelect: 'text' }}>
      <p style={{
        fontWeight: 'bold',
        fontSize: '1.15em',
        textAlign: 'center',
      }}>
        PİXELGLOBE TARAFINDAN TAMAMEN BANLANDIN!
      </p>
      <p>
        {jt`You are banned. You think it is unjustified? Check out the ${helpButton} on how to appeal. And don't forget to include the BID you can get below.`}
      </p>
      {errors.map((error) => (
        <p key={error} className="errormessage">
          <span>{t`Error`}</span>:&nbsp;{error}
        </p>
      ))}
      {bans.map(({ reason, mod, sleft, expires, uuid }, index) => (
        <div className="baninfo" key={uuid}>
          <p>
            <span className="stattext">{t`Reason`}: </span>
            {reason}
          </p>
          {(mod) && (
            <p key="mod">
              <span className="stattext">{t`By Mod`}: </span>
              {mod}
            </p>
          )}
          {(sleft > 0) && (
            <p key="exp">
              <span className="stattext">{t`Duration`}: </span>
              {t`Your ban expires at `}
              <span style={{ fontWeight: 'bold' }}>{expires}</span>
              {t` which is in `}
              <span
                style={{ fontWeight: 'bold' }}
              >
                {largeDurationToString(sleft)}
              </span>
            </p>
          )}
          <p>
            <span className="stattext">BID: </span>
            <ClipboardCopyField text={uuid} maxWidth="18em" />
          </p>
          {(index !== bans.length - 1) && (
            <div className="modaldivider" />
          )}
        </div>
      ))}
      <p>
        {(bans.length === 0) && (
          <Fragment key="btnr">
            <button
              type="button"
              style={{
                fontWeight: 'bold',
                animation: 'glowing 1300ms infinite',
              }}
              onClick={handleSubmit}
            >
              {(submitting) ? '...' : t`Why?`}
            </button>
            &nbsp;
          </Fragment>
        )}
        <button type="submit" onClick={close}>{t`OK`}</button>
      </p>
    </div>
  );
};

export default memo(BanInfo);
