/*
 * create texture map of country flags
 */

import fs from 'fs';
import path from 'path';
import sharp from 'sharp';

const FORBIDDEN_FLAGS = [
  'zz', 'z1', 'z2', 'z3', 'xx', 'a1', 'a2', 'yy', 'ap', 'eu', 'fa',
];
const MARGIN = 2;
const FLAG_WIDTH = 16;
const FLAG_HEIGHT = 11;
const SCALE = 1.5;

const PROJECT_DIR = path.resolve(import.meta.dirname, '..');
const flagDirectories = [
  path.join(PROJECT_DIR, 'public', 'cf'),
  path.join(PROJECT_DIR, 'public', 'public', 'cf'),
];
const flagdir = flagDirectories.find((candidate) => fs.existsSync(candidate));

async function mapFlags() {
  if (!flagdir) {
    throw new Error(`Country flag directory not found. Checked: ${flagDirectories.join(', ')}`);
  }
  const flagMapFile = path.join(flagdir, 'atlas.png');
  const flagMapJson = path.join(flagdir, 'atlas.json');
  if (fs.existsSync(flagMapFile) && fs.existsSync(flagMapJson)) {
    // only generate if atlas doesn't exist
    return;
  }
  const ts = Date.now();
  process.stdout.write(`\x1b[33mGenerating Country Flag texture map\x1b[0m\n`);
  const flagCodes = fs.readdirSync(flagdir)
    .filter((e) => e.endsWith('.gif') && e.length === 6)
    .map((e) => e.substring(0, 2))
    .filter((e) => !FORBIDDEN_FLAGS.includes(e))
    .sort();

  const flagCount = flagCodes.length;
  if (flagCount === 0) {
    return;
  }

  console.log('Available flags:', flagCodes);
  const columns = Math.ceil(Math.sqrt(flagCount) * 2);
  const rows = Math.ceil(flagCount / columns);
  const atlasWidth = columns * (FLAG_WIDTH + MARGIN) + MARGIN;
  const atlasHeight = rows * (FLAG_HEIGHT + MARGIN) + MARGIN;

  const atlas = sharp({
    create: {
      width: atlasWidth,
      height: atlasHeight,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 }
    }
  });

  const composites = [];
  const coordinates = {};

  for (let i = 0; i < flagCodes.length; i++) {
    const code = flagCodes[i];
    const flagPath = path.join(flagdir, `${code}.gif`);

    const col = i % columns;
    const row = Math.floor(i / columns);

    const left = MARGIN + col * (FLAG_WIDTH + MARGIN);
    const top = MARGIN + row * (FLAG_HEIGHT + MARGIN);

    coordinates[code] = {
      x: left,
      y: top,
      width: FLAG_WIDTH,
      height: FLAG_HEIGHT,
      /*
       * uv coordinates if needed
      u: left / atlasWidth,
      v: top / atlasHeight,
      u2: (left + FLAG_WIDTH) / atlasWidth,
      v2: (top + FLAG_HEIGHT) / atlasHeight
      */
    };

    composites.push({
      input: flagPath,
      left: Math.round(left),
      top: Math.round(top)
    });
  }

  // Generate the atlas
  const atlasBuffer = await sharp({
    create: {
      width: atlasWidth,
      height: atlasHeight,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 }
    }
  })
  .composite(composites)
  .png()
  .toBuffer();

  await sharp(atlasBuffer)
    .resize(atlasWidth * SCALE, atlasHeight * SCALE, {
      kernel: 'nearest',
      fit: 'fill',
    })
    .toFile(flagMapFile);

  fs.writeFileSync(flagMapJson, JSON.stringify({
    codes: flagCodes,
    width: FLAG_WIDTH * SCALE,
    height: FLAG_HEIGHT * SCALE,
    margin: MARGIN * SCALE,
    columns,
  }, null, 2));
  // eslint-disable-next-line max-len
  process.stdout.write(`\x1b[33mGenerating flag map took ${Math.round(Date.now() - ts)}ms\x1b[0m\n`);
}

if (import.meta.url.endsWith(process.argv[1])) {
  mapFlags();
}

export default mapFlags;
