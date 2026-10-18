/*
 * Renders Markdown that got parsed by core/MarkdownParser
 */
import { useState, useMemo, useEffect } from 'preact/hooks';
import { memo } from 'preact/compat';

import MdLink from './MdLink.jsx';
import MdMention from './MdMention.jsx';
import EMBEDS from '../embeds/index.js';
import EmbedContext from '../context/embed.js';
import { parseParagraph } from '../../utils/markdown/MarkdownParser.js';
import { gifEmbedKey, isKlipyGif } from '../../utils/pgGif.js';

/**
 * parse a markdown paragraph,
 * either text or pArray should be given, not both
 * @param {
 *   text: markdown text
 *   pArray: parsed markdown array
 * }
 */
const RecursiveMdParagraph = ({ pArray }) => pArray.map((part) => {
  if (!Array.isArray(part)) {
    return part;
  }
  const type = part[0];
  switch (type) {
    case 'c':
      return (<code>{part[1]}</code>);
    case '*':
      return (
        <strong>
          <RecursiveMdParagraph pArray={part[1]} />
        </strong>
      );
    case '~':
      return (
        <s>
          <RecursiveMdParagraph pArray={part[1]} />
        </s>
      );
    case '+':
      return (
        <em>
          <RecursiveMdParagraph pArray={part[1]} />
        </em>
      );
    case '_':
      return (
        <u>
          <RecursiveMdParagraph pArray={part[1]} />
        </u>
      );
    case 'img':
    case 'l':
      return (
        <MdLink href={part[2]} title={part[1]} />
      );
    case '@':
      return (
        <MdMention uid={part[2]} name={part[1]} />
      );
    default:
      return type;
  }
});

const MdParagraph = ({
  text, attachmentInfo = [], className, scrollRef, compact,
  pArray: gPArray, pAttachments: gPAttachments,
}) => {
  /*
   * [[desc, href], ...]
   */
  const [shownEmbeds, setShownEmbeds] = useState([]);

  const contextData = useMemo(() => ({
    isEmbedOpen: (href) => shownEmbeds.some(
      (embedOpts) => embedOpts[1] === href,
    ),
    openEmbed: (embedOpts) => {
      if (scrollRef?.current) {
        requestAnimationFrame(() => {
          scrollRef?.current?.();
        });
      }
      return setShownEmbeds((cs) => [...cs, embedOpts]);
    },
    closeEmbed: (href) => setShownEmbeds(
      (cs) => cs.filter((embedOpts) => embedOpts[1] !== href),
    ),
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [shownEmbeds]);

  /* KLIPY GIF bağlantıları tıklamadan görünsün (sohbet GIF'leri) */
  useEffect(() => {
    if (shownEmbeds.length) return;
    const gifs = [];
    (pArrayResolved || []).forEach((part) => {
      if (Array.isArray(part) && (part[0] === 'l' || part[0] === 'img') && isKlipyGif(part[2])) {
        gifs.push([gifEmbedKey(part[2]), part[2]]);
      }
    });
    if (gifs.length) setShownEmbeds(gifs);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text]);

  const [pArray, pAttachments] = useMemo(() => {
    if (gPArray) {
      return [gPArray, gPAttachments || []];
    }
    return parseParagraph(text);
  }, [text, gPArray, gPAttachments]);

  const pArrayResolved = useMemo(() => {
    if (gPArray) return gPArray;
    try {
      return parseParagraph(text)[0];
    } catch (error) {
      return [];
    }
  }, [text, gPArray]);

  const Attachment = EMBEDS['/'][0];

  return (
    <EmbedContext.Provider value={contextData}>
      <div className={className || 'md-paragraph'}>
        <RecursiveMdParagraph pArray={pArray} />
        {(shownEmbeds.length > 0 || pAttachments.length > 0) && (
          <div className="att-and-embeds">
            {shownEmbeds.map(([desc, href]) => {
              const Embed = EMBEDS[desc][0];
              return (
                <Embed
                  key={href}
                  url={href}
                  maxHeight={300}
                  scrollRef={scrollRef}
                />
              );
            })}
            {pAttachments.map(([title, mediaId]) => {
              const fileInfo = attachmentInfo.find(([id]) => id === mediaId);
              if (!fileInfo) {
                return null;
              }
              const [, type, , width, height, avgColor] = fileInfo;
              return (
                <Attachment
                  key={mediaId}
                  mediaId={mediaId}
                  title={title}
                  width={width}
                  height={height}
                  avgColor={avgColor}
                  type={type}
                  scrollRef={scrollRef}
                  compact={compact}
                />
              );
            })}
          </div>
        )}
      </div>
    </EmbedContext.Provider>
  );
};

export default memo(MdParagraph);
