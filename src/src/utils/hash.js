/*
 * Cryptographic hashing
 */

import bcrypt from 'bcrypt';
import { timingSafeEqual, createHash, randomBytes, createHmac } from 'crypto';

import { COOKIE_SECRET } from '../core/config.js';

/*
 * bcrypt hash for passwords
 */

export function generateHash(password) {
  return bcrypt.hashSync(password, bcrypt.genSaltSync(8), null);
}

export function compareToHash(password, hash) {
  if (!password || !hash) return false;
  return bcrypt.compareSync(password, hash);
}

/*
 * 216 bit token and SHA-224 hash for sessions
 */

export function generateToken() {
  return randomBytes(30).toString('base64url');
}

export function generateTokenHash(token) {
  return createHash('sha224')
    .update(token).digest('base64url').substring(0, 38);
}

/*
 * larger token for OIDC
 */
export function generateLargeToken() {
  return randomBytes(60).toString('base64url');
}

/*
 * tiny token for state
 */
export function generateTinyToken() {
  return randomBytes(15).toString('base64url');
}

/*
 * generate a pairwise pseudonymous identifier
 */
export function generatePPID(sector, value) {
  return createHash('sha256')
    .update(`${sector}:${value}:${COOKIE_SECRET}`)
    .digest('base64url');
}

/**
 * pkce challenge
 * @return boolean if passed
 */
export function validatePkceChallenge(verifier, challenge, method = 'plain') {
  if (!verifier || !challenge) {
    return false;
  }
  switch (method) {
    case 'plain':
      return verifier === challenge;
    case 'S256': {
      return createHash('sha256').update(verifier)
        .digest('base64')
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=/g, '') === challenge;
    }
    default:
      return false;
  }
}

/*
 * sign and verify cookies
 */

export function sign(value) {
  const hash = createHmac('sha256', COOKIE_SECRET)
    .update(value).digest('base64url');
  return `${value}.${hash}`;
}

export function unsign(signedValue) {
  if (!signedValue) {
    return null;
  }
  const seperator = signedValue.lastIndexOf('.');
  if (seperator === -1) {
    return null;
  }
  const value = signedValue.substring(0, seperator);
  const hash = signedValue.substring(seperator + 1);
  if (!value || !hash) {
    return null;
  }
  const compareHash = createHmac('sha256', COOKIE_SECRET)
    .update(value).digest('base64url');
  if (!timingSafeEqual(Buffer.from(hash), Buffer.from(compareHash))) {
    return null;
  }
  return value;
}

/*
 * UUIDv4 generation
 */
export function generateUUID() {
  const bytes = randomBytes(16);
  /* v4 */
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  /* variant 10 */
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  return bytes;
}

/*
 * convert buffer to uuid
 */
export function bufferToUUID(buffer) {
  const hex = buffer.toString('hex');
  return [
    hex.substring(0, 8),
    hex.substring(8, 12),
    hex.substring(12, 16),
    hex.substring(16, 20),
    hex.substring(20, 32),
  ].join('-');
}
