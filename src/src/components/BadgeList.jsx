/*
 * List of badges inside profile
 */
import { useState } from 'preact/hooks';
import { memo } from 'preact/compat';
import { t } from 'ttag';

import useLink from './hooks/link.js';
import { cdn } from '../utils/utag.js';

const BadgeList = ({ badges }) => {
  const [expanded, setExpanded] = useState(false);
  const link = useLink();
  if (!badges.length) {
    return null;
  }
  const sliceTill = (expanded) ? badges.length : 4;

  return (
    <p className="badgelist">
      <span className="stattext">{t`Badges`}:</span>
      {badges.slice(0, sliceTill).map(({ name, description, ts, id }) => {
        const shortname = name.toLowerCase().split(' ').join('');
        return (
          <span
            key={ts}
            className="profilebadge"
            title={description}
            onClick={(evt) => {
              evt.stopPropagation();
              link('BADGE_DISPLAY', {
                reuse: true,
                target: 'blank',
                args: { id },
                title: name,
                width: 300,
                height: 580,
              });
            }}
          >
            <img
              className={`profilebadge-img ${shortname}`}
              src={cdn`/badges/thumb/${shortname}.webp`}
              alt={name}
            />
          </span>
        );
      })}
      {(badges.length > 4) && (
        <span
          key="expand"
          className="profilebadge expandbtn"
          title={(expanded) ? t`Retract` : t`Expand`}
          onClick={(evt) => {
            evt.stopPropagation();
            setExpanded(!expanded);
          }}
        >
          <span>{(expanded) ? '◄' : '►'}</span>
        </span>
      )}
    </p>
  );
};

export default memo(BadgeList);
