/*
 * Minify CSS
 * currently just css files for themes are loades seperately,
 * so files beginning with "theme-" in the src/styles folder will
 * be read and automatically added.
 *
 */

/* eslint-disable import/no-extraneous-dependencies */

import fs from 'fs';
import path from 'path';
import CleanCSS from 'clean-css';
import crypto from 'crypto';

const __dirname = import.meta.dirname;

const assetdir = path.resolve(__dirname, '..', 'dist', 'public', 'assets');
const FOLDER = path.resolve(__dirname, '..', 'src', 'src', 'styles');

async function minifyCss() {
  const ts = Date.now();
  process.stdout.write(`\x1b[33mMinifying CSS assets\x1b[0m\n`);
  fs.readdirSync(FOLDER).filter((e) => e.endsWith('.css')).forEach((file) => {
    const input = fs.readFileSync(path.resolve(FOLDER, file), 'utf8');
    const options = {};
    const output = new CleanCSS(options).minify(input);
    if (output.warnings && output.warnings.length > 0) {
      for (let i = 0; i < output.warnings.length; i += 1) {
        console.log('\x1b[33m%s\x1b[0m', output.warnings[i]);
      }
    }
    if (output.errors && output.errors.length > 0) {
      for (let i = 0; i < output.errors.length; i += 1) {
        console.log('\x1b[31m%s\x1b[0m', output.errors[i]);
      }
      throw new Error('Minify CSS Error Occured');
    }
    console.log(`${file} by ${Math.round(output.stats.efficiency * 100)}%`);
    const hash = crypto.createHash('md5').update(output.styles).digest('hex');
    let key = file.substr(0, file.indexOf('.'));
    const filename = `${key}.${hash.substr(0, 8)}.css`;
    fs.writeFileSync(path.resolve(assetdir, filename), output.styles, 'utf8');
  });
  process.stdout.write(`\x1b[33mMinifying took ${Math.round((Date.now() - ts) / 1000)}s\x1b[0m\n`);
}

async function doMinifyCss() {
  try {
    fs.mkdirSync(assetdir, { recursive: true });
    await minifyCss();
  } catch (e) {
    console.log('ERROR while minifying css', e);
    process.exit(1);
  }
  process.exit(0); 
}

if (import.meta.url.endsWith(process.argv[1])) {
  doMinifyCss();
}

export default minifyCss;
