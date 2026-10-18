/**
 * StatusEditor — "Durumunu ayarla" modal.
 * Status message (128), bio (280), icon and an optional auto-clear timer.
 * Everything is stored through utils/pgProfile.js.
 */

import { useState, useCallback } from 'preact/hooks';
import { memo } from 'preact/compat';

import { getSelf, setSelf, clearSelf } from '../utils/pgProfile.js';
import { pgT } from '../utils/pgI18n.js';

const EMOJIS = ['😀', '🎨', '🔥', '👑', '🌙', '⚔️', '💎', '🎯', '☕', '🛰️', '🐟', '✨'];

const CLEAR_OPTIONS = [
  { id: 'never', ms: 0 },
  { id: 'hour', ms: 60 * 60 * 1000 },
  { id: 'eightHours', ms: 8 * 60 * 60 * 1000 },
  { id: 'tomorrow', ms: 24 * 60 * 60 * 1000 },
];

const StatusEditor = ({ avatarUrl, name, onClose, onSaved }) => {
  const current = getSelf();
  const [emoji, setEmoji] = useState(current.emoji || '');
  const [status, setStatus] = useState(current.status || '');
  const [bio, setBio] = useState(current.bio || '');
  const [clearId, setClearId] = useState('never');

  const save = useCallback(() => {
    const option = CLEAR_OPTIONS.find((entry) => entry.id === clearId);
    const next = setSelf({
      emoji,
      status,
      bio,
      clearAt: option && option.ms ? Date.now() + option.ms : 0,
    });
    if (onSaved) onSaved(next);
    if (onClose) onClose();
  }, [emoji, status, bio, clearId, onSaved, onClose]);

  const clear = useCallback(() => {
    const next = clearSelf();
    if (onSaved) onSaved(next);
    if (onClose) onClose();
  }, [onSaved, onClose]);

  return (
    <div
      className="pg-modal-overlay"
      role="dialog"
      aria-modal="true"
      aria-label={pgT('editor.title')}
      onClick={(evt) => {
        if (evt.target === evt.currentTarget && onClose) onClose();
      }}
    >
      <div className="pg-modal">
        <div className="pg-modal-head">
          <span className="pg-modal-badge" aria-hidden="true">{emoji || '✳'}</span>
          <span className="pg-modal-kicker">{pgT('editor.kicker')}</span>
          <h3 className="pg-modal-title">{pgT('editor.title')}</h3>
          <button
            type="button"
            className="pg-modal-x"
            aria-label={pgT('editor.cancel')}
            onClick={onClose}
          >
            ✕
          </button>
        </div>

        <div className="pg-modal-section">
          <div className="pg-modal-label">{pgT('editor.preview')}</div>
          <div className="pg-preview">
            <span
              className="pg-preview-avatar"
              style={avatarUrl ? { backgroundImage: `url(${avatarUrl})` } : undefined}
            >
              <i className="pg-dot active" aria-hidden="true" />
            </span>
            <span className="pg-preview-body">
              <strong>{name}</strong>
              <em>{emoji} {status || pgT('profile.none')}</em>
            </span>
          </div>
        </div>

        <div className="pg-modal-section">
          <div className="pg-modal-label">
            {pgT('editor.statusLabel')}
            <span className="pg-counter">{status.length}/128</span>
          </div>
          <div className="pg-input-wrap">
            <span className="pg-input-emoji" aria-hidden="true">{emoji || '🙂'}</span>
            <input
              className="pg-input"
              type="text"
              maxLength={128}
              value={status}
              placeholder={pgT('profile.none')}
              onInput={(evt) => setStatus(evt.currentTarget.value)}
            />
          </div>
        </div>

        <div className="pg-modal-section">
          <div className="pg-modal-label">
            {pgT('editor.emoji')}
          </div>
          <div className="pg-emoji-row">
            {EMOJIS.map((entry) => (
              <button
                key={entry}
                type="button"
                className={`pg-emoji${emoji === entry ? ' active' : ''}`}
                onClick={() => setEmoji(emoji === entry ? '' : entry)}
              >
                {entry}
              </button>
            ))}
          </div>
        </div>

        <div className="pg-modal-section">
          <div className="pg-modal-label">
            {pgT('editor.bioLabel')}
            <span className="pg-counter">{bio.length}/280</span>
          </div>
          <textarea
            className="pg-textarea"
            maxLength={280}
            value={bio}
            placeholder={pgT('profile.noBio')}
            onInput={(evt) => setBio(evt.currentTarget.value)}
          />
        </div>

        <div className="pg-modal-foot">
          <label className="pg-select-wrap">
            <select
              className="pg-select"
              value={clearId}
              onChange={(evt) => setClearId(evt.currentTarget.value)}
            >
              {CLEAR_OPTIONS.map((option) => (
                <option key={option.id} value={option.id}>
                  {pgT(`editor.${option.id}`)}
                </option>
              ))}
            </select>
          </label>
          <div className="pg-modal-actions">
            <button type="button" className="pg-btn ghost" onClick={clear}>
              {pgT('editor.clear')}
            </button>
            <button type="button" className="pg-btn primary" onClick={save}>
              {pgT('editor.save')}
            </button>
          </div>
        </div>

        <div className="pg-modal-hint">{pgT('editor.hint')}</div>
      </div>
    </div>
  );
};

export default memo(StatusEditor);
