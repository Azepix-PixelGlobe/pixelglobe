import { memo } from 'preact/compat';
import { useEffect, useState } from 'preact/hooks';
import { useSelector } from '../store/react-redux/index.js';

import MdParagraph from './markdown/MdParagraph.jsx';
import Avatar from './Avatar.jsx';
import { resolveFrame, subscribeFrames } from '../utils/pgFrames.js';
import {
  colorFromText, setBrightness, getDateTimeString,
} from '../core/utils.js';
import { selectIsDarkMode } from '../store/selectors/gui.js';
import { getUrlFromMediaIdAndName } from '../utils/media/utils.js';
import { cdn } from '../utils/utag.js';


function ChatMessage({
  name,
  uid,
  flag,
  msg,
  ts,
  flagLegit,
  avatarId,
  attachments,
  nameStyle,
  openCm,
  scrollRef,
  compact,
}) {
  const [, setNameStyleVersion] = useState(0);
  /*
   * Ayrı ayrı seçiciler: her biri ilkel (boolean/sayı/string) döndüğü için
   * gereksiz yeniden çizim olmaz ve dizi döndüren seçicinin tetiklediği
   * "selector returned a different result" uyarısı oluşmaz.
   */
  const isDarkMode = useSelector(selectIsDarkMode);
  const ownUid = useSelector((state) => state.user.id);
  const ownNameEffect = useSelector((state) => state.profile?.activeItems?.nameEffect);
  const ownFrameEffect = useSelector((state) => state.profile?.activeItems?.frameEffect);

  useEffect(() => {
    const updateNameStyle = () => {
      setNameStyleVersion((version) => version + 1);
    };
    window.addEventListener('pg-namestyle', updateNameStyle);
    return () => window.removeEventListener('pg-namestyle', updateNameStyle);
  }, []);

  /*
   * Avatar çerçevesi ayrı bir canlı haritadan gelir (window.__pgFrameStyles):
   * websocket 'fs' paketi ya da sohbet geçmişi doldurur. Bir oyuncu çerçevesini
   * değiştirdiği an bu bileşen yeniden çizilir — yani çerçeveyi HERKES görür.
   */
  useEffect(() => subscribeFrames(() => setNameStyleVersion((version) => version + 1)), []);

  /*
   * The websocket sends the current style to every connected client and the
   * chat history endpoint hydrates the same map after a refresh. Prefer that
   * live map over the message snapshot so deactivating an item immediately
   * removes the RGB name from every already-rendered message.
   */
  const liveNameStyle = typeof window !== 'undefined'
    ? window.__pgNameStyles?.[uid]
    : undefined;
  const effectiveNameStyle = liveNameStyle ?? nameStyle
    ?? (uid === ownUid ? ownNameEffect : 'none');
  const hasRainbowName = effectiveNameStyle === 'rainbow';

  /* çerçeve: canlı harita → kendi efektim (kendi mesajlarım için) */
  const frameEffect = resolveFrame(uid, null)
    || (uid === ownUid ? ownFrameEffect : null);

  const isInfo = (name === 'info');
  const isEvent = (name === 'event');

  let className = 'msg';
  if (isInfo) {
    className += ' info';
  } else if (isEvent) {
    className += ' event';
  } else if (msg.charAt(0) === '>') {
    className += ' greentext';
  } else if (msg.charAt(0) === '<') {
    className += ' redtext';
  }

  let flagClass = 'chatflag';
  if (!flagLegit) {
    flagClass += ' illegit';
  }

  if (isInfo || isEvent) {
    return (
      <li className="chatmsg">
        <div className="msgcontent">
          <MdParagraph text={msg} className={className} />
        </div>
      </li>
    );
  }

  const msgUser = (
    <span
      key="name"
      role="button"
      tabIndex={-1}
      className="msguser"
      style={{
        cursor: 'pointer',
      }}
      onClick={(event) => {
        openCm(event.clientX, event.clientY, name, uid);
      }}
    >
      <img
        className={flagClass}
        alt=""
        title={flag || ''}
        src={((flag || '').length === 2)
          ? cdn`/cf/${flag}.gif`
          : cdn`${getUrlFromMediaIdAndName(flag || '', 'flag')}`}
      />
      <span
        className={`chatname${hasRainbowName ? ' chatname-rainbow' : ''}`}
        style={hasRainbowName ? undefined : {
          color: setBrightness(colorFromText(name), isDarkMode),
        }}
        title={name}
      >
        {name}
      </span>
      {': '}
    </span>
  );

  if (compact) {
    return (
      <li className="chatmsg compact">
        {msgUser}
        <MdParagraph
          text={msg}
          className={className}
          attachmentInfo={attachments}
          scrollRef={scrollRef}
          compact
        />
      </li>
    );
  }

  return (
    <li className="chatmsg full">
      <Avatar
        uid={uid}
        isDarkMode={isDarkMode}
        avatarId={avatarId}
        frameEffect={frameEffect}
      />
      <div className="msgcontent">
        <div className="msgheader">
          {msgUser}
          <span className="chatts">
            {getDateTimeString(ts)}
          </span>
        </div>
        <MdParagraph
          text={msg}
          className={className}
          attachmentInfo={attachments}
          scrollRef={scrollRef}
        />
      </div>
    </li>
  );
}

export default memo(ChatMessage);
