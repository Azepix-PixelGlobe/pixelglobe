/*
 * get information of badge
 */
import { getBadgeById } from '../../data/sql/Goodies.js';
import { resolveSessionUidOfRequest } from '../../middleware/session.js';

export default async function badge(req, res) {
  /* GÜVENLİK: oturumsuz uç, her istek veritabanına gider → maliyet yükseltildi */
  req.tickRateLimiter(5000);

  res.set({
    'Cache-Control': 'public, s-maxage=180, max-age=280',
  });

  const { body: { id }, ttag: { t } } = req;
  if (typeof id !== 'number') {
    throw new Error(t`No or invalid fish id.`);
  }
  const badgeData = await getBadgeById(id);
  if (!badgeData) {
    throw new Error(t`No such badge found`);
  }
  if (badgeData.isPrivate) {
    const uid = await resolveSessionUidOfRequest(req);
    if (uid !== badgeData.userId) {
      throw new Error(t`The user owning this badge is private`);
    }
  }

  delete badgeData.isPrivate;
  res.status(200).json(badgeData);
}
