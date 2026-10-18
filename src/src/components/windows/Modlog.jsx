/*
 * Moderation logs
 */
import { useState, useEffect, useCallback } from 'preact/hooks';
import { memo } from 'preact/compat';
import { t } from 'ttag';

import { requestModLogs } from '../../store/actions/fetch.js';
import Table from '../Table.jsx';
import IoIosRefresh from '../../icons/IoIosRefresh.svg';

/* eslint-disable max-len */

const Modlogs = () => {
  const [data, setData] = useState({});
  const [filterTerm, setFilterTerm] = useState(null);

  const requestData = useCallback(async () => {
    const reqData = await requestModLogs();
    if (!reqData.errors) {
      setData(reqData);
    }
  }, []);

  useEffect(() => {
    requestData();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const { rows = [], columnIds = [], types = [], uniqueColumnKey = 0 } = data;

  return (
    <div className="content">
      <h2>{t`Moderation Logs`}</h2>
      <p>{t`Selected moderation actions that happened within the past two weeks.`}</p>
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
            requestData();
          }}
        ><IoIosRefresh /></button>
      </p>
      <Table
        rows={rows.filter((row) => {
          if (!filterTerm) {
            return true;
          }
          for (const val of row) {
            if (val?.includes?.(filterTerm)) {
              return true;
            }
          }
          return false;
        })}
        columnIds={columnIds}
        types={types}
        uniqueColumnKey={uniqueColumnKey}
        sortColumnKey={uniqueColumnKey}
      />
    </div>
  );
};

export default memo(Modlogs);
