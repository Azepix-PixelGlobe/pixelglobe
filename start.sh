#!/usr/bin/env bash
set -e

PPDIR="$(cd "$(dirname "$0")" && pwd)"
MARIADB_DATA="$PPDIR/.mariadb-data"
MARIADB_RUN="$PPDIR/.mariadb-run"
REDIS_DATA="$PPDIR/.redis-data"
PRELOAD="$PPDIR/fix_openat.so"
SHARE=/nix/store/a4jsa8kjdn3wlccj2wkvhxqza38rpxzf-mariadb-server-10.11.13/share/mysql

echo "=== PixelPlanet Startup ==="

# ─── 0. Open loading page IMMEDIATELY so Replit sees the port ───────────────
# This must happen before any slow operation (Redis load, tile gen, etc.)
PPPORT="${PORT:-5000}"
node -e "
const http = require('http');
const s = http.createServer((req, res) => {
  res.writeHead(200, {'Content-Type': 'text/html; charset=utf-8'});
  res.end('<html><head><meta charset=\"utf-8\"><meta http-equiv=\"refresh\" content=\"15\"><style>body{font-family:sans-serif;background:#1a1a2e;color:#eee;display:flex;flex-direction:column;align-items:center;justify-content:center;height:100vh;margin:0}</style></head><body><h2>PixelPlanet başlatılıyor...</h2><p>Harita hazırlanıyor, lütfen bekleyin.</p><p style=\"opacity:.6;font-size:.9em\">Bu sayfa 15 saniyede bir otomatik yenilenecek.</p></body></html>');
});
s.listen(${PPPORT}, '0.0.0.0', () => process.stdout.write('Loading page up on port ${PPPORT}\n'));
process.on('SIGTERM', () => { s.close(); process.exit(0); });
" &
LOADING_PID=$!
echo ">>> Loading page started (PID $LOADING_PID)"

# ─── 1. Build LD_PRELOAD fix if missing ────────────────────────────────────
if [ ! -f "$PRELOAD" ]; then
  echo ">>> Building openat fix library..."
  cat > /tmp/fix_openat_src.c << 'CEOF'
#define _GNU_SOURCE
#include <dlfcn.h>
#include <fcntl.h>
#include <stdarg.h>
#include <sys/types.h>
typedef int (*orig_openat_t)(int, const char *, int, ...);
int openat(int dirfd, const char *pathname, int flags, ...) {
    orig_openat_t orig = (orig_openat_t)dlsym(RTLD_NEXT, "openat");
    mode_t mode = 0;
    if (flags & O_CREAT) { va_list ap; va_start(ap, flags); mode = va_arg(ap, mode_t); va_end(ap); }
    if (dirfd == -1) dirfd = AT_FDCWD;
    if (flags & O_CREAT) return orig(dirfd, pathname, flags, mode);
    return orig(dirfd, pathname, flags);
}
int openat64(int dirfd, const char *pathname, int flags, ...) { return openat(dirfd, pathname, flags); }
CEOF
  gcc -shared -fPIC -o "$PRELOAD" /tmp/fix_openat_src.c -ldl
  echo ">>> openat fix built."
fi

# ─── 2. Redis ───────────────────────────────────────────────────────────────
mkdir -p "$REDIS_DATA"
if ! redis-cli ping &>/dev/null 2>&1; then
  echo ">>> Starting Redis..."
  redis-server --daemonize yes \
    --dir "$REDIS_DATA" \
    --logfile "$REDIS_DATA/redis.log" \
    --appendonly yes \
    --appendfilename "appendonly.aof" \
    --save "60 1" \
    --save "300 1"
  for i in $(seq 1 10); do redis-cli ping &>/dev/null 2>&1 && break || sleep 0.5; done
fi
echo ">>> Redis: $(redis-cli ping 2>/dev/null)"

# ─── 2b. Wait for Redis to finish loading dataset ───────────────────────────
echo ">>> Waiting for Redis to finish loading..."
for i in $(seq 1 60); do
  LOADING=$(redis-cli INFO persistence 2>/dev/null | grep "^loading:" | tr -d '\r' | cut -d: -f2)
  [ "$LOADING" = "0" ] && break
  sleep 1
done

# ─── 2c. Auto-import map at 65536 scale if not yet done ─────────────────────
FLAG="$PPDIR/.canvas0_65536_done"
CHUNK_COUNT=$(redis-cli KEYS "ch:0:*" 2>/dev/null | wc -l)
echo ">>> Redis chunk keys: $CHUNK_COUNT"

if [ ! -f "$FLAG" ] || [ "$CHUNK_COUNT" -lt 100 ]; then
  echo ">>> Canvas 0 at 65536 not yet imported — clearing old data..."
  redis-cli --scan --pattern 'ch:0:*' | xargs -r redis-cli DEL > /dev/null 2>&1 || true
  rm -rf "$PPDIR/dist/tiles/0"
  echo ">>> Old canvas 0 data cleared."

  ZIP=/tmp/new_map.zip
  if [ -f "$ZIP" ]; then
    echo ">>> Starting 65536-scale import from $ZIP..."
    python3 "$PPDIR/import_fast.py" && echo ">>> Map import done." && touch "$FLAG"
  else
    echo ">>> WARNING: $ZIP not found, skipping import."
    touch "$FLAG"
  fi
else
  echo ">>> Canvas 0 (65536) already imported, skipping."
fi

# ─── 2d. Pre-generate ALL tiles before starting the server ──────────────────
CANVAS_COUNT=$(node -e "try{const c=require('$PPDIR/dist/canvases.json');console.log(Object.keys(c).length)}catch(e){console.log(0)}" 2>/dev/null || echo 0)
echo ">>> Configured canvases: $CANVAS_COUNT"

if [ "$CANVAS_COUNT" -gt 0 ]; then

  # ─── 2e. globalpixel.fun haritasını import et (bir kez) ─────────────────────
  IMPORT_FLAG="$PPDIR/.pixeldays_import_done"
  if [ ! -f "$IMPORT_FLAG" ]; then
    echo ">>> globalpixel.fun chunk import başlıyor..."
    node "$PPDIR/import_globalpixel.cjs" 2>&1
    touch "$IMPORT_FLAG"
    rm -rf "$PPDIR/dist/tiles"
    mkdir -p "$PPDIR/dist/tiles"
    echo ">>> globalpixel.fun import tamamlandı, tile'lar sıfırlandı."
  else
    echo ">>> globalpixel.fun import zaten tamamlandı, atlanıyor."
  fi

  # ─── 2f. Kara piksellerini beyaz yap (bir kez) ──────────────────────────────
  PAINT_FLAG="$PPDIR/.land_painted_white_done"
  if [ ! -f "$PAINT_FLAG" ]; then
    echo ">>> Kara pikselleri beyaz yapılıyor (piksel!=24 → 0)..."
    node "$PPDIR/paint_land_white.cjs" 2>&1
    touch "$PAINT_FLAG"
    rm -rf "$PPDIR/dist/tiles"
    mkdir -p "$PPDIR/dist/tiles"
    echo ">>> Boyama tamamlandı, tile'lar sıfırlandı."
  else
    echo ">>> Kara boyama zaten tamamlandı, atlanıyor."
  fi

  ZOOM7_DIR="$PPDIR/dist/tiles/0/7"
  ZOOM7_COUNT=$(find "$ZOOM7_DIR" -name '*.webp' 2>/dev/null | wc -l)
  echo ">>> Existing zoom-7 tiles: $ZOOM7_COUNT (need 16384)"

  if [ "$ZOOM7_COUNT" -lt 16384 ]; then
    echo ">>> Tiles incomplete — pre-generating all tiles (server starts after this)..."
    rm -rf "$PPDIR/dist/tiles"
    mkdir -p "$PPDIR/dist/tiles"
    node "$PPDIR/generate_tiles.cjs"
    echo ">>> All tiles generated."
  else
    echo ">>> All tiles already present, skipping generation."
  fi
else
  echo ">>> No canvases configured — skipping tile generation."
  touch "$PPDIR/.redis_rebuilt_v2"
  touch "$PPDIR/.canvas0_65536_done"
fi

# Stop loading page and hand off to real server
kill "$LOADING_PID" 2>/dev/null || true
sleep 1

# ─── 3. MariaDB bootstrap (once only) ──────────────────────────────────────
mkdir -p "$MARIADB_DATA" "$MARIADB_RUN"

if [ ! -f "$MARIADB_DATA/.bootstrapped" ]; then
  echo ">>> Bootstrapping MariaDB..."
  {
    printf "create database if not exists mysql;\nuse mysql;\n"
    cat "$SHARE/mysql_system_tables.sql"
    printf "\nuse mysql;\n"
    cat "$SHARE/mysql_system_tables_data.sql"
    printf "\nuse mysql;\n"
    cat "$SHARE/mysql_performance_tables.sql"
    printf "\nuse mysql;\n"
    cat "$SHARE/maria_add_gis_sp_bootstrap.sql"
  } > "$MARIADB_DATA/bootstrap.sql"
  
  LD_PRELOAD="$PRELOAD" mariadbd --no-defaults \
    --datadir="$MARIADB_DATA" \
    --socket="$MARIADB_RUN/mysql.sock" \
    --bootstrap \
    --loose-innodb-use-native-aio=OFF \
    --skip-log-bin \
    < "$MARIADB_DATA/bootstrap.sql" 2>&1 | grep -E "(ERROR)" | grep -v "1046" || true
  touch "$MARIADB_DATA/.bootstrapped"
  rm -f "$MARIADB_DATA/bootstrap.sql"
  echo ">>> MariaDB bootstrap done."
fi

# ─── 4. Start MariaDB daemon ────────────────────────────────────────────────
if ! mariadb --socket="$MARIADB_RUN/mysql.sock" -u root -e "SELECT 1;" &>/dev/null 2>&1; then
  echo ">>> Starting MariaDB..."
  LD_PRELOAD="$PRELOAD" mariadbd --no-defaults \
    --datadir="$MARIADB_DATA" \
    --socket="$MARIADB_RUN/mysql.sock" \
    --pid-file="$MARIADB_RUN/mysqld.pid" \
    --port=3306 \
    --bind-address=127.0.0.1 \
    --loose-innodb-use-native-aio=OFF \
    --skip-log-bin \
    2>"$MARIADB_DATA/mariadb.log" &

  for i in $(seq 1 30); do
    mariadb --socket="$MARIADB_RUN/mysql.sock" -u root -e "SELECT 1;" &>/dev/null 2>&1 && break
    sleep 1
  done
fi
echo ">>> MariaDB ready."

# ─── 4b. Keep CAPTCHA fonts available to the compiled runtime ───────────────
# The imported project keeps the fonts under deployment/captchaFonts, while
# the compiled server resolves them relative to dist/. Copy only font files
# and never remove existing runtime fonts.
CAPTCHA_FONT_SOURCE="$PPDIR/deployment/captchaFonts"
if [ -d "$PPDIR/overrides/captchaFonts" ]; then
  CAPTCHA_FONT_SOURCE="$PPDIR/overrides/captchaFonts"
fi
CAPTCHA_FONT_TARGET="$PPDIR/dist/captchaFonts"
if [ -d "$CAPTCHA_FONT_SOURCE" ]; then
  mkdir -p "$CAPTCHA_FONT_TARGET"
  find "$CAPTCHA_FONT_SOURCE" -maxdepth 1 -type f \( -iname '*.ttf' -o -iname '*.otf' \) \
    -exec cp -f {} "$CAPTCHA_FONT_TARGET/" \;
  echo ">>> CAPTCHA fonts ready: $(find "$CAPTCHA_FONT_TARGET" -maxdepth 1 -type f \( -iname '*.ttf' -o -iname '*.otf' \) | wc -l)"
else
  echo ">>> WARNING: CAPTCHA font source not found at $CAPTCHA_FONT_SOURCE"
fi

# ─── 5. Create pixelplanet DB/user if needed ───────────────────────────────
if [ ! -f "$MARIADB_DATA/.db_created" ]; then
  echo ">>> Creating pixelplanet database..."
  mariadb --socket="$MARIADB_RUN/mysql.sock" -u root <<'SQL'
CREATE DATABASE IF NOT EXISTS pixelplanet CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER IF NOT EXISTS 'pixelplanet'@'localhost' IDENTIFIED BY 'sqlpassword';
CREATE USER IF NOT EXISTS 'pixelplanet'@'127.0.0.1' IDENTIFIED BY 'sqlpassword';
GRANT ALL PRIVILEGES ON pixelplanet.* TO 'pixelplanet'@'localhost';
GRANT ALL PRIVILEGES ON pixelplanet.* TO 'pixelplanet'@'127.0.0.1';
FLUSH PRIVILEGES;
SQL
  touch "$MARIADB_DATA/.db_created"
  echo ">>> Database created."
fi

# ─── 6. Start PixelPlanet (internal) + Gate (external) ────────────────────
PPPORT="${PORT:-5000}"
INTERNAL_PORT=$((PPPORT + 1))
echo ">>> Starting PixelPlanet on internal port $INTERNAL_PORT..."
cd "$PPDIR/dist"

sed -i "s/^PORT = .*/PORT = $INTERNAL_PORT/" config.ini
sed -i "s/^HOST = .*/HOST = 127.0.0.1/" config.ini
sed -i "s/^USE_XREALIP = .*/USE_XREALIP = yes/" config.ini
sed -i "s/^ADMIN_IDS = .*/ADMIN_IDS = 1, 2, 7, 29, 52, 242/" config.ini

PORT=$INTERNAL_PORT node server.js &
PP_PID=$!
echo ">>> PixelPlanet started (PID $PP_PID), waiting for it to be ready..."

# Wait up to 60s for PixelPlanet to open its port
for i in $(seq 1 60); do
  node -e "
    const net = require('net');
    const s = net.createConnection($INTERNAL_PORT, '127.0.0.1');
    s.on('connect', () => { s.destroy(); process.exit(0); });
    s.on('error', () => { s.destroy(); process.exit(1); });
  " 2>/dev/null && echo ">>> PixelPlanet ready after ${i}s." && break
  sleep 1
done

echo ">>> Starting IP gate on port $PPPORT..."
exec node "$PPDIR/gate-server.cjs"
