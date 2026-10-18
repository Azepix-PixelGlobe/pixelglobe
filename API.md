# PixelGlobe API

Base: `https://pixelglobe.fun/api` (or your host + `BASENAME`)

All JSON. `POST /api/entry-check` is public, the rest need a session cookie `ppfun.session`.

## Auth

- `POST /api/auth/local` — login with `{email, password}`
- `POST /api/auth/register` — `{name, username, email, password, captcha, captchaid, cs}`
- `GET /api/me` — session user
- `GET /api/baninfo` — your ban status

## Canvas

- `GET /api/canvases` — list canvases
- `GET /tiles/:z/:x/:y.png` — raster tile
- `GET /chunks?c=&ids=` — binary chunks
- `WS /ws` — live pixels (binary opcodes, see `src/socket/`)

### Pixel Inspector

- `GET /api/pixelinfo?c=0&x=123&y=456` → `{ok, found, info: {uid, name, username, ip?, proxy?, ts}}` — `ip/proxy` only for MOD+

### Admin (MOD+)

- `GET /api/admin/bans?type=all|ban|mute&limit=&offset=` → `{bans: [...]}`
- `GET /api/admin/scan-ip?ip=1.2.3.4` → `{ipData, proxy, analysis, users, alts}`
- `POST /api/admin/action` `{target, action: "ban|ipban|deviceban|mute|unban|unmute|whitelist", reason, duration}` → `{ok, message}`
- `GET /api/admin/stats` → `{banCount, muteCount, proxyCount}`

## Errors

All errors are `{error: "message"}` with HTTP status. Rate-limited → `429`.
