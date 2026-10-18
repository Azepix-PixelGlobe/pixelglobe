import { useState } from 'preact/hooks';
import { memo } from 'preact/compat';
import { t } from 'ttag';

import { cdn } from '../utils/utag.js';

/**
 * A list of items, where every single entry can be deleted
 * @param list [
 *   [identifier, string, iconUrl, [isDisabled]], ...
 * ]
 * @param callback that will be called with identifier and string
 * @param joinident if identifier should be shown as well
 * @param enabled boolean
 */
const DeleteList = ({ list, callback, enabled, joinident }) => {
  const [selected, setSelected] = useState(null);
  if (!list.length) {
    return null;
  }


  return (
    <div className="deletelist">{
      list.map(([identifier, name, iconUrl]) => (
        <div
          key={identifier}
          className={`deletelistitem ${
            (selected === identifier) ? 'selected' : 'unselected'
          }`}
          title={`${t`Remove`} ${name}`}
          role="button"
          onClick={() => setSelected(
            (selected === identifier) ? null : identifier,
          )}
          tabIndex={0}
        >
          {(iconUrl) ? (
            <img
              key="ic"
              alt=""
              src={cdn`${iconUrl}`}
            />
          ) : '⦸ '}
          {(joinident) ? `${name} [${identifier}]` : `${name} `}
          <button
            type="button"
            disabled={!(enabled && selected === identifier)}
            onClick={() => callback(identifier, name)}
          >
            {(selected === identifier) ? '🗑' : '‣'}
          </button>
        </div>
      ))
    }
    </div>
  );
};

export default memo(DeleteList);
