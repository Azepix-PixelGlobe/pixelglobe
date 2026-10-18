/*
 * Modtools
 */
import { useLayoutEffect, useContext, useCallback } from 'preact/hooks';
import { Fragment } from 'preact';
import { memo } from 'preact/compat';
import { useSelector } from '../../store/react-redux/index.js';

import WindowContext from '../context/window.js';
import Canvastools from '../Canvastools.jsx';
import Admintools from '../Admintools.jsx';
import Watchtools from '../Watchtools.jsx';
import Mediatools from '../Mediatools.jsx';
import ModLogTools from '../ModLogTools.jsx';
import IIDTools from '../IIDTools.jsx';
import { USERLVL } from '../../core/constants.js';

const CONTENT = {
  Canvas: Canvastools,
  Admin: Admintools,
  Watch: Watchtools,
  IID: IIDTools,
  Media: Mediatools,
  Logs: ModLogTools,
};

function Modtools() {
  const {
    args,
    setArgs,
    setTitle,
  } = useContext(WindowContext);
  const { activeTab } = args;

  const setActiveTab = useCallback((label) => {
    setArgs({
      activeTab: label,
    });
    setTitle(label);
  }, [setArgs, setTitle]);

  const userlvl = useSelector((state) => state.user.userlvl);

  const parts = Object.keys(CONTENT)
    .filter((part) => {
      switch (part) {
        case 'Admin':
          return userlvl >= USERLVL.ADMIN;
        case 'Watch':
        case 'IID':
          return userlvl >= USERLVL.MOD;
        case 'Canvas':
          return userlvl >= USERLVL.JANNY;
        case 'Media':
        case 'Logs':
          return userlvl >= USERLVL.CHATMOD;
        default:
          return false;
      }
    });

  useLayoutEffect(() => {
    if (!activeTab) {
      setActiveTab(parts[0]);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab]);

  const Content = CONTENT[activeTab];

  return (
    <>
      {(parts.length > 1) && (
        <div
          key="tabm"
          className="content tab-container margin-container"
        >
          {parts.map((part, ind) => (
            <Fragment key={part}>
              <span
                role="button"
                tabIndex={-1}
                className={
                  (activeTab === part) ? 'modallink selected' : 'modallink'
                }
                onClick={() => setActiveTab(part)}
              >{part}</span>
              {(ind !== parts.length - 1)
                && <span className="hdivider" />}
            </Fragment>
          ))}
          <div className="modaldivider" />
        </div>
      )}
      {Content && <Content />}
    </>
  );
}

export default memo(Modtools);
