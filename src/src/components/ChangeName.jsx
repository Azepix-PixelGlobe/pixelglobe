/*
 * Change Name Form
 */

import { useState } from 'preact/hooks';
import { memo } from 'preact/compat';
import { t } from 'ttag';
import { useDispatch } from '../store/react-redux/index.js';

import { validateName } from '../utils/validation.js';
import { changeUser } from '../store/actions/thunks.js';

const ChangeName = ({ done }) => {
  const [name, setStName] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [errors, setErrors] = useState([]);

  const dispatch = useDispatch();

  const handleSubmit = async (evt) => {
    evt.preventDefault();
    if (submitting) {
      return;
    }

    const error = validateName(name);
    if (error) {
      setErrors([error]);
      return;
    }

    setSubmitting(true);
    const respErrors = await dispatch(changeUser({ name }));
    setSubmitting(false);
    if (respErrors.length) {
      setErrors(respErrors);
      return;
    }
    done();
  };

  return (
    <div className="inarea">
      <form onSubmit={handleSubmit}>
        {errors.map((error) => (
          <p key={error} className="errormessage">
            <span>{t`Error`}</span>:&nbsp;{error}</p>
        ))}
        <input
          value={name}
          onChange={(evt) => setStName(evt.target.value)}
          type="text"
          placeholder={t`New Name`}
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

export default memo(ChangeName);
