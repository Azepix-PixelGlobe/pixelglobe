/*
 * Renders Markdown that got parsed by core/MarkdownParser
 */
import { memo } from 'preact/compat';

import MdParagraph from './MdParagraph.jsx';
import { parse } from '../../utils/markdown/MarkdownParser.js';

/**
 * parse a markdown article, an article can have multiple paragraphs
 * either text or mdArray should be given, not both
 * @param {
 *   text: markdown text
 *   mdArray: parsed markdown array
 *   refEmbed: a reference to the element where we can attach an embed to
 * }
 */
const Markdown = ({ text, mdArray, attachmentInfo, parseLinks = false }) => {
  if (!mdArray) {
    if (!text) {
      return null;
    }
    mdArray = parse(text, { parseLinks });
  }

  const markdown = mdArray.map((part) => {
    const type = part[0];
    switch (type) {
      /* Heading */
      case 'a': {
        const level = Number(part[1]);
        const heading = part[2];
        const children = part[3];
        let headingElem = [];
        switch (level) {
          case 1:
            headingElem = <h1>{heading}</h1>;
            break;
          case 2:
            headingElem = <h2>{heading}</h2>;
            break;
          case 3:
            headingElem = <h3>{heading}</h3>;
            break;
          default:
            headingElem = <h4>{heading}</h4>;
        }
        return (
          <section>
            {headingElem}
            <Markdown mdArray={children} />
          </section>
        );
      }
      /* Paragraph */
      case 'p': {
        return (
          <MdParagraph
            pArray={part[1]}
            pAttachments={part[2]}
            attachmentInfo={attachmentInfo}
          />
        );
      }
      /* Code Block */
      case 'cb': {
        const content = part[1];
        return <pre>{content}</pre>;
      }
      case '>':
      case '<': {
        const children = part[1];
        return (
          <blockquote
            className={(type === '>') ? 'gt' : 'rt'}
          >
            <Markdown mdArray={children} attachmentInfo={attachmentInfo} />
          </blockquote>
        );
      }
      case 'ul': {
        const children = part[1];
        return (
          <ul>
            <Markdown mdArray={children} attachmentInfo={attachmentInfo} />
          </ul>
        );
      }
      case 'ol': {
        const children = part[1];
        return (
          <ol>
            <Markdown mdArray={children} attachmentInfo={attachmentInfo} />
          </ol>
        );
      }
      case '-': {
        const children = part[1];
        return (
          <li>
            <Markdown mdArray={children} attachmentInfo={attachmentInfo} />
          </li>
        );
      }
      default:
        return part[0];
    }
  });

  return (
    <article>
      {markdown}
    </article>
  );
};

export default memo(Markdown);
