/*
 *
 */

import { memo } from 'preact/compat';
import { useSelector } from '../store/react-redux/index.js';
import { cdn } from '../utils/utag.js';

function Style() {
  const style = useSelector((state) => state.gui.style);

  if (!window.ssv.availableStyles) {
    return null;
  }

  const cssUri = window.ssv.availableStyles[style];

  return (style === 'default' || !cssUri) ? null
    : (<link rel="stylesheet" type="text/css" href={cdn`${cssUri}`} />);
}

export default memo(Style);
