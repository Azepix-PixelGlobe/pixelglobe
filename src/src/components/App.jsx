/**
 * Main App
 */
if (process.env.NODE_ENV === 'development') {
  // Must use require here as import statements are only allowed
  // to exist at top-level.
  require('preact/debug');
}

import {
  Provider,
  useSelector,
} from '../store/react-redux/index.js';
import { useEffect } from 'preact/hooks';
import { render } from 'preact';

import Style from './Style.jsx';
import CoordinatesBox from './CoordinatesBox.jsx';
import OnlineBox from './OnlineBox.jsx';
import ChatButton from './buttons/ChatButton.jsx';
import TopButtons from './buttons/TopButtons.jsx';
import ChaosBanner from './ChaosBanner.jsx';
import UI from './UI.jsx';
import WindowManager from './WindowManager.jsx';
import PixelInfoHost from './PixelInfoHost.jsx';
import WelcomeRulesModal from './WelcomeRulesModal.jsx';
import NoraTour from './NoraTour.jsx';
import PixelGlobeTheme from './PixelGlobeTheme.jsx';
import MenuProvider from './menus/index.jsx';
import { selectHasVisibleWindow } from '../store/selectors/windows.js';

const App = () => {
  const hasVisibleWindow = useSelector(selectHasVisibleWindow);

  useEffect(() => {
    const appRoot = document.getElementById('app') || document.body;
    const updateWindowClass = () => {
      const hasOpenWindow = Boolean(appRoot.querySelector('.window.show'));
      document.documentElement.classList.toggle(
        'pixel-window-open',
        hasOpenWindow,
      );
    };

    updateWindowClass();
    const observer = new MutationObserver(updateWindowClass);
    observer.observe(appRoot, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['class'],
    });

    return () => {
      observer.disconnect();
      document.documentElement.classList.remove('pixel-window-open');
    };
  }, []);

  return (
    <>
      <Style />
      <PixelGlobeTheme />
      <WelcomeRulesModal />
      <NoraTour />
      <ChaosBanner />
      <MenuProvider>
        {(!hasVisibleWindow) && (
          <div id="canvas-controls">
            <ChatButton />
            <OnlineBox />
            <CoordinatesBox />
            <TopButtons />
            <UI />
          </div>
        )}
        <WindowManager />
        <PixelInfoHost />
      </MenuProvider>
    </>
  );
};

function renderApp(domParent, store) {
  render(
    <Provider store={store}>
      <App />
    </Provider>,
    domParent,
  );
}

export default renderApp;
