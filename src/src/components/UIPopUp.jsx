/*
 * UI for single-window popUp
 */

import { useMemo } from 'preact/hooks';
import { memo, Suspense } from 'preact/compat';
import { t } from 'ttag';
import { useSelector, useDispatch } from '../store/react-redux/index.js';

import {
  selectWindowType, selectWindowArgs,
} from '../store/selectors/popup.js';
import {
  setWindowArgs,
  setWindowTitle,
  changeWindowType,
  togglePopUpfs,
} from '../store/actions/popup.js';
import WindowContext from './context/window.js';
import COMPONENTS from './windows/index.js';

const UIPopUp = () => {
  const windowType = useSelector(selectWindowType);
  const args = useSelector(selectWindowArgs);
  const fsPopUps = useSelector((state) => state.gui.fsPopUps);

  const [Content,, showInModal] = COMPONENTS[windowType];

  const dispatch = useDispatch();

  const contextData = useMemo(() => ({
    args,
    params: window.ssv?.params || {},
    setArgs: (newArgs) => dispatch(setWindowArgs(newArgs)),
    setTitle: (title) => dispatch(setWindowTitle(title)),
    // eslint-disable-next-line max-len
    changeType: (newType, newTitle, newArgs) => dispatch(changeWindowType(newType, newTitle, newArgs)),
  }), [args, dispatch]);

  const isFullscreen = fsPopUps.includes(windowType);

  return (
    <div
      className={`popup-modal${(isFullscreen || !showInModal) ? ' fs' : ''}`}
    >
      {(showInModal) && (
        <div key="fsbtnw" className="popup-fsbtn-wrapper">
          <div
            className="popup-fsbtn"
            onClick={() => dispatch(togglePopUpfs(windowType))}
          ><span>{(isFullscreen) ? '⇙' : '⇗'}</span></div>
        </div>
      )}
      <div className="popup-content">
        <WindowContext.Provider value={contextData}>
          {(windowType)
            ? (
                <Suspense
                  fallback={<div className="content">{t`Loading...`}</div>}
                >
                  <Content />
                </Suspense>
              ) : <h1>{t`Loading...`}</h1>}
        </WindowContext.Provider>
      </div>
    </div>
  );
};

export default memo(UIPopUp);
