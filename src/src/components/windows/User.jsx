/*
 * User
 */
import { useState, useEffect, useContext } from 'preact/hooks';
import { Fragment } from 'preact';
import { useSelector, useStore } from '../../store/react-redux/index.js';
import { t, jt } from 'ttag';

import IoIosRefresh from '../../icons/IoIosRefresh.svg';
import { cdn } from '../../utils/utag.js';
import { getUrlsFromMediaIdAndName } from '../../utils/media/utils.js';
import WindowContext from '../context/window.js';
import useLink from '../hooks/link.js';
import ClipboardCopyField from '../ClipboardCopyField.jsx';
import { buildPopUpUrl } from './popUpAvailable.js';
import { requestUserInfo } from '../../store/actions/fetch.js';
import { startDm, setUserBlock } from '../../store/actions/thunks.js';
import Stat from '../Stat.jsx';
import ProfileHero from '../ProfileHero.jsx';
import BadgeList from '../BadgeList.jsx';
import FishList from '../FishList.jsx';

/* eslint-disable max-len */

const User = () => {
  /*
   * {
   *   uid,
   *   name,
   *   username,
   *   age: number of age in days,
   *   avatarId,
   *   customFlag,
   *   isPrivate,
   *   activeFactionRoleName,
   *   activeFactionTitle,
   *   activeFactionRoleFlag,
   *   totalPixels,
   *   dailyTotalPixels,
   *   ranking,
   *   dailyRanking,
   *   factions: [{
   *     title,
   *     name,
   *   }, ...],
   *   fishes: [{
   *     id,
   *     type,
   *     size,
   *     ts,
   *   }, ...],
   *   badges: [{
   *     id,
   *     name,
   *     description,
   *     ts,
   *   }, ...],
   * } | null
   */
  const [userData, setUserData] = useState(null);
  const [errors, setErrors] = useState([]);

  const { args: { username: uidOrUsername } } = useContext(WindowContext);

  const link = useLink();

  /* fetch name only to check if we are logged in */
  const ownUid = useSelector((state) => state.user.id);
  const blocked = useSelector((state) => state.chat.blocked);
  const store = useStore();

  useEffect(() => {
    (async () => {
      if (userData) {
        return;
      }
      const reqUserData = await requestUserInfo(uidOrUsername);
      if (reqUserData.errors) {
        setErrors(reqUserData.errors);
        return;
      }
      setErrors([]);
      setUserData(reqUserData);
    })();
  }, [userData, uidOrUsername]);

  if (!userData) {
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

  const { uid } = userData;

  const [mediaUrl, thumbUrl] = getUrlsFromMediaIdAndName(
    userData.avatarId, 'avatar',
  );

  let activeFactionTitle = null;
  let activeFactionRoleName = null;
  if (userData.activeFactionRoleName) {
    if (userData.activeFactionTitle) {
      activeFactionTitle = <strong>&quot;{userData.activeFactionTitle}&quot;</strong>;
    } else {
      activeFactionTitle = t`a hidden faction`;
    }
    activeFactionRoleName = <strong>&quot;{userData.activeFactionRoleName}&quot;</strong>;
  }

  let isBlocked = false;
  if (ownUid) {
    isBlocked = blocked.some((b) => b[0] === uid);
  }

  return (
    <div className="content" key="userpage">
      <ProfileHero
        name={userData.name}
        username={userData.username}
        uid={uid}
        flagUrl={(userData.customFlag) ? cdn`/cf/${userData.customFlag}.gif` : null}
        avatarThumbUrl={(thumbUrl) ? cdn`${thumbUrl}` : null}
        avatarUrl={mediaUrl}
        isSelf={Boolean(ownUid) && ownUid === uid}
      />
      {(userData.activeFactionRoleName) && (
        <p>
          {jt`Represents ${activeFactionTitle} as ${activeFactionRoleName}`}
          {(userData.activeFactionRoleFlag) && (
            <img
              className="chatflag presentation"
              src={cdn`${getUrlsFromMediaIdAndName(userData.activeFactionRoleFlag)[0]}`}
              alt=""
            />
          )}.&nbsp;
        </p>
      )}
      {(thumbUrl) && (
        <div
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
      <Stat
        text={t`Today Placed Pixels`}
        value={userData.dailyTotalPixels}
      />
      <Stat
        text={t`Daily Rank`}
        value={userData.dailyRanking}
        zero="N/A"
        rank
      />
      <Stat
        text={t`Placed Pixels`}
        value={userData.totalPixels}
      />
      <Stat
        text={t`Total Rank`}
        value={userData.ranking}
        zero="N/A"
        rank
      />
      <Stat
        text={t`Age`}
        value={userData.age}
        unit={t`days`}
        full
      />
      <BadgeList badges={userData.badges} />
      <FishList fishes={userData.fishes} />
      {(userData.factions.length > 0) && (
        <table>
          <thead>
            <tr>
              <th>{t`Factions`}</th>
            </tr>
          </thead>
          <tbody>
            {userData.factions.map(({ title, name }) => (
              <tr key={name}>
                <td>
                  <span
                    role="button"
                    tabIndex={-1}
                    className="modallink"
                    onClick={(evt) => {
                      evt.stopPropagation();
                      link('FACTION', {
                        target: 'blank',
                        args: { name },
                      });
                    }}
                  >
                    {`${title} [${name}]`}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {errors.map((error) => (
        <p key={error} className="errormessage">
          <span>{t`Error`}</span>:&nbsp;{error}</p>
      ))}
      <div className="form-actions">
        <ClipboardCopyField
          hideField="true"
          text={window.location.origin + buildPopUpUrl('USER', {
            username: userData.username,
          })}
        />
        <button
          type="button"
          title={t`Refresh`}
          onClick={() => {
            setUserData(null);
            setErrors([]);
          }}
        ><IoIosRefresh /></button>
        {(ownUid !== 0 && ownUid && ownUid !== uid) && (
          <Fragment key="user-actions">
            <button
              type="button"
              title={(isBlocked) ? t`Unblock` : t`Block`}
              onClick={() => {
                setErrors([]);
                store.dispatch(setUserBlock(uid, userData.name, !isBlocked));
              }}
            >
              {(isBlocked) ? t`Unblock` : t`Block`}
            </button>
            <button
              type="button"
              title={t`DM`}
              onClick={async (evt) => {
                evt.stopPropagation();
                /*
                * if dm channel already exists,
                * just switch
                */
                const { chat: { channels } } = store.getState();
                const cids = Object.keys(channels);
                for (let i = 0; i < cids.length; i += 1) {
                  const cid = cids[i];
                  if (channels[cid].length === 4 && channels[cid][3] === uid) {
                    link('CHAT', {
                      target: 'parent',
                      args: { chatChannel: cid },
                    });
                    return;
                  }
                }
                const error = await store.dispatch(
                  startDm({ userId: uid }, (cid) => {
                    link('CHAT', {
                      target: 'parent',
                      args: { chatChannel: cid },
                    });
                  }, false),
                );
                if (error) {
                  setErrors([error]);
                }
              }}
            >
              {t`DM`}
            </button>
          </Fragment>
        )}
      </div>
    </div>
  );
};

export default User;
