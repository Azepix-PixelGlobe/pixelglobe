import { useState, useEffect } from 'preact/hooks';
import { memo } from 'preact/compat';
import { useSelector } from '../store/react-redux/index.js';


const NotifyBox = () => {
  const [className, setClassName] = useState('notifybox');
  const notification = useSelector((state) => state.user.notification);

  useEffect(() => {
    if (notification) {
      let newClassName = 'notifybox';
      if (notification && typeof notification !== 'string') {
        if (notification > 0) newClassName += ' green';
        else newClassName += ' red';
      }
      if (newClassName !== className) {
        setClassName(newClassName);
      }
    }
  }, [notification, className]);

  return (
    <div
      className={(notification) ? `${className} show` : className}
    >
      {notification}
    </div>
  );
};

export default memo(NotifyBox);
