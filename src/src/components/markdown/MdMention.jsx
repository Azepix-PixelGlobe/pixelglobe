/*
 * Parse Mention of Username
 */
import { memo } from 'preact/compat';
import { useSelector } from '../../store/react-redux/index.js';

import { colorFromText, setBrightness } from '../../core/utils.js';
import { selectIsDarkMode } from '../../store/selectors/gui.js';

const MdMention = ({ name, uid }) => {
  const id = uid && uid.trim();

  const isDarkMode = useSelector(selectIsDarkMode);
  const ownId = useSelector((state) => state.user.id);

  return (
    <span
      className={
        // eslint-disable-next-line eqeqeq
        (id == ownId) ? 'ping' : 'mention'
      }
      style={{
        color: setBrightness(colorFromText(name), isDarkMode),
      }}
    >{`@${name}`}</span>
  );
};

export default memo(MdMention);
