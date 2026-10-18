/*
 * Change Mail Form
 */
/* eslint-disable jsx-a11y/no-noninteractive-element-interactions */

import { useRef, useState, useCallback, useEffect } from 'preact/hooks';
import { memo } from 'preact/compat';
import {
  useSelector, shallowEqual, useDispatch,
} from '../store/react-redux/index.js';
import RiSave3Line from '../icons/RiSave3Line.svg';
import IoTrashOutline from '../icons/IoTrashOutline.svg';
import ImAttachment from '../icons/ImAttachment.svg';
import { t } from 'ttag';

import { cdn } from '../utils/utag.js';
import DeleteList from './DeleteList.jsx';

import {
  setUserBlock, changeProfile, changeUser,
} from '../store/actions/thunks.js';
import { requestFileUpload } from '../store/actions/fetch.js';
import { patchState } from '../store/actions/index.js';
import useProfile from './hooks/useProfile.js';
import { selectIsDarkMode } from '../store/selectors/gui.js';
import SettingsItem from './SettingsItem.jsx';
import Avatar from './Avatar.jsx';

const selectBlocks = (state) => [
  state.chat.blocked,
  state.user.blockDm,
  state.user.priv,
  state.user.id,
];

/* eslint-disable max-len */
const SocialSettings = ({ done }) => {
  const [
    blocked,
    blockDm,
    priv,
    userId,
  ] = useSelector(selectBlocks, shallowEqual);
  const [fetchChange, setFetchChange] = useState(false);

  const [avatarId, customFlag] = useProfile((profile) => [
    profile.avatarId, profile.customFlag,
  ]);

  const [avatarErrors, setAvatarErrors] = useState([]);
  const [avatarFileName, setAvatarFileName] = useState('');
  const [selectedCustomFlag, setSelectedCustomFlag] = useState(null);
  const isDarkMode = useSelector(selectIsDarkMode);
  const avatarFileRef = useRef(null);
  const avatarInputRef = useRef(null);
  const flagAtlasRef = useRef();
  const flagAtlasJsonRef = useRef();
  const dispatch = useDispatch();

  const onAvatarFileChange = useCallback((e) => {
    const file = e.target.files?.[0];
    if (file) {
      avatarFileRef.current = file;
      setAvatarFileName(file.name);
    }
    // reset input so same file can be re-selected
    e.target.value = '';
  }, []);

  useEffect(() => {
    setSelectedCustomFlag(customFlag);
  }, [customFlag]);

  const onFlagAtlasClick = async (event) => {
    /*
     * get information of flag atlas, set ref to true while fetching those
     */
    if (flagAtlasJsonRef.current === true) {
      return;
    }
    if (!flagAtlasJsonRef.current) {
      flagAtlasJsonRef.current = true;
      try {
        const response = await fetch(cdn`/cf/atlas.json`);
        flagAtlasJsonRef.current = await response.json();
      } catch {
        flagAtlasJsonRef.current = null;
        return;
      }
    }
    const { codes, width, height, margin, columns } = flagAtlasJsonRef.current;
    const rect = flagAtlasRef.current.getBoundingClientRect();
    const xRel = Math.floor((event.clientX - rect.left) / (width + margin));
    const yRel = Math.floor((event.clientY - rect.top) / (height + margin));
    const flag = codes[yRel * columns + xRel];
    setSelectedCustomFlag(flag);
  };

  return (
    <div className="inarea">

      <div className="setitem">
        <div className="setrow">
          <h3 className="settitle">{t`Avatar`}</h3>
          <div className="little-fileupload-container">
            <Avatar uid={userId} isDarkMode={isDarkMode} avatarId={avatarId} />
            {/* Direct file input — no FileUpload ref chain */}
            <button
              type="button"
              className="fileupload-input-btn"
              title={t`Select image`}
              disabled={fetchChange}
              onClick={() => avatarInputRef.current?.click()}
            >
              <ImAttachment />
            </button>
            <input
              ref={avatarInputRef}
              type="file"
              accept="image/*"
              className="fileupload-input-hidden"
              onChange={onAvatarFileChange}
            />
            {avatarFileName && (
              <span style={{
                fontSize: '10px',
                maxWidth: '60px',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
                alignSelf: 'center',
              }}>
                {avatarFileName}
              </span>
            )}
            <button
              type="button"
              onClick={async () => {
                if (!fetchChange) {
                  setFetchChange(true);
                  await dispatch(changeProfile({ avatarId: null }, true));
                  setFetchChange(false);
                }
              }}
              title={t`Clear`}
              disabled={fetchChange || avatarId === null}
            >
              <IoTrashOutline />
            </button>
            <button
              type="button"
              onClick={async () => {
                if (fetchChange) return;
                setAvatarErrors([]);
                const file = avatarFileRef.current;
                if (!file) {
                  setAvatarErrors([t`Please select an image first`]);
                  return;
                }
                setFetchChange(true);
                try {
                  const resp = await requestFileUpload(file, null, null, 'avatar');
                  if (!resp || resp.errors?.length) {
                    setAvatarErrors(resp?.errors || [t`Upload failed`]);
                    return;
                  }
                  const info = resp.availableFiles?.[0];
                  if (!info) {
                    setAvatarErrors([t`Could not get avatar info`]);
                    return;
                  }
                  // Server already wrote Profiles.avatar and sent ws update.
                  // Also patch local state immediately so UI doesn't wait for ws.
                  const newAvatarId = `${info.shortId}:${info.extension}`;
                  dispatch(patchState('profile', 'set', 'avatarId', newAvatarId));
                  avatarFileRef.current = null;
                  setAvatarFileName('');
                  setAvatarErrors([]);
                } catch (err) {
                  setAvatarErrors([err?.message || t`Upload failed`]);
                } finally {
                  setFetchChange(false);
                }
              }}
              title={t`Save`}
              disabled={fetchChange}
            >
              <RiSave3Line />
            </button>
          </div>
        </div>
        <div className="modaldesc">{
          t`Select your Avatar. Supported Formats: jpg, gif, png, webp`
        }</div>
        {avatarErrors.length > 0 && (
          <div className="errormessage">{avatarErrors.join(' ')}</div>
        )}
        {fetchChange && (
          <div className="modaldesc">{t`Saving avatar...`}</div>
        )}
        <div className="modaldivider" />
      </div>


      <h3
        style={{ textAlign: 'left' }}
      >{t`Custom Flag`}</h3>
      <p>
        {(selectedCustomFlag) ? (
          <span key="cfs">
            {t`Selected Flag:`}
            &nbsp;
            <img
              className="chatflag illegit"
              src={cdn`/cf/${selectedCustomFlag}.gif`}
              alt={selectedCustomFlag}
            />
          </span>
        ) : (
          <span key="ncf">{t`No flag selected`}</span>
        )}
        &nbsp;
        <button
          type="button"
          onClick={() => setSelectedCustomFlag(null)}
          title={t`Clear`}
          disabled={fetchChange || !selectedCustomFlag}
        >
          <IoTrashOutline />
        </button>
        <button
          type="button"
          onClick={async () => {
            if (!fetchChange) {
              setFetchChange(true);
              await dispatch(changeProfile({
                customFlag: selectedCustomFlag,
              }, true));
              setFetchChange(false);
            }
          }}
          title={t`Save`}
          disabled={fetchChange || customFlag === selectedCustomFlag}
        >
          <RiSave3Line />
        </button>
      </p>
      <div style={{ overflow: 'auto' }}>
        <img
          src={cdn`/cf/atlas.png`}
          alt={t`Select Flag`}
          ref={flagAtlasRef}
          onClick={onFlagAtlasClick}
          style={{ cursor: 'pointer' }}
          onDragStart={(e) => e.preventDefault()}
        />
      </div>
      <div className="modaldesc">{
        t`Note: Your active Faction may overwrite your flag settings.`
      }</div>
      <div className="modaldivider" />

      <SettingsItem
        title={t`Block DMs`}
        value={blockDm}
        onToggle={async () => {
          if (!fetchChange) {
            setFetchChange(true);
            await dispatch(changeUser({ blockDm: !blockDm }, true));
            setFetchChange(false);
          }
        }}
      >{t`Block all Private Messages. Enabling this will make it impossible for other users to start messaging you. You can still start new DMs with other users and already ongoing DMs will still be open.`}</SettingsItem>
      <SettingsItem
        title={t`Private`}
        value={priv}
        onToggle={async () => {
          if (!fetchChange) {
            setFetchChange(true);
            await dispatch(changeUser({ priv: !priv }, true));
            setFetchChange(false);
          }
        }}
      >{t`Don't show me in global stats`}</SettingsItem>
      <h3
        style={{
          textAlign: 'left',
          marginLeft: 10,
        }}
      >{t`Unblock Users`}</h3>
      {
        (blocked.length) ? (
          <DeleteList
            list={blocked}
            callback={async (id, name) => {
              if (!fetchChange) {
                setFetchChange(true);
                dispatch(setUserBlock(id, name, false));
                setFetchChange(false);
              }
            }}
            enabled={!fetchChange}
          />
        )
          : <p>{t`You have no users blocked`}</p>
      }
      <div className="modaldivider" />
      <button
        type="button"
        onClick={done}
        style={{ margin: 10 }}
      >
        Done
      </button>
    </div>
  );
};

export default memo(SocialSettings);
