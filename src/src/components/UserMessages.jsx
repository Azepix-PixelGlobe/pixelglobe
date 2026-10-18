/*
 * Messages on top of UserArea
 */
import { useState } from 'preact/hooks';
import { Fragment } from 'preact';
import { memo } from 'preact/compat';
import { useSelector } from '../store/react-redux/index.js';
import { t } from 'ttag';

import { requestResendVerify } from '../store/actions/fetch.js';


const UserMessages = () => {
  const [resentVerify, setResentVerify] = useState(false);
  const [verifyAnswer, setVerifyAnswer] = useState(null);

  const messages = useSelector((state) => state.user.messages);

  if (!messages) {
    return null;
  }

  return (
    <div style={{ paddingLeft: '5%', paddingRight: '5%' }}>
      {messages.includes('not_verified')
        && (
          <p className="usermessages">
            {(verifyAnswer) ? (
              <span style={{ fontWeight: 'bold' }}>{verifyAnswer}</span>
            ) : (
              <Fragment key="umv">
                {
                  // eslint-disable-next-line max-len
                  t`Please verify your mail address or add a new one, otherwise your account could get deleted in the future.`
                }&nbsp;
                <span
                  role="button"
                  tabIndex={-1}
                  className="modallink"
                  onClick={async () => {
                    if (resentVerify) return;
                    setResentVerify(true);
                    const { errors } = await requestResendVerify();
                    const answer = (errors)
                      ? errors[0]
                      : t`A new verification mail is getting sent to you.`;
                    setVerifyAnswer(answer);
                  }}
                >
                  {t`Click here to request a new verification mail.`}
                </span>
              </Fragment>
            )}
          </p>
        )}
      {messages.map((message) => {
        if (message === 'not_verified') return null;
        return <p className="usermessages" key={message}>{message}</p>;
      })}
    </div>
  );
};

export default memo(UserMessages);
