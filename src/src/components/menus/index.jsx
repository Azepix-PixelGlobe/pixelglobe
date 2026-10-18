import { useState, useCallback, useMemo } from 'preact/hooks';

import MenuContext from '../context/menu.js';
import Menu from './Menu.jsx';

const ContextMenuProvider = ({ children }) => {
  const [menuState, setMenuState] = useState(null);

  const contextData = useMemo(() => ({
    openMenu: (type, x, y, args, align, id) => {
      setMenuState({
        active: true, type, x, y, args, align, id,
      });
    },
    openMenuId: menuState?.id,
  }), [menuState?.id]);

  const remove = useCallback(() => {
    setMenuState((state) => {
      if (state?.active) {
        return { ...state, active: false };
      }
      return state;
    });
  }, []);

  const close = useCallback(() => {
    setMenuState(null);
  }, []);

  return (
    <MenuContext.Provider value={contextData}>
      {children}
      {(menuState) && (
        <Menu
          type={menuState.type}
          x={menuState.x}
          y={menuState.y}
          args={menuState.args}
          align={menuState.align}
          isOpen={menuState.active}
          remove={remove}
          close={close}
        />
      )}
    </MenuContext.Provider>
  );
};

export default ContextMenuProvider;
