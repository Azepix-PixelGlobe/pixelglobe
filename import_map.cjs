'use strict';
const sharp = require('/home/runner/workspace/artifacts/pixelplanet/dist/node_modules/sharp');
const redis = require('/home/runner/workspace/artifacts/pixelplanet/dist/node_modules/redis');
const fs = require('fs');
const path = require('path');

// Canvas 0 config
const CHUNK_SIZE = 256;
const GRID_SIZE = 32;
const CANVAS_ID = 0;
const TILE_DIR = path.join(__dirname, '.map-tiles');

// Color palette index 24 = [202, 227, 255] - light blue (ocean)
const OCEAN_COLOR_IDX = 24;
// Brightness threshold: pixels darker than this are ocean
const OCEAN_THRESHOLD = 128;

async function main() {
  console.log('Connecting to Redis...');
  const client = redis.createClient({ url: 'redis://localhost:6379' });
  await client.connect();
  console.log('Connected!');

  let totalChunks = 0;
  let storedChunks = 0;
  let processedTiles = 0;
  let missingTiles = 0;

  for (let tx = 0; tx < GRID_SIZE; tx++) {
    for (let ty = 0; ty < GRID_SIZE; ty++) {
      const tilePath = path.join(TILE_DIR, String(tx), `${ty}.png`);

      if (!fs.existsSync(tilePath)) {
        missingTiles++;
        // Missing tile = pure ocean or pure land - skip (background shows as white)
        continue;
      }

      // Resize 2048x2048 → 512x512 (2x2 chunks of 256x256 each)
      const pixels = await sharp(tilePath)
        .resize(CHUNK_SIZE * 2, CHUNK_SIZE * 2, { kernel: 'lanczos3' })
        .grayscale()
        .raw()
        .toBuffer();

      // Process 4 chunks within this tile
      for (let cox = 0; cox < 2; cox++) {
        for (let coy = 0; coy < 2; coy++) {
          const chunkX = tx * 2 + cox;
          const chunkY = ty * 2 + coy;
          const chunkData = new Uint8Array(CHUNK_SIZE * CHUNK_SIZE);
          let hasOcean = false;

          for (let py = 0; py < CHUNK_SIZE; py++) {
            for (let px = 0; px < CHUNK_SIZE; px++) {
              const imgX = cox * CHUNK_SIZE + px;
              const imgY = coy * CHUNK_SIZE + py;
              // grayscale = 1 byte per pixel
              const brightness = pixels[imgY * CHUNK_SIZE * 2 + imgX];

              if (brightness >= OCEAN_THRESHOLD) {
                // Bright = ocean (light blue)
                chunkData[py * CHUNK_SIZE + px] = OCEAN_COLOR_IDX;
                hasOcean = true;
              } else {
                // Dark = land (white background, index 0)
                chunkData[py * CHUNK_SIZE + px] = 0;
              }
            }
          }

          totalChunks++;

          if (!hasOcean) {
            // All land/background - no need to store
            continue;
          }

          const key = `ch:${CANVAS_ID}:${chunkX}:${chunkY}`;
          // SET NX = only set if key does NOT exist, preserving user-placed pixels
          const wasSet = await client.set(key, Buffer.from(chunkData.buffer), { NX: true });
          if (wasSet) storedChunks++;
        }
      }

      processedTiles++;
      if (processedTiles % 50 === 0) {
        console.log(`  ${processedTiles} tiles, ${storedChunks} chunks stored...`);
      }
    }
  }

  console.log(`\nImport complete!`);
  console.log(`  Tiles processed: ${processedTiles}`);
  console.log(`  Missing tiles: ${missingTiles}`);
  console.log(`  Chunks with ocean data: ${storedChunks} / ${totalChunks}`);

  await client.quit();
  console.log('Done.');
}

main().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
