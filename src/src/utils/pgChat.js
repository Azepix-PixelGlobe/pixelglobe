import { useEffect, useRef, useState } from 'preact/hooks';

/**
 * PixelGlobe chat extras — invisible protocol frames + typing indicator.
 * =====================================================================
 * The PixelPlanet websocket relays chat messages verbatim, so the new UI
 * features travel inside the normal chat stream as "frames": a chat message
 * whose text starts with the invisible separator U+2063.
 *
 *   \u2063t{"n":"Azepix"}   -> "Azepix is typing"
 *   \u2063p{"n":"Azepix"}   -> presence beacon
 *   \u2063r{...}            -> profile card (status / bio)
 *
 * Because they are ordinary chat messages they need no server changes; the
 * client hides them from the message list, keeps them out of the unread
 * counter and turns them into UI state instead.
 */

export const PG_SENTINEL = '\u2063';

export const PG_KIND = {
  TYPING: 't',
  PRESENCE: 'p',
  PROFILE: 'r',
};

export const PG_TYPING_TTL = 6000;      // a typing hint fades after 6s
export const PG_TYPING_THROTTLE = 2500; // at most one frame per 2.5s
export const PG_PRESENCE_TTL = 5 * 60 * 1000;

/* ------------------------------------------------------------- encoding */

export function encodeFrame(kind, data) {
  return `${PG_SENTINEL}${kind}${JSON.stringify(data)}`;
}

export function isFrame(text) {
  return typeof text === 'string' && text.length > 1
    && text.charCodeAt(0) === 0x2063;
}

export function decodeFrame(text) {
  if (!isFrame(text)) return null;
  const kind = text.charAt(1);
  try {
    return { kind, data: JSON.parse(text.slice(2)) };
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------- sending */

const lastTypingSent = {};

/**
 * Send one typing frame for a channel, throttled.
 * new content within the throttle window is ignored on purpose.
 */
export function pingTyping(dispatch, sendChatMessage, channelId, ownName) {
  if (!dispatch || !sendChatMessage || !channelId || !ownName) return false;
  const now = Date.now();
  if (now - (lastTypingSent[channelId] || 0) < PG_TYPING_THROTTLE) return false;
  lastTypingSent[channelId] = now;
  dispatch(sendChatMessage(encodeFrame(PG_KIND.TYPING, { n: ownName }), channelId));
  return true;
}

export function sendPresence(dispatch, sendChatMessage, channelId, ownName, uid) {
  if (!dispatch || !sendChatMessage || !channelId || !ownName) return false;
  dispatch(sendChatMessage(
    encodeFrame(PG_KIND.PRESENCE, { n: ownName, u: uid || 0 }),
    channelId,
  ));
  return true;
}

export function sendProfileFrame(dispatch, sendChatMessage, channelId, ownName, uid, profile) {
  if (!dispatch || !sendChatMessage || !channelId || !ownName) return false;
  const { emoji = '', status = '', bio = '' } = profile || {};
  dispatch(sendChatMessage(
    encodeFrame(PG_KIND.PROFILE, {
      n: ownName, u: uid || 0, e: emoji, s: status, b: bio,
    }),
    channelId,
  ));
  return true;
}

export function typingFrameName(text) {
  const frame = decodeFrame(text);
  if (!frame || frame.kind !== PG_KIND.TYPING) return null;
  const name = frame.data && frame.data.n;
  return typeof name === 'string' && name ? name : null;
}

/* --------------------------------------------------- outgoing hook (DOM) */

/**
 * Attach an `input` listener to a chat input element and emit throttled
 * typing frames while the player writes.
 *
 *   useTypingBroadcast(inputRef, chatChannel, dispatch, sendChatMessage, ownName);
 */
export function createTypingBroadcaster({
  dispatch, sendChatMessage, ownName,
}) {
  let lastChannel = null;
  return (channelId) => {
    lastChannel = channelId;
    return pingTyping(dispatch, sendChatMessage, lastChannel, ownName);
  };
}

/* ------------------------------------------------- typing hook (preact) -- */

/**
 * Turn the invisible typing frames of a channel into a live name list.
 * Re-renders only when the list actually changes.
 */
export function useTypingNames(channelMessages, ownName, ttl = PG_TYPING_TTL) {
  const [names, setNames] = useState([]);
  const pendingRef = useRef({}); // name -> expiresAt
  const shownRef = useRef('');

  useEffect(() => {
    const list = channelMessages || [];
    list.forEach((message) => {
      if (!message) return;
      const [, text, , , ts] = message;
      const name = typingFrameName(text);
      const when = (Number(ts) || 0) * 1000 || Date.now();
      if (name) {
        if (name !== ownName) {
          pendingRef.current[name] = Math.min(when + ttl, Date.now() + ttl);
        }
      } else if (text && text.charCodeAt(0) !== 0x2063) {
        // a real message means they stopped typing
        delete pendingRef.current[message[0]];
      }
    });
  }, [channelMessages, ownName, ttl]);

  useEffect(() => {
    const update = () => {
      const now = Date.now();
      const alive = Object.keys(pendingRef.current)
        .filter((name) => pendingRef.current[name] > now);
      const joined = alive.join('\u0000');
      if (joined !== shownRef.current) {
        shownRef.current = joined;
        setNames(alive);
      }
    };
    update();
    const id = window.setInterval(update, 1000);
    return () => window.clearInterval(id);
  }, []);

  return names;
}
