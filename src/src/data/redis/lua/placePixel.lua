-- Checking requirements for placing pixels, calculating cooldown
-- of user and incrementing pixel counts within redis itself.
-- Does not set pixels directly. Pixels are set in batches
-- in RedisCanvas.js
-- Keys:
--   ipCD: 'cd:canvasId:ip:ip'
--   uCD: 'cd:canvasId:id:userId'
--     'nope' if not logged in
--   chunk: 'ch:canvasId:i:j'
--   rankset: 'rank' sorted set of pixelcount
--   dailyset: 'rankd' sorted set of daily pixelcount
--     'nope' if not increasing ranks <- important
--   factionRankSet: 'frank' sorted set of faction pixelcount
--   factionDailySet: 'frankd' sorted set of daily faction pixelcount
--   countryset: sorted set for country stats
--   prevTop: sorted set of yesterdays top 10
-- Args:
--   clrIgnore: integer number of what colors are considered unset
--   bcd: number baseCooldown (fixed to cooldown factor)
--   pcd: number set pixel cooldown  (fixed to cooldown factor)
--   cds: max cooldown of canvas
--   cdIfNull: cooldown to use when no cooldown is stored
--   userId: '0' if not logged in
--   factionId: '0' if no faction
--   cc country code
--   req: requirements of canvas ('nope', unsigned integer or 'top')
--   dontIncreaseCounters: name says it all
--   off1, chunk offset of first pixel
--   off2, chunk offset of second pixel
--   ..., infinite pixels possible
-- Returns:
--   {
--     1: pixel return status code (check ui/placePixel.js)
--     2: amount of successfully set pixels
--     3: total cooldown of user
--     4: added cooldown of last pixel
--   }
local ret = {0, 0, 0, 0}
-- check if requirements for canvas met
if ARGV[9] ~= "nope" then
  if ARGV[6] == "0" then
    -- not logged in
    ret[1] = 6
    return ret;
  end
  if ARGV[9] == "top" then
    local pr = redis.call('zrank', KEYS[9], ARGV[6])
    if not pr or pr > 9 then
      -- not in yesterdays top 10
      ret[1] = 12;
      return ret;
    end
  else
    local req = tonumber(ARGV[9])
    if req > 0 then
      local sc = tonumber(redis.call('zscore', KEYS[4], ARGV[6]))
      if not sc or sc < req then
        -- not enough pxls placed
        ret[1] = 7;
        return ret
      end
    end
  end
end
-- get cooldown of user
-- logged-in users: track only by user ID
-- guests: track by IP
local cd
if KEYS[2] ~= "nope" then
  cd = redis.call('pttl', KEYS[2])
else
  cd = redis.call('pttl', KEYS[1])
end
if cd < 0 then
  cd = tonumber(ARGV[5])
end
-- set pixels
local pxlcd = 0
local pxlcnt = 0
local cli = tonumber(ARGV[1])
local bcd = tonumber(ARGV[2])
local pcd = tonumber(ARGV[3])
local cds = tonumber(ARGV[4])
for c = 11,#ARGV do
  local off = tonumber(ARGV[c]) * 8
  -- get color of pixel on canvas
  local sclr = redis.call('bitfield', KEYS[3], 'get', 'u8', off)
  sclr = sclr[1]
  -- check if protected (protected is last bit in u8)
  if sclr >= 128 then
    -- pixel protected
    ret[1] = 8
    break
  end
  -- calculate cooldown of pixel
  pxlcd = bcd
  if sclr >= cli then
    pxlcd = pcd
  end
  cd = cd + pxlcd
  if cd > cds then
    -- pixelstack used up
    -- report difference as last cd
    cd = cd - pxlcd
    pxlcd = cds - cd - pxlcd
    ret[1] = 9
    break
  end
  pxlcnt = pxlcnt + 1
end
-- increase counter if dontIncreaseCounters isn't set
if ARGV[10] == "0" and pxlcnt > 0 then
  -- set cooldown
  if cd > 0 then
    if KEYS[2] ~= "nope" then
      -- logged-in: only track by user ID
      redis.call('set', KEYS[2], '', 'px', cd)
    else
      -- guest: track by IP
      redis.call('set', KEYS[1], '', 'px', cd)
    end
  end
  -- increment pixelcount
  if KEYS[5] ~= "nope" then
    -- daily and total rank
    if ARGV[6] ~= "0" then
      redis.call('zincrby', KEYS[4], pxlcnt, ARGV[6])
      redis.call('zincrby', KEYS[5], pxlcnt, ARGV[6])
      if ARGV[7] ~= "0" then
        redis.call('zincrby', KEYS[6], pxlcnt, ARGV[7])
        redis.call('zincrby', KEYS[7], pxlcnt, ARGV[7])
      end
    end
    -- country stats
    if ARGV[8] ~= "xx" then
      redis.call('zincrby', KEYS[8], pxlcnt, ARGV[8])
    end
  end
end

ret[2] = pxlcnt
ret[3] = cd
ret[4] = pxlcd
return ret
