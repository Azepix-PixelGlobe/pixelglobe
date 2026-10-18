/*
 * NetGuard — PixelGlobe ağ katmanı koruması (DDoS / DoS)
 *
 * Amaç: Sunucu, saniyede binlerce istek gelse bile AYAKTA kalmalı ve
 * meşru oyuncu asla ceza almamalı.
 *
 * TASARIM KURALLARI
 *  1) Kayan pencere (sliding window) sayımı: sabit pencere sınırındaki
 *     "iki kat patlama" hilesi çalışmaz, ama sıradan kısa patlamalar
 *     (sayfa açılışı, hızlı tıklama) sorun çıkarmaz.
 *  2) Kademeli ceza: ilk ihlalde 15 saniye, sonra 1 dk, 5 dk, 30 dk, 2 saat.
 *     Tek seferlik hata yüzünden HOUR (1 saat) ban YOK.
 *  3) PIXEL İSTEKLERİ MUAF: pixel çizimi WebSocket ikili (binary) kanalından
 *     geçer ve bu modül o opcode'u ASLA saymaz/cezalandırmaz. Ardı ardına
 *     pixel atmak normal oyundur, DDoS değildir. (bkz. EXEMPT_ACTIONS ve
 *     SocketServer'daki PIXEL_UPDATE_OP kontrolü)
 *  4) Bellek sınırlı: takip tablosu en fazla MAX_TRACKED girdi tutar,
 *     düzenli süpürme ile ölü kayıtlar silinir; bellek şişmesi saldırı
 *     yüzeyi olmaktan çıkar.
 *  5) Ucuz ret: middleware gövde ayrıştırmadan ÖNCE çalışır; sel geldiğinde
 *     gövde okumadan, JSON ayrıştırmadan hızlıca 429 döner.
 */

const WINDOW_MS = 10000; // kayan pencere dilimi (10 saniye)
const SWEEP_MS = 30000; // ölü kayıt süpürme aralığı
const MAX_TRACKED = 20000; // en fazla kaç IP takip edilir
const DEFAULT_MAX_WINDOW = 120 * 1000; // pencereler arası azami takip süresi

/*
 * Politika tablosu: her eylem için yumuşak (soft) ve sert (hard) eşik,
 * pencere başına istek sayısı olarak.
 *
 * api   : /api/* uçları (sayfa başına ~10-40 çağrı normaldir)
 * page  : HTML sayfa yüklemesi (SSR + hash maliyetli)
 * ws_up : websocket el sıkışması (en pahalı işlem: oturum doğrulama)
 * ws_msg: websocket metin çerçeveleri (kontrol/ses sinyali; pixel DEĞİL)
 *
 * Eşikler bilerek geniş: okul/işyeri/mobil operatör NAT'ı arkasında
 * onlarca oyuncu aynı IP'yi paylaşabilir. Mesaj/araç seli yakalanır,
 * normal oyun yakalanmaz.
 */
const POLICIES = {
  api: { soft: 600, hard: 2000 },
  page: { soft: 60, hard: 200 },
  ws_up: { soft: 40, hard: 150 },
  ws_msg: { soft: 300, hard: 1200 },
  /*
   * asset: tile/chunk/minimap istekleri. Normalde çok olur (harita yakınlaştırma
   * yüzlerce tile çeker) → eşik çok geniş. Amaç sel halinde yanıt kopyalama
   * maliyetini (64 kB/chunk) sınırlamak.
   */
  asset: { soft: 4000, hard: 12000 },
  /*
   * mini: canlı minimap tile/state istekleri. Gerçek oyuncu saniyede birkaç
   * tane çeker (state yoklaması + değişen tile'lar); 30 kişilik bir okul NAT'ı
   * bile eşiğin çok altında kalır. Yanıtlar küçük (1-3 KB PNG) olduğu için
   * sel hâlinde bile sunucuyu boğmaz — ama yine de sert bir tavan var.
   */
  mini: { soft: 6000, hard: 24000 },
};

/* Kademeli ceza süreleri (ms) */
const PENALTY_STEPS = [
  15 * 1000,
  60 * 1000,
  5 * 60 * 1000,
  30 * 60 * 1000,
  2 * 60 * 60 * 1000,
];

/*
 * Ceza seviyesi ne zaman sıfırlanır: bir IP bu süre boyunca temiz kalırsa
 * kademe düşürülür.
 */
const PENALTY_DECAY_MS = 30 * 60 * 1000;

/*
 * Tekrar ihlal hafızası: bir IP bu süre içinde yine ihlal ederse kademe
 * yükselir (ceza süresi katlanır). Bu süre en uzun cezayla aynı.
 */
const PENALTY_MEMORY_MS = 2 * 60 * 60 * 1000;

/* Sel anında toplam eşzamanlı istek tavanı (event-loop koruması) */
const MAX_INFLIGHT = 1200;

/*
 * Uzun süreli (dakikalar) başarısız giriş denemesi kilidi eşikleri.
 */
const AUTH_IP_FAILS_SOFT = 8;
const AUTH_IP_FAILS_HARD = 20;
const AUTH_USER_FAILS = 15;
const AUTH_IP_WINDOW_MS = 10 * 60 * 1000;
const AUTH_USER_WINDOW_MS = 15 * 60 * 1000;
const AUTH_IP_LOCK_MS = 60 * 1000;
const AUTH_IP_LOCK_LONG_MS = 15 * 60 * 1000;
const AUTH_USER_LOCK_MS = 10 * 60 * 1000;

/* IPv4 / IPv6 adresini hafifçe normalize et (port, ::ffff: ve /64 kırpma) */
function normalizeIp(input) {
  if (typeof input !== 'string' || !input) {
    return 'bilinmeyen';
  }
  let ip = input.trim().toLowerCase();
  if (ip.length > 64) {
    ip = ip.slice(0, 64);
  }
  if (ip.startsWith('::ffff:')) {
    ip = ip.slice(7);
  }
  /* IPv4:port ya da [v6]:port kalıntısı */
  const v4port = ip.match(/^(\d{1,3}(?:\.\d{1,3}){3}):\d+$/);
  if (v4port) {
    return v4port[1];
  }
  if (ip.indexOf(':') !== -1) {
    /* IPv6: sadece ilk 4 grup (/64) — botnet tek blokla kaçamaz,
       meşru kullanıcı da tek blok yüzünden banlanmaz */
    return ip.split('%')[0].split(':').slice(0, 4).join(':');
  }
  return ip;
}

/*
 * Metnin gerçekten bir IP adresi gibi görünüp görünmediğini kontrol eder.
 * x-real-ip / x-forwarded-for başlıkları SAHTELENEBİLİR; biçim doğrulaması
 * hem ban kaçışını hem de veritabanına çöp IP yazılmasını engeller.
 */
function looksLikeIp(value) {
  if (typeof value !== 'string') {
    return false;
  }
  const text = value.trim();
  if (!text || text.length > 45) {
    return false;
  }
  if (/^\d{1,3}(\.\d{1,3}){3}(:\d+)?$/.test(text)) {
    return text.split(':')[0].split('.').every((part) => Number(part) <= 255);
  }
  if (!text.includes(':')) {
    return false;
  }
  return /^[0-9a-f:.]+$/i.test(text.replace(/%[0-9a-z]+$/i, ''));
}

function isTrustedPeer(addr) {
  if (typeof addr !== 'string' || !addr) {
    return false;
  }
  let ip = addr.toLowerCase();
  if (ip.startsWith('::ffff:')) {
    ip = ip.slice(7);
  }
  if (ip === '::1' || ip === '127.0.0.1' || ip.startsWith('127.')) {
    return true;
  }
  /* özel / iç ağ adresleri: bulut ters-proxy (Replit, nginx, docker) */
  if (ip.startsWith('10.') || ip.startsWith('192.168.')
    || ip.startsWith('169.254.') || ip.startsWith('fc') || ip.startsWith('fd')) {
    return true;
  }
  const m = ip.match(/^172\.(\d{1,3})\./);
  if (m) {
    const second = Number(m[1]);
    if (second >= 16 && second <= 31) {
      return true;
    }
  }
  return false;
}

class NetGuard {
  constructor() {
    /* Map<ip, { w: pencereNo, n: Map<action, count>, prev: Map<action,count> }> */
    this.windows = new Map();
    /* Map<ip, { ms: cezaBitişTs, lvl: kademe, last: son ceza ts }> */
    this.penalties = new Map();
    /* Map<ip, { n, win, lockTill }> */
    this.authIp = new Map();
    /* Map<user, { n, win, lockTill }> */
    this.authUser = new Map();
    /* Map<anahtar, { n, win }> — e-posta gönderimi gibi kotalar */
    this.quotas = new Map();
    this.inflight = 0;
    this.stats = {
      seen: 0, rejected: 0, penalized: 0, shed: 0, peakInflight: 0,
    };
    /* ölü kayıtları düzenli temizle (unref: süreci canlı tutmaz) */
    const t = setInterval(() => this.sweep(), SWEEP_MS);
    if (t.unref) {
      t.unref();
    }
  }

  /* ---------------- iç yardımcılar ---------------- */

  windowFor(ip, windowNo) {
    let entry = this.windows.get(ip);
    if (!entry) {
      if (this.windows.size >= MAX_TRACKED) {
        /* en eski kaydı at (Map ekleme sırası korur) */
        const oldest = this.windows.keys().next();
        if (!oldest.done) {
          this.windows.delete(oldest.value);
        }
      }
      entry = { w: windowNo, n: new Map(), prev: new Map() };
      this.windows.set(ip, entry);
    } else if (entry.w !== windowNo) {
      /* yeni pencere: mevcut sayım "önceki dilim" olur */
      entry.prev = entry.n;
      entry.n = new Map();
      entry.w = windowNo;
    }
    return entry;
  }

  /*
   * Kayar pencere toplamı: önceki dilimin tamamı + bu dilimin tamamı
   * (yaklaşık kayan pencere; 2 pencere = 20 saniyelik gerçek pencere).
   */
  countOf(entry, action) {
    return (entry.n.get(action) || 0) + (entry.prev.get(action) || 0);
  }

  penaltyEntry(ip) {
    let pen = this.penalties.get(ip);
    const now = Date.now();
    if (pen && pen.ms <= now) {
      /* ceza bitti; uzun süredir temizse kademeyi düşür */
      if (now - pen.last > PENALTY_DECAY_MS) {
        this.penalties.delete(ip);
        return null;
      }
      pen.ms = 0;
    }
    if (!pen && this.penalties.size >= MAX_TRACKED) {
      const oldest = this.penalties.keys().next();
      if (!oldest.done) {
        this.penalties.delete(oldest.value);
      }
    }
    return pen || null;
  }

  /* ---------------- genel API ---------------- */

  /*
   * Bir eylemi say ve sonucu döndür:
   *   { count, soft, hard, penalized, penaltyMs, level }
   */
  hit(rawIp, action = 'api', weight = 1) {
    const ip = normalizeIp(rawIp);
    const policy = POLICIES[action] || POLICIES.api;
    const now = Date.now();
    const windowNo = Math.floor(now / WINDOW_MS);
    const entry = this.windowFor(ip, windowNo);
    const prevCount = entry.n.get(action) || 0;
    const next = prevCount + weight;
    entry.n.set(action, next);
    const count = this.countOf(entry, action);

    this.stats.seen += weight;

    let penalized = false;
    let penaltyMs = 0;
    if (count >= policy.hard) {
      /*
       * Zaten ceza altındaysa cezayı YENİDEN üretmiyoruz: aksi halde
       * saniyede binlerce istek kademeyi anında en üste çıkarır ve
       * masum bir yoğunluk 2 saatlik banla biterdi.
       */
      const active = this.isPenalized(ip);
      if (active > 0) {
        penalized = true;
        penaltyMs = active;
      } else {
        penalized = true;
        penaltyMs = this.penalize(ip, `sel:${action}`);
      }
    } else if (count >= policy.soft) {
      /* yumuşak eşik: sadece kayda geç, ceza yok (meşru yoğunluk olabilir) */
      this.stats.shed += 1;
    }
    return {
      ip,
      action,
      count,
      soft: policy.soft,
      hard: policy.hard,
      penalized,
      penaltyMs,
      level: this.levelOf(ip),
    };
  }

  /* ---------------- süpürme ---------------- */

  sweep() {
    const now = Date.now();
    const maxAge = Math.ceil(DEFAULT_MAX_WINDOW / WINDOW_MS);
    const current = Math.floor(now / WINDOW_MS);
    this.windows.forEach((entry, ip) => {
      if (current - entry.w > maxAge) {
        this.windows.delete(ip);
      }
    });
    this.penalties.forEach((pen, ip) => {
      if (pen.ms <= now && now - pen.last > PENALTY_DECAY_MS) {
        this.penalties.delete(ip);
      }
    });
    this.authIp.forEach((rec, ip) => {
      if (now - rec.win > AUTH_IP_WINDOW_MS && rec.lockTill <= now) {
        this.authIp.delete(ip);
      }
    });
    this.authUser.forEach((rec, user) => {
      if (now - rec.win > AUTH_USER_WINDOW_MS && rec.lockTill <= now) {
        this.authUser.delete(user);
      }
    });
    this.quotas.forEach((rec, key) => {
      if (now - rec.win > 2 * 60 * 60 * 1000) {
        this.quotas.delete(key);
      }
    });
  }

  /* ---------------- cezalar ---------------- */

  isPenalized(rawIp) {
    const ip = normalizeIp(rawIp);
    const pen = this.penaltyEntry(ip);
    if (!pen || pen.ms <= Date.now()) {
      return 0;
    }
    return pen.ms - Date.now();
  }

  levelOf(rawIp) {
    const pen = this.penaltyEntry(normalizeIp(rawIp));
    return pen ? pen.lvl : 0;
  }

  /*
   * Kademeli ceza uygula (seviye yükselir, süre uzar).
   * @return ceza bitişine kalan ms
   */
  penalize(rawIp, reason = 'sel', minMs = 0) {
    const ip = normalizeIp(rawIp);
    const now = Date.now();
    let pen = this.penalties.get(ip);
    if (!pen) {
      pen = { ms: 0, lvl: 0, last: now, reason };
      this.penalties.set(ip, pen);
    }
    /*
     * Kademe yalnızca ceza SÜRERKEN gelen yeni ihlalde yükselir ve en fazla
     * 5 saniyede bir artar. Böylece tek bir yoğun patlama kademeyi anında
     * en üste taşımaz; gerçek ve ısrarcı saldırgan ise cezayı uzatır.
     */
    const repeat = now - pen.last <= PENALTY_MEMORY_MS;
    const canEscalate = repeat && now - (pen.lastEscalate || 0) > 5000;
    if (canEscalate) {
      pen.lastEscalate = now;
      pen.lvl = Math.min(pen.lvl + 1, PENALTY_STEPS.length);
    }
    pen.last = now;
    pen.reason = reason;
    if (pen.lvl === 0) {
      pen.lvl = 1;
      pen.lastEscalate = now;
    }
    const stepMs = PENALTY_STEPS[pen.lvl - 1];
    const duration = Math.max(stepMs, minMs);
    const firstForLevel = pen.loggedLvl !== pen.lvl;
    pen.loggedLvl = pen.lvl;
    pen.ms = now + duration;
    this.stats.penalized += 1;
    /*
     * Log selini engelle: bir sel sırasında saniyede binlerce uyarı basmak
     * sunucunun kendisini yorar (log da bir DoS yüzeyi). Aynı kademe için
     * ve aynı IP için en fazla 30 saniyede bir yazılır.
     */
    if (firstForLevel && now - (pen.lastLog || 0) > 30000) {
      pen.lastLog = now;
      console.warn(
        `[NetGuard] ${ip} cezalandırıldı (${reason}) seviye=${pen.lvl} süre=${Math.round(duration / 1000)}s`,
      );
    }
    return pen.ms - now;
  }

  /* ---------------- HTTP middleware ---------------- */

  ipOf(req) {
    /*
     * x-real-ip'e SADECE bağlantı gerçekten yerel bir ters-proxyden
     * geliyorsa güvenilir (bkz. middleware/ip.js). Aksi halde başlık
     * sahtelenebilir, o yüzden TCP eş adresi kullanılır.
     */
    const sock = req.socket || req.connection || {};
    const peer = sock.remoteAddress || '';
    if (typeof req.headers === 'object' && req.headers) {
      const header = req.headers['x-real-ip'] || req.headers['x-forwarded-for'];
      if (typeof header === 'string' && header.length < 64 && isTrustedPeer(peer)) {
        const first = header.split(',')[0].trim();
        if (looksLikeIp(first)) {
          return normalizeIp(first);
        }
        console.warn('Şüpheli x-real-ip biçimi yok sayıldı');
      }
    }
    return normalizeIp(peer || req.ip || 'bilinmeyen');
  }

  classify(req) {
    const path = req.path || '/';
    if (path.startsWith('/api/')) {
      return 'api';
    }
    if (path === '/' || path === '' || path.startsWith('/void') || path.startsWith('/tp')) {
      return 'page';
    }
    if (path.startsWith('/minimap')) {
      return 'mini';
    }
    if (path.startsWith('/tiles') || path.startsWith('/chunks')) {
      return 'asset';
    }
    return null; /* statik dosya (js/css/resim): sayılmaz, önbellekli ve ucuz */
  }

  /*
   * Express middleware — en dışta, gövde ayrıştırıcıdan önce çalışır.
   */
  middleware() {
    return (req, res, next) => {
      /* eşzamanlı istek tavanı: sel anında event loop'u korumak için hızlı ret */
      this.inflight += 1;
      if (this.inflight > MAX_INFLIGHT) {
        this.stats.rejected += 1;
        res.status(503).set('Retry-After', '5').type('text/plain')
          .send('Sunucu yoğun, birazdan tekrar dene.');
        this.inflight -= 1;
        return;
      }
      if (this.inflight > this.stats.peakInflight) {
        this.stats.peakInflight = this.inflight;
      }

      let released = false;
      const release = () => {
        if (!released) {
          released = true;
          this.inflight -= 1;
        }
      };
      res.on('finish', release);
      res.on('close', release);

      const ip = this.ipOf(req);
      Object.defineProperty(req, 'netguardIp', { value: ip, configurable: true });

      const waiting = this.isPenalized(ip);
      if (waiting > 0) {
        this.stats.rejected += 1;
        res.status(429).set('Retry-After', String(Math.ceil(waiting / 1000)))
          .type('text/plain')
          .send('Çok fazla istek. Kısa bir mola ver.');
        release();
        return;
      }

      const action = this.classify(req);
      if (action) {
        const result = this.hit(ip, action, 1);
        if (result.penalized) {
          this.stats.rejected += 1;
          res.status(429).set('Retry-After', String(Math.ceil(result.penaltyMs / 1000)))
            .type('text/plain')
            .send('Çok fazla istek. Kısa bir mola ver.');
          release();
          return;
        }
      }
      next();
    };
  }

  /* ---------------- giriş denemesi koruması (brute force) ---------------- */

  /*
   * @return { locked, lockMs, fails } — locked ise istek reddedilmeli
   */
  authCheck(ipRaw, usernameRaw) {
    const ip = normalizeIp(ipRaw);
    const username = typeof usernameRaw === 'string'
      ? usernameRaw.trim().toLowerCase().slice(0, 64) : '';
    const now = Date.now();

    const ipRec = this.authIp.get(ip);
    if (ipRec && ipRec.lockTill > now) {
      return { locked: true, lockMs: ipRec.lockTill - now };
    }
    if (username) {
      const uRec = this.authUser.get(username);
      if (uRec && uRec.lockTill > now) {
        return { locked: true, lockMs: uRec.lockTill - now };
      }
    }
    return { locked: false, lockMs: 0 };
  }

  /*
   * Başarısız giriş denemesi kaydet.
   */
  authFail(ipRaw, usernameRaw, windowMs = 0) {
    const ip = normalizeIp(ipRaw);
    const username = typeof usernameRaw === 'string'
      ? usernameRaw.trim().toLowerCase().slice(0, 64) : '';
    const now = Date.now();

    let ipRec = this.authIp.get(ip);
    if (!ipRec || now - ipRec.win > (windowMs || AUTH_IP_WINDOW_MS)) {
      ipRec = { n: 0, win: now, lockTill: 0 };
      this.authIp.set(ip, ipRec);
    }
    ipRec.n += 1;
    if (ipRec.n >= AUTH_IP_FAILS_HARD) {
      ipRec.lockTill = now + AUTH_IP_LOCK_LONG_MS;
      ipRec.n = 0;
      console.warn(`[NetGuard] ${ip} çok fazla başarısız giriş: 15 dk kilit`);
    } else if (ipRec.n >= AUTH_IP_FAILS_SOFT) {
      ipRec.lockTill = now + AUTH_IP_LOCK_MS;
    }

    if (username) {
      let uRec = this.authUser.get(username);
      if (!uRec || now - uRec.win > AUTH_USER_WINDOW_MS) {
        uRec = { n: 0, win: now, lockTill: 0 };
        this.authUser.set(username, uRec);
      }
      uRec.n += 1;
      if (uRec.n >= AUTH_USER_FAILS) {
        uRec.lockTill = now + AUTH_USER_LOCK_MS;
        uRec.n = 0;
        console.warn(`[NetGuard] hesap "${username}" kilitlendi: 10 dk`);
      }
    }
    return { locked: ipRec.lockTill > now, lockMs: Math.max(ipRec.lockTill - now, 0) };
  }

  /* Başarılı giriş: sayaçları temizle */
  authOk(ipRaw, usernameRaw) {
    this.authIp.delete(normalizeIp(ipRaw));
    if (typeof usernameRaw === 'string') {
      this.authUser.delete(usernameRaw.trim().toLowerCase().slice(0, 64));
    }
  }

  /*
   * Basit kayan kota: e-posta gönderme, kayıt gibi işlemler için.
   * @return true = izin var, false = kota doldu
   */
  quota(key, max, windowMs = 60 * 60 * 1000) {
    const safeKey = String(key || '').slice(0, 120);
    const now = Date.now();
    let rec = this.quotas.get(safeKey);
    if (!rec || now - rec.win > windowMs) {
      if (this.quotas.size >= MAX_TRACKED) {
        const oldest = this.quotas.keys().next();
        if (!oldest.done) {
          this.quotas.delete(oldest.value);
        }
      }
      rec = { n: 0, win: now };
      this.quotas.set(safeKey, rec);
    }
    rec.n += 1;
    return rec.n <= max;
  }

  /* kalan kota (test/gözlem için) */
  quotaUsed(key) {
    const rec = this.quotas.get(String(key || '').slice(0, 120));
    return rec ? rec.n : 0;
  }

  /* ---------------- gözlemlenebilirlik ---------------- */

  snapshot() {
    return {
      ...this.stats,
      tracked: this.windows.size,
      penalizedNow: this.penalties.size,
      inflight: this.inflight,
    };
  }
}

const netGuard = new NetGuard();

netGuard.normalizeIp = normalizeIp;
netGuard.isTrustedPeer = isTrustedPeer;
netGuard.looksLikeIp = looksLikeIp;
netGuard.POLICIES = POLICIES;
netGuard.PENALTY_STEPS = PENALTY_STEPS;

export default netGuard;
export {
  NetGuard, normalizeIp, isTrustedPeer, looksLikeIp, POLICIES,
};
