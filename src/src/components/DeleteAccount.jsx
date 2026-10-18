/*
 * Change Password Form
 */

import { useState } from 'preact/hooks';
import { Fragment } from 'preact';
import { useSelector, useDispatch } from '../store/react-redux/index.js';
import { t } from 'ttag';

import { validatePassword } from '../utils/validation.js';
import { requestDeleteAccount } from '../store/actions/fetch.js';
import { logoutUser } from '../store/actions/index.js';

const DeleteAccount = ({ done }) => {
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [errors, setErrors] = useState([]);

  const havePassword = useSelector((state) => state.user.havePassword);
  const dispatch = useDispatch();

  const handleSubmit = async (evt) => {
    evt.preventDefault();
    if (submitting) {
      return;
    }
    if (!confirm) {
      setConfirm(true);
      return;
    }

    if (havePassword) {
      const validationError = validatePassword(password);
      if (validationError) {
        setErrors([validationError]);
        return;
      }
    }

    setSubmitting(true);
    const { errors: respErrors } = await requestDeleteAccount(password);
    setSubmitting(false);
    if (respErrors) {
      setErrors(respErrors);
      return;
    }
    dispatch(logoutUser());
  };

  return (
    <div className="inarea" style={{ backgroundColor: '#ff6666' }}>
      <form onSubmit={handleSubmit}>
        {errors.map((error) => (
          <p
            key={error}
            className="errormessage"
            style={{ color: '#000' }}
          ><span>{t`Error`}</span>
            :&nbsp;{error}</p>
        ))}
        {(havePassword)
          && (
            <Fragment key="pass">
              <input
                value={password}
                onChange={(evt) => setPassword(evt.target.value)}
                type="password"
                placeholder={t`Password`}
              />
              <br />
            </Fragment>
          )}
        <button
          type="submit"
          disabled={submitting}
          className={confirm ? 'confirm' : undefined}
        >
          {/* t: button for leaving a faction, it asks for confirmation */}
          {(confirm) ? t`Yes, really delete Me` : t`Delete My Account`}
        </button>
        <button type="button" onClick={done}>{t`Cancel`}</button>
      </form>
    </div>
  );
};

export default DeleteAccount;
