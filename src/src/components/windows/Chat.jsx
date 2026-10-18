/**
 *
 */

import {
  useRef,
  useLayoutEffect,
  useState,
  useEffect,
  useCallback,
  useContext,
  useMemo,
} from 'preact/hooks';
import { Fragment } from 'preact';
import { useSelector, useDispatch } from '../../store/react-redux/index.js';
import { t } from 'ttag';

import WindowContext from '../context/window.js';
import MenuContext from '../context/menu.js';
import useLink from '../hooks/link.js';
import useStayScrolled from '../hooks/stayScrolled.js';
import ChatMessage from '../ChatMessage.jsx';
import FileUpload from '../FileUpload.jsx';
import ChannelDropDown from '../ChannelDropDown.jsx';
import TypingRow from '../TypingRow.jsx';
import { useTypingNames, isFrame } from '../../utils/pgChat.js';
import { pingTyping, sendPresence, sendProfileFrame } from '../../utils/pgChat.js';
import { ingestMessage, getSelf } from '../../utils/pgProfile.js';
import { CHANNEL_TYPES } from '../../core/constants.js';
import { escapeMd } from '../../core/utils.js';

import {
  markChannelAsRead, sendChatMessage, refCountChatChannel,
} from '../../store/actions/index.js';
import { receiveChatMessage } from '../../store/actions/socket.js';
import { receiveChatHistory } from '../../store/actions/thunks.js';
import { requestChatMessages } from '../../store/actions/fetch.js';
import { api } from '../../utils/utag.js';
import VoiceCall from '../VoiceCall.jsx';
import GifPicker from '../GifPicker.jsx';
import call, { CALL_KIND, resolveDmPeer } from '../../utils/pgCall.js';
import { gifMarkdown } from '../../utils/pgGif.js';
import { pgT } from '../../utils/pgI18n.js';


const Chat = () => {
  const listRef = useRef();
  const targetRef = useRef();
  const inputRef = useRef();
  const uploadRef = useRef();
  const scrollRef = useRef();
  const waitingForUpload = useRef();
  const historyFetchRef = useRef();

  const [btnSize, setBtnSize] = useState(20);
  const [voiceActive, setVoiceActive] = useState(false);
  const [gifOpen, setGifOpen] = useState(false);
  const [callState, setCallState] = useState(() => call.snapshot().state);

  const dispatch = useDispatch();

  const ownName = useSelector((state) => state.user.name);
  const ownUid = useSelector((state) => state.user.id);
  const chatCompact = useSelector((state) => state.gui.chatCompact);
  const {
    channels, messages, blocked, channelViews,
  } = useSelector((state) => state.chat);

  const { args, setArgs, setTitle } = useContext(WindowContext);
  const { openMenu } = useContext(MenuContext);

  const chatChannel = args.chatChannel || 0;
  const previousChatChannelRef = useRef();

  const setChannel = useCallback((cid) => {
    setArgs({ chatChannel: Number(cid) });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    setVoiceActive(false);
    setGifOpen(false);
  }, [chatChannel]);

  /* arama durumunu düğmelerde göstermek için dinle */
  useEffect(() => call.subscribe((snap) => setCallState(snap.state)), []);

  useEffect(() => {
    const previousChatChannel = previousChatChannelRef.current;
    if (!previousChatChannel && !chatChannel) {
      return;
    }
    previousChatChannelRef.current = chatChannel;
    const cidRefCountAdditions = {};
    if (previousChatChannel) {
      cidRefCountAdditions[previousChatChannel] = -1;
    }
    if (chatChannel) {
      cidRefCountAdditions[chatChannel] = 1;
      dispatch(markChannelAsRead(chatChannel));
    }
    dispatch(refCountChatChannel(cidRefCountAdditions));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chatChannel]);

  useEffect(() => () => {
    if (previousChatChannelRef.current) {
      dispatch(refCountChatChannel({
        [previousChatChannelRef.current]: -1,
      }));
    }
  },
  // eslint-disable-next-line react-hooks/exhaustive-deps
  []);

  const [
    channelName, channelType, channelMuted, channelAvatarId,
  ] = useMemo(() => {
    let retValue;
    const types = Object.keys(channels);
    for (let i = 0; i < types.length; i += 1) {
      const typeChannels = channels[types[i]];
      for (let u = 0; u < typeChannels.length; u += 1) {
        const typeChannel = typeChannels[u];
        if (typeChannel[0] === chatChannel) {
          retValue = [
            typeChannel[1], Number(types[i]), typeChannel[4], typeChannel[5],
          ];
          break;
        }
      }
    }
    if (retValue) {
      return retValue;
    }
    return ['', CHANNEL_TYPES.PUBLIC, true, null];
  }, [chatChannel, channels]);

  const blockedIds = useMemo(() => blocked.map(([id]) => id), [blocked]);

  useEffect(() => {
    if (channelName) {
      setTitle(`${t`Channel`}: ${channelName}`);
    } else {
      /*
       * set channel if not exists
       */
      let replacementChannel = channels[CHANNEL_TYPES.PUBLIC]?.[0];
      if (!replacementChannel) {
        replacementChannel = channels[CHANNEL_TYPES.FACTION]?.[0];
      }
      if (replacementChannel) {
        setChannel(replacementChannel[0]);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channelName, channels[CHANNEL_TYPES.PUBLIC]?.length]);

  const link = useLink();

  const printWarnings = useCallback((warnings) => {
    warnings.forEach((warning) => {
      dispatch(receiveChatMessage(
        // eslint-disable-next-line max-len
        chatChannel, false, 'info', warning, 'xx', 0, Math.floor(Date.now() / 1000), 0, false, null, [],
      ));
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chatChannel]);

  /* özel sohbet mi? (yüz yüze arama yalnızca DM'de olur) */
  const isDm = channelType === CHANNEL_TYPES.DM;
  const callActive = callState !== 'idle' && callState !== 'ended';

  /* DM'deki karşı tarafı ara: sesli ya da görüntülü */
  const startPrivateCall = useCallback(async (video) => {
    if (!chatChannel) return;
    const peer = await resolveDmPeer(chatChannel);
    if (!peer || !peer.canCall) {
      printWarnings([peer ? pgT('call.noPartner') : pgT('call.noPartner')]);
      return;
    }
    call.startCall({
      channelId: chatChannel,
      peer: { uid: peer.uid, name: peer.name || channelName },
      video,
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chatChannel, channelName]);

  /* seçilen GIF'i sohbete gönder (kart olarak görünür) */
  const sendGif = useCallback((url) => {
    const text = gifMarkdown(url);
    if (!text) return;
    dispatch(sendChatMessage(text, chatChannel));
    setGifOpen(false);
  }, [chatChannel, dispatch]);

  const addToInput = useCallback((msg) => {
    const inputElem = inputRef.current;
    if (!inputElem) {
      return;
    }
    let newInputMessage = inputElem.value;
    if (newInputMessage.slice(-1) !== ' ') {
      newInputMessage += ' ';
    }
    newInputMessage += `${msg} `;
    inputElem.value = newInputMessage;
    inputRef.current.focus();
  }, []);

  const openUserCm = useCallback((x, y, userName, uid) => {
    openMenu(
      'USER', x, y, { name: userName, uid, setChannel, addToInput },
    );
  }, [setChannel, addToInput, openMenu]);

  const { stayScrolled } = useStayScrolled(listRef, {
    initialScroll: Infinity,
    inaccuracy: 20,
  });

  const channelMessages = messages[chatChannel];

  /* PixelGlobe: "⁣" frames carry typing / presence / profile data */
  const typingNames = useTypingNames(channelMessages, ownName);

  useEffect(() => {
    if (!channelMessages?.length) return;
    channelMessages.forEach((message) => {
      if (!message) return;
      ingestMessage(message[0], message[1], message[4]);
    });
  }, [channelMessages]);

  /* announce ourselves when the channel changes so profiles/presence update */
  useEffect(() => {
    if (!ownName || !chatChannel) return;
    sendPresence(dispatch, sendChatMessage, chatChannel, ownName, ownUid);
    const self = getSelf();
    if (self && (self.status || self.bio || self.emoji)) {
      sendProfileFrame(dispatch, sendChatMessage, chatChannel, ownName, ownUid, self);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chatChannel, ownName]);

  useEffect(() => {
    if (!channelMessages?.length) return undefined;
    const uids = [...new Set(channelMessages.map((message) => message[3]).filter(Boolean))];
    if (!uids.length) return undefined;
    let cancelled = false;
    fetch(api`/api/market/styles?uids=${uids.slice(0, 80).join(',')}`, {
      credentials: 'include',
    })
      .then((response) => response.json())
      .then((data) => {
        if (cancelled) return;
        if (data.styles) {
          window.__pgNameStyles = { ...(window.__pgNameStyles || {}), ...data.styles };
          window.dispatchEvent(new CustomEvent('pg-namestyle'));
        }
        /* hareketli avatar çerçeveleri: aynı uçtan gelir, herkese görünür */
        if (data.frames) {
          window.__pgFrameStyles = { ...(window.__pgFrameStyles || {}), ...data.frames };
          window.dispatchEvent(new CustomEvent('pg-framestyle'));
        }
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [channelMessages]);

  useEffect(() => {
    if (messages[chatChannel] || !channelViews[chatChannel] || !channelName) {
      return;
    }

    if (historyFetchRef.current) {
      const { controller, cid } = historyFetchRef.current;
      if (cid === chatChannel) {
        return;
      }
      if (!controller.signal.aborted) {
        controller.abort();
      }
    }

    const fetchHistory = async () => {
      const controller = new AbortController();
      historyFetchRef.current = { controller, cid: chatChannel };
      const history = await requestChatMessages(chatChannel, controller);
      if (history) {
        dispatch(receiveChatHistory(chatChannel, history));
        historyFetchRef.current = null;
      } else if (!controller.signal.aborted) {
        setTimeout(fetchHistory, 5000);
      }
    };
    fetchHistory();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chatChannel, messages, channelName, channelViews]);

  useEffect(() => () => {
    // cancel history fetches
    if (historyFetchRef.current) {
      const { controller } = historyFetchRef.current;
      if (!controller.signal.aborted) {
        controller.abort();
      }
    }
  }, []);

  useLayoutEffect(() => {
    stayScrolled();
  }, [channelMessages, stayScrolled]);

  useEffect(() => {
    scrollRef.current = stayScrolled;
  }, [stayScrolled]);

  useEffect(() => {
    setTimeout(() => {
      const fontSize = Math.round(targetRef.current.offsetHeight / 10);
      setBtnSize(Math.min(28, fontSize));
    }, 330);
  }, [targetRef]);

  async function handleSubmit(evt) {
    evt.preventDefault();
    if (waitingForUpload.current) {
      return;
    }
    waitingForUpload.current = true;

    try {
      let inptMsg = inputRef.current.value.trim();
      // if there are files to upload, do that and add links to them
      const files = await uploadRef.current?.();
      if (files.length) {
        const attachments = files.map(

          (i) => `$[${escapeMd(i.name)}](${i.shortId}:${i.extension})`,
        ).join(' ');
        if (attachments) {
          inptMsg = `${inptMsg} ${attachments}`;
        }
      }
      if (!inptMsg) {
        return;
      }
      // send message via websocket
      dispatch(sendChatMessage(inptMsg, chatChannel));
      inputRef.current.value = '';
    } finally {
      waitingForUpload.current = false;
    }
  }

  return (
    <div
      ref={targetRef}
      className="chat-container"
    >
      <ul
        className="chatarea"
        ref={listRef}
        style={{ flexGrow: 1 }}
        role="presentation"
      >
        {(channelMessages?.length === 0) && (
          <ChatMessage
            key="initm"
            uid={0}
            name="info"
            flag="xx"
            msg={t`Start chatting here`}
          />
        )}
        {
          channelMessages?.map((message) => (
            (!blockedIds.includes(message[3])) && (!isFrame(message[1])) && (
              <ChatMessage
                name={message[0]}
                msg={message[1]}
                flag={message[2]}
                uid={message[3]}
                ts={message[4]}
                msgId={message[5]}
                flagLegit={message[6]}
                avatarId={message[7]}
                attachments={message[8]}
                nameStyle={message[9]}
                key={message[5]}
                openCm={openUserCm}
                scrollRef={scrollRef}
                compact={chatCompact}
              />
            )))
        }
      </ul>
      <GifPicker
        open={gifOpen}
        onClose={() => setGifOpen(false)}
        onPick={sendGif}
      />
      {voiceActive && !isDm && (
        <VoiceCall
          key={`vc-${chatChannel}`}
          channelId={chatChannel}
          onClose={() => setVoiceActive(false)}
        />
      )}
      <TypingRow names={typingNames} />
      <div
        className="chatinput"
        key="iptfl"
        style={{
          display: 'flex',
        }}
      >
        {(ownName) ? (
          <Fragment key="iptfr">
            <input
              key="iptre"
              name="chat-input"
              style={{
                flexGrow: 1,
                minWidth: 40,
              }}
              ref={inputRef}
              onKeyDown={(evt) => {
                if (evt.key === 'Enter') {
                  handleSubmit(evt);
                }
              }}
              autoComplete="off"
              maxLength="200"
              type="text"
              className="chtipt"
              onInput={() => pingTyping(dispatch, sendChatMessage, chatChannel, ownName)}
              placeholder={t`Chat here`}
            />
            <FileUpload
              key="fui"
              maxFiles={3}
              uploadRef={uploadRef}
              printErrors={printWarnings}
            />
            {isDm ? (
              <Fragment key="dmcallbtns">
                <button
                  key="dmvoice"
                  className={`pg-call-chip${callActive ? ' is-on' : ''}`}
                  type="button"
                  title={pgT('call.startVoice')}
                  onClick={() => startPrivateCall(false)}
                >
                  🎙️
                </button>
                <button
                  key="dmvideo"
                  className={`pg-call-chip${callActive ? ' is-on' : ''}`}
                  type="button"
                  title={pgT('call.startVideo')}
                  onClick={() => startPrivateCall(true)}
                >
                  🎥
                </button>
              </Fragment>
            ) : (
              <button
                key="vcbtn"
                type="button"
                title={voiceActive ? t`Sesli Aramadan Çık` : t`Sesli Arama Başlat`}
                style={{
                  flexGrow: 0,
                  width: 28,
                  background: voiceActive ? '#c0392b' : 'transparent',
                  border: 'none',
                  cursor: 'pointer',
                  fontSize: 16,
                  padding: 0,
                }}
                onClick={() => setVoiceActive((v) => !v)}
              >
                🎙️
              </button>
            )}
            <button
              key="gifbtn"
              className={`pg-gif-btn${gifOpen ? ' is-on' : ''}`}
              type="button"
              title={pgT('chat.gif')}
              onClick={() => setGifOpen((v) => !v)}
            >
              GIF
            </button>
            <button
              className="sendbtn"
              style={{ flexGrow: 0, width: 32 }}
              type="button"
              onClick={handleSubmit}
            >
              ‣
            </button>
          </Fragment>
        ) : (
          <div
            className="modallink"
            key="nlipt"
            onClick={(evt) => {
              evt.stopPropagation();
              link('USERAREA', { target: 'parent' });
            }}
            style={{
              textAlign: 'center',
              fontSize: 13,
              flexGrow: 1,
            }}
            role="button"
            tabIndex={0}
          >
            {t`You must be logged in to chat`}
          </div>
        )}
        <ChannelDropDown
          key="cdd"
          setChatChannel={setChannel}
          chatChannel={chatChannel}
          channelName={channelName}
          channelType={channelType}
          channelAvatarId={channelAvatarId}
        />
      </div>
      <div
        className="chatlink"
        style={{
          fontSize: btnSize,
        }}
      >
        <span
          onClick={(evt) => {
            openMenu(
              'CHANNEL', evt.clientX, evt.clientY, {
                cid: chatChannel, type: channelType, muted: channelMuted,
              }, 'tr',
            );
          }}
          role="button"
          title={t`Channel settings`}
          tabIndex={-1}
        >⚙</span>
      </div>
    </div>
  );
};

export default Chat;
