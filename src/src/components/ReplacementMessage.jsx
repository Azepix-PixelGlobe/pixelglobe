/*
 * display a message during specific intervals
 */

import { useSelector } from '../store/react-redux/index.js';
import { t } from 'ttag';

const ReplacementMessage = () => {
  const replacementMessage = useSelector(
    (state) => state.canvas.replacementMessage,
  );

  return (
    <div className="repmsg">
      <div>
        <h1>{t`You are not allowed to play this game right now :(`}</h1>
        <p>{replacementMessage}</p>
      </div>
    </div>
  );
};

export default ReplacementMessage;
