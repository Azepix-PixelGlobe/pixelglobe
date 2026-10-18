/*
 * display an avatar — YUVARLAK, isteğe bağlı olarak hareketli çerçeveli.
 *
 * Çerçeve (DarkNitro tarzı kozmetik) avatarın içine eklenen tek bir
 * `.avatar-frame-ring` elemanıyla çizilir; animasyonlar
 * `styles/pixelglobe-frames.css` içindedir. Böylece eski yerleşim bozulmaz:
 * `.avatar` yine aynı kutu, sadece üstünde dönen halkalar var.
 */
import { useEffect, useState } from 'preact/hooks';

import { getColorFromId, getCharFromId } from '../core/utils.js';
import { cdn } from '../utils/utag.js';
import useLink from './hooks/link.js';
import { getUrlsFromMediaIdAndName } from '../utils/media/utils.js';
import {
  frameClassName, normalizeFrame, resolveFrame, subscribeFrames,
} from '../utils/pgFrames.js';

const Avatar = ({
  uid,
  isDarkMode,
  avatarId,
  frameEffect = null,
}) => {
  const link = useLink();
  const [, setVersion] = useState(0);

  /* çerçeve canlı haritası değişince yeniden çiz */
  useEffect(() => subscribeFrames(() => setVersion((version) => version + 1)), []);

  const avatarStyle = {
    backgroundColor: getColorFromId(uid, isDarkMode),
    color: (isDarkMode) ? '#636363' : '#a7a5a5',
  };
  const [image, thumb] = getUrlsFromMediaIdAndName(avatarId, 'avatar');
  if (thumb) {
    avatarStyle.backgroundImage = `url(${cdn`${thumb}`})`;
  }

  /*
   * Verilen ipucu yoksa canlı haritaya (sunucu gerçeği) bakılır; uid kendi
   * uid'imizse kendi kayıtlı çerçevemiz kullanılır. Efekt yoksa sınıf eklenmez,
   * yani eski görünüm aynen kalır.
   */
  const frame = normalizeFrame(frameEffect) || resolveFrame(uid);
  const frameClass = frameClassName(frame);

  return (
    <div
      className={`avatar${frameClass ? ` ${frameClass}` : ''}`}
      style={avatarStyle}
      data-frame={frame || undefined}
      onClick={(image) ? (evt) => {
        evt.stopPropagation();
        if (image) {
          link('PLAYER', {
            reuse: true,
            target: 'blank',
            args: { uri: image },
          });
        }
      } : undefined}
    >
      {frameClass ? <i className="avatar-frame-ring" aria-hidden="true" /> : null}
      {!avatarId && getCharFromId(uid)}
    </div>
  );
};

export default Avatar;
