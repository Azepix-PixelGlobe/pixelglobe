/*
 * choose an API URL out of API_URLS config
 */
import { API_URLS } from './config.js';

let iter = 0;

export default function chooseAPIUrl() {
  if (Array.isArray(API_URLS) && API_URLS.length) {
    iter += 1;
    if (iter >= API_URLS.length) {
      iter = 0;
    }
    return API_URLS[iter];
  }
  return API_URLS;
}
