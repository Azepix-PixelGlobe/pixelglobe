/*
 * context for context menus
 */
import { createContext } from 'preact';

const MenuContext = createContext();
/*
 * {
 *   openMenuId,
 *   openMenu(type, x, y, align, args, id),
 * }
 */

export default MenuContext;
