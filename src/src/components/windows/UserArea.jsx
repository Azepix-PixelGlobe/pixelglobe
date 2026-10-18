/*
 * Menu to change user credentials
 */

import { useState, useCallback } from 'preact/hooks';
import { Fragment } from 'preact';
import { memo } from 'preact/compat';
import {
  useSelector, shallowEqual, useDispatch,
} from '../../store/react-redux/index.js';
import { t } from 'ttag';

import { cdn } from '../../utils/utag.js';
import { getUrlsFromMediaIdAndName } from '../../utils/media/utils.js';
import useLink from '../hooks/link.js';
import UserMessages from '../UserMessages.jsx';
import FishList from '../FishList.jsx';
import BadgeList from '../BadgeList.jsx';
import ChangePassword from '../ChangePassword.jsx';
import ChangeName from '../ChangeName.jsx';
import ChangeUsername from '../ChangeUsername.jsx';
import ChangeMail from '../ChangeMail.jsx';
import DeleteAccount from '../DeleteAccount.jsx';
import LogInForm from '../LogInForm.jsx';
import SocialSettings from '../SocialSettings.jsx';
import Stat from '../Stat.jsx';
import ProfileHero from '../ProfileHero.jsx';
import { logoutUser } from '../../store/actions/index.js';
import { requestLogOut } from '../../store/actions/fetch.js';
import { selectIsDarkMode } from '../../store/selectors/gui.js';
import useProfile from '../hooks/useProfile.js';

const AREAS = {
  CHANGE_NAME: ChangeName,
  CHANGE_USERNAME: ChangeUsername,
  CHANGE_MAIL: ChangeMail,
  CHANGE_PASSWORD: ChangePassword,
  DELETE_ACCOUNT: DeleteAccount,
  SOCIAL_SETTINGS: SocialSettings,
};

const UserArea = () => {
  const [area, setArea] = useState('NONE');

  const dispatch = useDispatch();
  const logout = useCallback(async () => {
    const ret = await requestLogOut();
    if (ret) {
      dispatch(logoutUser());
    }
  }, [dispatch]);

  const isDarkMode = useSelector(selectIsDarkMode);
  const [
    name,
    havePassword,
    username,
    ownUid,
  ] = useSelector((state) => [
    state.user.name,
    state.user.havePassword,
    state.user.username,
    state.user.id,
  ], shallowEqual);
  const [
    totalPixels,
    dailyTotalPixels,
    ranking,
    dailyRanking,
  ] = useSelector((state) => [
    state.ranks.totalPixels,
    state.ranks.dailyTotalPixels,
    state.ranks.ranking,
    state.ranks.dailyRanking,
  ], shallowEqual);

  const done = useCallback(() => setArea('NONE'), []);

  const [
    badges, fishes, avatarId,
  ] = useProfile((profile) => [
    profile.badges, profile.fishes, profile.avatarId,
  ]);
  const link = useLink();

  if (!name) {
    return <LogInForm title={t`Login to access more features and stats.`} />;
  }

  const Area = AREAS[area];

  const [mediaUrl, thumbUrl] = getUrlsFromMediaIdAndName(avatarId, 'avatar');

  return (
    <div className="content">
      <ProfileHero
        name={name}
        username={username}
        uid={ownUid}
        avatarThumbUrl={(thumbUrl) ? cdn`${thumbUrl}` : null}
        avatarUrl={mediaUrl}
        isSelf
      />
      {(false) && (
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
      <UserMessages />
      <Stat
        text={t`Today Placed Pixels`}
        value={dailyTotalPixels}
      />
      <Stat
        text={t`Daily Rank`}
        value={dailyRanking}
        zero="N/A"
        rank
      />
      <Stat
        text={t`Placed Pixels`}
        value={totalPixels}
      />
      <Stat
        text={t`Total Rank`}
        value={ranking}
        zero="N/A"
        rank
      />
      <BadgeList badges={badges} />
      <FishList fishes={fishes} />
      <div>
        <p>
          {t`Your name is:`}<span className="statvalue">{` ${name} `}</span>
          [{` ${username} `}]
        </p>(
        <span
          role="button"
          tabIndex={-1}
          className="modallink"
          onClick={logout}
        > {t`Log out`}</span>
        <span className="hdivider" />
        <span
          role="button"
          tabIndex={-1}
          className="modallink"
          onClick={() => setArea('CHANGE_NAME')}
        > {t`Change Name`}</span>
        <span className="hdivider" />
        {(username.startsWith('pp_')) && (
          <Fragment key="choseun">
            <span
              role="button"
              tabIndex={-1}
              style={{
                fontWeight: 'bold',
                color: (isDarkMode) ? '#fcff4b' : '#8f270d',
              }}
              className="modallink"
              onClick={() => setArea('CHANGE_USERNAME')}
            > {t`Choose Username`}</span>
            <span className="hdivider" />
          </Fragment>
        )}
        <span
          role="button"
          tabIndex={-1}
          className="modallink"
          onClick={() => setArea('CHANGE_MAIL')}
        > {t`Login Methods`}</span>
        <span className="hdivider" />
        <span
          role="button"
          tabIndex={-1}
          style={(havePassword) ? {} : {
            fontWeight: 'bold',
            color: (isDarkMode) ? '#fcff4b' : '#8f270d',
          }}
          className="modallink"
          onClick={() => setArea('CHANGE_PASSWORD')}
        > {(havePassword) ? t`Change Password` : t`Set Password`}</span>
        <span className="hdivider" />
        <span
          role="button"
          tabIndex={-1}
          className="modallink"
          onClick={() => setArea('DELETE_ACCOUNT')}
        > {t`Delete Account`}</span> )
        <br />(
        <span
          role="button"
          tabIndex={-1}
          className="modallink"
          onClick={() => setArea('SOCIAL_SETTINGS')}
        > {t`Social Settings`}</span> )
      </div>
      {(Area) && <Area key="area" done={done} />}
    </div>
  );
};

export default memo(UserArea);
