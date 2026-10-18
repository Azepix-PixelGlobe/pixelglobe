/*
 *
 */

import { useState, useEffect, useCallback } from 'preact/hooks';
import { memo } from 'preact/compat';
import { useSelector, useDispatch } from '../store/react-redux/index.js';

import GlobalCaptcha from './GlobalCaptcha.jsx';
import BanInfo from './BanInfo.jsx';
import Overlay from './Overlay.jsx';
import RefreshPrompt from './RefreshPrompt.jsx';
import { closeAlert } from '../store/actions/index.js';
import Markdown from './markdown/Markdown.jsx';

const Alert = () => {
  const [render, setRender] = useState(false);

  const {
    open,
    alertType,
    title,
    message,
    btn,
  } = useSelector((state) => state.alert);

  const dispatch = useDispatch();
  const close = useCallback(() => {
    dispatch(closeAlert());
  }, [dispatch]);

  useEffect(() => {
    if (open) {
      window.setTimeout(() => {
        setRender(true);
      }, 10);
    }
  }, [open]);

  let Content = null;
  switch (alertType) {
    case 'captcha':
      Content = GlobalCaptcha;
      break;
    case 'ban':
      Content = BanInfo;
      break;
    case 'refresh':
      Content = RefreshPrompt;
      break;
    default:
      // nothing
  }

  if (!render && !open) {
    return null;
  }

  const show = open && render;

  return (
    <>
      <Overlay
        z={6}
        show={show}
        onClick={close}
      />
      <div
        className={(show) ? 'Alert show' : 'Alert'}
        onTransitionEnd={() => {
          if (!open) setRender(false);
        }}
      >
        <h2>{title}</h2>
        {(message) && (
          <Markdown text={message} parseLinks />
        )}
        {(Content) ? (
          <Content close={close} />
        ) : (
          <button type="button" onClick={close}>{btn}</button>
        )}
      </div>
      )
    </>
  );
};

export default memo(Alert);
