#!/usr/bin/env bash
set -euo pipefail

APP_DIR="$(cd "$(dirname "$0")" && pwd)"
RUNTIME_DIR="/tmp/pixelplanet-runtime-${PORT:-21995}"
REDIS_DIR="$APP_DIR/.redis-data"
MARIADB_DIR="$APP_DIR/.mariadb-data"
MARIADB_SOCKET="$RUNTIME_DIR/mysql.sock"

mkdir -p "$REDIS_DIR" "$MARIADB_DIR" "$RUNTIME_DIR"

exec nix shell nixpkgs#redis nixpkgs#mariadb --command bash -c '
  set -euo pipefail

  if ! redis-cli -h 127.0.0.1 -p 6379 ping >/dev/null 2>&1; then
    redis-server \
      --daemonize yes \
      --bind 127.0.0.1 \
      --port 6379 \
      --dir "$1" \
      --dbfilename dump.rdb \
      --appendonly yes \
      --appendfilename appendonly.aof \
      --appendfsync everysec \
      --save "60 1" \
      --save "300 1" \
      --pidfile "$1/redis.pid" \
      --logfile "$1/redis.log"
  fi

  loaded=0
  for _ in $(seq 1 180); do
    loading=$(redis-cli -h 127.0.0.1 -p 6379 info persistence 2>/dev/null | awk -F: "/^loading:/{gsub(/\r/,\"\"); print \$2}")
    if [ "$loading" = "0" ] && [ "$(redis-cli -h 127.0.0.1 -p 6379 ping 2>/dev/null)" = "PONG" ]; then
      loaded=1
      break
    fi
    sleep 1
  done
  if [ "$loaded" -ne 1 ]; then
    echo "Redis map data did not finish loading in time." >&2
    exit 1
  fi

  if [ ! -d "$2/mysql" ]; then
    mariadb-install-db \
      --datadir="$2" \
      --auth-root-authentication-method=normal \
      --skip-test-db \
      >"$3/mariadb-install.log" 2>&1
  fi

  if ! mariadb-admin --protocol=socket --socket="$3/mysql.sock" ping >/dev/null 2>&1; then
    mariadbd \
      --no-defaults \
      --datadir="$2" \
      --socket="$3/mysql.sock" \
      --pid-file="$3/mariadb.pid" \
      --port=3306 \
      --bind-address=127.0.0.1 \
      --skip-log-bin \
      --log-error="$3/mariadb.log" \
      >/dev/null 2>&1 &
  fi

  for _ in $(seq 1 60); do
    mariadb-admin --protocol=socket --socket="$3/mysql.sock" ping >/dev/null 2>&1 && break
    sleep 1
  done

  mariadb --protocol=socket --socket="$3/mysql.sock" -u root <<SQL
CREATE DATABASE IF NOT EXISTS pixelplanet CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER IF NOT EXISTS "pixelplanet"@"localhost" IDENTIFIED BY "sqlpassword";
CREATE USER IF NOT EXISTS "pixelplanet"@"127.0.0.1" IDENTIFIED BY "sqlpassword";
GRANT ALL PRIVILEGES ON pixelplanet.* TO "pixelplanet"@"localhost";
GRANT ALL PRIVILEGES ON pixelplanet.* TO "pixelplanet"@"127.0.0.1";
FLUSH PRIVILEGES;
SQL

  cd "$4/dist"
  exec env \
    PORT="${PORT:-21995}" \
    HOST=0.0.0.0 \
    REDIS_URL=redis://127.0.0.1:6379 \
    MARIADB_HOST=127.0.0.1 \
    MARIADB_USER=pixelplanet \
    MARIADB_PW=sqlpassword \
    MARIADB_DATABASE=pixelplanet \
    node server.js
' bash "$REDIS_DIR" "$MARIADB_DIR" "$RUNTIME_DIR" "$APP_DIR"