/*
 * Community template share hub — list, preview, install and upload.
 */
import { useState, useEffect, useCallback, useRef } from 'preact/hooks';
import { memo } from 'preact/compat';
import { useSelector, useDispatch } from '../../store/react-redux/index.js';
import { t } from 'ttag';
import { api } from '../../utils/utag.js';
import templateLoader from '../../ui/templateLoader.js';
import { pAlert } from '../../store/actions/index.js';
import { toggleOVEnabled } from '../../store/actions/templates.js';

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function loadImageSize(dataUrl) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve({ width: image.width, height: image.height });
    image.onerror = reject;
    image.src = dataUrl;
  });
}

function TemplateShare() {
  const dispatch = useDispatch();
  const userId = useSelector((state) => state.user.id);
  const userName = useSelector((state) => state.user.name);
  const canvasId = useSelector((state) => state.canvas.canvasId);
  const hover = useSelector((state) => state.canvas.hover);
  const overlayEnabled = useSelector((state) => state.templates.ovEnabled);

  const [tab, setTab] = useState('list');
  const [templates, setTemplates] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState(null);
  const [message, setMessage] = useState('');
  const [title, setTitle] = useState('');
  const [x, setX] = useState('');
  const [y, setY] = useState('');
  const [file, setFile] = useState(null);
  const [previewUrl, setPreviewUrl] = useState(null);
  const [dimensions, setDimensions] = useState(null);
  const fileRef = useRef();

  const flash = useCallback((text) => {
    setMessage(text);
    window.setTimeout(() => setMessage(''), 3500);
  }, []);

  const fetchTemplates = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch(api`/api/templateshare?limit=50`, {
        credentials: 'include',
      });
      const data = await response.json();
      setTemplates(data.templates || []);
    } catch {
      flash(t`Could not load templates`);
    } finally {
      setLoading(false);
    }
  }, [flash]);

  useEffect(() => {
    fetchTemplates();
  }, [fetchTemplates]);

  useEffect(() => {
    if (Array.isArray(hover) && hover.length >= 2) {
      setX(String(Math.floor(hover[0])));
      setY(String(Math.floor(hover[1])));
    }
  }, [hover]);

  const onPickFile = async (event) => {
    const picked = event.target.files?.[0];
    if (!picked) return;
    if (!picked.type.startsWith('image/')) {
      flash(t`Only images allowed`);
      return;
    }
    try {
      const dataUrl = await fileToDataUrl(picked);
      const size = await loadImageSize(dataUrl);
      setFile(picked);
      setPreviewUrl(dataUrl);
      setDimensions(size);
    } catch {
      flash(t`Invalid image`);
    }
  };

  const handleUpload = async () => {
    if (!userId) {
      flash(t`You have to be logged in`);
      return;
    }
    if (!file || !previewUrl || !dimensions || !title.trim()) {
      flash(t`Fill title, image and coordinates`);
      return;
    }
    const xi = parseInt(x, 10);
    const yi = parseInt(y, 10);
    if (Number.isNaN(xi) || Number.isNaN(yi)) {
      flash(t`Invalid coordinates`);
      return;
    }

    setBusyId('upload');
    try {
      const response = await fetch(api`/api/templateshare`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: title.trim(),
          canvasId,
          x: xi,
          y: yi,
          width: dimensions.width,
          height: dimensions.height,
          mime: file.type || 'image/png',
          imageData: previewUrl,
        }),
      });
       const data = await response.json().catch(() => null);
       if (!response.ok || !data?.ok) {
         const serverError = data?.error || data?.errors?.[0];
         const errorMessage = response.status === 413
           ? t`Image is too large`
           : serverError || t`Error`;
         flash(errorMessage);
        return;
      }
      setTitle('');
      setFile(null);
      setPreviewUrl(null);
      setDimensions(null);
      if (fileRef.current) fileRef.current.value = '';
      setTab('list');
      flash(t`Template shared!`);
      await fetchTemplates();
    } catch {
      flash(t`Error`);
    } finally {
      setBusyId(null);
    }
  };

  const handleInstall = async (item) => {
    setBusyId(item.id);
    try {
      const response = await fetch(api`/api/templateshare/${item.id}`, {
        credentials: 'include',
      });
      const data = await response.json();
      if (!data.ok || !data.template?.imageData) {
        flash(t`Could not load template`);
        return;
      }
      const template = data.template;
      const imageResponse = await fetch(template.imageData);
      const blob = await imageResponse.blob();
      await templateLoader.addFile(
        blob,
        template.title.slice(0, 40),
        template.canvasId,
        template.x,
        template.y,
      );
      if (!overlayEnabled) dispatch(toggleOVEnabled());
      dispatch(pAlert(
        t`Template installed`,
        `"${template.title}" → (${template.x}, ${template.y})`,
        'info',
      ));
      flash(`✓ ${t`Installed`}: ${template.title}`);
    } catch (error) {
      console.error(error);
      flash(t`Install failed`);
    } finally {
      setBusyId(null);
    }
  };

  const handleDelete = async (id) => {
    if (!window.confirm(t`Delete this template?`)) return;
    setBusyId(id);
    try {
      const response = await fetch(api`/api/templateshare/${id}`, {
        method: 'DELETE',
        credentials: 'include',
      });
      const data = await response.json();
      if (!data.ok) {
        flash(data.error || t`Error`);
        return;
      }
      await fetchTemplates();
    } catch {
      flash(t`Error`);
    } finally {
      setBusyId(null);
    }
  };

  const useHoverCoords = () => {
    if (Array.isArray(hover) && hover.length >= 2) {
      setX(String(Math.floor(hover[0])));
      setY(String(Math.floor(hover[1])));
    } else {
      flash(t`Move cursor on canvas first`);
    }
  };

  return (
    <div className="content margin-container" style={{ maxWidth: 520 }}>
      <h2 style={{ marginTop: 0 }}>📋 {t`Shared Templates`}</h2>
      <p style={{ fontSize: '0.88em', opacity: 0.75 }}>
        Şablon paylaş, önizle, tek tıkla kur. Kurunca overlay olarak gelir.
      </p>

      {message && (
        <div style={noticeStyle}>{message}</div>
      )}

      <div style={tabsStyle}>
        <button type="button" onClick={() => setTab('list')} style={tabStyle(tab === 'list')}>
          Liste
        </button>
        <button type="button" onClick={() => setTab('upload')} style={tabStyle(tab === 'upload')}>
          Paylaş
        </button>
        <button type="button" onClick={fetchTemplates} style={{ ...tabStyle(false), flex: 0 }}>
          ↻
        </button>
      </div>

      {tab === 'list' && (
        <div>
          {loading && <p>…</p>}
          {!loading && !templates.length && (
            <p style={{ opacity: 0.7 }}>{t`No shared templates yet.`}</p>
          )}
          {templates.map((item) => (
            <div key={item.id} style={cardStyle}>
              <img
                src={api`/api/templateshare/${item.id}/preview`}
                alt=""
                width={72}
                height={72}
                style={thumbnailStyle}
              />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 700 }}>{item.title}</div>
                <div style={{ fontSize: '0.8em', opacity: 0.7 }}>
                  {item.authorName} · ({item.x}, {item.y}) · {item.width}×{item.height} · C{item.canvasId}
                </div>
                <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
                  <button
                    type="button"
                    disabled={busyId === item.id}
                    onClick={() => handleInstall(item)}
                    style={primaryButton}
                  >
                    {busyId === item.id ? '…' : t`Install`}
                  </button>
                  {userId === item.uid && (
                    <button type="button" onClick={() => handleDelete(item.id)} style={dangerButton}>
                      Sil
                    </button>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {tab === 'upload' && (
        <div>
          {!userId && <p>{t`You have to be logged in`}</p>}
          {userId && (
            <>
              <label style={labelStyle}>
                Başlık
                <input
                  type="text"
                  value={title}
                  maxLength={48}
                  onInput={(event) => setTitle(event.target.value)}
                  style={inputStyle}
                  placeholder="Bayrak / logo…"
                />
              </label>
              <label style={labelStyle}>
                Görsel
                <input
                  ref={fileRef}
                  type="file"
                  accept="image/png,image/jpeg,image/gif,image/webp"
                  onChange={onPickFile}
                  style={{ marginTop: 4 }}
                />
              </label>
              {previewUrl && (
                <div style={{ margin: '8px 0' }}>
                  <img src={previewUrl} alt="preview" style={previewStyle} />
                  {dimensions && (
                    <div style={{ fontSize: '0.8em', opacity: 0.7 }}>
                      {dimensions.width}×{dimensions.height}
                    </div>
                  )}
                </div>
              )}
              <div style={{ display: 'flex', gap: 8 }}>
                <label style={{ ...labelStyle, flex: 1 }}>
                  X
                  <input type="number" value={x} onInput={(event) => setX(event.target.value)} style={inputStyle} />
                </label>
                <label style={{ ...labelStyle, flex: 1 }}>
                  Y
                  <input type="number" value={y} onInput={(event) => setY(event.target.value)} style={inputStyle} />
                </label>
              </div>
              <button type="button" onClick={useHoverCoords} style={{ ...tabStyle(false), marginBottom: 8 }}>
                İmleç koordinatını kullan
              </button>
              <div style={{ fontSize: '0.8em', opacity: 0.65, marginBottom: 8 }}>
                Canvas: {canvasId} {userName ? `· ${userName}` : ''}
              </div>
              <button
                type="button"
                disabled={busyId === 'upload'}
                onClick={handleUpload}
                style={{ ...primaryButton, width: '100%', padding: 10 }}
              >
                {busyId === 'upload' ? '…' : t`Share template`}
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}

const tabStyle = (active) => ({
  flex: 1,
  padding: 8,
  borderRadius: 8,
  border: 'none',
  cursor: 'pointer',
  fontWeight: 700,
  background: active
    ? 'linear-gradient(135deg,#6366f1,#8b5cf6)'
    : 'rgba(0,0,0,0.08)',
  color: active ? '#fff' : 'inherit',
});

const noticeStyle = {
  marginBottom: 10,
  padding: '8px 12px',
  borderRadius: 8,
  background: 'rgba(99,102,241,0.18)',
  fontWeight: 600,
};

const tabsStyle = { display: 'flex', gap: 8, marginBottom: 12 };

const cardStyle = {
  display: 'flex',
  gap: 10,
  padding: 10,
  marginBottom: 8,
  borderRadius: 10,
  border: '1px solid rgba(255,255,255,0.1)',
  background: 'rgba(0,0,0,0.06)',
};

const thumbnailStyle = {
  objectFit: 'contain',
  background: 'rgba(0,0,0,0.2)',
  borderRadius: 8,
  imageRendering: 'pixelated',
  flexShrink: 0,
};

const primaryButton = {
  padding: '6px 12px',
  borderRadius: 8,
  border: 'none',
  cursor: 'pointer',
  fontWeight: 700,
  color: '#fff',
  background: 'linear-gradient(135deg,#22c55e,#16a34a)',
};

const dangerButton = {
  padding: '6px 10px',
  borderRadius: 8,
  border: 'none',
  cursor: 'pointer',
  fontWeight: 600,
  color: '#fff',
  background: '#b91c1c',
};

const labelStyle = {
  display: 'block',
  marginBottom: 8,
  fontSize: '0.9em',
  fontWeight: 600,
};

const inputStyle = {
  display: 'block',
  width: '100%',
  marginTop: 4,
  padding: 8,
  borderRadius: 8,
  border: '1px solid rgba(0,0,0,0.15)',
  boxSizing: 'border-box',
};

const previewStyle = {
  maxWidth: 160,
  maxHeight: 160,
  imageRendering: 'pixelated',
  borderRadius: 8,
  border: '1px solid rgba(255,255,255,0.15)',
};

export default memo(TemplateShare);