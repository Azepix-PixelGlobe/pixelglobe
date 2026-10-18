/*
 * ModWatchtools
 * Tools to check who placed what where
 */

import { useState, useEffect } from 'preact/hooks';
import { Fragment } from 'preact';
import { memo } from 'preact/compat';
import {
  useSelector, shallowEqual, useDispatch,
} from '../store/react-redux/index.js';
import { t } from 'ttag';

import copyTextToClipboard from '../utils/clipboard.js';
import { parseInterval, coordsFromString } from '../core/utils.js';
import { api, cdn } from '../utils/utag.js';
import { selectCanvas } from '../store/actions/index.js';
import { USERLVL } from '../core/constants.js';

const keepState = {
  tlcoords: '',
  brcoords: '',
  interval: '15m',
  iid: '',
};

async function submitWatchAction(
  action,
  canvas,
  tlcoords,
  brcoords,
  interval,
  iid,
  callback,
) {
  let time = parseInterval(interval);
  if (!time) {
    callback({ info: t`Interval is invalid` });
    return;
  }
  time = Date.now() - time;
  const data = new FormData();
  data.append('watchaction', action);
  data.append('canvasid', canvas);
  data.append('ulcoor', tlcoords);
  data.append('brcoor', brcoords);
  data.append('time', time);
  data.append('iid', iid);
  try {
    const resp = await fetch(api`/api/modtools`, {
      credentials: 'include',
      method: 'POST',
      body: data,
    });
    callback(await resp.json());
  } catch (err) {
    callback({
      info: `Error: ${err.message}`,
    });
  }
}

function ModWatchtools() {
  const [sortAsc, setSortAsc] = useState(true);
  const [sortBy, setSortBy] = useState(0);
  const [table, setTable] = useState({});
  const [resp, setResp] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [checkedValues, setCheckedValues] = useState(new Set());

  useEffect(() => {
    setCheckedValues(new Set());
  }, [table]);

  const checkValue = (evt) => {
    const { target } = evt;
    const newCheckedValues = new Set(checkedValues);
    if (target.checked) {
      newCheckedValues.add(target.value);
    } else {
      newCheckedValues.delete(target.value);
    }
    setCheckedValues(newCheckedValues);
  };

  const [
    canvasId,
    canvases,
    userlvl,
  ] = useSelector((state) => [
    state.canvas.canvasId,
    state.canvas.canvases,
    state.user.userlvl,
  ], shallowEqual);

  const dispatch = useDispatch();

  if (userlvl < USERLVL.MOD) {
    return (<div className="content"><h1>{t`Not Allowed`}</h1></div>);
  }

  const {
    columns, types, rows, ts,
  } = table;
  const cidColumn = (types) ? (types.indexOf('cid')) : -1;

  return (
    <div style={{ textAlign: 'center' }}>
      <div className="content">
        {resp && (
          <div className="respbox">
            {resp.split('\n').map((line) => (
              <p key={line.slice(0, 3)}>
                {line}
              </p>
            ))}
            <span
              role="button"
              tabIndex={-1}
              className="modallink"
              onClick={() => setResp(null)}
            >
              {t`Close`}
            </span>
          </div>
        )}
        <p>{t`Check who placed in an area`}</p>
        <p>{t`Canvas`}:&nbsp;
          <select
            value={canvasId}
            onChange={(e) => {
              const sel = e.target;
              dispatch(selectCanvas(sel.options[sel.selectedIndex].value));
            }}
          >
            {Object.keys(canvases)
              .filter((c) => !canvases[c].v)
              .map((canvas) => (
                <option
                  key={canvas}
                  value={canvas}
                >
                  {canvases[canvas].title}
                </option>
              ))}
          </select>
          {` ${t`Interval`}: `}
          <input
            defaultValue={keepState.interval}
            style={{
              display: 'inline-block',
              width: '100%',
              maxWidth: '5em',
            }}
            type="text"
            placeholder="15m"
            onChange={(evt) => {
              const newInterval = evt.target.value.trim();
              keepState.interval = newInterval;
            }}
          />
          {` ${t`IID (optional)`}: `}
          <input
            defaultValue={keepState.iid}
            style={{
              display: 'inline-block',
              width: '100%',
              maxWidth: '10em',
            }}
            type="text"
            placeholder="xxxx-xxxxx-xxxx"
            onChange={(evt) => {
              const newIid = evt.target.value.trim();
              keepState.iid = newIid;
            }}
          />
        </p>
        <p>
          {t`Top-left corner`}:&nbsp;
          <input
            defaultValue={keepState.tlcoords}
            style={{
              display: 'inline-block',
              width: '100%',
              maxWidth: '15em',
            }}
            type="text"
            placeholder="X_Y or URL"
            onChange={(evt) => {
              let co = evt.target.value.trim();
              co = coordsFromString(co);
              if (co) {
                co = co.join('_');
                evt.target.value = co;
              }
              keepState.tlcoords = co;
            }}
          />
        </p>
        <p>
          {t`Bottom-right corner`}:&nbsp;
          <input
            defaultValue={keepState.brcoords}
            style={{
              display: 'inline-block',
              width: '100%',
              maxWidth: '15em',
            }}
            type="text"
            placeholder="X_Y or URL"
            onChange={(evt) => {
              let co = evt.target.value.trim();
              co = coordsFromString(co);
              if (co) {
                co = co.join('_');
                evt.target.value = co;
              }
              keepState.brcoords = co;
            }}
          />
        </p>
        <button
          type="button"
          onClick={() => {
            if (submitting) {
              return;
            }
            setSubmitting(true);
            submitWatchAction(
              'all',
              canvasId,
              keepState.tlcoords,
              keepState.brcoords,
              keepState.interval,
              keepState.iid,
              (ret) => {
                setSubmitting(false);
                setResp(ret.info);
                if (ret.rows) {
                  setSortBy(0);
                  setTable({
                    columns: ret.columns,
                    types: ret.types,
                    rows: ret.rows,
                    ts: Date.now(),
                  });
                }
              },
            );
          }}
        >
          {(submitting) ? '...' : t`Get Pixels`}
        </button>
        <button
          type="button"
          onClick={() => {
            if (submitting) {
              return;
            }
            setSubmitting(true);
            submitWatchAction(
              'summary',
              canvasId,
              keepState.tlcoords,
              keepState.brcoords,
              keepState.interval,
              keepState.iid,
              (ret) => {
                setSubmitting(false);
                setResp(ret.info);
                if (ret.rows) {
                  setSortBy(0);
                  setTable({
                    columns: ret.columns,
                    types: ret.types,
                    rows: ret.rows,
                    ts: Date.now(),
                  });
                }
              },
            );
          }}
        >
          {(submitting) ? '...' : t`Get Users`}
        </button>
      </div>
      <br />
      {(rows && columns && types) && (
        <Fragment key={ts}>
          <div className="modaldivider" />
          <table className="watchtable">
            <thead>
              <tr>
                {columns.slice(1).map((col, ind) => (
                  <th
                    key={col}
                    style={
                      (sortBy - 1 === ind) ? {
                        cursor: 'pointer',
                        fontWeight: 'normal',
                      } : {
                        cursor: 'pointer',
                      }
                    }
                    onClick={() => {
                      if (sortBy - 1 === ind) {
                        setSortAsc(!sortAsc);
                      } else {
                        setSortBy(ind + 1);
                      }
                    }}
                  >{col}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.sort((a, b) => {
                a = a[sortBy];
                b = b[sortBy];
                if (typeof a === 'string' && typeof b === 'string') {
                  let ret = a.localeCompare(b);
                  if (sortAsc) ret *= -1;
                  return ret;
                }
                if (!a || a === 'N/A') a = 0;
                if (!b || b === 'N/A') b = 0;
                if (a < b) return (sortAsc) ? -1 : 1;
                if (a > b) return (sortAsc) ? 1 : -1;
                return 0;
              }).map((row) => (
                <tr key={row[0]}>
                  {row.slice(1).map((val, ind) => {
                    const type = types[ind + 1];
                    if (val === null) {
                      return (<td key={type}>N/A</td>);
                    }
                    switch (type) {
                      case 'ts': {
                        const date = new Date(val);
                        const hours = date.getHours();
                        const minutes = `0${date.getMinutes()}`.slice(-2);
                        const seconds = `0${date.getSeconds()}`.slice(-2);
                        const ms = `00${date.getMilliseconds()}`.slice(-3);
                        return (
                          <td key={type} title={date.toLocaleDateString()}>
                            {`${hours}:${minutes}:${seconds}.${ms}`}
                          </td>
                        );
                      }
                      case 'clr': {
                        const cid = (cidColumn > 0)
                          ? row[cidColumn] : canvasId;
                        const rgb = canvases[cid]
                          && canvases[cid].colors
                          && canvases[cid].colors[val];
                        if (!rgb) {
                          return (<td key={type}>{val}</td>);
                        }
                        const color = `rgb(${rgb[0]},${rgb[1]},${rgb[2]})`;
                        return (
                          <td
                            key={type}
                            style={{ backgroundColor: color }}
                          >{val}</td>
                        );
                      }
                      case 'coord': {
                        const cid = (cidColumn > 0)
                          ? row[cidColumn] : canvasId;
                        const ident = canvases[cid] && canvases[cid].ident;
                        const coords = `./#${ident},${val},47`;
                        return (
                          <td key={type}>
                            <a href={coords}>{val}</a>
                          </td>
                        );
                      }
                      case 'flag': {
                        const flag = val.toLowerCase();
                        return (
                          <td key={type} title={val}><img
                            style={{
                              height: '1em',
                              imageRendering: 'crisp-edges',
                            }}
                            alt={val}
                            src={cdn`/cf/${flag}.gif`}
                          /></td>
                        );
                      }
                      case 'cid': {
                        const ident = canvases[val]?.ident;
                        return (<td key={type}>{ident}</td>);
                      }
                      case 'code': {
                        const code = Number(val);
                        let color = '#8eff8e';
                        if (code === 9) {
                          /* stack used up */
                          color = 'yellow';
                        } else if (code === 10) {
                          /* captcha */
                          color = 'orange';
                        } else if (code > 0) {
                          /* other error */
                          color = 'red';
                        }
                        return (
                          <td
                            key={type}
                            style={{ backgroundColor: color }}
                          >{val}</td>
                        );
                      }
                      case 'cidr': {
                        return (
                          <td key={type}>
                            <span
                              role="button"
                              tabIndex={-1}
                              style={{
                                cursor: 'pointer',
                                whiteSpace: 'initial',
                              }}
                              title={t`Copy to Clipboard`}
                              onClick={() => copyTextToClipboard(
                                val.slice(0, val.indexOf('/')),
                              )}
                            >{val}</span>
                          </td>
                        );
                      }
                      case 'uuid': {
                        return (
                          <td key={type}>
                            <div className="checkcontainer">
                              <input
                                type="checkbox"
                                value={val}
                                checked={checkedValues.has(val)}
                                onChange={checkValue}
                              />
                              <span
                                role="button"
                                tabIndex={-1}
                                className="modallink"
                                style={{ whiteSpace: 'initial' }}
                                title={t`Copy to Clipboard`}
                                onClick={() => copyTextToClipboard(val)}
                              >{val}</span>
                            </div>
                          </td>
                        );
                      }
                      case 'user': {
                        const seperator = val.lastIndexOf(',');
                        if (seperator === -1) {
                          return (<td key={type}><span>{val}</span></td>);
                        }
                        const uid = val.slice(seperator + 1);
                        return (
                          <td key={type}>
                            <div className="checkcontainer">
                              <input
                                type="checkbox"
                                value={uid}
                                checked={checkedValues.has(uid)}
                                onChange={checkValue}
                              />
                              <span
                                role="button"
                                tabIndex={-1}
                                className="modallink"
                                title={t`Copy UserId to Clipboard`}
                                onClick={() => copyTextToClipboard(uid)}
                              >
                                {

                                  `${val.slice(0, seperator)} [${uid}]`
                                }
                              </span>
                            </div>
                          </td>
                        );
                      }
                      default: {
                        return (<td key={type}>{val}</td>);
                      }
                    }
                  })}
                </tr>
              ))}
            </tbody>
          </table>
          <br />
          <button
            type="button"
            onClick={() => copyTextToClipboard(
              Array.from(checkedValues).join('\n'),
            )}
            disabled={checkedValues.size === 0}
          >
            {t`Copy Selected to Clipboard`}
          </button>
        </Fragment>
      )}
    </div>
  );
}

// possible types:
// 'coord', 'clr', 'ts', 'user', 'uuid', 'string', 'number', 'flag', 'cid'

export default memo(ModWatchtools);
