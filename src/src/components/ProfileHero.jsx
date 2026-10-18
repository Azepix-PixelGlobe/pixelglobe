/**
 * ProfileHero — the header card used on every profile page.
 *
 *   * big avatar with a live presence ring (Aktif / Çevrimdışı)
 *   * status message + icon
 *   * bio
 *   * "Durumu düzenle" button on your own profile (opens StatusEditor)
 *
 * Usage (see windows/User.jsx and windows/UserArea.jsx):
 *   <ProfileHero
 *     name={userData.name}
 *     uid={uid}
 *     avatarThumbUrl={thumbUrl}
 *     avatarUrl={mediaUrl}
 *     flag={userData.customFlag}
 *     isSelf={false}
 *   />
 */

import { useState, useEffect, useCallback } from 'preact/hooks';
import { memo } from 'preact/compat';

import {
  subscribe, getProfile, getSelf, isActive, markActive,
} from '../utils/pgProfile.js';
import { pgT } from '../utils/pgI18n.js';
import StatusEditor from './StatusEditor.jsx';
import {
  frameClassName, resolveFrame, subscribeFrames,
} from '../utils/pgFrames.js';

const ProfileHero = ({
  name,
  username,
  uid,
  avatarThumbUrl,
  avatarUrl,
  flagUrl,
  isSelf,
  onProfileChange,
}) => {
  const [, setVersion] = useState(0);
  const [editing, setEditing] = useState(false);

  /* re-render when profiles / presence change */
  useEffect(() => subscribe(() => setVersion((v) => v + 1)), []);

  /* çerçeve canlı haritası değişince profil kartı da tazelenir */
  useEffect(() => subscribeFrames(() => setVersion((v) => v + 1)), []);

  /* keep the presence chip fresh without spamming renders */
  useEffect(() => {
    const id = window.setInterval(() => setVersion((v) => v + 1), 30000);
    return () => window.clearInterval(id);
  }, []);

  /* opening your own profile means you are here */
  useEffect(() => {
    if (isSelf && name) markActive(name);
  }, [isSelf, name]);

  /*
   * Your own status lives in the local self store; the cache only holds what
   * other players broadcast. Never let an empty cache entry overwrite your
   * own values (that would blank the card right after saving).
   */
  const selfProfile = getSelf();
  const cachedProfile = getProfile(name);
  const profile = isSelf
    ? {
      emoji: selfProfile.emoji || cachedProfile.emoji,
      status: selfProfile.status || cachedProfile.status,
      bio: selfProfile.bio || cachedProfile.bio,
    }
    : cachedProfile;
  const active = isSelf || isActive(name);

  const openEditor = useCallback(() => setEditing(true), []);
  const closeEditor = useCallback(() => setEditing(false), []);

  /* hareketli çerçeve (varsa): sohbette görünen çerçevenin aynısı profilde de */
  const frame = resolveFrame(uid);
  const frameClass = frameClassName(frame);

  const emoji = profile.emoji || '';
  const statusText = profile.status || '';
  const bioText = profile.bio || '';

  return (
    <div className={`pg-hero${active ? ' is-active' : ' is-offline'}`}>
      <div className="pg-hero-glow" aria-hidden="true" />

      <div className="pg-hero-avatar-wrap">
        <span
          className={`pg-hero-avatar${frameClass ? ` ${frameClass}` : ''}`}
          style={avatarThumbUrl ? { backgroundImage: `url(${avatarThumbUrl})` } : undefined}
        >
          {frameClass ? <i className="avatar-frame-ring" aria-hidden="true" /> : null}
          {!avatarThumbUrl && <span className="pg-hero-initial" aria-hidden="true">?</span>}
        </span>
        <span
          className={`pg-dot ${active ? 'active' : 'offline'}`}
          title={active ? pgT('presence.active') : pgT('presence.offline')}
          aria-hidden="true"
        />
      </div>

      <div className="pg-hero-main">
        <div className="pg-hero-name-row">
          {flagUrl && <img className="pg-hero-flag" src={flagUrl} alt="" />}
          <h2 className="pg-hero-name">{name}</h2>
          {username ? <span className="pg-hero-username">@{username}</span> : null}
          {uid ? <span className="pg-hero-uid">#{uid}</span> : null}
        </div>

        <div className={`pg-chip ${active ? 'active' : 'offline'}`}>
          <span className="pg-chip-dot" aria-hidden="true" />
          {active ? pgT('presence.active') : pgT('presence.offline')}
        </div>

        <div className="pg-hero-status">
          {emoji ? <span className="pg-hero-emoji" aria-hidden="true">{emoji}</span> : null}
          <span className={statusText ? 'pg-hero-status-text' : 'pg-hero-status-empty'}>
            {statusText || pgT('profile.none')}
          </span>
        </div>

        {bioText ? (
          <p className="pg-hero-bio">{bioText}</p>
        ) : (
          <p className="pg-hero-bio empty">{pgT('profile.noBio')}</p>
        )}

        {isSelf && (
          <button type="button" className="pg-btn primary pg-hero-edit" onClick={openEditor}>
            <span aria-hidden="true">✎</span>
            {pgT('profile.edit')}
          </button>
        )}
      </div>

      {editing && (
        <StatusEditor
          name={name}
          avatarUrl={avatarThumbUrl || avatarUrl}
          onClose={closeEditor}
          onSaved={(next) => {
            if (onProfileChange) onProfileChange(next);
          }}
        />
      )}
    </div>
  );
};

export default memo(ProfileHero);
