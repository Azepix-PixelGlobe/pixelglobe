/*
 * banning media context menu for mods
 */
import { api } from '../../utils/utag.js';
import { MEDIA_BAN_REASONS } from '../../core/constants.js';

export default function banMediaContextMenu(store, args) {
  const { mediaId } = args;

  return Object.keys(MEDIA_BAN_REASONS).map((reason) => ({
    id: reason,
    type: 'confirm',
    func: () => {
      const data = new FormData();
      data.append('mediaaction', 'ban');
      data.append('mediaidormbid', mediaId);
      data.append('reason', reason);
      /*
          * its only for mods, so not much error handling here
          */
      return fetch(api`/api/modtools`, {
        credentials: 'include',
        method: 'POST',
        body: data,
      });
    },
    text: reason,
  }));
}
