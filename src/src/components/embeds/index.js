/*
 * Embeds for external content like youtube, etc.
 * Usage for Markdown is in ../MdLink.js
 *
 */
import TikTok from './TikTok.jsx';
import Telegram from './Telegram.jsx';
import Twitter from './Twitter.jsx';
import YouTube from './YouTube.jsx';
import Matrix from './Matrix.jsx';
import Odysee from './Odysee.jsx';
import BitChute from './BitChute.jsx';
import AfreecaTv from './AfreecaTv.jsx';
import TwitchTv from './TwitchTv.jsx';
import DirectLinkMedia from './DirectLinkMedia.jsx';
import LocalMedia from './LocalMedia.jsx';

/*
 * key is the domain (with .com and www. stripped)
 * value is an Array with
 *  [
 *    ReactElement: takes url as prop,
 *    isEmbedAvailable: function that takes url as argument and returns boolean
 *                      whether embed is available for this url of this domain
 *    title: function that returns the title for a link, gets url as argument
 *    icon: link to icon
 *  ]
 */
export default {
  tiktok: TikTok,
  youtube: YouTube,
  'youtu.be': YouTube,
  bitchute: BitChute,
  'matrix.gs-os': Matrix,
  'i.4cdn.org': DirectLinkMedia,
  'i.imgur': DirectLinkMedia,
  'litter.catbox.moe': DirectLinkMedia,
  'files.catbox.moe': DirectLinkMedia,
  'i.redd.it': DirectLinkMedia,
  'media.discordapp.net': DirectLinkMedia,
  'media.consumeproduct.win': DirectLinkMedia,
  'cdn.discord.com': DirectLinkMedia,
  't.me': Telegram,
  twitter: Twitter,
  x: Twitter,
  odysee: Odysee,
  'vod.afreecatv': AfreecaTv,
  'play.afreecatv': AfreecaTv,
  'twitch.tv': TwitchTv,
  '/': LocalMedia,
  /* KLIPY GIF'leri (sohbet GIF arayıcısı) doğrudan satır içi görünsün */
  'static.klipy': DirectLinkMedia,
  'media.klipy': DirectLinkMedia,
  'klipy': DirectLinkMedia,
};
