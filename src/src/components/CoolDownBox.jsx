/**
 *
 */

import { memo } from 'preact/compat';
import { useSelector } from '../store/react-redux/index.js';

import {
  durationToString,
} from '../core/utils.js';


const CoolDownBox = () => {
  const coolDown = useSelector((state) => state.user.coolDown);

  return (
    <div
      className={(coolDown && coolDown >= 300)
        ? 'cooldownbox show' : 'cooldownbox'}
    >
      {coolDown && durationToString(coolDown, true)}
    </div>
  );
};

export default memo(CoolDownBox);
