/*
 * get ThreePIDs
 */
import { removeTpidFromUser } from '../../../data/sql/ThreePID.js';
import socketEvents from '../../../socket/socketEvents.js';

export default async (req, res) => {
  const { user, body: { id }, ttag: { t } } = req;

  const [
    remReturn, newUserlvl,
  ] = await removeTpidFromUser(user.id, id, user.hasPassword);

  switch (remReturn) {
    case 0:
      break;
    case 2:
      throw new Error(t`Could not find this login method`);
    case 3:
      throw new Error(
        // eslint-disable-next-line max-len
        t`You can not delete this login method, because you have nothing else left.`,
      );
    default:
      throw new Error(t`Server Error`);
  }

  if ((newUserlvl || newUserlvl === 0) && newUserlvl !== user.userlvl) {
    socketEvents.patchUserState(user.id, 'user', {
      op: 'setex',
      path: 'userlvl',
      value: newUserlvl,
    });
  }

  res.status(200).json({ success: true });
};
