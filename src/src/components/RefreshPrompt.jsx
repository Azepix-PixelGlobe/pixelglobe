import { memo } from 'preact/compat';
import { t } from 'ttag';

const RefreshPrompt = ({ close }) => (
  <>
    <button
      type="button"
      style={{
        fontWeight: 'bold',
        animation: 'glowing 1300ms infinite',
      }}
      onClick={() => window.location.reload()}
    >
      {t`Refresh`}
    </button>&nbsp;
    <button type="submit" onClick={close}>{t`Cancel`}</button>
  </>
);

export default memo(RefreshPrompt);
