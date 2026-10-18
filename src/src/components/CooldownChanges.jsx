/*
 * display cooldown changes per country
 */

/* eslint-disable max-len */

import { memo } from 'preact/compat';
import { useSelector } from '../store/react-redux/index.js';
import { t } from 'ttag';

import { cdn } from '../utils/utag.js';

const CooldownChanges = () => {
  const cooldownChanges = useSelector((state) => state.ranks.cooldownChanges);

  if (!cooldownChanges.length) {
    return null;
  }

  return (
    <>
      <h3>{t`Current Cooldown Changes per Country`}</h3>
      <table style={{ display: 'inline' }}>
        <thead>
          <tr>
            <th>{t`Country`}</th>
            <th>{t`Factor`}</th>
          </tr>
        </thead>
        <tbody>
          {cooldownChanges.map(([cc, factor]) => (
            <tr key={cc}>
              <td
                title={cc}
                className="tab-cc-cell"
              >
                <img
                  alt={cc}
                  src={cdn`/cf/${cc}.gif`}
                />
              </td>
              <td>
                x&nbsp;{factor}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p>
        {t`Cooldown is usually automatically changed for a country that is dominating. In example in the case of a streamer raid.`}
      </p>
    </>
  );
};

export default memo(CooldownChanges);
