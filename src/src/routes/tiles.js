/**
 *
 * Serve zoomlevel tiles
 *
 */

import fs from 'fs';
import path from 'path';
import express from 'express';

import canvases from '../core/canvases.js';
import { getMaxTiledZoom } from '../core/utils.js';
import {
  TILE_FOLDER, CDN_HOST, NO_CDN_COUNTRIES, NO_CDN,
} from '../core/config.js';


const router = express.Router();

/*
 * decide on cache length
 */
router.use('/:c/:z/:x/:y.webp', (req, res, next) => {
  if (CDN_HOST
    && CDN_HOST !== req.ip.getHost(false, false)
    && !NO_CDN
    && !NO_CDN_COUNTRIES?.includes(req.ip.country)
  ) {
    /*
     * do not allow chunks and tiles requests from any other URL than CDN,
     * if CDN_URL is set
     */
    res.redirect(`${req.protocol}://${CDN_HOST}${req.originalUrl}`);
    return;
  }

  res.set({
    'Access-Control-allow-origin': '*',
  });
  const { c: paramC } = req.params;
  const id = parseInt(paramC, 10);
  if (Number.isNaN(id)) {
    next(new Error('Invalid canvas id.'));
    return;
  }
  const canvas = canvases[id];
  if (!canvas) {
    next(new Error('Canvas not found.'));
    return;
  }
  req.canvasId = id;

  const maxTiledZoom = getMaxTiledZoom(canvas.size);
  const { z: paramZ } = req.params;
  const z = parseInt(paramZ, 10);
  if (Number.isNaN(z) || z < 0 || z >= maxTiledZoom) {
    next(new Error('Invalid zoom level'));
    return;
  }
  const invZoom = maxTiledZoom - z - 1;
  const cacheTime = (15 + 180 * invZoom) * 60;
  const pubCacheTime = Math.floor(cacheTime * 0.75);
  res.set({
    'Cache-Control': `public, s-maxage=${pubCacheTime}, max-age=${cacheTime}`,
  });
  next();
});

/*
 * get other tiles from directory
 */
router.use(express.static(TILE_FOLDER));


/*
 * catch File Not Found: Send empty tile
 */
router.use(async (req, res) => {
  const { canvasId } = req;

  const filename = path.join(TILE_FOLDER, String(canvasId), 'emptytile.webp');
  if (!fs.existsSync(filename)) {
    res.set({
      'Cache-Control': `public, s-maxage=${24 * 3600}, max-age=${24 * 3600}`,
    });
    res.status(404).end();
    return;
  }

  res.set({
    'Cache-Control': `public, s-maxage=${2 * 3600}, max-age=${1 * 3600}`,
    'Content-Type': 'image/webp',
  });
  res.status(200);
  res.sendFile(filename, (err) => {
    if (err) {
      // Silently return 404 without logging
      res.status(404).end();
    }
  });
});

/*
 * error handler
 */

router.use((err, req, res, next) => {
  if (res.headersSent) {
    next(err);
    return;
  }
  res.status(400).end();
});


export default router;
