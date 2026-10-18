import express from 'express';
import { getPixelInfo } from '../../core/PixelInfo.js';
import { verifySession } from '../../middleware/session.js';
import { USERLVL } from '../../core/constants.js';

const router = express.Router();

// This endpoint is readable by guests as well as signed-in users.
// IP/device detayları sadece MOD+ görür, misafir sadece temel bilgiyi alır.
router.use(verifySession);

router.get('/', async (req, res, next) => {
  try {
    const canvasId = Number.parseInt(req.query.c, 10);
    const x = Number.parseInt(req.query.x, 10);
    const y = Number.parseInt(req.query.y, 10);

    if ([canvasId, x, y].some(Number.isNaN)) {
      res.status(400).json({ ok: false, error: 'invalid_coords' });
      return;
    }

    const info = await getPixelInfo(canvasId, x, y);
    if (!info) {
      res.json({ ok: true, found: false, info: null });
      return;
    }
    // Yetkisiz kullanıcıya IP/proxy/device sızdırma
    const lvl = req.user?.userlvl || 0;
    if (lvl < USERLVL.MOD) {
      const { ip, deviceHash, ipMeta, proxy, ...pub } = info;
      res.json({ ok: true, found: true, info: pub });
      return;
    }
    res.json({ ok: true, found: true, info });
  } catch (error) {
    next(error);
  }
});

export default router;
