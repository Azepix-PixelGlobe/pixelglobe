/*
 * /api/dmpeer?cid=<DM kanalı>
 * =====================================================================
 * Özel arama (sesli / görüntülü) başlatmak için DM kanalındaki karşı
 * tarafın kullanıcı kimliği gerekir; kanal listesi yalnızca adı taşır.
 *
 * Yanıt: { uid, name, canCall: true|false, reason? }
 *   canCall false ise mesajla birlikte sebep döner (engel, oda yok...).
 */

import express from 'express';
import { getDmPartner } from '../../data/sql/Channel.js';
import { isUserBlockedBy } from '../../data/sql/User.js';

const router = express.Router();

router.get('/', async (req, res) => {
  req.tickRateLimiter(300);

  const { user } = req;
  if (!user) {
    return res.status(401).json({ errors: ['Not logged in'] });
  }

  const cid = parseInt(req.query.cid, 10);
  if (!cid || Number.isNaN(cid)) {
    return res.status(400).json({ errors: ['cid not defined'] });
  }

  const partner = await getDmPartner(cid, user.id);
  if (!partner) {
    return res.status(404).json({ errors: ['Bu sohbetin karşı tarafı bulunamadı'] });
  }

  /* karşı taraf bizi engellediyse arama başlatmayalım */
  let blocked = false;
  try {
    blocked = await isUserBlockedBy(partner.uid, user.id);
  } catch (error) {
    blocked = false;
  }

  res.set('Cache-Control', 'no-store');
  return res.json({
    uid: partner.uid,
    name: partner.name,
    canCall: !blocked,
    reason: blocked ? 'blocked' : null,
  });
});

export default router;
