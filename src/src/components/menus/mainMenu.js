/*
 * top left main menu
 */

// settings cog wheel
import FaCog from '../../icons/FaCog.svg';
// Questionmark
import FaQuestion from '../../icons/FaQuestion.svg';
// canvas icon
import FaFlipboard from '../../icons/FaFlipboard.svg';
// paint roller for templates
import FaPaintRoller from '../../icons/FaPaintRoller.svg';
// shield
import FaShieldAlt from '../../icons/FaShieldAlt.svg';
// search icon
import FaSearch from '../../icons/FaSearch.svg';
// download symbol
import MdFileDownload from '../../icons/MdFileDownload.svg';
// User Symbol
import MdPerson from '../../icons/MdPerson.svg';
// 3d symbol,
import Md3dRotation from '../../icons/Md3dRotation.svg';
// bar chart
import IoIosStats from '../../icons/IoIosStats.svg';
// battle axe
import PiAxeFill from '../../icons/PiAxeFill.svg';
// some square for converter
import GiConvergenceTarget from '../../icons/GiConvergenceTarget.svg';
import fileDownload from 'js-file-download';
import { t } from 'ttag';

import { getRenderer } from '../../ui/rendererFactory.js';
import { CANVAS_TYPES, USERLVL } from '../../core/constants.js';
import {
  selectCanvas, setViewCoordinates, toggleHistoricalView,
} from '../../store/actions/index.js';

function download() {
  const renderer = getRenderer();
  const viewport = renderer.getViewport();
  if (!viewport) return;
  const filename = `pixelplanet-${
    window.location.hash.replace('#', '').replaceAll(',', '-')
  }.png`;
  viewport.toBlob((blob) => fileDownload(blob, filename));
}

export default function mainMenu(store) {
  const elements = [{
    id: 'ca1',
    type: 'link',
    symbol: FaFlipboard,
    link: 'CANVAS_SELECTION',
    text: t`Canvas Selection`,
  }];

  const state = store.getState();

  if (state.canvas.rendererType !== CANVAS_TYPES.THREED) {
    elements.push({
      id: 'gl',
      type: 'func',
      symbol: Md3dRotation,
      func: () => {
        const {
          canvasIdent, canvasId, canvasSize, view,
        } = store.getState().canvas;
        const [x, y] = view.map(Math.round);
        // eslint-disable-next-line max-len
        window.location.href = `globe#${canvasIdent},${canvasId},${canvasSize},${x},${y}`;
      },
      text: t`Globe View`,
    });
  }

  if (window.ssv?.backupurl
    && state.canvas.rendererType !== CANVAS_TYPES.THREED
  ) {
    elements.push({
      id: 'hi',
      type: 'boolean',
      func: () => {
        store.dispatch(toggleHistoricalView());
        return true;
      },
      state: state.canvas.isHistoricalView,
      text: t`Historical View`,
    });
  }

  elements.push({
    id: 'sc1',
    type: 'func',
    symbol: MdFileDownload,
    func: download,
    text: t`Make Screenshot`,
  },
  { id: 's1', type: 'spacer' },
  );

  if (state.user.name) {
    elements.push({
      id: 'pe',
      type: 'submenu',
      symbol: MdPerson,
      text: t`User Area`,
      elements: [{
        id: 'uapr',
        type: 'link',
        symbol: MdPerson,
        link: 'USERAREA',
        text: t`Profile`,
        reuse: true,
      }, {
        id: 'uafa',
        type: 'link',
        symbol: PiAxeFill,
        link: 'MYFACTIONS',
        text: t`My Factions`,
        reuse: true,
      }],
    });
  } else {
    elements.push({
      id: 'pe',
      type: 'link',
      symbol: MdPerson,
      link: 'USERAREA',
      text: t`Log in or Register`,
    });
  }

  elements.push({
    id: 'sea',
    type: 'link',
    symbol: FaSearch,
    link: 'SEARCH',
    reuse: true,
    text: t`Search`,
  });

  if (state.user.userlvl >= USERLVL.CHATMOD) {
    let activeTab = 'Media';
    if (state.user.userlvl >= USERLVL.MOD) {
      activeTab = 'Watch';
    } else if (state.user.userlvl >= USERLVL.JANNY) {
      activeTab = 'Canvas';
    }

    elements.push({
      id: 'mtsu',
      type: 'link',
      link: 'MODTOOLS',
      args: { activeTab },
      symbol: FaShieldAlt,
      /* t: This if for moderation tools, it's not important to translate this */
      text: (state.user.userlvl >= USERLVL.ADMIN) ? t`Admintools` : t`Modtools`,
    });
  }

  if (state.templates.available) {
    let templateSubmenu = [{
      id: 'te',
      type: 'link',
      link: 'TEMPLATES',
      text: t`Manage Templates`,
    }];
    const templateList = state.templates.list.map((template, index) => ({
      id: `template-${template.title}${index}`,
      type: 'func',
      text: template.title,
      func: () => {
        store.dispatch(selectCanvas(template.canvasId));
        store.dispatch(setViewCoordinates([
          template.x + template.width / 2, template.y + template.height / 2,
        ]));
      },
    }));
    if (templateList.length) {
      templateSubmenu = templateSubmenu.concat(
        { id: 'st1', type: 'spacer' },
        templateList,
      );
    }
    templateSubmenu.push({
      id: 'st2',
      type: 'spacer',
    }, {
      id: 'uaco',
      type: 'link',
      symbol: GiConvergenceTarget,
      link: 'CONVERTER',
      text: t`Converter`,
    });

    elements.push({
      id: 'te',
      type: 'submenu',
      symbol: FaPaintRoller,
      text: t`Templates`,
      elements: templateSubmenu,
    });
  }

  elements.push(
    {
      id: 'st',
      type: 'link',
      symbol: IoIosStats,
      link: 'STATISTICS',
      text: t`Statistics`,
    },
    { id: 's2', type: 'spacer' },
    {
      id: 'set',
      type: 'link',
      symbol: FaCog,
      link: 'SETTINGS',
      text: t`Settings`,
    },
    {
      id: 'he',
      type: 'link',
      symbol: FaQuestion,
      link: 'HELP',
      reuse: true,
      text: t`Help`,
    },
  );

  return elements;
}
