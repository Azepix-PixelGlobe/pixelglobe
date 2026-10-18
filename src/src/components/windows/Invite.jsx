/*
 * resolving an invite
 */

import { useState, useEffect, useContext } from 'preact/hooks';
import { Fragment } from 'preact';
import {
  useSelector, shallowEqual, useDispatch,
} from '../../store/react-redux/index.js';
import { t } from 'ttag';

import WindowContext from '../context/window.js';
import {
  requestInviteData,
  requestUseInvite,
} from '../../store/actions/fetch.js';
import useLink from '../hooks/link.js';
import { cdn } from '../../utils/utag.js';
import { getUrlsFromMediaIdAndName } from '../../utils/media/utils.js';
import { applyPatches } from '../../store/actions/index.js';
import LogInForm from '../LogInForm.jsx';

/* eslint-disable max-len */

const Invite = () => {
  /*
   * {
   *   factionName,
   *   factionTitle,
   *   factionDescription,
   *   avatarId,
   *   memberCount,
   * }
   */
  const [inviteData, setInviteData] = useState(null);
  const [errors, setErrors] = useState([]);

  const { args: { inviteId } } = useContext(WindowContext);

  useEffect(() => {
    (async () => {
      if (inviteData) {
        return;
      }
      const reqInviteData = await requestInviteData(inviteId);
      if (reqInviteData.errors) {
        setErrors(reqInviteData.errors);
        return;
      }
      setInviteData(reqInviteData);
    })();
  }, [inviteData, inviteId]);

  const [
    name, username,
  ] = useSelector((state) => [
    state.user.name,
    state.user.username,
  ], shallowEqual);

  const link = useLink();
  const dispatch = useDispatch();

  if (!inviteData || errors.length) {
    return (
      <div className="content" key="loading">
        {errors.map((error) => (
          <p key={error} className="errormessage">
            <span>{t`Error`}</span>:&nbsp;{error}</p>
        ))}
        {!errors.length && (<h3>{t`Loading...`}</h3>)}
      </div>
    );
  }

  const { avatarId, memberCount, factionName } = inviteData;
  const [mediaUrl, thumbUrl] = getUrlsFromMediaIdAndName(avatarId, 'avatar');

  return (
    <div className="content">
      <h2>{inviteData.factionTitle}</h2>
      <h3>[{factionName}]</h3>
      {(thumbUrl) && (
        <div
          key="thumb"
          className="avatar-big"
          style={{
            backgroundImage: `url(${cdn`${thumbUrl}`})`,
          }}
          onClick={(evt) => {
            evt.stopPropagation();
            link('PLAYER', {
              reuse: true,
              target: 'blank',
              args: { uri: mediaUrl },
            });
          }}
        />
      )}
      <p>{t`You have been invited to join us on pixelplanet. We currently have ${memberCount} members.`}</p>
      {(name) ? (
        <Fragment key="need-login">
          <p>{t`You are logged in as ${name} [${username}].`}</p>
          <div className="form-actions">
            <button
              type="button"
              onClick={async (evt) => {
                evt.stopPropagation();
                const {
                  errors: respErrors, patches,
                } = await requestUseInvite(inviteId);
                if (patches) {
                  dispatch(applyPatches(patches));
                }
                if (respErrors) {
                  setErrors(respErrors);
                } else {
                  link('FACTION', {
                    args: { name: factionName },
                  });
                }
              }}
            >
              {t`Join`}
            </button>
            <button
              type="button"
              onClick={(evt) => {
                evt.stopPropagation();
                link('FACTION', {
                  args: { name: factionName },
                });
              }}
            >
              {t`Cancel`}
            </button>
          </div>
        </Fragment>
      ) : (
        <LogInForm title={t`Login to join us.`} />
      )}
    </div>
  );
};

export default Invite;
