import { useDispatch } from '../store/react-redux/index.js';
import FaLink from '../icons/FaLink.svg';
import { t } from 'ttag';

import copyTextToClipboard from '../utils/clipboard.js';
import { notify } from '../store/actions/thunks.js';

const ClipboardCopyField = ({ text, hideField, maxWidth = '10em' }) => {
  const dispatch = useDispatch();

  if (hideField) {
    return (
      <button
        type="button"
        title={t`Copy Link`}
        onClick={() => {
          copyTextToClipboard(text);
          dispatch(notify(t`Copied`));
        }}
      ><FaLink /></button>
    );
  }

  return (
    <>
      <input
        style={{
          display: 'inline-block',
          width: '100%',
          maxWidth,
        }}
        readOnly
        value={text}
      />
      <button
        type="button"
        onClick={() => {
          copyTextToClipboard(text);
          dispatch(notify(t`Copied`));
        }}
      >{t`Copy`}</button>
    </>
  );
};

export default ClipboardCopyField;
