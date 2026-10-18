/*
 * map flags of user
 */
import { USERLVL } from '../core/constants.js';

export default function mapFlag(
  customRoleFlagId, customFlag, userlvl, country,
) {
  if (customRoleFlagId) {
    return [false, customRoleFlagId];
  }
  if (customFlag) {
    return [false, customFlag];
  }
  if (userlvl >= USERLVL.CLEANER) {
    switch (userlvl) {
      case USERLVL.CLEANER:
        customFlag = 'z3';
        break;
      case USERLVL.JANNY:
        customFlag = 'z2';
        break;
      case USERLVL.MOD:
        customFlag = 'z1';
        break;
      default:
        customFlag = 'zz';
    }
    return [true, customFlag];
  }
  return [true, country || 'xx'];
}
