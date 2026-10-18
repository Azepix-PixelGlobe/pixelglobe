/*
 * component that shows a login form if not loged in and its children otherwise
 */

import { useSelector } from '../store/react-redux/index.js';

import LogInForm from './LogInForm.jsx';

const LogInRequired = ({ children, title }) => {
  const userId = useSelector((state) => state.user.id);

  if (!userId) {
    return (
      <LogInForm title={title} />
    );
  }
  return children;
};

export default LogInRequired;
