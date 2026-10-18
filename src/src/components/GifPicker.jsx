/**
 * GifPicker — sohbetin GIF düğmesiyle açılan KLIPY arama paneli.
 * ===================================================================
 * • Arama kutusuna yazdıkça (300 ms gecikmeli) KLIPY'de arar.
 * • "türk bayrağı" yazınca Türk bayrağı GIF'leri gelir.
 * • Boş bırakılırsa öne çıkan GIF'ler listelenir.
 * • Bir GIF'e dokununca sohbete gönderilir, panel kapanır.
 * • "Daha fazla" ile sonraki sonuç sayfası yüklenir.
 *
 * Kullanım:
 *   <GifPicker open={gifOpen} onClose={...} onPick={(url) => ...} />
 */

import {
  useCallback, useEffect, useMemo, useRef, useState,
} from 'preact/hooks';
import { memo } from 'preact/compat';

import {
  GIF_QUICK_TAGS, fetchGifs, isKlipyGif,
} from '../utils/pgGif.js';
import { pgT, pgLang } from '../utils/pgI18n.js';
import '../styles/pixelglobe-chatgif.css';

const SEARCH_DELAY = 300;

const GifPicker = ({ open, onClose, onPick, anchor = 'left' }) => {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [next, setNext] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const inputRef = useRef();
  const reqRef = useRef(0);

  const run = useCallback(async (q, pos = '', append = false) => {
    const ticket = reqRef.current + 1;
    reqRef.current = ticket;
    setLoading(true);
    setError(null);
    /* yerelleştirme: Türkçe arayüzde tr_TR sonuçları gelir */
    const data = await fetchGifs({ q, pos, locale: pgLang() === 'tr' ? 'tr_TR' : 'en_US' });
    if (reqRef.current !== ticket) return; // daha yeni bir istek var
    if (data.error && data.error !== 'aborted') {
      setError(data.error);
      if (!append) setResults([]);
    } else {
      setResults((prev) => (append ? [...prev, ...data.results] : data.results));
      setNext(data.next || '');
    }
    setLoading(false);
  }, []);

  /* panel açılınca kaynağa odaklan ve öne çıkanları getir */
  useEffect(() => {
    if (!open) return undefined;
    setQuery('');
    run('');
    const id = setTimeout(() => inputRef.current?.focus(), 60);
    return () => clearTimeout(id);
  }, [open, run]);

  /* yazarken ara (gecikmeli) */
  useEffect(() => {
    if (!open) return undefined;
    const id = setTimeout(() => run(query), SEARCH_DELAY);
    return () => clearTimeout(id);
  }, [query, open, run]);

  /* Esc ile kapat */
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (evt) => {
      if (evt.key === 'Escape') {
        evt.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [open, onClose]);

  const tags = useMemo(() => GIF_QUICK_TAGS.map((tag) => (
    <button
      key={tag.key}
      type="button"
      className={`pg-gif-tag${query === tag.q ? ' is-on' : ''}`}
      onClick={() => setQuery(tag.q)}
    >
      {pgT(tag.key)}
    </button>
  )), [query]);

  if (!open) return null;

  return (
    <div className={`pg-gif-panel pg-gif-panel--${anchor}`} role="dialog" aria-label={pgT('gif.title')}>
      <div className="pg-gif-head">
        <span className="pg-gif-logo">GIF</span>
        <input
          ref={inputRef}
          className="pg-gif-search"
          type="text"
          value={query}
          maxLength={60}
          autoComplete="off"
          spellcheck={false}
          placeholder={pgT('gif.placeholder')}
          onInput={(evt) => setQuery(evt.target.value)}
          onKeyDown={(evt) => {
            evt.stopPropagation();
            if (evt.key === 'Enter') run(query);
          }}
        />
        <button
          type="button"
          className="pg-gif-close"
          title={pgT('gif.close')}
          onClick={onClose}
        >
          ✕
        </button>
      </div>

      <div className="pg-gif-tags">{tags}</div>

      <div className="pg-gif-grid">
        {results.map((gif) => (
          <button
            key={gif.id}
            type="button"
            className="pg-gif-card"
            title={gif.title || pgT('gif.send')}
            onClick={() => {
              if (isKlipyGif(gif.url)) {
                onPick(gif.url);
                onClose();
              }
            }}
          >
            <img src={gif.preview} alt={gif.title || 'gif'} loading="lazy" />
          </button>
        ))}

        {!loading && !results.length && !error && (
          <div className="pg-gif-empty">{pgT('gif.empty')}</div>
        )}
        {error && (
          <div className="pg-gif-empty pg-gif-empty--err">
            {pgT('gif.error')}
            <button type="button" className="pg-gif-retry" onClick={() => run(query)}>
              {pgT('gif.retry')}
            </button>
          </div>
        )}
        {loading && <div className="pg-gif-loading">{pgT('gif.loading')}</div>}
      </div>

      <div className="pg-gif-foot">
        <span className="pg-gif-brand">{pgT('gif.poweredBy')}</span>
        {next && (
          <button
            type="button"
            className="pg-gif-more"
            onClick={() => run(query, next, true)}
            disabled={loading}
          >
            {pgT('gif.more')}
          </button>
        )}
      </div>
    </div>
  );
};

export default memo(GifPicker);
