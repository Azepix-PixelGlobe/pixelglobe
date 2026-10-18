/*
 * show some data as table
 */
import { useState } from 'preact/hooks';
import { c, t } from 'ttag';

import useLink from './hooks/link.js';
import { cdn } from '../utils/utag.js';
import { getUrlsFromMediaIdAndName } from '../utils/media/utils.js';
import { numberToStringFull } from '../core/utils.js';
import MdParagraph from './markdown/MdParagraph.jsx';

const Table = ({
  rows, columnIds, types, uniqueColumnKey = 0, sortColumnKey = 0,
}) => {
  const [sortAsc, setSortAsc] = useState(true);
  const [sortBy, setSortBy] = useState(sortColumnKey);

  const link = useLink();

  const columnIdToNames = {
    avatar: t`Avatar`,
    title: t`Title`,
    name: t`Name`,
    description: t`Description`,
    /* t: Column title in tables */
    time: t`Time`,
    /* t: Column title of column indicating whether or not a faction is able to be joined in public */
    ispublic: c('statistics-table').t`Public`,
    members: t`Members`,
    role: t`Role`,
    joined: t`Joined`,
    /* eslint-disable camelcase */
    today_rank: t`Daily Rank`,
    today_pixel: t`Daily Pixels`,
    yesterday_rank: t`Rank`,
    yesterday_pixel: t`Pixels`,
    /* eslint-enable camelcase */
    rank: t`Rank`,
    pixel: t`Pixels`,
  };

  if (!columnIds || !rows || !types) {
    return null;
  }

  return (
    <table>
      <thead>
        <tr>
          {columnIds.map((col, ind) => {
            if (types[ind] === 'hidden') {
              return null;
            }
            return (
              <th
                key={col}
                style={
                  (sortBy === ind) ? {
                    cursor: 'pointer',
                    fontWeight: 'normal',
                  } : {
                    cursor: 'pointer',
                  }
                }
                onClick={() => {
                  if (sortBy === ind) {
                    setSortAsc(!sortAsc);
                  } else {
                    setSortBy(ind);
                  }
                }}
              >{columnIdToNames[col] || col}</th>
            );
          })}
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
          if (!a) a = 0;
          if (!b) b = 0;
          if (a < b) return (sortAsc) ? -1 : 1;
          if (a > b) return (sortAsc) ? 1 : -1;
          return 0;
        }).map((row) => (
          <tr key={row[uniqueColumnKey]}>
            {row.map((val, ind) => {
              const type = types[ind];
              const key = columnIds[ind];
              if (!val && val !== 0 && type !== 'user' && type !== 'faction') {
                return (<td key={key} />);
              }

              switch (type) {
                case 'bool':
                  return <td key={key}>{val && 'X'}</td>;
                case 'number':
                  return (
                    <td key={key} className="number-cell">
                      {numberToStringFull(val)}
                    </td>
                  );
                case 'mdstring' :
                  return <td><MdParagraph text={val} /></td>;
                case 'faction': {
                  if (!val) {
                    return (<td key={key}>{t`Private`}</td>);
                  }
                  const seperator = val.lastIndexOf(',');
                  if (seperator === -1) {
                    return (<td key={key}>{val}</td>);
                  }
                  const name = val.substring(seperator + 1);
                  return (
                    <td key={key}>
                      <span
                        role="button"
                        tabIndex={-1}
                        className="modallink"
                        onClick={(evt) => {
                          evt.stopPropagation();
                          link('FACTION', {
                            target: 'blank',
                            args: { name },
                          });
                        }}
                      >
                        {`${val.substring(0, seperator)} [${name}]`}
                      </span>
                    </td>
                  );
                }
                case 'user': {
                  if (!val) {
                    return (<td key={key}>{t`Private`}</td>);
                  }
                  const seperator = val.lastIndexOf(',');
                  if (seperator === -1) {
                    return (<td key={key}>{val}</td>);
                  }
                  const username = val.substring(seperator + 1);
                  return (
                    <td key={key}>
                      <span
                        role="button"
                        tabIndex={-1}
                        className="modallink"
                        onClick={(evt) => {
                          evt.stopPropagation();
                          link('USER', {
                            target: 'parent',
                            args: { username },
                          });
                        }}
                      >
                        {`${val.substring(0, seperator)} [${username}]`}
                      </span>
                    </td>
                  );
                }
                case 'mediaId': {
                  let [url,, thumb] = getUrlsFromMediaIdAndName(val);
                  if (thumb) {
                    thumb = `url(${cdn`${thumb}`})`;
                  }
                  return (
                    <td key={key}>
                      <div
                        className="search-media"
                        style={{
                          backgroundImage: thumb || undefined,
                        }}
                        onClick={(url) ? (evt) => {
                          evt.stopPropagation();
                          link('PLAYER', {
                            reuse: true,
                            target: 'blank',
                            args: { uri: url },
                          });
                        } : undefined}
                      />
                    </td>
                  );
                }
                case 'flagId': {
                  const url = getUrlsFromMediaIdAndName(val)[0];
                  if (url) {
                    return (
                      <td key={key}>
                        <img
                          src={cdn`${url}`}
                          className="chatflag"
                          title={val}
                          alt=""
                        />
                      </td>
                    );
                  }
                  return (<td key={key} />);
                }
                case 'ts':
                  return (
                    <td key={key}>{
                      (new Date(val)).toLocaleDateString()
                    }</td>
                  );
                case 'hidden':
                  return null;
                default:
                  return (<td key={key}>{val}</td>);
              }
            })}
          </tr>
        ))}
      </tbody>
    </table>
  );
};

export default Table;
