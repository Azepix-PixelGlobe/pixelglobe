/*
 * context for window to provide window-specific
 * state (args) and set stuff
 */
import { createContext } from 'preact';

const WindowContext = createContext();
/*
 * args are stored in state and they can be given by URI path
 * params are given by window.ssv.params on popup pages, they can be used to
 *   resolve some data server side and spare a request on the client, a window
 *   shall usually be able to work without them
 *
 * {
 *   args: object,
 *   setArgs: function,
 *   setTitle: function,
 *   changeType: function,
 *   params: object,
 * }
 */

export default WindowContext;
