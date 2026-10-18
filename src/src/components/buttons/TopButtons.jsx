/*
 * Top-left floating round button bar (pixeldays.xyz style)
 * Row: [toggle] [canvas] [templates] [3D]
 * Expanded column: [settings] [user/login] [download] [help]
 */

import { useState, useCallback } from 'preact/hooks';
import { memo } from 'preact/compat';
import {
  useSelector, shallowEqual,
} from '../../store/react-redux/index.js';
import { t } from 'ttag';
import fileDownload from 'js-file-download';

import FaCog from '../../icons/FaCog.svg';
import FaFlipboard from '../../icons/FaFlipboard.svg';
import FaPaintRoller from '../../icons/FaPaintRoller.svg';
import FaQuestion from '../../icons/FaQuestion.svg';
import Md3dRotation from '../../icons/Md3dRotation.svg';
import MdFileDownload from '../../icons/MdFileDownload.svg';
import MdPerson from '../../icons/MdPerson.svg';

import useLink from '../hooks/link.js';
import { getRenderer } from '../../ui/rendererFactory.js';
import { CANVAS_TYPES, USERLVL } from '../../core/constants.js';

function download(view) {
  const renderer = getRenderer();
  const viewport = renderer.getViewport();
  if (!viewport) return;
  const [x, y] = view.map(Math.round);
  const filename = `pixelplanet-${x}-${y}.png`;
  viewport.toBlob((blob) => fileDownload(blob, filename));
}

/* Animated hamburger → X icon */
const HamburgerIcon = ({ open }) => (
  <span className={`hamburger-icon${open ? ' open' : ''}`} aria-hidden="true">
    <span />
    <span />
    <span />
  </span>
);

const RoundBtn = ({
  title, onClick, children, active,
}) => (
  <button
    type="button"
    className={`topbtn${active ? ' topbtn-active' : ''}`}
    title={title}
    aria-label={title}
    onClick={onClick}
  >
    {children}
  </button>
);

const TopButtons = () => {
  const [expanded, setExpanded] = useState(false);

  const [
    view,
    rendererType,
    userName,
    userlvl,
    canvasIdent,
    canvasId,
    canvasSize,
  ] = useSelector((state) => [
    state.canvas.view,
    state.canvas.rendererType,
    state.user.name,
    state.user.userlvl,
    state.canvas.canvasIdent,
    state.canvas.canvasId,
    state.canvas.canvasSize,
  ], shallowEqual);

  const link = useLink();

  const is3D = rendererType === CANVAS_TYPES.THREED;

  const goGlobe = useCallback(() => {
    const [x, y] = view.map(Math.round);
    window.location.href = `globe#${canvasIdent},${canvasId},${canvasSize},${x},${y}`;
  }, [view, canvasIdent, canvasId, canvasSize]);

  const openCanvas = useCallback(() => {
    link('CANVAS_SELECTION', { target: 'parent' });
  }, [link]);

  const openTemplates = useCallback(() => {
    link('TEMPLATES', { target: 'parent', reuse: true });
  }, [link]);

  const openSettings = useCallback(() => {
    link('SETTINGS', { target: 'parent', reuse: true });
  }, [link]);

  const openUser = useCallback(() => {
    link('USERAREA', { target: 'parent', reuse: true });
  }, [link]);

  const openHelp = useCallback(() => {
    link('HELP', { target: 'parent', reuse: true });
  }, [link]);

  const openAdminPanel = useCallback(() => {
    link('ADMINPANEL', { target: 'parent', reuse: true });
  }, [link]);

  const openMarket = useCallback(() => {
    link('MARKET', { target: 'parent', reuse: true });
  }, [link]);

  const openTemplateShare = useCallback(() => {
    link('TEMPLATESHARE', { target: 'parent', reuse: true });
  }, [link]);

  const toggleLabel = expanded ? t`Close Menu` : t`Open Menu`;

  return (
    <div id="topbtnbar">
      {/* Horizontal top row */}
      <div id="topbtnrow">
        <button
          type="button"
          className={`topbtn${expanded ? ' topbtn-active' : ''}`}
          title={toggleLabel}
          aria-label={toggleLabel}
          aria-expanded={expanded}
          aria-controls="topbtncol"
          onClick={() => setExpanded((e) => !e)}
        >
          <HamburgerIcon open={expanded} />
        </button>

        <RoundBtn title={t`Canvas Selection`} onClick={openCanvas}>
          <FaFlipboard />
        </RoundBtn>

        <RoundBtn title={t`Templates`} onClick={openTemplates}>
          <FaPaintRoller />
        </RoundBtn>

        {!is3D && (
          <RoundBtn title={t`Globe View`} onClick={goGlobe}>
            <Md3dRotation />
          </RoundBtn>
        )}
      </div>

      {/* Vertical expanded column — always rendered, animated via CSS */}
      <div
        id="topbtncol"
        className={expanded ? 'open' : ''}
        aria-hidden={!expanded}
      >
        <RoundBtn title={t`Settings`} onClick={openSettings}>
          <FaCog />
        </RoundBtn>

        <RoundBtn
          title={userName ? t`User Area` : t`Log in or Register`}
          onClick={openUser}
        >
          <MdPerson />
        </RoundBtn>

        {userName && (
          <RoundBtn title="Market" onClick={openMarket}>
            <span style={{ fontSize: '1.05em' }}>🛒</span>
          </RoundBtn>
        )}

        <RoundBtn title={t`Shared Templates`} onClick={openTemplateShare}>
          <span style={{ fontSize: '1.05em' }}>📋</span>
        </RoundBtn>

        {userlvl >= USERLVL.ADMIN && (
          <RoundBtn title="Admin Panel" onClick={openAdminPanel}>
            <span style={{ fontSize: '1.1em', fontWeight: 800 }}>A</span>
          </RoundBtn>
        )}

        <RoundBtn title={t`Make Screenshot`} onClick={() => download(view)}>
          <MdFileDownload />
        </RoundBtn>

        <RoundBtn title={t`Help`} onClick={openHelp}>
          <FaQuestion />
        </RoundBtn>
      </div>
    </div>
  );
};

export default memo(TopButtons);
