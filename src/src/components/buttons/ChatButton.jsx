/**
 *
 */

import { memo } from 'preact/compat';
import {
  useSelector, shallowEqual, useDispatch,
} from '../../store/react-redux/index.js';
import MdForum from '../../icons/MdForum.svg';
import { t } from 'ttag';

import {
  hideAllWindowTypes,
  openChatWindow,
} from '../../store/actions/windows.js';
import { selectChatWindowStatus } from '../../store/selectors/windows.js';

const ChatButton = () => {
  const dispatch = useDispatch();

  /*
   * [ chatOpen: if any chat window or modal is open,
   *   chatHidden: if any chat windows are hidden ]
   */
  const [chatOpen, chatHidden] = useSelector(
    selectChatWindowStatus, shallowEqual,
  );

  return (
    <div
      id="chatbutton"
      className="actionbuttons"
      onClick={() => {
        if (chatOpen) {
          dispatch(hideAllWindowTypes('CHAT', true));
        } else if (chatHidden) {
          dispatch(hideAllWindowTypes('CHAT', false));
        } else {
          dispatch(openChatWindow());
        }
      }}
      role="button"
      title={(chatOpen) ? t`Close Chat` : t`Open Chat`}
      tabIndex={0}
    >
      <MdForum />
    </div>
  );
};

export default memo(ChatButton);
