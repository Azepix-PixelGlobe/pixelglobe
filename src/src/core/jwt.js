/*
 * functions for jwts
 */

import {
  createSign, generateKeyPairSync, createHash, createPublicKey,
} from 'crypto';
import path from 'path';
import fs from 'fs';

import FsWatcher from './fsWatcher.js';


let keys = [];
let jwks = [];

const keyFile = path.resolve('jwtkeys.json');
if (!fs.existsSync(keyFile)) {
  fs.writeFileSync(keyFile, '[]');
}
const keyFileWatcher = new FsWatcher(keyFile);

/**
 * populate jwks array to send on well-known endpoint
 * Sad that we need a third-party library for this :(
 */
async function populateJWKS() {
  if (!keys.length) {
    jwks.length = 0;
    return;
  }
  const newJwks = [];
  for (let i = 0; i < keys.length; i += 1) {
    const { publicKey, kid } = keys[i];
    try {
      const jwk = createPublicKey(publicKey).export({ format: 'jwk' });
      newJwks.push({
        ...jwk,
        use: 'sig',
        kid,
        alg: 'RS256',
      });
    } catch (error) {
      console.error('Could not create jwk public key', error.message);
    }
  }
  jwks = newJwks;
}

export function getJWKS() {
  return jwks;
}

/*
 * load available keys from file
 */
function loadJWTKeys() {
  if (!fs.existsSync(keyFile)) {
    keys.length = 0;
    jwks.length = 0;
    return false;
  }
  let fileKeys;
  try {
    fileKeys = JSON.parse(fs.readFileSync(keyFile));
  } catch (error) {
    console.error(`loadJWTKeys: Error ${error.message}`);
    keys.length = 0;
    jwks.length = 0;
    return false;
  }
  if (Array.isArray(fileKeys) && fileKeys.length) {
    keys = fileKeys;
    populateJWKS();
    return true;
  }
  keys.length = 0;
  jwks.length = 0;
  return false;
}

/*
 * create new keypair and store it in file
 */
function createJWTKeys() {
  try {
    const { publicKey, privateKey } = generateKeyPairSync('rsa', {
      modulusLength: 2048,
      publicKeyEncoding: { type: 'spki', format: 'pem' },
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    });

    const kid = String(Date.now());
    keys = [{ kid, publicKey, privateKey }];

    fs.writeFileSync(keyFile, JSON.stringify(keys));
  } catch (error) {
    keys.length = 0;
    console.error(`createJWTKeys: Error ${error.message}`);
  }
  populateJWKS();
}

/*
 * get a kepair
 */
function getKeyPair() {
  if (!keys.length) {
    createJWTKeys();
  }
  if (!keys.length) {
    return null;
  }
  return keys[0];
}

keyFileWatcher.onChange((eventType) => {
  /* rename also fired on remove */
  if (eventType === 'rename') {
    if (!fs.existsSync(keyFile)) {
      createJWTKeys();
      /* reload watcher just to be safe */
      keyFileWatcher.destructor();
      keyFileWatcher.initialize();
    }
    return;
  }
  loadJWTKeys();
});
loadJWTKeys();

/**
 * create a JWT with RS256 algo
 * @param payload object
 */
export function createJWT(payload) {
  const key = getKeyPair();
  if (!key) {
    return null;
  }

  const { kid, privateKey } = key;
  const header = {
    alg: 'RS256',
    typ: 'JWT',
    kid,
  };

  const encodedHeader = Buffer.from(JSON.stringify(header))
    .toString('base64url');
  const encodedPayload = Buffer.from(JSON.stringify(payload))
    .toString('base64url');

  const signature = createSign('RSA-SHA256')
    .update(`${encodedHeader}.${encodedPayload}`)
    .end()
    .sign(privateKey, 'base64url');

  return `${encodedHeader}.${encodedPayload}.${signature}`;
}

/**
 * hash value for JWT reference
 * OpenID Connect spec:
 *   Its value is the base64url encoding of the left-most half of the hash of
 * the octets of the ASCII representation of the access_token value, where the
 * hash algorithm used is the hash algorithm used in the alg Header Parameter of
 * the ID Token's JOSE Header. For instance, if the alg is RS256, hash the
 * access_token value with SHA-256, then take the left-most 128 bits and
 * base64url-encode them.
 * @param value
 */
export function hashValue(value) {
  const digest = createHash('sha256').update(value).digest();
  const leftHalf = digest.slice(0, Math.floor(digest.length / 2));
  return leftHalf.toString('base64url');
}

