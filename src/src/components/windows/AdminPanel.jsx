/* PixelGlobe — Mega Admin Panel (IP ban, cihaz banı, mute, liste, IP tarama, pixel dedektifi, paste fix) */
import { useState, useCallback, useEffect, useRef } from 'preact/hooks';
import { memo } from 'preact/compat';
import { useSelector } from '../../store/react-redux/index.js';
import { api } from '../../utils/utag.js';
import { USERLVL } from '../../core/constants.js';

const TABS = [
  { id: 'moderasyon', label: '🔨 Moderasyon' },
  { id: 'liste', label: '📋 Ban Listesi' },
  { id: 'ipscan', label: '🛰️ IP Tarama' },
  { id: 'pixel', label: '🎯 Pixel Dedektifi' },
  { id: 'paste', label: '🖼️ Paste' },
];

const DURATION_PRESETS = [
  { label: '1 saat', ms: 3600000 },
  { label: '6 saat', ms: 21600000 },
  { label: '1 gün', ms: 86400000 },
  { label: '7 gün', ms: 604800000 },
  { label: '30 gün', ms: 2592000000 },
  { label: 'Kalıcı', ms: 0 },
];

async function postMod(form) {
  const res = await fetch(api`/api/modtools`, { credentials: 'include', method: 'POST', body: form });
  return { ok: res.ok, text: await res.text() };
}
async function postAdminAction(payload) {
  const res = await fetch(api`/api/admin/action`, {
    credentials: 'include',
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const j = await res.json().catch(() => ({ error: res.statusText }));
  return { ok: res.ok && j.ok, msg: j.message || j.error || '' };
}

function durationMs(amount, unit) {
  if (unit === 'permanent') return 0;
  const v = Number(amount);
  if (!v || v < 1) return null;
  return v * ({ m: 60000, h: 3600000, d: 86400000 }[unit] || 60000);
}

function Section({ title, color, children }) {
  const bg = {
    red: 'rgba(180,40,40,.10)',
    blue: 'rgba(40,100,180,.10)',
    purple: 'rgba(120,60,180,.10)',
    green: 'rgba(40,140,80,.10)',
    dark: 'rgba(30,30,40,.60)',
  }[color] || 'rgba(255,255,255,.04)';
  const border = {
    red: '1px solid rgba(255,80,80,.35)',
    blue: '1px solid rgba(80,160,255,.35)',
    purple: '1px solid rgba(168,85,247,.35)',
    green: '1px solid rgba(50,200,110,.35)',
    dark: '1px solid rgba(255,255,255,.10)',
  }[color] || '1px solid rgba(255,255,255,.08)';
  return (
    <section style={{ padding: 14, borderRadius: 12, border, background: bg, marginBottom: 14 }}>
      <h3 style={{ margin: '0 0 10px', fontSize: '1.05em' }}>{title}</h3>
      {children}
    </section>
  );
}

function AdminPanel() {
  const userlvl = useSelector((s) => s.user.userlvl);
  const currentCanvasId = useSelector((s) => s.canvas?.canvasId);
  const canvases = useSelector((s) => s.canvas?.canvases) || {};
  const [tab, setTab] = useState('moderasyon');

  // moderasyon state
  const [target, setTarget] = useState('');
  const [reason, setReason] = useState('');
  const [amount, setAmount] = useState('1');
  const [unit, setUnit] = useState('d');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [actionType, setActionType] = useState('ban'); // ban | ipban | deviceban | mute

  // liste
  const [bans, setBans] = useState([]);
  const [banFilter, setBanFilter] = useState('all');
  const [banLoading, setBanLoading] = useState(false);
  const [banMsg, setBanMsg] = useState('');

  // ipscan
  const [scanIp, setScanIp] = useState('');
  const [scanRes, setScanRes] = useState(null);
  const [scanBusy, setScanBusy] = useState(false);

  // pixel dedektifi
  const [pixelMode, setPixelMode] = useState(false);
  const [pixelPos, setPixelPos] = useState({ x: 0, y: 0 });
  const [pixelInfo, setPixelInfo] = useState(null);
  const [pixelBusy, setPixelBusy] = useState(false);
  const [pixelMsg, setPixelMsg] = useState('');

  // paste
  const [file, setFile] = useState(null);
  const [canvasId, setCanvasId] = useState(String(currentCanvasId ?? '0'));
  const [px, setPx] = useState('0');
  const [py, setPy] = useState('0');
  const [pasteMsg, setPasteMsg] = useState('');
  const [pasteBusy, setPasteBusy] = useState(false);
  const [previewUrl, setPreviewUrl] = useState('');

  const [stats, setStats] = useState(null);

  useEffect(() => {
    fetch(api`/api/admin/stats`, { credentials: 'include' }).then((r) => r.json()).then(setStats).catch(() => {});
  }, [tab]);

  const refreshBans = useCallback(async () => {
    setBanLoading(true);
    setBanMsg('');
    try {
      const r = await fetch(api`/api/admin/bans?limit=100&type=${banFilter}`, { credentials: 'include' });
      const j = await r.json();
      if (j.ok) setBans(j.bans || []);
      else setBanMsg(j.error || 'Liste alınamadı');
    } catch (e) { setBanMsg(e.message); }
    setBanLoading(false);
  }, [banFilter]);

  useEffect(() => {
    if (tab === 'liste') refreshBans();
  }, [tab, banFilter, refreshBans]);

  // pixel inspector: global click listener when enabled
  useEffect(() => {
    if (!pixelMode) return undefined;
    const handler = async (e) => {
      // admin sadece oyun tuvaline tıklayınca tetikle (canvas element kontrolü basit)
      // Koordinatı pixelPos'tan değil, oyun içindeki son tıklamadan alacağız ama basit olarak elle girilen koordinatı kullan
    };
    // Ayrıca window'dan gelen pg-pixelinfo olayını dinle (oyun içi uzun basış ile entegre)
    const onPixelInfo = (ev) => {
      const d = ev.detail;
      if (d && d.x !== undefined && d.y !== undefined) {
        setPixelPos({ x: Math.floor(d.x), y: Math.floor(d.y) });
        doPixelLookup(d.x, d.y, d.canvasId);
      }
    };
    window.addEventListener('pg-pixelinfo', onPixelInfo);
    return () => window.removeEventListener('pg-pixelinfo', onPixelInfo);
  }, [pixelMode]);

  const doPixelLookup = useCallback(async (x, y, cId) => {
    const cid = cId ?? currentCanvasId ?? 0;
    setPixelBusy(true);
    setPixelMsg('');
    setPixelInfo(null);
    try {
      const r = await fetch(api`/api/pixelinfo?c=${cid}&x=${Math.floor(x)}&y=${Math.floor(y)}`, { credentials: 'include' });
      const j = await r.json();
      if (j.found && j.info) {
        setPixelInfo(j.info);
        // IP varsa otomatik tara
        if (j.info.ip) setScanIp(j.info.ip);
      } else {
        setPixelMsg('Bu piksel için kayıt yok (çok eski veya hiç iz bırakmamış). Son 90 gün içindeki pikseller saklanır.');
      }
    } catch (e) { setPixelMsg(e.message); }
    setPixelBusy(false);
  }, [currentCanvasId]);

  const doBan = useCallback(async () => {
    if (!target.trim() || !reason.trim()) { setMsg('Hedef ve sebep zorunlu kanka.'); return; }
    const ms = durationMs(amount, unit);
    if (ms === null) { setMsg('Süre yanlış'); return; }
    setBusy(true); setMsg('İşleniyor…');
    const map = { ban: 'ban', ipban: 'ipban', deviceban: 'deviceban', mute: 'mute' };
    const act = map[actionType] || 'ban';
    const res = await postAdminAction({ target: target.trim(), action: act, reason: reason.trim(), duration: ms });
    setMsg(`${res.ok ? '✅' : '❌'} ${res.msg}`);
    setBusy(false);
    if (res.ok) refreshBans();
  }, [target, reason, amount, unit, actionType, refreshBans]);

  const doUnban = useCallback(async (buuid, isMute) => {
    setBusy(true);
    const act = isMute ? 'unmute' : 'unban';
    const res = await postAdminAction({ target: buuid, action: act });
    setBanMsg(`${res.ok ? '✅' : '❌'} ${res.msg}`);
    setBusy(false);
    refreshBans();
  }, [refreshBans]);

  const doScan = useCallback(async () => {
    if (!scanIp.trim()) return;
    setScanBusy(true); setScanRes(null);
    try {
      const r = await fetch(api`/api/admin/scan-ip?ip=${encodeURIComponent(scanIp.trim())}`, { credentials: 'include' });
      const j = await r.json();
      if (j.ok) setScanRes(j);
      else setScanRes({ error: j.error });
    } catch (e) { setScanRes({ error: e.message }); }
    setScanBusy(false);
  }, [scanIp]);

  const doPaste = useCallback(async () => {
    const x = Math.floor(Number(px)); const y = Math.floor(Number(py));
    if (!file) { setPasteMsg('PNG/JPG/GIF/WEBP seç aga'); return; }
    if (Number.isNaN(x) || Number.isNaN(y)) { setPasteMsg('Koordinat hatalı'); return; }
    setPasteBusy(true); setPasteMsg('Yükleniyor… Arnavutluk fix aktif: renkler en yakın palete otomatik düşüyor, şeffaflık korunuyor.');
    try {
      const form = new FormData();
      form.append('imageaction', 'load');
      form.append('coords', `${x}_${y}`);
      form.append('canvasid', String(canvasId));
      form.append('image', file, file.name || 'template.png');
      const r = await postMod(form);
      setPasteMsg(`${r.ok ? '✅' : '❌'} ${r.text}`);
    } catch (e) { setPasteMsg(`❌ ${e.message}`); }
    setPasteBusy(false);
  }, [file, px, py, canvasId]);

  useEffect(() => {
    if (!file) { setPreviewUrl(''); return; }
    const url = URL.createObjectURL(file);
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  if (userlvl < USERLVL.MOD) {
    return <div className="content margin-container"><p>Bu sayfaya erişim iznin yok kanka.</p></div>;
  }

  const canvasOptions = Object.keys(canvases).filter((id) => canvases[id] && !canvases[id].ed && !canvases[id].v);

  return (
    <div className="content margin-container admin-panel" style={{ maxWidth: 980 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
        <h2 style={{ margin: 0 }}>🛡️ PixelGlobe Mega Admin</h2>
        {stats && (
          <div style={{ fontSize: '.85em', opacity: .75, background: 'rgba(255,255,255,.06)', padding: '6px 10px', borderRadius: 999 }}>
            Aktif ban: <b>{stats.banCount ?? '–'}</b> · mute: <b>{stats.muteCount ?? '–'}</b> · şüpheli proxy: <b>{stats.proxyCount ?? '–'}</b>
          </div>
        )}
      </div>
      <p style={{ opacity: .7, marginTop: 6 }}>IP ban, cihaz parmak izi banı, normal ban, mute, pixel geçmişi ve IP tarama hepsi burada. Sağ taraftaki listeden direkt kaldırabilirsin.</p>

      {/* TAB BAR */}
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 14 }}>
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            style={{
              padding: '8px 14px',
              borderRadius: 999,
              border: tab === t.id ? '1px solid #a78bfa' : '1px solid rgba(255,255,255,.12)',
              background: tab === t.id ? 'linear-gradient(135deg,#6d28d9,#4338ca)' : 'rgba(255,255,255,.06)',
              color: '#fff',
              fontWeight: tab === t.id ? 800 : 600,
              cursor: 'pointer',
            }}
          >{t.label}</button>
        ))}
      </div>

      {tab === 'moderasyon' && (
        <>
          <Section title="🔨 Hedefi Cezalandır" color="red">
            <div style={{ display: 'grid', gap: 10 }}>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <select value={actionType} onChange={(e) => setActionType(e.target.value)} style={{ flex: '0 0 160px', padding: 8, borderRadius: 8, background: '#1f2937', color: '#fff', border: '1px solid #374151' }}>
                  <option value="ban">Kullanıcı Ban</option>
                  <option value="mute">Mute (sustur)</option>
                  <option value="ipban">IP Ban</option>
                  {userlvl >= USERLVL.ADMIN && <option value="deviceban">Cihaz (parmak izi) Ban — ADMIN</option>}
                </select>
                <input value={target} onInput={(e) => setTarget(e.target.value)} placeholder="Kullanıcı adı / ID / IP / cihaz hash" style={{ flex: '1 1 260px', padding: 10, borderRadius: 8, border: '1px solid #374151', background: '#111827', color: '#fff' }} />
              </div>
              <input value={reason} onInput={(e) => setReason(e.target.value)} placeholder="Sebep (örn: Arnavutluk'a botla spam)" style={{ padding: 10, borderRadius: 8, border: '1px solid #374151', background: '#111827', color: '#fff' }} />
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                <input type="number" min="1" value={amount} disabled={unit === 'permanent'} onInput={(e) => setAmount(e.target.value)} style={{ width: 90, padding: 8, borderRadius: 8, border: '1px solid #374151', background: '#111827', color: '#fff' }} />
                <select value={unit} onChange={(e) => setUnit(e.target.value)} style={{ padding: 8, borderRadius: 8, background: '#1f2937', color: '#fff', border: '1px solid #374151' }}>
                  <option value="m">dakika</option>
                  <option value="h">saat</option>
                  <option value="d">gün</option>
                  <option value="permanent">kalıcı</option>
                </select>
                <div style={{ display: 'flex', gap: 6 }}>
                  {DURATION_PRESETS.map((p) => (
                    <button key={p.label} type="button" onClick={() => { if (p.ms === 0) { setUnit('permanent'); } else { setAmount(String(p.ms / 86400000)); setUnit('d'); } }} style={{ padding: '6px 8px', borderRadius: 999, border: '1px solid rgba(255,255,255,.12)', background: 'rgba(255,255,255,.06)', color: '#fff', fontSize: '.82em' }}>{p.label}</button>
                  ))}
                </div>
                <button type="button" disabled={busy} onClick={doBan} style={{ marginLeft: 'auto', padding: '10px 18px', borderRadius: 10, border: 'none', background: 'linear-gradient(135deg,#ef4444,#b91c1c)', color: '#fff', fontWeight: 800, cursor: 'pointer' }}>{busy ? '…' : (actionType === 'mute' ? 'Mutele' : 'Banla')}</button>
              </div>
              {msg && <pre style={{ whiteSpace: 'pre-wrap', background: 'rgba(0,0,0,.25)', padding: 10, borderRadius: 8 }}>{msg}</pre>}
              <div style={{ fontSize: '.82em', opacity: .6 }}>İpucu: Cihaz banı, o parmak iziyle giriş yapan tüm hesapları + IP'leri banlar. Sadece ADMIN yapabilir.</div>
            </div>
          </Section>

          <Section title="♻️ Hızlı Kaldır (Unban / Unmute)" color="green">
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <input id="quickUnban" placeholder="Ban UUID / Kullanıcı ID / IP / isim" style={{ flex: 1, padding: 10, borderRadius: 8, border: '1px solid #374151', background: '#111827', color: '#fff' }} />
              <button type="button" onClick={async () => {
                const el = document.getElementById('quickUnban');
                const v = el.value.trim(); if (!v) return;
                setBusy(true);
                const r1 = await postAdminAction({ target: v, action: 'unban' });
                const r2 = r1.ok ? r1 : await postAdminAction({ target: v, action: 'unmute' });
                setMsg(`${r2.ok ? '✅' : '❌'} ${r2.msg}`);
                setBusy(false);
                refreshBans();
              }} style={{ padding: '10px 14px', borderRadius: 8, border: 'none', background: '#16a34a', color: '#fff', fontWeight: 700 }}>Banı / Mute'u Kaldır</button>
            </div>
            {msg && <div style={{ marginTop: 8, fontSize: '.9em', opacity: .8 }}>{msg}</div>}
          </Section>
        </>
      )}

      {tab === 'liste' && (
        <Section title="📋 Tüm Banlı / Muteli Listesi" color="dark">
          <div style={{ display: 'flex', gap: 8, marginBottom: 10, flexWrap: 'wrap' }}>
            <select value={banFilter} onChange={(e) => setBanFilter(e.target.value)} style={{ padding: 8, borderRadius: 8, background: '#1f2937', color: '#fff', border: '1px solid #374151' }}>
              <option value="all">Hepsi</option>
              <option value="ban">Sadece Ban</option>
              <option value="mute">Sadece Mute</option>
            </select>
            <button type="button" onClick={refreshBans} disabled={banLoading} style={{ padding: '8px 12px', borderRadius: 8, border: '1px solid rgba(255,255,255,.12)', background: 'rgba(255,255,255,.08)', color: '#fff' }}>{banLoading ? '…' : 'Yenile'}</button>
            <span style={{ opacity: .6, fontSize: '.9em', alignSelf: 'center' }}>{bans.length} kayıt</span>
          </div>
          {banMsg && <pre style={{ whiteSpace: 'pre-wrap' }}>{banMsg}</pre>}
          <div style={{ overflowX: 'auto', borderRadius: 10, border: '1px solid rgba(255,255,255,.08)' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '.9em' }}>
              <thead style={{ background: 'rgba(255,255,255,.06)' }}>
                <tr>
                  <th style={{ padding: 8, textAlign: 'left' }}>Tür</th>
                  <th style={{ padding: 8, textAlign: 'left' }}>Sebep</th>
                  <th style={{ padding: 8, textAlign: 'left' }}>Kimler</th>
                  <th style={{ padding: 8, textAlign: 'left' }}>IP</th>
                  <th style={{ padding: 8, textAlign: 'left' }}>Bitiş</th>
                  <th style={{ padding: 8, textAlign: 'left' }}>Yetkili</th>
                  <th style={{ padding: 8 }} />
                </tr>
              </thead>
              <tbody>
                {bans.map((b) => (
                  <tr key={b.buuid} style={{ borderTop: '1px solid rgba(255,255,255,.06)', background: b.isBan ? 'rgba(239,68,68,.06)' : 'rgba(234,179,8,.06)' }}>
                    <td style={{ padding: 8 }}>{b.isBan && b.isMute ? 'Ban+Mute' : b.isBan ? 'Ban' : 'Mute'}</td>
                    <td style={{ padding: 8, maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis' }}>{b.reason}</td>
                    <td style={{ padding: 8 }}>
                      {(b.users || []).map((u) => (
                        <div key={u.id}><b>{u.id}</b> {u.name || ''}</div>
                      ))}
                      {(!b.users || b.users.length === 0) && <span style={{ opacity: .5 }}>—</span>}
                    </td>
                    <td style={{ padding: 8, fontFamily: 'monospace', fontSize: '.9em' }}>
                      {(b.ips || []).map((ip) => <div key={ip.ip}>{ip.ip || ip.ipString}</div>)}
                      {(!b.ips || b.ips.length === 0) && <span style={{ opacity: .5 }}>—</span>}
                    </td>
                    <td style={{ padding: 8 }}>{b.expires ? new Date(b.expires).toLocaleString() : 'Kalıcı'}</td>
                    <td style={{ padding: 8 }}>{b.mname ? `${b.mname} (${b.muid})` : b.muid || '—'}</td>
                    <td style={{ padding: 8 }}>
                      <button type="button" disabled={busy} onClick={() => doUnban(b.buuid, !b.isBan && b.isMute)} style={{ padding: '6px 10px', borderRadius: 8, border: 'none', background: b.isBan ? '#16a34a' : '#f59e0b', color: '#fff', fontWeight: 700, cursor: 'pointer' }}>{b.isBan ? 'Unban' : 'Unmute'}</button>
                    </td>
                  </tr>
                ))}
                {!bans.length && !banLoading && <tr><td colSpan={7} style={{ padding: 14, textAlign: 'center', opacity: .6 }}>Kayıt yok</td></tr>}
              </tbody>
            </table>
          </div>
        </Section>
      )}

      {tab === 'ipscan' && (
        <Section title="🛰️ IP Tarama — Proxy / VPN / TOR / Bot" color="purple">
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 10 }}>
            <input value={scanIp} onInput={(e) => setScanIp(e.target.value)} placeholder="Örn: 1.2.3.4" style={{ flex: 1, padding: 10, borderRadius: 8, border: '1px solid #374151', background: '#111827', color: '#fff', fontFamily: 'monospace' }} />
            <button type="button" disabled={scanBusy} onClick={doScan} style={{ padding: '10px 16px', borderRadius: 8, border: 'none', background: 'linear-gradient(135deg,#7c3aed,#4f46e5)', color: '#fff', fontWeight: 800 }}>{scanBusy ? '…' : 'Tara'}</button>
          </div>
          <div style={{ fontSize: '.82em', opacity: .6, marginBottom: 10 }}>Pixel dedektifinden gelen IP buraya otomatik düşer. Taradığında sistem ProxyIntel + whois + risk skorunu gösterir.</div>
          {scanRes && scanRes.error && <pre style={{ whiteSpace: 'pre-wrap', color: '#fca5a5' }}>{scanRes.error}</pre>}
          {scanRes && scanRes.ok && (
            <div style={{ display: 'grid', gap: 10 }}>
              <div style={{ padding: 12, borderRadius: 10, background: scanRes.proxy?.isProxy ? 'rgba(239,68,68,.15)' : 'rgba(16,185,129,.15)', border: '1px solid rgba(255,255,255,.08)' }}>
                <div style={{ fontWeight: 800, fontSize: '1.05em' }}>{scanRes.analysis?.verdict}</div>
                <div style={{ fontSize: '.9em', opacity: .8 }}>{scanRes.proxy ? `${scanRes.proxy.kindLabel} — ${scanRes.proxy.type || ''} ${scanRes.proxy.operator ? `· ${scanRes.proxy.operator}` : ''} ${scanRes.proxy.city ? `· ${scanRes.proxy.city}` : ''}` : 'Temiz veya henüz veri yok'}</div>
                {scanRes.proxy && <div style={{ fontSize: '.85em', opacity: .7 }}>Risk: {scanRes.proxy.risk} · Güven: {scanRes.proxy.confidence}% · Cihaz sayısı: {scanRes.proxy.devices}</div>}
              </div>
              {scanRes.ipData && (
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, fontSize: '.9em' }}>
                  <div style={{ padding: 10, borderRadius: 8, background: 'rgba(255,255,255,.04)' }}><div style={{ opacity: .6 }}>Ülke</div><b>{scanRes.ipData.country || '—'}</b></div>
                  <div style={{ padding: 10, borderRadius: 8, background: 'rgba(255,255,255,.04)' }}><div style={{ opacity: .6 }}>ASN / Org</div><b>{scanRes.ipData.asn || '—'} {scanRes.ipData.org || ''}</b></div>
                  <div style={{ padding: 10, borderRadius: 8, background: 'rgba(255,255,255,.04)' }}><div style={{ opacity: .6 }}>CIDR</div><b style={{ fontFamily: 'monospace' }}>{scanRes.ipData.cidr || '—'}</b></div>
                  <div style={{ padding: 10, borderRadius: 8, background: 'rgba(255,255,255,.04)' }}><div style={{ opacity: .6 }}>Tür</div><b>{scanRes.ipData.type || '—'} {scanRes.ipData.isProxy ? '· PROXY' : ''} {scanRes.ipData.isWhitelisted ? '· WHITELIST' : ''}</b></div>
                </div>
              )}
              {!!scanRes.users?.length && (
                <div style={{ padding: 10, borderRadius: 8, background: 'rgba(255,255,255,.04)' }}>
                  <div style={{ fontWeight: 700, marginBottom: 6 }}>Bu IP ile ilişkili hesaplar (son 30 gün)</div>
                  {scanRes.users.map((u) => (
                    <div key={u.id} style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderTop: '1px solid rgba(255,255,255,.06)' }}>
                      <span><b>{u.name}</b> <span style={{ opacity: .6 }}>@{u.username}</span> <span style={{ fontFamily: 'monospace' }}>#{u.id}</span></span>
                      <button type="button" onClick={() => { setTarget(String(u.id)); setTab('moderasyon'); }} style={{ padding: '4px 8px', borderRadius: 999, border: 'none', background: '#ef4444', color: '#fff', fontSize: '.82em' }}>Banla</button>
                    </div>
                  ))}
                  <div style={{ fontSize: '.82em', opacity: .6 }}>{scanRes.alts?.userIds?.length > 5 ? `+ ${scanRes.alts.userIds.length - 5} daha` : ''} · Toplam IID: {scanRes.alts?.iids?.length || 0}</div>
                </div>
              )}
              {!scanRes.users?.length && scanRes.alts && (
                <div style={{ fontSize: '.85em', opacity: .6 }}>Bu IP ile eşleşen kullanıcı yok (veya henüz loglanmadı).</div>
              )}
            </div>
          )}
        </Section>
      )}

      {tab === 'pixel' && (
        <Section title="🎯 Pixel Dedektifi — Tıkla, Kim Attı Gör" color="blue">
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 8 }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 10px', borderRadius: 999, background: pixelMode ? 'rgba(16,185,129,.18)' : 'rgba(255,255,255,.06)', border: '1px solid rgba(255,255,255,.12)' }}>
              <input type="checkbox" checked={pixelMode} onChange={(e) => setPixelMode(e.target.checked)} />
              Dedektif modu {pixelMode ? 'AÇIK' : 'kapalı'}
            </label>
            <span style={{ fontSize: '.82em', opacity: .6 }}>Açtığında haritada bir piksele uzun bas / sağ tıkla → otomatik buraya düşer. Veya elle gir:</span>
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 10 }}>
            <input type="number" value={pixelPos.x} onInput={(e) => setPixelPos({ ...pixelPos, x: Number(e.target.value) })} placeholder="X" style={{ width: 110, padding: 8, borderRadius: 8, border: '1px solid #374151', background: '#111827', color: '#fff' }} />
            <input type="number" value={pixelPos.y} onInput={(e) => setPixelPos({ ...pixelPos, y: Number(e.target.value) })} placeholder="Y" style={{ width: 110, padding: 8, borderRadius: 8, border: '1px solid #374151', background: '#111827', color: '#fff' }} />
            <select value={String(canvasId)} onChange={(e) => setCanvasId(e.target.value)} style={{ padding: 8, borderRadius: 8, background: '#1f2937', color: '#fff', border: '1px solid #374151' }}>
              {canvasOptions.map((id) => <option key={id} value={id}>{canvases[id].title || canvases[id].ident} ({id})</option>)}
            </select>
            <button type="button" disabled={pixelBusy} onClick={() => doPixelLookup(pixelPos.x, pixelPos.y, canvasId)} style={{ padding: '8px 14px', borderRadius: 8, border: 'none', background: 'linear-gradient(135deg,#0ea5e9,#6366f1)', color: '#fff', fontWeight: 800 }}>{pixelBusy ? '…' : 'Sorgula'}</button>
          </div>
          {pixelMsg && <div style={{ padding: 10, borderRadius: 8, background: 'rgba(255,255,255,.06)', marginBottom: 10 }}>{pixelMsg}</div>}
          {pixelInfo && (
            <div style={{ display: 'grid', gap: 10 }}>
              <div style={{ padding: 12, borderRadius: 10, background: 'rgba(255,255,255,.05)', border: '1px solid rgba(255,255,255,.08)' }}>
                <div style={{ fontWeight: 800 }}>{pixelInfo.name} <span style={{ opacity: .6, fontWeight: 400 }}>@{pixelInfo.username || '—'}</span> <span style={{ fontFamily: 'monospace', fontSize: '.9em' }}>#{pixelInfo.uid}</span></div>
                <div style={{ fontSize: '.85em', opacity: .7 }}>{pixelInfo.x}, {pixelInfo.y} · Canvas {pixelInfo.canvasId} · {pixelInfo.ts ? new Date(pixelInfo.ts).toLocaleString() : ''}</div>
                <div style={{ marginTop: 8, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  <button type="button" onClick={() => { setTarget(String(pixelInfo.uid)); setTab('moderasyon'); }} style={{ padding: '6px 10px', borderRadius: 8, border: 'none', background: '#ef4444', color: '#fff', fontWeight: 700 }}>Bu kişiyi banla</button>
                  <button type="button" onClick={() => { setScanIp(pixelInfo.ip || ''); setTab('ipscan'); if (pixelInfo.ip) doScan(); }} disabled={!pixelInfo.ip} style={{ padding: '6px 10px', borderRadius: 8, border: '1px solid rgba(255,255,255,.12)', background: 'rgba(255,255,255,.08)', color: '#fff' }}>IP tara</button>
                  <button type="button" onClick={() => window.open(`?profile=${pixelInfo.uid}`, '_blank')} style={{ padding: '6px 10px', borderRadius: 8, border: '1px solid rgba(255,255,255,.12)', background: 'rgba(255,255,255,.08)', color: '#fff' }}>Profili aç</button>
                </div>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                <div style={{ padding: 10, borderRadius: 8, background: 'rgba(255,255,255,.04)' }}>
                  <div style={{ opacity: .6, fontSize: '.82em' }}>IP Adresi (MOD+)</div>
                  <div style={{ fontFamily: 'monospace', fontWeight: 700 }}>{pixelInfo.ip || '— (eski piksel)'}</div>
                  {pixelInfo.ipMeta && <div style={{ fontSize: '.82em', opacity: .7 }}>{pixelInfo.ipMeta.country} · {pixelInfo.ipMeta.org} · ASN {pixelInfo.ipMeta.asn}</div>}
                </div>
                <div style={{ padding: 10, borderRadius: 8, background: pixelInfo.proxy?.isProxy ? 'rgba(239,68,68,.12)' : 'rgba(255,255,255,.04)' }}>
                  <div style={{ opacity: .6, fontSize: '.82em' }}>Proxy / VPN</div>
                  <div style={{ fontWeight: 700 }}>{pixelInfo.proxy ? (pixelInfo.proxy.isProxy ? `${pixelInfo.proxy.kindLabel} (${pixelInfo.proxy.type})` : 'Temiz') : '—'}</div>
                  {pixelInfo.proxy && <div style={{ fontSize: '.82em', opacity: .7 }}>Risk {pixelInfo.proxy.risk} · Güven {pixelInfo.proxy.confidence}%</div>}
                </div>
              </div>
              {pixelInfo.deviceHash && <div style={{ fontSize: '.82em', opacity: .6, fontFamily: 'monospace' }}>Cihaz parmak izi: {pixelInfo.deviceHash}</div>}
            </div>
          )}
          <div style={{ marginTop: 10, fontSize: '.82em', opacity: .55 }}>Not: Pixel geçmişi 90 gün saklanır. Eski piksellerde IP/isim boş döner. Yeni piksellerde anında dolar.</div>
        </Section>
      )}

      {tab === 'paste' && (
        <Section title="🖼️ Şablon Yapıştır — Arnavutluk Fix" color="green">
          <div style={{ display: 'grid', gap: 10 }}>
            <div style={{ padding: 10, borderRadius: 10, background: 'rgba(16,185,129,.10)', border: '1px solid rgba(16,185,129,.25)', fontSize: '.9em' }}>
              <b>Fix aktif:</b> Artık renkler birebir palette yoksa <b>en yakın renge</b> otomatik düşüyor. Şeffaf (alpha &lt;10) pikseller atlanıyor, anti-alias kenarlar bozulmuyor. Arnavutluk gibi kırmızı-siyah bayraklarda test edildi.
            </div>
            <input type="file" accept="image/png,image/jpeg,image/gif,image/webp" onChange={(e) => setFile(e.target.files?.[0] || null)} style={{ width: '100%' }} />
            {previewUrl && (
              <div style={{ display: 'grid', gridTemplateColumns: '140px 1fr', gap: 10, alignItems: 'center' }}>
                <img src={previewUrl} alt="Önizleme" style={{ width: 140, height: 140, objectFit: 'contain', background: '#0b0e14', borderRadius: 8, border: '1px solid rgba(255,255,255,.08)' }} />
                <div style={{ fontSize: '.85em', opacity: .7 }}>{file?.name} · {file?.size ? `${Math.round(file.size / 1024)} KB` : ''} · {file?.type}</div>
              </div>
            )}
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <select value={canvasId} onChange={(e) => setCanvasId(e.target.value)} style={{ padding: 8, borderRadius: 8, background: '#1f2937', color: '#fff', border: '1px solid #374151' }}>
                {canvasOptions.map((id) => <option key={id} value={id}>{canvases[id].title || canvases[id].ident} ({id})</option>)}
              </select>
              <input type="number" value={px} onInput={(e) => setPx(e.target.value)} placeholder="X" style={{ width: 100, padding: 8, borderRadius: 8, border: '1px solid #374151', background: '#111827', color: '#fff' }} />
              <input type="number" value={py} onInput={(e) => setPy(e.target.value)} placeholder="Y" style={{ width: 100, padding: 8, borderRadius: 8, border: '1px solid #374151', background: '#111827', color: '#fff' }} />
              <button type="button" disabled={pasteBusy} onClick={doPaste} style={{ padding: '10px 16px', borderRadius: 8, border: 'none', background: 'linear-gradient(135deg,#10b981,#059669)', color: '#fff', fontWeight: 800 }}>{pasteBusy ? '…' : 'Yapıştır'}</button>
            </div>
            {pasteMsg && <pre style={{ whiteSpace: 'pre-wrap', background: 'rgba(0,0,0,.25)', padding: 10, borderRadius: 8 }}>{pasteMsg}</pre>}
            <div style={{ fontSize: '.82em', opacity: .6 }}>İpucu: Büyük görsellerde önce 1x yakınlaştırmada dene. Korumalı alanlara yapıştırma engellenir.</div>
          </div>
        </Section>
      )}
    </div>
  );
}

export default memo(AdminPanel);
