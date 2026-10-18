/*
 * Menu Button on top left
 */
import { useContext } from 'preact/hooks';

import MdExpandMore from '../../icons/MdExpandMore.svg';
import MdExpandLess from '../../icons/MdExpandLess.svg';
import MenuContext from '../context/menu.js';

const MenuButton = () => {
  const { openMenuId, openMenu } = useContext(MenuContext);
  const isOpen = openMenuId === 'mm';

  return (
    <div
      id="menubutton"
      className={`actionbuttons${isOpen ? ' pressed' : ''}`}
      role="button"
      tabIndex={0}
      onClick={(evt) => {
        if (!isOpen) {
          const rect = evt.currentTarget.getBoundingClientRect();
          const x = rect.left + window.scrollX;
          const y = rect.bottom + window.scrollY + 3;
          openMenu(
            'MAIN', x, y, {}, 'tl', 'mm',
          );
        }
      }}
    >
      {(isOpen) ? <MdExpandLess /> : <MdExpandMore /> }
    </div>
  );
};

export default MenuButton;
