import express from 'express';
import { verifySession, ensureLoggedIn } from '../../middleware/session.js';
import TemplateShare from '../../core/TemplateShare.js';

const router = express.Router();

/*
 * GÜVENLİK: 12 MB'lık şablon gövdesi YALNIZCA oturumu olan kullanıcı için
 * ayrıştırılır; oturumsuz istek en fazla 200 kB ayrıştırabilir. Eskiden
 * giriş yapmamış biri de 12 MB gövde gönderip sunucuyu boğabiliyordu.
 */
const bigJson = express.json({ limit: '12mb' });
const smallJson = express.json({ limit: '200kb' });
router.use(verifySession);
router.use((req, res, next) => {
  if (req.method === 'POST' || req.method === 'PUT' || req.method === 'PATCH') {
    const parser = req.user?.id ? bigJson : smallJson;
    parser(req, res, next);
    return;
  }
  next();
});

router.get('/', async (req, res, next) => {
  try {
    const list = await TemplateShare.listTemplates(req.query.limit, req.query.offset);
    res.json({
      ok: true,
      templates: list.map((r) => ({
        id: r.id,
        uid: r.uid,
        authorName: r.authorName,
        title: r.title,
        canvasId: r.canvasId,
        x: r.x,
        y: r.y,
        width: r.width,
        height: r.height,
        createdAt: r.createdAt,
      })),
    });
  } catch (err) {
    next(err);
  }
});

router.get('/:id', async (req, res, next) => {
  try {
    const row = await TemplateShare.getTemplate(parseInt(req.params.id, 10));
    if (!row) {
      res.status(404).json({ ok: false, error: 'not_found' });
      return;
    }
    res.json({
      ok: true,
      template: {
        id: row.id,
        uid: row.uid,
        authorName: row.authorName,
        title: row.title,
        canvasId: row.canvasId,
        x: row.x,
        y: row.y,
        width: row.width,
        height: row.height,
        mime: row.mime,
        imageData: row.imageData,
        createdAt: row.createdAt,
      },
    });
  } catch (err) {
    next(err);
  }
});

router.get('/:id/preview', async (req, res, next) => {
  try {
    const row = await TemplateShare.getTemplate(parseInt(req.params.id, 10));
    if (!row?.imageData) {
      res.status(404).end();
      return;
    }
    const m = /^data:([^;]+);base64,(.+)$/.exec(row.imageData);
    if (!m) {
      res.status(404).end();
      return;
    }
    const buf = Buffer.from(m[2], 'base64');
    res.set('Content-Type', m[1]);
    res.set('Cache-Control', 'public, max-age=3600');
    res.send(buf);
  } catch (err) {
    next(err);
  }
});

router.post('/', ensureLoggedIn, async (req, res, next) => {
  try {
    const result = await TemplateShare.createTemplate(req.user, req.body || {});
    if (!result.ok) {
      res.status(400).json(result);
      return;
    }
    res.json(result);
  } catch (err) {
    next(err);
  }
});

router.delete('/:id', ensureLoggedIn, async (req, res, next) => {
  try {
    const result = await TemplateShare.deleteTemplate(
      req.user,
      parseInt(req.params.id, 10),
    );
    if (!result.ok) {
      res.status(result.error === 'forbidden' ? 403 : 400).json(result);
      return;
    }
    res.json(result);
  } catch (err) {
    next(err);
  }
});

export default router;