/*
 * Change Username Form
 */

import { useState } from 'preact/hooks';
import { memo } from 'preact/compat';
import { t } from 'ttag';
import { useDispatch } from '../store/react-redux/index.js';

import { validateUsername } from '../utils/validation.js';
import { changeUser } from '../store/actions/thunks.js';

const ChangeUsername = ({ done }) => {
  const [username, setStUsername] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [errors, setErrors] = useState([]);

  const dispatch = useDispatch();

  const handleSubmit = async (evt) => {
    evt.preventDefault();
    if (submitting) {
      return;
    }

    const error = validateUsername(username);
    if (error) {
      setErrors([error]);
      return;
    }

    setSubmitting(true);
    const respErrors = await dispatch(
      changeUser({ username }),
    );
    setSubmitting(false);
    if (respErrors.length) {
      setErrors(respErrors);
      return;
    }
    done();
  };

  return (
    <div
      className="inarea"
      style={{
        backgroundColor: '#dcb822',
        color: 'black',
      }}
    >
      <form onSubmit={handleSubmit}>
        {errors.map((error) => (
          <p key={error} className="errormessage">
            <span>{t`Error`}</span>:&nbsp;{error}</p>
        ))}
        <p>
          <span
            style={{ fontWeight: 'bold' }}
          >{t`YOU CAN ONLY CHOOSE YOUR USERNAME ONCE!`}</span><br />
          {t`Username can only contain the characters: a-z A-z . _ and -`}
        </p>
        <input
          value={username}
          onChange={(evt) => setStUsername(evt.target.value)}
          type="text"
          placeholder={t`New Username`}
        />
        <br />
        <button type="submit">
          {(submitting) ? '...' : t`Save`}
        </button>
        <button type="button" onClick={done}>{t`Done`}</button>
      </form>
    </div>
  );
};

export default memo(ChangeUsername);
