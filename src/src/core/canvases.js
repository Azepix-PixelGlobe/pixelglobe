import path from 'path';
import { readFileSync } from 'fs';

const canvases = JSON.parse(readFileSync(
  path.resolve(__dirname, './canvases.json'),
));

export const defaultCanvasForCountry = {};
(function populateDefaultCanvases() {
  for (const [canvasId, canvas] of Object.entries(canvases)) {
    canvas.dcc?.forEach(
      (country) => {
        defaultCanvasForCountry[country.toLowerCase()] = canvasId;
      },
    );
  }
}());

export default canvases;
