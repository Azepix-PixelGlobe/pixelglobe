/*
 * Controls for 2D canvases
 *
 * keycodes:
 * https://developer.mozilla.org/en-US/docs/Web/API/KeyboardEvent/key/Key_Values
 *
 */

import {
  setHover,
  unsetHover,
  selectColor,
} from '../store/actions/index.js';
import { requestBanMe } from '../store/actions/fetch.js';
import pixelTransferController from '../ui/PixelTransferController.js';
import { setCursor, getCursor } from './cursors.js';
import {
  screenToWorld,
  getChunkOfPixel,
  getOffsetOfPixel,
  getTapOrClickCenter,
} from '../core/utils.js';
import { PENCIL_MODE } from '../core/constants.js';
import { brushRect } from '../utils/pgBrush.js';
import templateLoader from '../ui/templateLoader.js';

class PixelPainterControls {
  store;
  renderer;
  viewport;
  //
  clickTapStartView = [0, 0];
  clickTapStartTime = 0;
  tapStartDist = 50;
  // screen coords of where a tap/click started
  clickTapStartCoords = [0, 0];
  // stored speed for acceleration
  speedScalar = 0;
  // on mouse: true as long as left mouse button is pressed
  isClicking = false;
  // on touch: true if more than one finger on screen
  isMultiTap = false;
  // on touch: true if current tab was ever more than one figher at any time
  wasEverMultiTap = false;
  // on touch: when painting with holdPaint is active
  isTapPainting = false;
  // on touch: timeout to detect long-press
  tapTimeout = null;
  // time of last tick
  prevTime = Date.now();
  // if we are waiting before placing pixel via holdPaint again
  coolDownDelta = false;
  // long-press pixel info
  infoTimeout = null;
  showedPixelInfo = false;

  constructor(renderer, viewport, store) {
    this.store = store;
    this.renderer = renderer;
    this.viewport = viewport;

    this.onMouseDown = this.onMouseDown.bind(this);
    this.onAuxClick = this.onAuxClick.bind(this);
    this.onMouseOut = this.onMouseOut.bind(this);
    this.onMouseMove = this.onMouseMove.bind(this);
    this.onWheel = this.onWheel.bind(this);
    this.onMouseUp = this.onMouseUp.bind(this);
    this.onTouchStart = this.onTouchStart.bind(this);
    this.onTouchEnd = this.onTouchEnd.bind(this);
    this.onTouchMove = this.onTouchMove.bind(this);

    viewport.addEventListener('auxclick', this.onAuxClick, false);
    viewport.addEventListener(
      'contextmenu',
      (event) => event.preventDefault(),
      false,
    );
    viewport.addEventListener('mousedown', this.onMouseDown, false);
    viewport.addEventListener('mousemove', this.onMouseMove, false);
    viewport.addEventListener('mouseup', this.onMouseUp, false);
    viewport.addEventListener('wheel', this.onWheel, false);
    viewport.addEventListener('touchstart', this.onTouchStart, false);
    viewport.addEventListener('touchend', this.onTouchEnd, false);
    viewport.addEventListener('touchmove', this.onTouchMove, false);
    viewport.addEventListener('mouseout', this.onMouseOut, false);
    viewport.addEventListener('touchcancel', this.onMouseOut, false);
    this.setCursor('default');
  }

  // eslint-disable-next-line class-methods-use-this
  dispose() {}

  clearInfoTimeout() {
    if (this.infoTimeout) {
      clearTimeout(this.infoTimeout);
      this.infoTimeout = null;
    }
  }

  showPixelInfoAt(screenCoords) {
    const cell = this.screenToWorld(screenCoords).map(Math.floor);
    const { canvasId } = this.store.getState().canvas;
    const [x, y] = cell;
    this.showedPixelInfo = true;
    window.dispatchEvent(new CustomEvent('pg-pixelinfo', {
      detail: {
        canvasId,
        x,
        y,
        screenX: screenCoords[0],
        screenY: screenCoords[1],
      },
    }));
  }

  gotCoolDownDelta(delta) {
    this.coolDownDelta = true;
    setTimeout(() => {
      this.coolDownDelta = false;
    }, delta * 1000);
  }

  setCursor(keyword) {
    const state = this.store.getState();
    let modeAdd;
    switch (state.canvas.pencilMode) {
      case PENCIL_MODE.COLOR:
        modeAdd = 'color';
        break;
      case PENCIL_MODE.OVERLAY:
        modeAdd = 'template';
        break;
      case PENCIL_MODE.HISTORY:
        modeAdd = 'history';
        break;
      default:
    }
    if (keyword === 'default' && modeAdd) {
      keyword += `-${modeAdd}`;
      if (state.gui.holdPaint) {
        keyword += '-on';
      }
    }
    if (keyword === 'move' && modeAdd) {
      keyword += `-${modeAdd}`;
    }
    setCursor(keyword, this.viewport, this.store.getState().gui.cursor);
  }

  updateCursor() {
    this.setCursor(getCursor(this.viewport));
  }

  onMouseDown(event) {
    event.preventDefault();
    document.activeElement.blur();

    if (event.button === 0) {
      this.renderer.cancelStoreViewInState();
      this.isClicking = true;
      this.showedPixelInfo = false;
      this.clearInfoTimeout();
      const { clientX, clientY } = event;
      this.clickTapStartTime = Date.now();
      this.clickTapStartCoords = [clientX, clientY];
      this.clickTapStartView = this.renderer.view;
      setTimeout(() => {
        if (this.isClicking && !this.showedPixelInfo) {
          this.setCursor('move');
        }
      }, 300);
      this.infoTimeout = setTimeout(() => {
        if (this.isClicking && !this.showedPixelInfo) {
          this.showPixelInfoAt(this.clickTapStartCoords);
          this.setCursor('default');
        }
      }, 550);
    } else if (event.button === 2) {
      event.preventDefault();
      this.showPixelInfoAt([event.clientX, event.clientY]);
    }
  }

  onMouseUp(event) {
    event.preventDefault();

    const { store, renderer } = this;
    if (event.button === 0) {
      this.isClicking = false;
      const { clientX, clientY } = event;
      const { clickTapStartCoords, clickTapStartTime } = this;
      const coordsDiff = [
        clickTapStartCoords[0] - clientX,
        clickTapStartCoords[1] - clientY,
      ].map(Math.abs);
      this.clearInfoTimeout();
      // Skip normal placement if a long press opened pixel info.
      if (!this.showedPixelInfo
        && clickTapStartTime > Date.now() - 250
        && coordsDiff[0] < 6 && coordsDiff[1] < 6
      ) {
        if (!(event instanceof MouseEvent) || !event.isTrusted) {
          requestBanMe(4);
          return;
        }
        PixelPainterControls.placePixel(
          store,
          renderer,
          this.screenToWorld([clientX, clientY]),
        );
      }
      this.showedPixelInfo = false;
      this.setCursor('default');
    }
    renderer.storeViewInState();
  }

  static getTouchCenter(event) {
    let x = 0;
    let y = 0;
    for (const { pageX, pageY } of event.touches) {
      x += pageX;
      y += pageY;
    }
    const { length } = event.touches;
    return [x / length, y / length];
  }

  /*
   * place pixel
   * either with given colorIndex or with selected color if none is given
   */
  static placePixel(store, renderer, cell, colorIndex = null) {
    cell = cell.map(Math.floor);
    const state = store.getState();
    if (state.canvas.isHistoricalView) {
      return;
    }
    const { viewscale: scale } = renderer;

    if (state.gui.autoZoomIn && scale < 8) {
      renderer.updateView([cell[0], cell[1], 12]);
      return;
    }

    // allow placing of pixel just on low zoomlevels
    if (scale < 3) {
      return;
    }

    const { canvasSize, clrIgnore } = state.canvas;
    const [x, y] = cell;
    const brushSize = state.gui.brushSize || 1;

    const selectedColor = (brushSize === 1 || colorIndex !== null)
      ? (
          colorIndex
          ?? PixelPainterControls.getWantedColor(state, renderer, cell)
        )
      : PixelPainterControls.getWantedColor(state, renderer, cell);
    if (brushSize === 1 && selectedColor === null) {
      return;
    }

    // apu link
    // 5275_-8713
    // 5398_-8614
    if (x > 5275 && y > -8713 && x < 5398 && y < -8614) {
      if (state.canvas.canvasId === '0') {
        window.location.href = 'https://files.catbox.moe/gh2wtr.mp4';
        return;
      }
    }

    const maxCoords = canvasSize / 2;
    if (x < -maxCoords || x >= maxCoords || y < -maxCoords || y >= maxCoords) {
      return;
    }

    if (brushSize === 1) {
      const curColor = renderer.getColorIndexOfPixel(...cell);
      if (selectedColor === curColor) {
        return;
      }
      if (selectedColor < clrIgnore) {
        const { palette } = state.canvas;
        const { rgb } = palette;
        let clrOffset = selectedColor * 3;
        const r = rgb[clrOffset++];
        const g = rgb[clrOffset++];
        const b = rgb[clrOffset];
        if (palette.getIndexOfColor(r, g, b) === curColor) {
          return;
        }
      }
      const [i, j] = getChunkOfPixel(canvasSize, x, y);
      const offset = getOffsetOfPixel(canvasSize, x, y);
      pixelTransferController.tryPlacePixel(
        i, j, offset,
        selectedColor,
        curColor,
      );
    } else {
      /*
       * Tam N×N fırça (1x1, 3x3, 5x5, 10x10). Geometri utils/pgBrush.js'te:
       * tek sayılı boyutlar tıklanan pikselin tam ortasında (eski davranış),
       * 10x10 ise tıklanan pikselden başlar ve tam 100 piksel boyar.
       */
      const { x0, y0, size: bSize } = brushRect(x, y, brushSize);
      const { palette } = state.canvas;
      for (let dy = 0; dy < bSize; dy += 1) {
        for (let dx = 0; dx < bSize; dx += 1) {
          const px = x0 + dx;
          const py = y0 + dy;
          if (px < -maxCoords || px >= maxCoords
            || py < -maxCoords || py >= maxCoords) {
            continue;
          }
          const pixColor = colorIndex
            ?? PixelPainterControls.getWantedColor(state, renderer, [px, py]);
          if (pixColor === null) {
            continue;
          }
          const pxColor = renderer.getColorIndexOfPixel(px, py);
          if (pxColor === pixColor) {
            continue;
          }
          if (pixColor < clrIgnore) {
            const { rgb } = palette;
            let clrOffset = pixColor * 3;
            const r = rgb[clrOffset++];
            const g = rgb[clrOffset++];
            const b = rgb[clrOffset];
            if (palette.getIndexOfColor(r, g, b) === pxColor) {
              continue;
            }
          }
          const [pi, pj] = getChunkOfPixel(canvasSize, px, py);
          const pOffset = getOffsetOfPixel(canvasSize, px, py);
          pixelTransferController.tryPlacePixel(
            pi, pj, pOffset,
            pixColor,
            pxColor,
          );
        }
      }
    }
  }

  static getMultiTouchDistance(event) {
    if (event.touches.length < 2) {
      return 1;
    }
    const a = event.touches[0];
    const b = event.touches[1];
    return Math.sqrt(
      (b.pageX - a.pageX) ** 2 + (b.pageY - a.pageY) ** 2,
    );
  }

  onTouchStart(event) {
    event.preventDefault();
    document.activeElement.blur();

    this.renderer.cancelStoreViewInState();
    this.clearTabTimeout();
    this.isTapPainting = false;
    this.showedPixelInfo = false;
    this.clickTapStartTime = Date.now();
    this.clickTapStartCoords = getTapOrClickCenter(event);
    this.clickTapStartView = this.renderer.view;

    if (event.touches.length > 1) {
      this.tapStartDist = PixelPainterControls.getMultiTouchDistance(event);
      this.isMultiTap = true;
      this.wasEverMultiTap = true;
    } else {
      this.isMultiTap = false;
      this.wasEverMultiTap = false;
      const state = this.store.getState();
      if (state.gui.holdPaint) {
        this.tapTimeout = setTimeout(() => {
          this.isTapPainting = true;
          PixelPainterControls.placePixel(
            this.store,
            this.renderer,
            this.screenToWorld(this.clickTapStartCoords),
          );
        }, 200);
      } else {
        this.tapTimeout = setTimeout(() => {
          this.showPixelInfoAt(this.clickTapStartCoords);
        }, 550);
      }
    }
  }

  onTouchEnd(event) {
    event.preventDefault();
    if (event.touches.length) {
      return;
    }

    const { store, renderer } = this;
    if (!this.wasEverMultiTap) {
      const [clientX, clientY] = getTapOrClickCenter(event);
      const { clickTapStartCoords, clickTapStartTime } = this;
      const coordsDiff = [
        clickTapStartCoords[0] - clientX,
        clickTapStartCoords[1] - clientY,
      ].map(Math.abs);
      if (clickTapStartTime > Date.now() - 580
        && coordsDiff[0] < 6 && coordsDiff[1] < 6
      ) {
        PixelPainterControls.placePixel(
          store,
          this.renderer,
          this.screenToWorld([clientX, clientY]),
        );
        setTimeout(() => {
          store.dispatch(unsetHover());
        }, 500);
      }
    }
    renderer.storeViewInState();
    this.clearTabTimeout();
  }

  onTouchMove(event) {
    event.preventDefault();
    event.stopPropagation();

    const multiTouch = (event.touches.length > 1);
    const state = this.store.getState();

    const [clientX, clientY] = getTapOrClickCenter(event);
    if (this.isMultiTap !== multiTouch) {
      this.wasEverMultiTap = true;
      this.isMultiTap = multiTouch;
      this.clickTapStartCoords = [clientX, clientY];
      this.clickTapStartView = this.renderer.view;
      this.tapStartDist = PixelPainterControls.getMultiTouchDistance(event);
      return;
    }
    const { clickTapStartView, clickTapStartCoords } = this;
    if (multiTouch) {
      this.clearTabTimeout();
      const a = event.touches[0];
      const b = event.touches[1];
      const dist = Math.sqrt(
        (b.pageX - a.pageX) ** 2 + (b.pageY - a.pageY) ** 2,
      );
      const pinchScale = dist / this.tapStartDist;
      const [x, y] = this.renderer.view;
      this.renderer.updateView([x, y, clickTapStartView[2] * pinchScale]);
    }
    if (!state.gui.holdPaint || multiTouch) {
      const [lastPosX, lastPosY] = clickTapStartView;
      const deltaX = clientX - clickTapStartCoords[0];
      const deltaY = clientY - clickTapStartCoords[1];
      if (deltaX > 5 || deltaY > 5) {
        this.clearTabTimeout();
      }
      const { viewscale: scale } = this.renderer;
      this.renderer.updateView([
        lastPosX - (deltaX / scale),
        lastPosY - (deltaY / scale),
      ]);
    } else if (!this.wasEverMultiTap && !this.coolDownDelta) {
      if (this.isTapPainting) {
        PixelPainterControls.placePixel(
          this.store,
          this.renderer,
          this.screenToWorld([clientX, clientY]),
        );
      } else {
        this.clickTapStartCoords = [clientX, clientY];
        this.clickTapStartView = this.renderer.view;
        this.tapStartDist = PixelPainterControls.getMultiTouchDistance(event);
      }
    }
  }

  clearTabTimeout() {
    this.clearInfoTimeout();
    if (this.tapTimeout) {
      clearTimeout(this.tapTimeout);
      this.tapTimeout = null;
    }
  }

  zoom(direction, origin) {
    const [x, y, scale] = this.renderer.view;
    const deltaScale = scale >= 1.0 ? 1.1 : 1.04;
    const newScale = (direction > 0) ? scale * deltaScale : scale / deltaScale;
    this.renderer.updateView([x, y, newScale], origin);
    this.renderer.storeViewInState();
  }

  step(direction) {
    const [x, y, scale] = this.renderer.view;
    const [dx, dy] = direction.map((z) => z * 100.0 / scale);
    this.renderer.updateView([x + dx, y + dy]);
    this.renderer.storeViewInState();
  }

  holdPaintStarted(immediate) {
    if (!immediate) {
      return;
    }
    const { hover } = this.store.getState().canvas;
    if (hover) {
      PixelPainterControls.placePixel(
        this.store,
        this.renderer,
        hover,
      );
    }
  }

  onWheel(event) {
    event.preventDefault();
    event.stopPropagation();
    document.activeElement.blur();

    const { clientX, clientY, deltaY } = event;
    const origin = this.screenToWorld([clientX, clientY]);
    if (deltaY < 0) {
      this.zoom(1, origin);
    }
    if (deltaY > 0) {
      this.zoom(-1, origin);
    }
  }

  static getWantedColor(state, renderer, cell) {
    if (state.gui.holdPaint) {
      const { pencilMode } = state.canvas;
      if (pencilMode === PENCIL_MODE.HISTORY) {
        return renderer.getColorIndexOfPixel(...cell, true);
      }
      if (pencilMode === PENCIL_MODE.OVERLAY) {
        const { canvasId } = state.canvas;
        const rgb = templateLoader.getColorOfPixel(canvasId, ...cell);
        if (!rgb) {
          return null;
        }
        return state.canvas.palette.getClosestIndexOfColor(...rgb);
      }
    }
    return state.canvas.selectedColor;
  }

  screenToWorld(screenCoor) {
    return screenToWorld(
      this.renderer.view,
      this.renderer.viewscale,
      this.viewport,
      screenCoor,
    );
  }

  setHoverFromScrrenCoor(screenCoor) {
    const { store } = this;
    const state = store.getState();
    const { hover: prevHover } = state.canvas;
    const hover = this.screenToWorld(screenCoor).map(Math.floor);
    const [x, y] = hover;

    const { canvasSize } = state.canvas;
    const maxCoords = canvasSize / 2;
    if (x < -maxCoords || x >= maxCoords
      || y < -maxCoords || y >= maxCoords
    ) {
      if (prevHover) {
        store.dispatch(unsetHover());
      }
      return null;
    }

    if (!prevHover || prevHover[0] !== x || prevHover[1] !== y) {
      store.dispatch(setHover(hover));
      return hover;
    }
    return null;
  }

  onMouseMove(event) {
    event.preventDefault();

    const { clientX, clientY } = event;
    const { renderer, isClicking } = this;
    const { viewscale } = renderer;
    if (isClicking) {
      if (Date.now() < this.clickTapStartTime + 100) {
        return;
      }
      const { clickTapStartView, clickTapStartCoords } = this;
      const [lastPosX, lastPosY] = clickTapStartView;
      const deltaX = clientX - clickTapStartCoords[0];
      const deltaY = clientY - clickTapStartCoords[1];

      this.renderer.updateView([
        lastPosX - (deltaX / viewscale),
        lastPosY - (deltaY / viewscale),
      ]);
    } else {
      const hover = this.setHoverFromScrrenCoor([clientX, clientY]);
      if (!hover) {
        return;
      }
      const state = this.store.getState();
      if (!this.coolDownDelta && state.gui.holdPaint) {
        if (!(event instanceof MouseEvent) || !event.isTrusted) {
          requestBanMe(4);
          return;
        }
        PixelPainterControls.placePixel(
          this.store,
          this.renderer,
          hover,
        );
      }
    }
  }

  onMouseOut() {
    const { store } = this;
    this.setCursor('default');
    store.dispatch(unsetHover());
    this.isClicking = false;
    this.clearTabTimeout();
  }

  selectColorFromScreen(center) {
    const { renderer, store } = this;
    if (this.renderer.viewscale < 3) {
      return;
    }
    const coords = this.screenToWorld(center).map(Math.floor);
    const clrIndex = renderer.getColorIndexOfPixel(...coords);
    if (clrIndex !== null) {
      store.dispatch(selectColor(clrIndex));
    }
  }

  onAuxClick(event) {
    const { which, clientX, clientY } = event;
    if (which !== 2) {
      return;
    }
    event.preventDefault();
    this.selectColorFromScreen([clientX, clientY]);
  }

  update() {
    let time = Date.now();
    const { moveU, moveV, moveW } = this.store.getState().gui;
    const isAccelerating = (moveU || moveV || moveW);

    if (!isAccelerating) {
      this.prevTime = time;
      this.speedScalar = 0;
      return false;
    }
    time -= this.prevTime;
    this.prevTime += time;

    this.speedScalar = Math.min(1, this.speedScalar + 0.025);

    const [x, y, scale] = this.renderer.view;

    const directionalStep = time * 0.4 / scale * this.speedScalar;
    let scaleFactor = scale >= 1.0 ? 1.0005 : 1.0003;
    scaleFactor **= moveW * this.speedScalar;

    this.renderer.updateView([
      x + directionalStep * moveU,
      y + directionalStep * moveV,
      scale * scaleFactor ** time,
    ]);

    return true;
  }
}

export default PixelPainterControls;
