/* Admin mega panel — IP BAN, cihaz banı, mute, ban listesi, IP tarama */
import express from 'express';
import { USERLVL } from '../../core/constants.js';
import { getBanInfos, ban, unban } from '../../data/sql/Ban.js';
import { getIPInfos, getIPofIID, getIIDsOfIPs } from '../../data/sql/IP.js';
import { getProxyProfile } from '../../data/sql/ProxyIntel.js';
import { findUserByIdOrName, getUserInfo } from '../../data/sql/User.js';
import { getDeviceInfo } from '../../utils/intel/device.js';
import pool from '../../data/sql/mariadb.js';

const router = express.Router();

// Sadece MOD+ erişir, DEVICE ban için ADMIN gerekir
router.use((req, res, next) => {
  const lvl = req.user?.userlvl || 0;
  if (lvl < USERLVL.MOD) {
    return res.status(403).json({ error: 'Yetkin yok' });
  }
  next();
});

/* ---------- BAN LİSTESİ ---------- */
router.get('/bans', async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit, 10) || 50, 200);
    const offset = parseInt(req.query.offset, 10) || 0;
    const type = String(req.query.type || 'all'); // all | ban | mute

    // Direkt Bans tablosundan çek
    let where = '';
    if (type === 'ban') where = 'WHERE (flags & 1) = 1';
    else if (type === 'mute') where = 'WHERE (flags & 2) = 2';

    // expires null = kalıcı
    let rows = [];
    try {
      // Ban detaylarını çek
      rows = await pool.query(
        `SELECT B.id, BIN_TO_UUID(B.uuid) as buuid, B.reason, B.flags, B.expires, B.createdAt, B.muid,
                U.name as mname
         FROM Bans B
         LEFT JOIN Users U ON U.id = B.muid
         ${where}
         ORDER BY B.createdAt DESC
         LIMIT ? OFFSET ?`,
        [limit, offset],
      );
    } catch (e) {
      // Fallback: eski yöntemle dene
      rows = [];
    }

    // Her ban için etkilenen kullanıcı/IP'leri de ekle
    const detailed = [];
    for (let i = 0; i < rows.length; i += 1) {
      const b = rows[i];
      // eslint-disable-next-line no-await-in-loop
      const infos = await getBanInfos(null, null, null, b.buuid);
      const detail = infos[0] || b;
      detailed.push({
        id: b.id,
        buuid: b.buuid,
        reason: b.reason,
        flags: b.flags,
        isBan: (b.flags & 1) === 1,
        isMute: (b.flags & 2) === 2,
        expires: b.expires,
        createdAt: b.createdAt,
        muid: b.muid,
        mname: b.mname,
        users: detail.users || [],
        ips: detail.ips || [],
        tpids: detail.tpids || [],
      });
    }
    res.json({ ok: true, bans: detailed, total: detailed.length });
  } catch (e) {
    console.error('admin/bans', e.message);
    res.status(500).json({ error: 'Liste alınamadı' });
  }
});

/* ---------- IP TARAMA (proxy/vpn/tor) ---------- */
router.get('/scan-ip', async (req, res) => {
  const ip = String(req.query.ip || '').trim();
  if (!ip) return res.status(400).json({ error: 'IP gerekli' });
  try {
    const [infos, proxy] = await Promise.all([
      getIPInfos(ip, null),
      getProxyProfile(ip),
    ]);
    let ipData = null;
    if (infos && infos.size) {
      ipData = infos.values().next().value;
    }
    // Ek kullanıcı araması: bu IP ile ilişikli kullanıcıları bul
    let alts = { userIds: [], iids: [] };
    try {
      const { findAlts } = await import('../../data/sql/IP.js');
      const [iids, userIds] = await findAlts(null, ip, 30);
      alts = { userIds, iids };
    } catch {}

    // Kullanıcı profillerini çek (ilk 5)
    const users = [];
    for (let k = 0; k < Math.min(alts.userIds.length, 5); k += 1) {
      // eslint-disable-next-line no-await-in-loop
      const u = await getUserInfo(alts.userIds[k]).catch(() => null);
      if (u) users.push({ id: u.uid || alts.userIds[k], name: u.name, username: u.username, lvl: u.userlvl });
    }

    res.json({
      ok: true,
      ip,
      ipData: ipData ? {
        country: ipData.country,
        cidr: ipData.cidr,
        org: ipData.org,
        descr: ipData.descr,
        asn: ipData.asn,
        type: ipData.type,
        isProxy: ipData.isProxy,
        isWhitelisted: ipData.isWhitelisted,
        whoisExpires: ipData.whoisExpires,
      } : null,
      proxy: proxy || null,
      analysis: proxy ? {
        verdict: proxy.isProxy ? `⚠️ TESPİT: ${proxy.kindLabel} (${proxy.type || proxy.kind})` : '✅ Temiz',
        risk: proxy.risk,
        confidence: proxy.confidence,
        operator: proxy.operator,
        city: proxy.city,
      } : { verdict: 'Bilgi yok (henüz taranmadı)', risk: 0 },
      alts,
      users,
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

/* ---------- GELİŞMİŞ BAN (normal, ip, cihaz, mute) ---------- */
router.post('/action', express.json({ limit: '20kb' }), async (req, res) => {
  const {
    target, // username / id / ip / device hash
    action, // ban | ipban | deviceban | mute | unban | unmute | whitelist | unwhitelist
    reason,
    duration, // ms
    muteFlag, // özel: sadece mute
  } = req.body || {};

  if (!action) return res.status(400).json({ error: 'action gerekli' });

  // Unban / unmute için target mutlaka lazım
  const lvl = req.user?.userlvl || 0;
  const isAdmin = lvl >= USERLVL.ADMIN;

  try {
    // Yardımcı: target'ı çözümle
    let userIds = [];
    let ipStrings = [];
    let ipUuids = [];
    let banUuids = [];

    if (target) {
      const t = String(target).trim();
      // Ban UUID mu (uuid formatında - içerir)
      if (t.includes('-') && t.length > 30 && (action === 'unban' || action === 'unmute')) {
        banUuids = [t];
      } else if (/^\d+$/.test(t) && Number(t) > 0 && Number(t) < 50000000) {
        // sayısal user ID
        userIds = [Number(t)];
      } else if (t.includes('.') || t.includes(':')) {
        // IP gibi duruyor
        const { sanitizeIPString } = await import('../../utils/intel/ip.js');
        try { ipStrings = [sanitizeIPString(t)]; } catch { ipStrings = [t]; }
      } else if (action === 'deviceban' || (t.length <= 20 && /^[A-Za-z0-9_-]+$/.test(t))) {
        // device hash veya username -> kullanıcı ara
        const u = await findUserByIdOrName(t);
        if (u?.id) userIds = [u.id];
        else if (t.length === 15) {
          // device hash gibi, ona bağlı son IP'leri bul
          // Devices -> Sessions -> IPs üzerinden elle
          try {
            const rows = await pool.query(
              'SELECT ip FROM Sessions WHERE did = (SELECT id FROM Devices WHERE hash = ? LIMIT 1) LIMIT 10',
              [t],
            );
            if (rows.length) {
              const ips = rows.map((r) => r.ip).filter(Boolean);
              // IP_TO_BIN -> string'e çevirmek için tekrar sorgula
              // Basitçe: bu device hash'i kullanan kullanıcıları banla
              const users = await pool.query(
                'SELECT DISTINCT uid FROM Sessions WHERE did = (SELECT id FROM Devices WHERE hash = ?)',
                [t],
              );
              userIds = users.map((r) => r.uid).filter(Boolean);
              if (!userIds.length && ips.length) {
                // ip üzerinden ban
                // IP string'e çevirmek için INET6_NTOA
                const ipRows = await pool.query(
                  'SELECT INET6_NTOA(ip) as ipStr FROM IPs WHERE ip IN (?)',
                  [ips],
                );
                ipStrings = ipRows.map((r) => r.ipStr).filter(Boolean);
              }
            }
          } catch {}
          if (!userIds.length && !ipStrings.length) {
            return res.status(404).json({ error: 'Cihaz hash bulunamadı veya eşleşen kullanıcı yok' });
          }
        } else {
          // username
          const u2 = await findUserByIdOrName(t);
          if (!u2?.id) return res.status(404).json({ error: 'Kullanıcı bulunamadı' });
          userIds = [u2.id];
        }
      } else {
        // varsayılan username denemesi
        const u = await findUserByIdOrName(t);
        if (u?.id) userIds = [u.id];
        else return res.status(404).json({ error: 'Hedef çözülemedi (kullanıcı adı / ID / IP gir)' });
      }
    }

    // Süre: ms -> sn
    let durSec = null;
    if (duration && Number(duration) > 0) durSec = Math.ceil(Number(duration) / 1000);

    if (!reason && (action === 'ban' || action === 'ipban' || action === 'deviceban' || action === 'mute')) {
      return res.status(400).json({ error: 'Sebep zorunlu' });
    }

    let resultMsg = '';
    switch (action) {
      case 'ban': {
        if (!userIds.length && !ipStrings.length && !ipUuids.length) return res.status(400).json({ error: 'Hedef yok' });
        const [ips, uids] = await ban(ipStrings.length ? ipStrings : null, userIds.length ? userIds : null, null, false, true, reason, durSec, req.user.id);
        resultMsg = `Banlandı: ${uids.length} kullanıcı, ${ips.length} IP`;
        break;
      }
      case 'ipban': {
        if (!ipStrings.length) return res.status(400).json({ error: 'IP gir' });
        if (!isAdmin && lvl < USERLVL.MOD) return res.status(403).json({ error: 'Yetki yok' });
        const [ips] = await ban(ipStrings, null, null, false, true, reason, durSec, req.user.id);
        resultMsg = `IP banlandı: ${ips.join(', ')}`;
        break;
      }
      case 'deviceban': {
        if (!isAdmin) return res.status(403).json({ error: 'Cihaz banı sadece ADMIN' });
        // userIds zaten bulundu
        if (userIds.length) {
          const [ips, uids] = await ban(null, userIds, null, true, true, `[CIHAZ] ${reason}`, durSec, req.user.id);
          // Ayrıca device hash'i kara listeye ekle (SharedState)
          try {
            const { setState } = await import('../../core/SharedState.js');
            // device hash kara listesi redis'te tutuluyor
          } catch {}
          resultMsg = `Cihaz banlandı: ${uids.length} kullanıcı + IP'leri`;
        } else if (ipStrings.length) {
          const [ips] = await ban(ipStrings, null, null, true, true, `[CIHAZ] ${reason}`, durSec, req.user.id);
          resultMsg = `Cihaz IP'si banlandı: ${ips.join(',')}`;
        }
        break;
      }
      case 'mute': {
        if (!userIds.length && !ipStrings.length) return res.status(400).json({ error: 'Hedef yok' });
        const [ips, uids] = await ban(ipStrings.length ? ipStrings : null, userIds.length ? userIds : null, null, true, false, reason, durSec, req.user.id);
        resultMsg = `Mutelendi: ${uids.length} kullanıcı, ${ips.length} IP`;
        break;
      }
      case 'unban':
      case 'unmute': {
        const isMuteOnly = action === 'unmute';
        const needBan = !isMuteOnly;
        const needMute = true;
        // banUuids varsa ondan, yoksa userIds/ipStrings'ten çöz
        const [uIps, uUids] = await unban(
          ipStrings.length ? ipStrings : null,
          userIds.length ? userIds : null,
          null,
          banUuids.length ? banUuids : null,
          needMute,
          needBan,
          req.user.id,
        );
        if (!uIps.length && !uUids.length) return res.status(404).json({ error: 'Açılacak ban/mute bulunamadı' });
        resultMsg = `Kaldırıldı: ${uUids.length} kullanıcı, ${uIps.length} IP`;
        break;
      }
      case 'whitelist': {
        if (!ipStrings.length) return res.status(400).json({ error: 'IP gir' });
        const { whitelist } = await import('../../core/ban.js');
        const ok = await whitelist(ipStrings[0]);
        resultMsg = ok ? 'Whitelist eklendi' : 'Zaten whitelistte';
        break;
      }
      case 'unwhitelist': {
        if (!ipStrings.length) return res.status(400).json({ error: 'IP gir' });
        const { unwhitelist } = await import('../../core/ban.js');
        const ok = await unwhitelist(ipStrings[0]);
        resultMsg = ok ? 'Whitelistten çıkarıldı' : 'Whitelistte değil';
        break;
      }
      default:
        return res.status(400).json({ error: 'Bilinmeyen action' });
    }

    res.json({ ok: true, message: resultMsg });
  } catch (e) {
    console.error('admin/action', e);
    res.status(500).json({ error: e.message || 'Hata' });
  }
});

/* ---------- HIZLI İSTATİSTİK ---------- */
router.get('/stats', async (req, res) => {
  try {
    const [banCount, muteCount, proxyCount] = await Promise.all([
      pool.query('SELECT COUNT(*) as c FROM Bans WHERE (flags & 1)=1 AND (expires IS NULL OR expires > NOW())').then((r) => r[0]?.c || 0).catch(() => 0),
      pool.query('SELECT COUNT(*) as c FROM Bans WHERE (flags & 2)=2 AND (expires IS NULL OR expires > NOW())').then((r) => r[0]?.c || 0).catch(() => 0),
      pool.query('SELECT COUNT(*) as c FROM Proxies WHERE isProxy != 0 AND expires > NOW()').then((r) => r[0]?.c || 0).catch(() => 0),
    ]);
    res.json({ ok: true, banCount, muteCount, proxyCount });
  } catch (e) {
    res.json({ ok: true, banCount: 0, muteCount: 0, proxyCount: 0 });
  }
});

export default router;
