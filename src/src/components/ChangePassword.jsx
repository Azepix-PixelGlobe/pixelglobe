/*
 * Change Password Form
 */

import { useState } from 'preact/hooks';
import { Fragment } from 'preact';
import { t } from 'ttag';
import { useSelector, useDispatch } from '../store/react-redux/index.js';

import { setHavePassword } from '../store/actions/index.js';
import { validatePassword } from '../utils/validation.js';
import { requestPasswordChange } from '../store/actions/fetch.js';

function validate(havePassword, password, newPassword, confirmPassword) {
  const errors = [];

  if (havePassword) {
    const oldpasserror = validatePassword(password);
    if (oldpasserror) errors.push(oldpasserror);
  }
  if (newPassword !== confirmPassword) {
    errors.push(t`Passwords do not match.`);
    return errors;
  }
  const passerror = validatePassword(newPassword);
  if (passerror) errors.push(passerror);

  return errors;
}

const ChangePassword = ({ done }) => {
  const [password, setPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [success, setSuccess] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [errors, setErrors] = useState([]);

  const havePassword = useSelector((state) => state.user.havePassword);
  const dispatch = useDispatch();

  if (success) {
    return (
      <div className="inarea">
        <p className="modalmessage">{t`Password successfully changed.`}</p>
        <button type="button" onClick={done}>Close</button>
      </div>
    );
  }

  return (
    <div className="inarea">
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          if (submitting) return;
          const valerrors = validate(
            havePassword,
            password,
            newPassword,
            confirmPassword,
          );
          setErrors(valerrors);
          if (valerrors.length) return;
          setSubmitting(true);
          const { errors: resperrors } = await requestPasswordChange(
            newPassword,
            password,
          );
          if (resperrors) {
            setErrors(resperrors);
            setSubmitting(false);
            return;
          }
          dispatch(setHavePassword(true));
          setSuccess(true);
        }}
      >
        {errors.map((error) => (
          <p key={error} className="errormessage"><span>{t`Error`}</span>
            :&nbsp;{error}</p>
        ))}
        {(havePassword)
          ? (
              <Fragment key="oldpass">
                <input
                  value={password}
                  onChange={(evt) => setPassword(evt.target.value)}
                  type="password"
                  placeholder={t`Old Password`}
                />
                <br />
              </Fragment>
            ) : (
              <p key="passinfo">{
                /* eslint-disable-next-line max-len */
                t`Setting a password allows you to login by username or email, rather than only relying on 3rd party login.`
              }</p>
            )}
        <input
          value={newPassword}
          onChange={(evt) => setNewPassword(evt.target.value)}
          type="password"
          placeholder={(havePassword) ? t`New Password` : t`Password`}
        />
        <br />
        <input
          value={confirmPassword}
          onChange={(evt) => setConfirmPassword(evt.target.value)}
          type="password"
          placeholder={
            (havePassword) ? t`Confirm New Password` : t`Confirm Password`
          }
        />
        <br />
        <button
          type="submit"
        >
          {(submitting) ? '...' : t`Save`}
        </button>
        <button
          type="button"
          onClick={done}
        >
          {t`Cancel`}
        </button>
      </form>
    </div>
  );
};

export default ChangePassword;
