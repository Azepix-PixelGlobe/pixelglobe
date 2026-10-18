/*
 * state related functions
 */



/**
 * Apply a patch to a state. In example:
 * Add a channel:
 * {
 *   op: 'add',
 *   path: 'channels.1'
 *   value: [cid, name, lastTs, lastReadTs, muted, avatarId]
 * }
 * Change channel Avatar:
 * {
 *   op: 'set',
 *   path: 'channels.1[0:cid][5]',
 *   value: avatarId,
 * }
 * Remove faction with the id: 1234:
 * {
 *   op: 'del',
 *   path: 'factions[id:1234]',
 * }
 * @param state
 * @param patch {
 *   op:
 *     'add':  add into an array and create array if not exists,
 *     'push': push into an array only if it exists,
 *     'pushnx',
 *     'addnx',
 *     'set': set a target value,
 *     'setex': set a target value, but only if its target already exists,
 *     'del': delete a target value,
 *   path: a path description,
 *   [value]: given for all operations except del
 * }
 * @return [newState, firstTarget, success]
 */
export function patchState(state, patch) {
  const { path, op } = patch;
  const newState = { ...state };

  let failed = false;
  let firstTarget = null;

  let location = newState;
  let locationIndex = null;
  let sectionStart = 0;

  let targetSelectorPushNX = null;

  let i = 0;
  while (i < path.length) {
    const char = path[i];
    if (char === '.' || char === '[') {
      let locationTarget;
      if (locationIndex || locationIndex === 0) {
        if (sectionStart !== i) {
          failed = true;
          break;
        }
        locationTarget = locationIndex;
        locationIndex = null;
      } else {
        locationTarget = path.substring(sectionStart, i);
        if (!firstTarget) {
          firstTarget = locationTarget;
        }
      }
      let newLocation = location[locationTarget];
      if (!newLocation && op === 'addnx' && char === '['
        && !Array.isArray(location)
        && path.indexOf('[', i + 1) === -1
        && path.indexOf('.', i + 1) === -1
      ) {
        /*
         * special case where we create the last array for "addnx",
         * array creation for "add" would happen later
         */
        newLocation = [];
      }
      if (!newLocation || typeof newLocation !== 'object') {
        failed = true;
        break;
      }
      if (char === '.') {
        /* object in tree */
        if (Array.isArray(newLocation)) {
          failed = true;
          break;
        }
        location[locationTarget] = { ...newLocation };
        location = location[locationTarget];
        sectionStart = i + 1;
      } else {
        /* array in tree */
        if (!Array.isArray(newLocation)) {
          failed = true;
          break;
        }
        location[locationTarget] = [...newLocation];
        location = location[locationTarget];
        i += 1;
        /* array index */
        const endIndex = path.indexOf(']', i);
        if (endIndex === -1) {
          failed = true;
          break;
        }
        let index = path.substring(i, endIndex);
        if (index.includes(':')) {
          const [key, value] = index.split(':');
          // eslint-disable-next-line eqeqeq
          index = location.findIndex((l) => l?.[key] == value);
          if (index === -1) {
            if ((op === 'pushnx' || op === 'addnx')
              && endIndex === path.length - 1
            ) {
              /*
               * pushnx HAS to end with a [key:value] selector that doesn't
               * exist
               */
              targetSelectorPushNX = [key, value];
            } else {
              failed = true;
            }
            break;
          }
          locationIndex = index;
        } else {
          locationIndex = Number(index);
          if (Number.isNaN(locationIndex)) {
            failed = true;
            break;
          }
        }
        i = endIndex;
        sectionStart = i + 1;
      }
    }
    i += 1;
  }

  /*
  console.log('location', location);
  console.log('firstTarget', firstTarget);
  console.log('locationIndex', locationIndex);
  console.log('sectionStart', sectionStart, sectionStart === path.length);
  console.log('pushnx', targetSelectorPushNX);
  */

  let target;
  if (!failed) {
    if (locationIndex || locationIndex === 0) {
      if (sectionStart !== path.length) {
        failed = true;
      } else {
        target = locationIndex;
      }
    } else {
      target = path.substring(sectionStart);
      if (!firstTarget) {
        firstTarget = target;
      }
    }
  }

  const { value } = patch;
  if (!failed) {
    switch (op) {
      case 'add': {
        if (!location[target]) {
          location[target] = [value];
          break;
        }
      }
      // eslint-disable-next-line no-fallthrough
      case 'push': {
        if (!Array.isArray(location[target])) {
          failed = true;
        } else {
          location[target].push(value);
        }
        break;
      }
      case 'addnx':
      case 'pushnx': {
        if (!targetSelectorPushNX || !Array.isArray(location)) {
          failed = true;
        } else {
          location.push(value);
        }
        break;
      }
      case 'setex': {
        if (typeof location[target] === 'undefined') {
          failed = true;
          break;
        }
      }
      // eslint-disable-next-line no-fallthrough
      case 'set': {
        location[target] = value;
        break;
      }
      case 'del': {
        if (!location[target]) {
          failed = true;
        } else if (Array.isArray(location)) {
          location.splice(target, 1);
        } else {
          delete location[target];
        }
        break;
      }
      default:
        failed = true;
    }
  }

  if (failed || !patch.op) {
    return [state, firstTarget, false];
  }
  return [newState, firstTarget, true];
}
