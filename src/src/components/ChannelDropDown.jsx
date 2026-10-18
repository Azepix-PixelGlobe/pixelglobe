/*
 * Drop Down menu for Chat Channel selection
 *
 */

import {
  useRef, useState, useCallback, useMemo, useEffect,
} from 'preact/hooks';
import { memo } from 'preact/compat';
import { Fragment } from 'preact';
import { useSelector } from '../store/react-redux/index.js';
import MdPerson from '../icons/MdPerson.svg';
import MdGroups from '../icons/MdGroups.svg';
import PiAxeFill from '../icons/PiAxeFill.svg';
import IoMdChatbubbles from '../icons/IoMdChatbubbles.svg';
import { c, t } from 'ttag';

import { useConditionalClickOutside } from './hooks/clickOutside.js';
import { CHANNEL_TYPES } from '../core/constants.js';
import { selectIsDarkMode } from '../store/selectors/gui.js';
import {
  selectUnreadCategories, isChannelUnread,
} from '../store/selectors/chat.js';
// for channel avatar
import { getColorFromId } from '../core/utils.js';
import { getUrlsFromMediaIdAndName } from '../utils/media/utils.js';
import { cdn } from '../utils/utag.js';


const ChannelAvatar = ({ cid, isDarkMode, avatarId, type }) => {
  const avatarStyle = {
    backgroundColor: getColorFromId(cid, isDarkMode),
    color: (isDarkMode) ? '#636363' : '#a7a5a5',
  };
  const [, thumb] = getUrlsFromMediaIdAndName(avatarId, 'avatar');
  if (thumb) {
    avatarStyle.backgroundImage = `url(${cdn`${thumb}`})`;
  }
  let text;
  if (!avatarId) {
    if (type === CHANNEL_TYPES.DM) {
      text = '@';
    } else {
      text = '#';
    }
  }
  return (
    <div className="channelavatar" style={avatarStyle}>
      {!avatarId && text}
    </div>
  );
};


const ChannelDropDown = ({
  setChatChannel, chatChannel, channelName, channelType, channelAvatarId,
}) => {
  const [selectedType, setSelectedType] = useState(channelType);
  const wrapperRef = useRef(null);

  const isDarkMode = useSelector(selectIsDarkMode);
  const unreadCategories = useSelector(selectUnreadCategories);
  /*
   * whether or not dropdown is active and rendered, used for animating it
   * 0: fade-in opacity:0
   * 1: shown
   * 2: fade-out opacity:0
   * 3: hidden
   */
  const [dropDownState, setDropDownState] = useState(3);

  // [cid, name, lastTs, avatar]
  const channels = useSelector((state) => state.chat.channels);

  useConditionalClickOutside(
    [wrapperRef],
    dropDownState < 2,
    useCallback(() => setDropDownState(2), []),
  );

  const [categoryNames, categorySymbols] = useMemo(() => [{
    [CHANNEL_TYPES.PUBLIC]: c('channel-list').t`Public`,
    /* t: Abbrevation for Direct Messages in Chat Channel selection */
    [CHANNEL_TYPES.DM]: t`DM`,
    [CHANNEL_TYPES.GROUP]: t`Groups`,
    [CHANNEL_TYPES.FACTION]: t`Factions`,
  }, {
    [CHANNEL_TYPES.PUBLIC]: IoMdChatbubbles,
    [CHANNEL_TYPES.DM]: MdPerson,
    [CHANNEL_TYPES.GROUP]: MdGroups,
    [CHANNEL_TYPES.FACTION]: PiAxeFill,
  }], []);

  const [, channelThumb] = getUrlsFromMediaIdAndName(channelAvatarId, 'avatar');

  let buttonClassName = 'channeldd-button';
  if (dropDownState !== 3) {
    buttonClassName += ' selected';
  }
  if (unreadCategories.length) {
    buttonClassName += ' unread';
  }

  useEffect(() => {
    if (dropDownState === 0) {
      requestAnimationFrame(() => {
        setDropDownState(1);
      });
    }
  }, [dropDownState]);

  /* eslint-disable max-len */
  return (
    <div
      ref={wrapperRef}
      style={{ position: 'relative' }}
    >
      <button
        key="expbtn"
        type="button"
        tabIndex={-1}
        onClick={() => {
          if (dropDownState < 2) {
            setDropDownState(2);
          } else if (dropDownState > 1) {
            setDropDownState(0);
          }
        }}
        className={buttonClassName}
        style={(channelThumb) ? {
          backgroundImage: `url(${cdn`${channelThumb}`})`,
        } : undefined}
      >
        {!channelThumb && channelName}
      </button>
      {(dropDownState !== 3)
        && (
          <div
            key="dropdown"
            className="channeldd"
            style={{
              opacity: dropDownState === 1 ? 1 : 0,
              transition: 'opacity 100ms ease-in-out',
            }}
            onTransitionEnd={dropDownState !== 2 ? undefined
              : () => setDropDownState(3)}
          >
            {Object.values(CHANNEL_TYPES).map((type) => channels[type]?.length > 0 && (
              <Fragment key={type}>
                <div
                  className={`channeldd-category${(selectedType === type) ? ' selected' : ''}${(unreadCategories.includes(type)) ? ' unread' : ''}`}
                  role="button"
                  tabIndex={0}
                  onClick={() => {
                    setSelectedType(selectedType === type ? null : type);
                  }}
                >
                  <span><span>{categorySymbols[type]()}</span> {categoryNames[type]}</span>
                  <span className="expand-btn">{(selectedType === type) ? '▼' : '▶'}</span>
                </div>
                <div className={`channeldd-channellist${(selectedType === type) ? ' expanded' : ''}`}>
                  {(type !== CHANNEL_TYPES.PUBLIC
                    ? channels[type].sort((a, b) => b[2] - a[2])
                    : channels[type]
                  ).map((channelArray) => {
                    const isUnread = isChannelUnread(channelArray);
                    const [cid, name] = channelArray;
                    const avatarId = channelArray[5];
                    let className = 'channeldd-channel';
                    if (cid === chatChannel) {
                      className += ' selected';
                    }
                    if (isUnread) {
                      className += ' unread';
                    }
                    return (
                      <div
                        key={cid}
                        className={className}
                        onClick={() => { setChatChannel(cid); }}
                      >
                        <ChannelAvatar
                          cid={cid}
                          isDarkMode={isDarkMode}
                          avatarId={avatarId}
                          type={type}
                        />
                        <span className="channeldd-name">{name}</span>
                      </div>
                    );
                  })}
                </div>
              </Fragment>
            ))}
          </div>
        )}
    </div>
  );
};

export default memo(ChannelDropDown);
