/*
 * watching live logs, selective by moderation level
 */
import {
  useEffect, useState, useCallback, useRef, useMemo,
} from 'preact/hooks';
import { useSelector } from '../store/react-redux/index.js';
import { t } from 'ttag';

import { api } from '../utils/utag.js';
import IoIosRefresh from '../icons/IoIosRefresh.svg';
import useInterval from './hooks/interval.js';
import { escapeMd } from '../core/utils.js';
import { USERLVL } from '../core/constants.js';

const ModLogTools = () => {
  const [logLines, setLogLines] = useState([]);
  const [liveUpdate, setLiveUpdate] = useState(true);
  const [filterTerm, setFilterTerm] = useState(null);
  const lastTsRef = useRef(0);

  const updateLogs = useCallback(async () => {
    const lastTs = lastTsRef.current;

    /* null indicated we are already fetching */
    if (lastTs === null) {
      return;
    }
    lastTsRef.current = null;

    const data = new FormData();
    data.append('livelog', true);
    data.append('lastts', lastTs);
    let newLogs;
    try {
      let res = await fetch(api`/api/modtools`, {
        credentials: 'include',
        method: 'POST',
        body: data,
      });
      if (!res.ok) {
        throw new Error();
      }
      res = await res.json();
      if (!res.length) {
        throw new Error();
      }
      lastTsRef.current = res[0][0];
      newLogs = res.map(([ts,, typeDescription, params, uid, name]) => {
        const date = new Date(ts);
        // eslint-disable-next-line max-len
        return `${date.toLocaleDateString()}-${date.toLocaleTimeString()} ${name ? escapeMd(name) : 'N/A'} ${uid || 0} ${typeDescription.replaceAll(' ', '-')} ${params.join(' ')}`;
      });
    } catch {
      lastTsRef.current = lastTs;
      return;
    }

    if (newLogs.length) {
      setLogLines((lines) => {
        let newLines = newLogs.concat(lines);
        if (newLines.length > 500) {
          newLines.splice(500);
        }
        return newLines;
      });
    }
  }, []);

  const doLiveUpdate = useCallback(() => {
    if (liveUpdate) updateLogs();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [liveUpdate]);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(updateLogs, []);

  useInterval(doLiveUpdate, 4500);

  const logText = useMemo(() => {
    let filteredLogLines = logLines;
    if (filterTerm) {
      const insensitiveFilterTerm = filterTerm.toLowerCase();
      filteredLogLines = filteredLogLines.filter(
        (l) => l.toLowerCase().includes(insensitiveFilterTerm),
      );
    }
    return filteredLogLines.join('\n');
  }, [logLines, filterTerm]);

  const userlvl = useSelector((state) => state.user.userlvl);
  if (userlvl < USERLVL.CHATMOD) {
    return (<div className="content"><h1>{t`Not Allowed`}</h1></div>);
  }

  return (
    <div className="content">
      <p>{t`Filter`}:&nbsp;
        <input
          type="text"
          placeholder={t`Search Term`}
          onChange={(evt) => {
            evt.stopPropagation();
            let term = evt.target.value.trim();
            if (!term) {
              term = null;
            }
            if (term !== filterTerm) {
              setFilterTerm(term);
            }
          }}
        />&nbsp;
        <button
          type="button"
          title={t`Refresh`}
          onClick={(evt) => {
            evt.stopPropagation();
            updateLogs();
          }}
        ><IoIosRefresh /></button>
      </p>
      <p>Live update:&nbsp;
        <input
          type="checkbox"
          checked={liveUpdate}
          onChange={(evt) => {
            evt.stopPropagation();
            if (!liveUpdate) {
              updateLogs();
            }
            setLiveUpdate(!liveUpdate);
          }}
        />
      </p>
      <textarea
        style={{
          width: '100%',
        }}
        rows={40}
        value={logText}
        readOnly
      />
    </div>
  );
};

export default ModLogTools;
