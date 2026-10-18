/**
 *
 */

import { memo } from 'preact/compat';
import { useSelector } from '../../store/react-redux/index.js';
import MdFileDownload from '../../icons/MdFileDownload.svg';
import fileDownload from 'js-file-download';
import { t } from 'ttag';

import { getRenderer } from '../../ui/rendererFactory.js';

/**
 * https://jsfiddle.net/AbdiasSoftware/7PRNN/
 */
function download(view) {
  const renderer = getRenderer();
  const viewport = renderer.getViewport();
  if (!viewport) return;

  const [x, y] = view.map(Math.round);
  const filename = `pixelplanet-${x}-${y}.png`;

  viewport.toBlob((blob) => fileDownload(blob, filename));
}


const DownloadButton = () => {
  const view = useSelector((state) => state.canvas.view);

  return (
    <div
      id="downloadbutton"
      className="actionbuttons"
      role="button"
      title={t`Make Screenshot`}
      tabIndex={0}
      onClick={() => download(view)}
    >
      <MdFileDownload />
    </div>
  );
};

export default memo(DownloadButton);
