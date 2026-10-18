#!/usr/bin/env python3
"""
Import real world map from pixelplanet ZIP into Redis.

OSM tiles (RGB 2048x2048, original 65536-px canvas)
→ 4× NEAREST downscale → 512×512
→ split into 4×(256×256) sub-chunks
→ zip_chunk(cx,cy) → our chunks (cx*2+sx, cy*2+sy)

Palette:
  0  = white        → urban / generic land
  17 = sand         → desert / dry land
  20 = light green  → parks / grass
  21 = green        → forest
  24 = light blue   → ALL water (ocean, sea, lake)
"""

import zipfile, io, time
import redis
import numpy as np
from PIL import Image

ZIP_PATH   = '/tmp/map_input.img'
CANVAS_ID  = 0
REDIS_HOST = 'localhost'
REDIS_PORT = 6379


def classify(arr: np.ndarray) -> np.ndarray:
    """arr: (N,3) uint8 → (N,) uint8 palette indices."""
    r = arr[:, 0].astype(np.int16)
    g = arr[:, 1].astype(np.int16)
    b = arr[:, 2].astype(np.int16)

    # Water: OSM ocean #aad3df (170,211,223) and similar blue-greens
    # Key: b and g both high, r notably lower, b >= g (bluish-green)
    is_water = (b >= 190) & (g >= 185) & (r < 200) & (b >= g - 20) & (b > r + 10)

    # Light green: parks/grass (#d4e7cc, #cae2c2 etc.) — green > red+10, green > blue
    is_lt_green = (~is_water) & (g >= 210) & (g > r + 10) & (g > b)

    # Dark green: forest (#add19e, #b4d4a7) — more saturated green
    is_dk_green = (~is_water) & (~is_lt_green) & (g >= 175) & (g > r + 18) & (g > b + 5)

    # Desert/sand: OSM desert #f5eedd, #f0e8c1 — warm, high r+g, low b
    is_desert = (~is_water) & (r >= 220) & (g >= 210) & (b < 200) & (r > b + 30)

    out = np.zeros(len(arr), dtype=np.uint8)   # default = 0 (white land)
    out[is_water]    = 24
    out[is_lt_green] = 20
    out[is_dk_green] = 21
    out[is_desert]   = 17
    return out


_CACHE: dict = {}

def to_palette(arr_hw3: np.ndarray) -> np.ndarray:
    flat = arr_hw3.reshape(-1, 3)
    unique, inverse = np.unique(flat, axis=0, return_inverse=True)
    result = np.empty(len(unique), dtype=np.uint8)
    for i, row in enumerate(unique):
        key = (int(row[0]), int(row[1]), int(row[2]))
        if key not in _CACHE:
            _CACHE[key] = int(classify(unique[i:i+1])[0])
        result[i] = _CACHE[key]
    return result[inverse]


def main():
    r = redis.Redis(host=REDIS_HOST, port=REDIS_PORT, socket_timeout=10)
    r.ping()
    print("Redis connected. Starting import…")

    total = 0
    t0 = time.time()

    with zipfile.ZipFile(ZIP_PATH) as z:
        for cx in range(32):
            for cy in range(32):
                img = None
                for path, mode in [
                    (f'pixelplanetmap/osm/{cx}/{cy}.png',   'osm'),
                    (f'pixelplanetmap/ocean/{cx}/{cy}.png', 'ocean'),
                ]:
                    try:
                        img = Image.open(io.BytesIO(z.read(path)))
                        img.load()
                        src = mode
                        break
                    except KeyError:
                        pass

                if img is None:
                    continue

                # NEAREST keeps discrete OSM colours — no colour bleeding
                scaled = img.resize((512, 512), Image.NEAREST)

                if src == 'osm':
                    arr = np.array(scaled.convert('RGB'), dtype=np.uint8)
                    flat = to_palette(arr)
                else:
                    # Binary mask: dark=ocean, bright=land
                    lum = np.array(scaled.convert('L'), dtype=np.uint8).ravel()
                    flat = np.where(lum < 128, np.uint8(24), np.uint8(0))

                grid = flat.reshape(512, 512)
                pipe = r.pipeline(transaction=False)
                for sy in range(2):
                    for sx in range(2):
                        key = f'ch:{CANVAS_ID}:{cx*2+sx}:{cy*2+sy}'
                        sub = grid[sy*256:(sy+1)*256, sx*256:(sx+1)*256]
                        pipe.set(key, sub.ravel().tobytes())
                        total += 1
                pipe.execute()

                done = cx * 32 + cy + 1
                el   = time.time() - t0
                eta  = el / done * (1024 - done)
                print(f'\r  {done}/1024  {total} chunks  ETA {eta:.0f}s   ',
                      end='', flush=True)

    print(f'\nDone! {total} chunks in {time.time()-t0:.1f}s  |  cache={len(_CACHE)} colours')


if __name__ == '__main__':
    main()
