import { useEffect } from 'preact/hooks';
import {
  useSelector, shallowEqual, useDispatch,
} from '../../store/react-redux/index.js';

import { fetchProfile } from '../../store/actions/thunks.js';

function useProfile(selector) {
  const [fetched, ...value] = useSelector((state) => {
    const ret = selector(state.profile);
    if (Array.isArray(ret)) {
      return [
        state.profile.fetched,
        ...ret,
      ];
    }
    return [
      state.profile.fetched,
      ret,
    ];
  }, shallowEqual);
  const dispatch = useDispatch();

  useEffect(() => {
    if (!fetched) {
      dispatch(fetchProfile());
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetched]);

  return [...value, fetched];
}

export default useProfile;
