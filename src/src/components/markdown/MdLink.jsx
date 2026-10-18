/*
 * Renders a markdown link
 * Also provides previews
 * Links are assumed to start with protocol (http:// etc.)
 */
import { useContext, useMemo } from 'preact/hooks';
import { memo } from 'preact/compat';
import HiArrowsExpand from '../../icons/HiArrowsExpand.svg';
import HiStop from '../../icons/HiStop.svg';
import HiWindow from '../../icons/HiWindow.svg';
import { t } from 'ttag';

import { getLinkDesc } from '../../core/utils.js';
import EMBEDS from '../embeds/index.js';
import EmbedContext from '../context/embed.js';
import { isPopUp } from '../windows/popUpAvailable.js';
import useLink from '../hooks/link.js';
import { cdn, u } from '../../utils/utag.js';

const titleAllowed = [
  'odysee',
  'twitter',
  'matrix.gs-os',
  'youtube',
  'youtu.be',
  'bitchute',
  'tiktok',
  't.me',
  'play.afreecatv',
  'vod.afreecatv',
  'twitch.tv',
  '/',
];

const MdLink = ({ href, title }) => {
  const {
    isEmbedOpen,
    openEmbed,
    closeEmbed,
  } = useContext(EmbedContext);

  const link = useLink();

  const [desc, uri] = useMemo(() => {
    let newDesc = getLinkDesc(href);
    let newUri = href;
    // make full urls of our own wesbite relative
    if (newDesc === getLinkDesc(window.location.host)) {
      newDesc = '/';
      newUri = href.substring(
        href.indexOf(window.location.host) + window.location.host.length,
      );
    }
    return [newDesc, newUri];
  }, [href]);

  if (!desc || !uri) {
    return null;
  }

  // treat pixelplanet links separately
  if (uri.startsWith('/#')) {
    const coords = uri.substring(1);
    if (isPopUp() && window.opener && !window.opener.closed) {
      return (
        <a href={u`${uri}`} target="main">{title || coords}</a>
      );
    }
    return (
      <a href={u`${uri}`}>{title || coords}</a>
    );
  }

  const embedObj = EMBEDS[desc];
  const embedAvailable = embedObj && embedObj[1](uri);

  let parsedTitle;
  if (title && titleAllowed.includes(desc)) {
    parsedTitle = title;
  } else if (embedAvailable && embedObj[2]) {
    parsedTitle = embedObj[2](uri);
  } else {
    parsedTitle = uri;
  }

  const isOpen = isEmbedOpen(uri);

  return (
    <>
      <a
        href={uri}
        target="_blank"
        rel="noopener noreferrer"
      >
        {parsedTitle}
      </a>
      {(embedAvailable) && (
        <span className="mdlink-buttoncontainer">
          &nbsp;
          {(embedObj[3])
            && (
              <img
                style={{
                  width: '1em',
                  height: '1em',
                  verticalAlign: 'middle',
                }}
                src={cdn`${embedObj[3]}`}
                alt={`${desc}-icon`}
              />
            )}
          <span
            onClick={(evt) => {
              evt.stopPropagation();
              link('PLAYER', {
                reuse: true,
                target: 'blank',
                args: { uri },
              });
            }}
            title={t`Open in PopUp`}
          >
            <HiWindow className="mdlink-button" />
          </span>
          <span
            onClick={() => {
              if (isOpen) {
                closeEmbed(uri);
              } else {
                openEmbed([desc, uri]);
              }
            }}
          >
            {(isOpen)
              ? (
                  <HiStop
                    className="mdlink-redbutton"
                    title={t`Hide Embed`}
                  />
                )
              : (
                  <HiArrowsExpand
                    className="mdlink-button"
                    title={t`Show Embedded`}
                  />
                )}
          </span>
        </span>
      )}
    </>
  );
};

export default memo(MdLink);
