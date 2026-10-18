/*
 * parse only links from a given markdown
 */

import MString from './MString.js';

export default function parseAttachmentsFromMd(rawText) {
  const text = new MString(rawText);
  const attachments = [];

  let chr = null;
  while (!text.done()) {
    chr = text.getChar();

    if (chr === '\\') {
      /*
       * escape character
       */
      text.moveForward();
    } else if (chr === '$') {
      /*
       * $[y](mediaId)
       * since we do not check for other types of enclosures, nested enclosures
       * might be parsed different than on the client
       */
      text.moveForward();
      if (text.getChar() === '[') {
        const encArr = text.checkIfEnclosure(false, true);
        if (encArr !== null) {
          attachments.push(encArr[1]);
        }
      } else {
        continue;
      }
    }
    text.moveForward();
  }

  return attachments;
}
