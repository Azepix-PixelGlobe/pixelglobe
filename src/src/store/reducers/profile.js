import { patchState } from '../index.js';

const initialState = {
  fishes: [],
  badges: [],
  /*
   * [{
   *     name,
   *     title,
   *     description,
   *     isPrivate,
   *     isPublic,
   *     isHidden,
   *     memberCount,
   *     avatarId,
   *     roles: [{
   *       frid,
   *       name,
   *       customFlagId,
   *       factionlvl,
   *       isMember,
   *     }, ...],
   *   }, ...],
   */
  factions: [],
  activeFactionRole: null,
  /*
   * two letter custom flag code
   */
  customFlag: null,
  /*
   * media id of user avtar
   */
  avatarId: null,
  /*
   * whether or not profile is fetched
   */
  fetched: false,
};

export default function profile(state = initialState, action) {
  switch (action.type) {
    case 's/REC_PROFILE':
      return {
        ...state,
        ...action.profile,
        fetched: true,
      };

    case 's/PATCH_STATE': {
      if (action.state === 'profile') {
        return patchState(state, action.patch)[0];
      }
      return state;
    }

    case 's/REC_ME':
    case 's/LOGIN':
    case 's/LOGOUT':
      // reset profile if user changes
      return { ...initialState };

    default:
      return state;
  }
}
