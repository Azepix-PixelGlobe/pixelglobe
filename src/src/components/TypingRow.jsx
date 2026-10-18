/**
 * TypingRow — "Azepix mesaj yazıyor..." line shown above the chat input.
 * Names come from the invisible typing frames decoded in the Chat window.
 */

import { memo } from 'preact/compat';
import { pgT } from '../utils/pgI18n.js';

const TypingRow = ({ names }) => {
  if (!names || !names.length) return null;

  let label;
  if (names.length === 1) {
    label = pgT('typing.one', { name: names[0] });
  } else if (names.length === 2) {
    label = pgT('typing.two', { a: names[0], b: names[1] });
  } else {
    label = pgT('typing.many', { n: names.length });
  }

  return (
    <div className="pg-typing" role="status" aria-live="polite">
      <span className="pg-typing-dots" aria-hidden="true">
        <i />
        <i />
        <i />
      </span>
      <span className="pg-typing-text">{label}</span>
    </div>
  );
};

export default memo(TypingRow);
