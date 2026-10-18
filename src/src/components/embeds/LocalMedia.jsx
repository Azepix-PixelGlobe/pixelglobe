/*
 * Renders a markdown image embed from our own media storage
 */
/* eslint-disable jsx-a11y/media-has-caption */

import { useState, useMemo, useContext, useCallback } from 'preact/hooks';
import { Fragment } from 'preact';
import { useSelector } from '../../store/react-redux/index.js';
import { t } from 'ttag';
import MdFileDownload from '../../icons/MdFileDownload.svg';
import HiStop from '../../icons/HiStop.svg';
import HiWindow from '../../icons/HiWindow.svg';
import LuFileVideo2 from '../../icons/LuFileVideo2.svg';

import useLink from '../hooks/link.js';
import { cdn } from '../../utils/utag.js';
import { splitUrl } from '../../core/utils.js';
import MenuContext from '../context/menu.js';
import {
  getMediaDetailsFromUrl,
  getUrlsFromMediaIdAndName,
} from '../../utils/media/utils.js';
import {
  VIDEO_EXTENSIONS, IMAGE_EXTENSIONS, USERLVL,
} from '../../core/constants.js';

const LocalMedia = ({
  url, fill, width, height, scrollRef, avgColor, compact,
  title: gTitle, type: gType, mediaId: gMediaId,
}) => {
  const [expanded, setExpanded] = useState(false);
  const [imageLoaded, setImageLoaded] = useState(false);

  const link = useLink();
  const userlvl = useSelector((state) => state.user.userlvl);
  const { openMenu } = useContext(MenuContext);

  const [
    mediaId, fullUrl, thumbUrl, iconUrl, title, type, backgroundColor,
  ] = useMemo(() => {
    let oMediaId = gMediaId;
    let oTitle = gTitle;
    let oType = gType;

    if (url) {
      [oMediaId, oTitle] = getMediaDetailsFromUrl(url);
    }
    const oExtension = oMediaId?.substring(oMediaId.indexOf(':') + 1);

    if (!oType) {
      if (IMAGE_EXTENSIONS.includes(oExtension)) {
        oType = 'image';
      } else if (VIDEO_EXTENSIONS.includes(oExtension)) {
        oType = 'video';
      }
    }

    return [
      oMediaId,
      ...getUrlsFromMediaIdAndName(oMediaId, oTitle),
      oTitle, oType,
      avgColor && `#${avgColor.toString(16).padStart(6, '0')}`,
    ];
  }, [url, gTitle, gType, gMediaId, avgColor]);

  const toggleExpand = useCallback((evt) => {
    evt?.stopPropagation();
    if (!fill) {
      console.log('toggle expand');
      setExpanded((oldExpanded) => !oldExpanded);
      if (scrollRef?.current) {
        requestAnimationFrame(() => {
          scrollRef?.current?.();
        });
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!fullUrl || !type) {
    return null;
  }

  if (compact && iconUrl && !expanded && !fill) {
    return (
      <div
        className="attcontainer icon"
        onClick={toggleExpand}
      >
        <img
          alt={title}
          src={cdn`${iconUrl}`}
          loading="lazy"
          className="icon"
        />
        {type === 'video' && (
          <div className="attplaybutton icon">
            <LuFileVideo2 />
          </div>
        )}
      </div>
    );
  }

  let thumbWidth = width;
  if (width && height) {
    if (width > 200 || height > 150) {
      const ratio = Math.min(200 / width, 150 / height);
      thumbWidth = Math.round(width * ratio);
    }
  }

  let containerClass;
  const containerStyle = {};
  const attachmentStyle = {};
  if (fill) {
    containerClass = 'fill';
    containerStyle.width = '100%';
    containerStyle.height = '100%';
    if (type === 'video') {
      attachmentStyle.width = '100%';
      attachmentStyle.height = '100%';
    } else {
      attachmentStyle.maxWidth = '100%';
      attachmentStyle.maxHeight = '100%';
    }
  } else {
    if (expanded) {
      containerClass = 'expanded';
    } else {
      containerClass = 'thumb';
    }

    if (width && height && !compact) {
      /*
      * if dimensions are known, container will occupy the space and image will
      * be 100%
      */
      containerStyle.aspectRatio = `${width} / ${height}`;
      containerStyle.width = '100%';
      containerStyle.maxHeight = '100%';
      attachmentStyle.width = '100%';
      attachmentStyle.height = '100%';

      if (expanded) {
        containerStyle.maxWidth = width;
      } else {
        containerStyle.maxWidth = thumbWidth;
      }
    } else {
      attachmentStyle.maxWidth = '100%';
      attachmentStyle.maxHeight = '100%';
    }
  }

  const onLoad = () => setImageLoaded(true);
  if (backgroundColor && !imageLoaded) {
    containerStyle.backgroundColor = backgroundColor;
  }

  containerClass += ' attcontainer';

  if (thumbUrl && !expanded && !fill) {
    return (
      <div
        className={containerClass}
        style={containerStyle}
        onClick={toggleExpand}
      >
        <img
          alt={title}
          src={cdn`${thumbUrl}`}
          loading="lazy"
          className="attachment"
          style={attachmentStyle}
          onLoad={onLoad}
        />
        {type === 'video' && (
          <div className="attplaybutton">
            <LuFileVideo2 />
          </div>
        )}
      </div>
    );
  }

  const isMod = userlvl >= USERLVL.CHATMOD;

  return (
    <div
      className={containerClass}
      style={containerStyle}
      onClick={toggleExpand}
    >
      {(() => {
        switch (type) {
          case 'image':
            return (
              <img
                alt={title}
                src={cdn`${fullUrl}`}
                className="attachment"
                style={attachmentStyle}
                referrerPolicy="no-referrer"
                onLoad={onLoad}
              />
            );
          case 'video':
            return (
              <video
                src={cdn`${fullUrl}`}
                className="attachment"
                style={attachmentStyle}
                onLoadedData={onLoad}
                controls
                autoPlay
                onClick={(e) => e.stopPropagation()}
              />
            );
          default:
            return null;
        }
      })()}
      <span className="att-buttoncontainer">
        {(isMod) && (
          <span
            onClick={(evt) => {
              evt.stopPropagation();
              openMenu(
                'BANMEDIA', evt.clientX, evt.clientY, { mediaId }, 'tr',
              );
            }}
            className="att-button"
            title={t`Ban media`}
            key="emebb"
          >🔨</span>
        )}
        <a
          href={cdn`${fullUrl}`}
          target="_blank"
          className="att-button"
          title={t`Download`}
          rel="noreferrer"
        >
          <MdFileDownload />
        </a>
        {(!fill) && (
          <Fragment key="fillbtn">
            <span
              onClick={(evt) => {
                evt.stopPropagation();
                link('PLAYER', {
                  reuse: true,
                  target: 'blank',
                  args: { uri: fullUrl },
                });
                if (type === 'video') {
                  toggleExpand();
                }
              }}
              className="att-button"
              title={t`Open in PopUp`}
              key="emebp"
            >
              <HiWindow />
            </span>
            <span
              onClick={toggleExpand}
              className="att-redbutton"
              title={t`Shrink`}
              key="embr"
            >
              <HiStop />
            </span>
          </Fragment>
        )}
      </span>
    </div>
  );
};

export default [
  LocalMedia,
  (url) => {
    const [path, ext] = splitUrl(url);
    if (!ext || !path.startsWith('/m/') || path[4] === '/') {
      return false;
    }
    return (VIDEO_EXTENSIONS.includes(ext) || IMAGE_EXTENSIONS.includes(ext));
  },
  null,
  '/embico/direct.png',
];
