/*
 * context for Embeds to attach to parent elements
 */
import { createContext } from 'preact';

const EmbedContext = createContext();
/*
 * {
 *   isEmbedOpen, // function returning if an embed is open
 *   openEmbed, // function to open an embed args: desc, href
 *   closeEmbed, // function to close an embed args: href
 * }
 */

export default EmbedContext;
