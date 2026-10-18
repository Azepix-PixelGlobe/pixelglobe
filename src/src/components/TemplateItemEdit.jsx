/**
 * Item for list of Tamplates
 */

import {
  useRef, useState, useEffect, useMemo, useCallback,
} from 'preact/hooks';
import { memo } from 'preact/compat';
import { useSelector, shallowEqual } from '../store/react-redux/index.js';
import { t } from 'ttag';

import templateLoader from '../ui/templateLoader.js';
import { coordsFromString } from '../core/utils.js';

const NUDGE_HOLD_MS = 80;

const TemplateItemEdit = ({
  title: initTitle,
  canvasId: initCanvasId,
  x: initX, y: initY,
  imageId,
  stopEditing,
}) => {
  const [initCoords] = useMemo(() => [
    (Number.isNaN(parseInt(initX, 10))
      || Number.isNaN(parseInt(initY, 10))) ? null : [initX, initY],
  ], [initX, initY]);

  const [coords, setCoords] = useState(initCoords);
  const [dimensions, setDimensions] = useState(null);
  const [title, setTitle] = useState(initTitle || '');
  const [file, setFile] = useState(null);
  const [titleUnique, setTitleUnique] = useState(true);
  const [moveMode, setMoveMode] = useState(false);
  const [pickMouse, setPickMouse] = useState(false);
  const imgRef = useRef();
  const fileRef = useRef();
  const coordInputRef = useRef();
  const holdTimer = useRef(null);
  const [
    storeCanvasId,
    canvases,
    templateList,
    hover,
  ] = useSelector((state) => [
    state.canvas.canvasId,
    state.canvas.canvases,
    state.templates.list,
    state.canvas.hover,
  ], shallowEqual);
  const [canvasId, selectCanvas] = useState(initCanvasId ?? storeCanvasId);

  useEffect(() => {
    (async () => {
      if (!imageId || !imgRef.current) {
        return;
      }
      const previewImg = await templateLoader.getTemplate(imageId);
      if (!previewImg) {
        return;
      }
      const bitmap = await createImageBitmap(previewImg);
      const canvas = imgRef.current;
      const { width, height } = bitmap;
      canvas.width = width;
      canvas.height = height;
      canvas.getContext('bitmaprenderer').transferFromImageBitmap(bitmap);
      setDimensions([width, height]);
      bitmap.close();
    })();
  }, [imageId]);

  useEffect(() => {
    if (!file || !imgRef.current) {
      return;
    }
    (async () => {
      const bitmap = await createImageBitmap(file);
      const canvas = imgRef.current;
      const { width, height } = bitmap;
      canvas.width = width;
      canvas.height = height;
      canvas.getContext('bitmaprenderer').transferFromImageBitmap(bitmap);
      setDimensions([width, height]);
      bitmap.close();
    })();
  }, [file]);

  const applyCoords = useCallback((nx, ny) => {
    const next = [Math.floor(nx), Math.floor(ny)];
    setCoords(next);
    if (coordInputRef.current) {
      coordInputRef.current.value = next.join('_');
    }
    if (initTitle) {
      try {
        templateLoader.changeTemplate(initTitle, {
          x: next[0],
          y: next[1],
        });
      } catch {
        // The local edit remains usable if the overlay is not ready yet.
      }
    }
  }, [initTitle]);

  const nudge = useCallback((dx, dy) => {
    const base = coords || [0, 0];
    applyCoords(base[0] + dx, base[1] + dy);
  }, [coords, applyCoords]);

  const stopHold = useCallback(() => {
    if (holdTimer.current) {
      clearInterval(holdTimer.current);
      holdTimer.current = null;
    }
  }, []);

  const startHold = useCallback((dx, dy) => {
    stopHold();
    nudge(dx, dy);
    holdTimer.current = setInterval(() => nudge(dx, dy), NUDGE_HOLD_MS);
  }, [nudge, stopHold]);

  useEffect(() => () => stopHold(), [stopHold]);

  useEffect(() => {
    if (!pickMouse || !moveMode) return undefined;
    const onCanvasClick = (evt) => {
      if (evt.target?.closest?.('.tmpitm')
        || evt.target?.closest?.('.windows')
        || evt.target?.closest?.('.window')
        || evt.target?.closest?.('.modal')
        || evt.target?.closest?.('#pg-tpl-move-pad')) {
        return;
      }
      if (Array.isArray(hover) && hover.length >= 2) {
        applyCoords(hover[0], hover[1]);
        setPickMouse(false);
      }
    };
    window.addEventListener('click', onCanvasClick, true);
    window.addEventListener('touchend', onCanvasClick, true);
    return () => {
      window.removeEventListener('click', onCanvasClick, true);
      window.removeEventListener('touchend', onCanvasClick, true);
    };
  }, [pickMouse, moveMode, hover, applyCoords]);

  const canSubmit = (file || imageId)
    && titleUnique && coords && title && dimensions;

  return (
    <div className="tmpitm">
      <div className="tmpitm-preview">
        <div style={{ width: '100%', height: '100%' }}>
          <canvas
            className="tmpitm-img"
            ref={imgRef}
            key="editimg"
            style={{ opacity: 0.4 }}
          />
        </div>
        <div
          className="centered-on-img modallink"
          onClick={() => fileRef.current?.click()}
        >{t`Select File`}</div>
        <input
          type="file"
          key="hinpt"
          accept="image/*"
          ref={fileRef}
          style={{ display: 'none' }}
          onChange={(evt) => {
            setDimensions(null);
            setFile(evt.target.files?.[0]);
          }}
        />
      </div>
      <div className="tmpitm-desc">
        <h4><input
          value={title}
          style={{ width: '10em' }}
          type="text"
          onChange={(evt) => {
            const newTitle = evt.target.value;
            setTitleUnique(!templateList.some((z) => z.title === newTitle));
            setTitle(evt.target.value);
          }}
          placeholder={t`Template Name`}
        /></h4>
        <p>{t`Canvas`}:&nbsp;
          <span><select
            value={canvasId}
            onChange={(e) => {
              const sel = e.target;
              selectCanvas(sel.options[sel.selectedIndex].value);
            }}
          >
            {Object.keys(canvases)
              .filter((c) => !canvases[c].v && !canvases[c].ed)
              .map((canvas) => (
                <option key={canvas} value={canvas}>
                  {canvases[canvas].title}
                </option>
              ),
              )}
          </select></span>
        </p>
        <p>
          {t`Coordinates`}:&nbsp;
          <span><input
            ref={coordInputRef}
            type="text"
            key={coords ? coords.join('_') : 'empty'}
            defaultValue={coords && coords.join('_')}
            style={{
              display: 'inline-block',
              maxWidth: '9em',
              fontWeight: 700,
            }}
            placeholder="X_Y or URL"
            onChange={(evt) => {
              const co = coordsFromString(evt.target.value.trim());
              if (co) {
                evt.target.value = co.join('_');
                applyCoords(co[0], co[1]);
              } else {
                setCoords(null);
              }
            }}
          /></span>
        </p>
        {coords && (
          <p style={{ fontSize: '0.9em', opacity: 0.85 }}>
            ({coords[0]}, {coords[1]})
          </p>
        )}
        <p>
          {t`Dimensions`}:&nbsp;<span>
            {(dimensions) ? dimensions.join(' x ') : 'N/A'}
          </span>
        </p>

        <p style={{ marginTop: 8 }}>
          <button
            type="button"
            onClick={() => {
              setMoveMode((mode) => {
                if (mode) {
                  setPickMouse(false);
                  stopHold();
                }
                return !mode;
              });
            }}
            style={{
              padding: '8px 12px',
              borderRadius: 8,
              border: moveMode
                ? '2px solid #22c55e'
                : '1px solid rgba(255,255,255,0.2)',
              cursor: 'pointer',
              fontWeight: 700,
              background: moveMode
                ? 'linear-gradient(135deg,#16a34a,#22c55e)'
                : 'rgba(0,0,0,0.2)',
              color: moveMode ? '#fff' : 'inherit',
            }}
          >
            {moveMode
              ? t`Disable Move Controls`
              : t`Enable Move Controls`}
          </button>
        </p>

        {moveMode && (
          <div style={{ marginTop: 6 }}>
            <button
              type="button"
              onClick={() => setPickMouse((picking) => !picking)}
              style={{
                padding: '8px 12px',
                borderRadius: 8,
                border: pickMouse
                  ? '2px solid #6366f1'
                  : '1px solid rgba(255,255,255,0.2)',
                cursor: 'pointer',
                fontWeight: 700,
                background: pickMouse
                  ? 'linear-gradient(135deg,#4f46e5,#6366f1)'
                  : 'rgba(0,0,0,0.2)',
                color: pickMouse ? '#fff' : 'inherit',
                marginBottom: 8,
              }}
            >
              {pickMouse
                ? t`Click on canvas…`
                : t`Position With Mouse`}
            </button>
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: '44px 44px 44px',
                gridTemplateRows: '44px 44px 44px',
                gap: 6,
                justifyContent: 'start',
                marginTop: 4,
              }}
            >
              <span />
              {arrowButton('↑', 0, -1, startHold, stopHold)}
              <span />
              {arrowButton('←', -1, 0, startHold, stopHold)}
              <span style={{
                width: 44,
                height: 44,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: '0.7em',
                opacity: 0.6,
              }}
              >
                1px
              </span>
              {arrowButton('→', 1, 0, startHold, stopHold)}
              <span />
              {arrowButton('↓', 0, 1, startHold, stopHold)}
              <span />
            </div>
            <p style={{ fontSize: '0.8em', opacity: 0.7, marginTop: 6 }}>
              Oklar 1px kaydırır (basılı tut = hızlı).
              Kayıtlı şablonda overlay canlı hareket eder.
            </p>
          </div>
        )}
      </div>
      <div className="tmpitm-actions">
        {(initTitle) && (
          <button
            onClick={() => {
              stopEditing(initTitle);
              templateLoader.deleteTemplate(initTitle);
            }}
            type="button"
          >
            {t`Delete`}
          </button>
        )}
        <button
          onClick={() => stopEditing(title)}
          type="button"
        >
          {t`Cancel`}
        </button>
        <button
          disabled={!canSubmit}
          onClick={async () => {
            if (!canSubmit || !imgRef.current) {
              return;
            }
            const [x, y] = coords;
            if (!initTitle) {
              await templateLoader.addFile(file, title, canvasId, x, y);
            } else {
              if (file && imageId) {
                await templateLoader.updateFile(imageId, file);
              }
              if (initTitle
                && (initTitle !== title || initX !== x
                  || initY !== y || initCanvasId !== canvasId
                )) {
                templateLoader.changeTemplate(initTitle, {
                  title, canvasId, x, y,
                });
              }
            }
            stopEditing(initTitle);
          }}
          type="button"
        >
          {t`Save`}
        </button>
      </div>

      {moveMode && (
        <div
          id="pg-tpl-move-pad"
          style={{
            position: 'fixed',
            left: 12,
            bottom: 88,
            zIndex: 9999,
            padding: 10,
            borderRadius: 14,
            background: 'rgba(12,12,20,0.82)',
            backdropFilter: 'blur(8px)',
            boxShadow: '0 4px 20px rgba(0,0,0,0.4)',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: 8,
          }}
        >
          <div style={{
            color: '#fff',
            fontWeight: 700,
            fontSize: '0.85em',
            opacity: 0.9,
          }}
          >
            {coords ? `(${coords[0]}, ${coords[1]})` : '—'}
          </div>
          <div style={{
            display: 'grid',
            gridTemplateColumns: '44px 44px 44px',
            gap: 6,
          }}
          >
            <span />
            {arrowButton('↑', 0, -1, startHold, stopHold)}
            <span />
            {arrowButton('←', -1, 0, startHold, stopHold)}
            <span />
            {arrowButton('→', 1, 0, startHold, stopHold)}
            <span />
            {arrowButton('↓', 0, 1, startHold, stopHold)}
            <span />
          </div>
          <button
            type="button"
            onClick={() => setPickMouse((picking) => !picking)}
            style={{
              padding: '6px 10px',
              borderRadius: 8,
              border: 'none',
              fontWeight: 700,
              cursor: 'pointer',
              background: pickMouse ? '#6366f1' : 'rgba(255,255,255,0.12)',
              color: '#fff',
              fontSize: '0.8em',
            }}
          >
            {pickMouse ? t`Click on canvas…` : t`Position With Mouse`}
          </button>
        </div>
      )}
    </div>
  );
};

function arrowButton(label, dx, dy, startHold, stopHold) {
  return (
    <button
      type="button"
      key={label}
      aria-label={label}
      onMouseDown={(event) => {
        event.preventDefault();
        startHold(dx, dy);
      }}
      onMouseUp={stopHold}
      onMouseLeave={stopHold}
      onTouchStart={(event) => {
        event.preventDefault();
        startHold(dx, dy);
      }}
      onTouchEnd={stopHold}
      style={{
        width: 44,
        height: 44,
        borderRadius: 10,
        border: 'none',
        fontWeight: 800,
        fontSize: '1.1em',
        cursor: 'pointer',
        background: 'rgba(30,30,40,0.85)',
        color: '#fff',
        boxShadow: '0 2px 8px rgba(0,0,0,0.35)',
      }}
    >
      {label}
    </button>
  );
}

export default memo(TemplateItemEdit);
