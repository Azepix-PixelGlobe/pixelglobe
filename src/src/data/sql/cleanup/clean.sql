DELETE FROM Ranges WHERE expires < NOW();
DELETE FROM Proxies WHERE expires < NOW() - INTERVAL 14 DAY;
DELETE FROM Sessions WHERE expires < NOW();
DELETE FROM WhoisReferrals WHERE expires < NOW();
DELETE FROM FactionBans WHERE expires IS NOT NULL AND expires < NOW();
DELETE FROM FactionInvites WHERE expires IS NOT NULL AND expires < NOW();
DELETE FROM OIDCConsents WHERE expires < NOW();
DELETE FROM OIDCAccessTokens WHERE expires < NOW();
DELETE FROM OIDCAuthCodes WHERE expires < NOW();
DELETE FROM OIDCRefreshTokens WHERE expires < NOW();
DELETE FROM IPTrusts WHERE expires IS NOT NULL AND expires <= NOW();
DELETE FROM IPHumans WHERE expires IS NOT NULL AND expires <= NOW();
DELETE FROM CaptchaSolutions WHERE expires < NOW();
DELETE FROM ChallengeSolutions WHERE expires < NOW();
DELETE FROM AuthLogs WHERE createdAt < NOW() - INTERVAL 14 DAY;

-- delete DM channels with less than 2 members
-- CHANNEL_TYPES.DM
DELETE c FROM Channels c WHERE c.type = 1 AND (
  SELECT COUNT(*) FROM UserChannels uc WHERE uc.cid = c.id
) <= 1;
