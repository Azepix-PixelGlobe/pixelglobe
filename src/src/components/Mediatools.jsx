/*
 * Admintools
 */



import { useState } from 'preact/hooks';
import { Fragment } from 'preact';
import { memo } from 'preact/compat';
import { useSelector } from '../store/react-redux/index.js';
import { t } from 'ttag';

import { MEDIA_BAN_REASONS, USERLVL } from '../core/constants.js';
import { api } from '../utils/utag.js';

async function submitMediaAcion(
  action, mediaIdOrMbid, reason,
) {
  const data = new FormData();
  data.append('mediaaction', action);
  if (!mediaIdOrMbid) {
    return t`You must enter a mediaId or media BID`;
  }
  data.append('mediaidormbid', mediaIdOrMbid);
  if (action === 'ban') {
    if (!reason) {
      return t`You must enter a reason`;
    }
    data.append('reason', reason);
  }
  const resp = await fetch(api`/api/modtools`, {
    credentials: 'include',
    method: 'POST',
    body: data,
  });
  return resp.text();
}

function ModMediatools() {
  const [mediaAction, setMediaAction] = useState('ban');
  const [mediaIdOrMbid, setMediaIdOrMbid] = useState('');
  const [reason, setReason] = useState('DEGENERACY');
  const [resp, setResp] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const userlvl = useSelector((state) => state.user.userlvl);
  if (userlvl < USERLVL.CHATMOD) {
    return (<div className="content"><h1>{t`Not Allowed`}</h1></div>);
  }

  return (
    <div className="content">
      <form
        onSubmit={async (evt) => {
          evt.preventDefault();
          if (submitting) {
            return;
          }
          const ret = await submitMediaAcion(
            mediaAction, mediaIdOrMbid, reason,
          );
          setSubmitting(false);
          setResp(ret);
        }}
      >
        <h3>{t`Media Actions`}</h3>
        <select
          value={mediaAction}
          onChange={(e) => {
            const sel = e.target;
            setMediaAction(sel.options[sel.selectedIndex].value);
          }}
        >
          {[
            'ban', 'unban',
          ].map((opt) => (
            <option
              key={opt}
              value={opt}
            >
              {opt}
            </option>
          ))}
        </select>

        {(() => {
          switch (mediaAction) {
            case 'ban':
              return (
                <Fragment key="ban">
                  <p>{t`Ban media`}</p>
                  <p>
                    mediaId:&nbsp;
                    <input
                      value={mediaIdOrMbid}
                      style={{
                        display: 'inline-block',
                        width: '100%',
                        maxWidth: '37em',
                      }}
                      type="text"
                      placeholder="xxxxxx:ext"
                      onChange={(evt) => {
                        setMediaIdOrMbid(evt.target.value.trim());
                      }}
                    />
                  </p>
                  {t`Reason`}:&nbsp;
                  <select
                    value={reason}
                    onChange={(e) => {
                      const sel = e.target;
                      setReason(sel.options[sel.selectedIndex].value);
                    }}
                  >
                    {Object.keys(MEDIA_BAN_REASONS).map((opt) => (
                      <option
                        key={opt}
                        value={opt}
                      >
                        {opt}
                      </option>
                    ))}
                  </select>
                </Fragment>
              );
            case 'unban':
              return (
                <Fragment key="unban">
                  <p>{t`Unban media`}</p>
                  <p>
                    Media BID:&nbsp;
                    <input
                      value={mediaIdOrMbid}
                      style={{
                        display: 'inline-block',
                        width: '100%',
                        maxWidth: '37em',
                      }}
                      type="text"
                      placeholder="xxxx-xxxxx-xxxx"
                      onChange={(evt) => {
                        setMediaIdOrMbid(evt.target.value.trim());
                      }}
                    />
                  </p>
                </Fragment>
              );
            default:
              return null;
          }
        })()}
        <p>
          <button type="submit">
            {(submitting) ? '...' : t`Submit`}
          </button>
        </p>
      </form>
      <textarea
        style={{
          width: '100%',
        }}
        rows={(resp) ? resp.split('\n').length : 10}
        value={resp}
        readOnly
      />
    </div>
  );
}

export default memo(ModMediatools);
