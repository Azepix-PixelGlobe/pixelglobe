/**
 * Main App
 */
if (process.env.NODE_ENV === 'development') {
  // Must use require here as import statements are only allowed
  // to exist at top-level.
  require('preact/debug');
}

import { Provider } from '../store/react-redux/index.js';
import { render } from 'preact';

import Style from './Style.jsx';
import UIPopUp from './UIPopUp.jsx';
import MenuProvider from './menus/index.jsx';

const AppPopUp = () => (
  <>
    <Style />
    <MenuProvider>
      <UIPopUp />
    </MenuProvider>
  </>
);

function renderAppPopUp(domParent, store) {
  render(
    <Provider store={store}>
      <AppPopUp />
    </Provider>,
    domParent,
  );
}

export default renderAppPopUp;
