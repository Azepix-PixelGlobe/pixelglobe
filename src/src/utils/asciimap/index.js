/*
 * Map unicode character to similar looking ascii.
 * Useful for captcha when someone enters cyrillic chars that look equal to
 * ascii chars.
 */
import fs from 'fs';
// import block from '../../../node_modules/any-ascii/block.js';
import asciiMap from './map.js';

/*
 * print mapping object as javascript code
 */
function printMappingObject(map) {
  console.log('/* eslint-disable max-len */\n\nconst asciiMap = {');
  for (let [blockCode, mapping] of Object.entries(map)) {
    console.log(
      `  '${blockCode}': new Uint8Array([${Array.from(mapping).join(', ')}]),`,
    );
  }
  console.log('};\n\nexport default asciiMap;\n');
}

/*
 * compare two mapping objects
 */
function compareMappings(mapA, mapB) {
  let differs = false;
  for (let [blockCodeA, mappingA] of Object.entries(mapA)) {
    const mappingB = mapB[blockCodeA];
    if (!mappingB) {
      differs = true;
      console.log(`Mapping for block ${blockCodeA} not in B`);
    }
    if (mappingA.length < mappingB.length) {
      differs = true;
      console.log(`Mapping B has ${
        mappingB.length - mappingA.length
      } more chars for block ${blockCodeA}`);
    }
    if (mappingB.length < mappingA.length) {
      differs = true;
      console.log(`Mapping A has ${
        mappingB.length - mappingA.length
      } more chars for block ${blockCodeA}`);
    }
    for (let i = 0; i < mappingA.length; i += 1) {
      const charA = String.fromCharCode(mappingA[i]);
      const charB = String.fromCharCode(mappingB[i]);
      if (charA !== charB) {
        differs = true;
        console.log(`Char in block ${blockCodeA} differs: ${charA} ${charB}`);
      }
    }
    delete mapA[blockCodeA];
    delete mapB[blockCodeA];
  }
  for (let blockCodeB of Object.keys(mapB)) {
    differs = true;
    console.log(`Mapping for block ${blockCodeB} not in A`);
  }
  if (!differs) {
    console.log('Mappings are equal');
  }
  return differs;
}

/**
 * any-ascii is a library that does this stuff already, but it may map one char
 * to multiple, like ẞ -> ss, which isn't suitable for our purpose of doing
 * captcha chars that requires equal length. It also does string spliting stuff
 * which is generally slower.
 * This function converts their block layout to our asciiMap in a lossy way.
 * @param block block.js fom any-ascii
 */
export function generateFromAnyAscii(block) {
  const newAsciiMap = {};
  for (let i = 0; i < 3600; i += 1) {
    let b = block(i);
    if (b) {
      let len = 0;
      let final = [];
      b = b.split('\t').forEach((c) => {
        if (!c || c.length > 1) {
          // space
          final.push(32);
          return;
        }
        if (c) {
          len += 1;
        }
        const code = c.codePointAt(0);
        if (code > 0x7f || code < 32) {
          throw new Error('No readable ascii');
        }
        final.push(code);
      });

      let trim = final.length - 1;
      while (trim >= 0 && final[trim] === 32) trim -= 1;
      if (trim >= 0 && trim < final.length - 1) {
        final = final.slice(0, trim + 1);
      }

      if (len > 5) {
        newAsciiMap[i] = new Uint8Array(final);
      }
    }
  }
  printMappingObject(newAsciiMap);
  compareMappings(asciiMap, newAsciiMap);
}

/**
 * print map as csv, so it can be edited
 */
export function printMapAsTsv() {
  for (const [i, map] of Object.entries(asciiMap)) {
    const intArray = Array.from(map);
    console.log(`${i}\t${intArray.map((x, u) => {
      const c = ((i << 8) | u);
      if (c < 32) {
        return ' ';
      }
      let code = String.fromCodePoint(c).trim();
      if (!code) {
        return ' ';
      }
      if (code === '"') {
        code = '""""';
      }
      return code;
    }).join('\t')}`);
    console.log(`${i}\t${intArray.map((c) => {
      if (c < 32) {
        return ' ';
      }
      let code = String.fromCodePoint(c).trim();
      if (!code) {
        return ' ';
      }
      if (code === '"') {
        code = '""""';
      }
      return code;
    }).join('\t')}\n`);
  }
}

/**
 * load from tsv
 */
export function loadFromTsv(filePath) {
  const content = fs.readFileSync(filePath, 'utf8');
  const lines = content.split(/\r?\n/);

  const newAsciiMap = {};
  let care = false;
  for (const line of lines) {
    if (line.trim() === '') {
      continue;
    }
    if (care) {
      const values = line.split('\t');
      const blockNum = values.shift();
      if (!blockNum && blockNum !== 0) {
        continue;
      }
      let final = values.map((v) => {
        v = v.trim();
        if (v === '""""') {
          v = '"';
        }
        if (!v) {
          v = ' ';
        }
        if (v.length > 1) {
          throw new Error(`Couldn't parse: ${v}`);
        }
        const code = v.codePointAt(0);
        if (code > 0x7f || code < 32) {
          throw new Error('No readable ascii');
        }
        return code;
      });

      let trim = final.length - 1;
      while (trim >= 0 && final[trim] === 32) trim -= 1;
      if (trim >= 0 && trim < final.length - 1) {
        final = final.slice(0, trim + 1);
      }

      newAsciiMap[blockNum] = new Uint8Array(final);
    }
    /* we care about every second line */
    care = !care;
  }
  printMappingObject(newAsciiMap);
  compareMappings(asciiMap, newAsciiMap);
}

/**
 * convert a unicode string to an ascii string, mapping characters to similar
 * looking ascii characters
 * @param string unicode string
 * @return [
 *   result, the resulting asciii string
 *   emojiOnly, if the input consisted of emojis only
 * ]
 */
export default function anyAscii(string) {
  let result = '';
  let emojiOnly = true;
  for (const char of string) {
    const codePoint = char.codePointAt(0);
    if (codePoint <= 0x7f) {
      result += char;
      emojiOnly = false;
    } else {
      const blockNum = codePoint >>> 8;
      if (blockNum !== 502) {
        emojiOnly = false;
      }
      const lo = codePoint & 0xff;
      const newCharCode = asciiMap[blockNum]?.[lo];
      result += (newCharCode) ? String.fromCharCode(newCharCode) : ' ';
    }
  }
  return [result, emojiOnly];
}
