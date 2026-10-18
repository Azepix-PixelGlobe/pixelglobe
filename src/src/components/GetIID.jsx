/*
 * show IID
 */

import { useState } from 'preact/hooks';
import { useDispatch } from '../store/react-redux/index.js';
import { t } from 'ttag';

import { notify } from '../store/actions/thunks.js';
import copyTextToClipboard from '../utils/clipboard.js';
import {
  requestIID,
} from '../store/actions/fetch.js';

const GetIID = () => {
  const [iid, setIID] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const dispatch = useDispatch();

  return (
    <p>
      <input
        style={{
          display: 'inline-block',
          width: '100%',
          maxWidth: '18em',
        }}
        readOnly
        value={iid}
      />
      {(!iid)
        ? (
            <button
              key="subtn"
              type="button"
              onClick={async () => {
                setSubmitting(true);
                const resp = await requestIID();
                if (resp.iid) {
                  setIID(resp.iid);
                }
                setSubmitting(false);
              }}
            >{(submitting) ? '...' : t`Get IID`}</button>
          ) : (
            <button
              key="cobtn"
              type="button"
              onClick={() => {
                copyTextToClipboard(iid);
                dispatch(notify(t`Copied`));
              }}
            >{t`Copy`}</button>
          )}
    </p>
  );
};

export default GetIID;
