DELIMITER ;;

-- delete all DMs of user
-- first result set is dmuid, cid of other affected users
CREATE PROCEDURE IF NOT EXISTS DELETE_USER_DMS(
  IN p_uid INT UNSIGNED
) NOT DETERMINISTIC MODIFIES SQL DATA
BEGIN
  DECLARE EXIT HANDLER FOR SQLEXCEPTION
  BEGIN
    DROP TEMPORARY TABLE IF EXISTS temp_dm_channels;
    RESIGNAL;
  END;

  DROP TEMPORARY TABLE IF EXISTS temp_dm_channels;
  CREATE TEMPORARY TABLE temp_dm_channels (
    cid INT UNSIGNED PRIMARY KEY,
    dmuid INT UNSIGNED
  );

  INSERT INTO temp_dm_channels (dmuid, cid)
    SELECT uc.uid AS dmuid, uc.cid FROM UserChannels uc
    WHERE uc.cid IN (
      SELECT DISTINCT c.id FROM Channels c
        INNER JOIN UserChannels uci ON uci.cid = c.id
      -- CHANNEL_TYPES.DM
      WHERE c.type = 1 AND uci.uid = p_uid
    ) AND uc.uid != p_uid;

  DELETE FROM Channels WHERE id IN (SELECT cid FROM temp_dm_channels);

  SELECT cid, dmuid FROM temp_dm_channels;
  DROP TEMPORARY TABLE IF EXISTS temp_dm_channels;
END;;

-- Remove TPID frm User
-- first result set contains a return code as 'result'
CREATE PROCEDURE IF NOT EXISTS REMOVE_THREEPID_FROM_USER(
  IN p_uid INT UNSIGNED,
  IN p_tid INT UNSIGNED,
  IN p_has_password TINYINT
) NOT DETERMINISTIC MODIFIES SQL DATA
BEGIN
  DECLARE v_verified_after_deletion TINYINT;
  DECLARE v_userlvl TINYINT UNSIGNED;
  -- USERLVL.REGISTERED
  DECLARE USERLVL_REGISTERED TINYINT UNSIGNED DEFAULT 10;
  -- USERLVL.VERIFIED
  DECLARE USERLVL_VERIFIED TINYINT UNSIGNED DEFAULT 20;

  DECLARE EXIT HANDLER FOR SQLEXCEPTION
  BEGIN
    ROLLBACK;
    RESIGNAL;
  END;
  START TRANSACTION;

  SELECT COALESCE(MAX(t.verified), 0), MAX(u.userlvl) INTO v_verified_after_deletion, v_userlvl FROM Users u
    LEFT JOIN ThreePIDs t ON t.uid = u.id AND t.id != p_tid
  WHERE u.id = p_uid;

  IF v_userlvl IS NULL THEN
    -- user doesn't exist
    ROLLBACK;
    SELECT 1 AS result;
  ELSEIF NOT EXISTS(
    SELECT 1 FROM ThreePIDs WHERE id = p_tid
  ) THEN
    -- no such tpid
    ROLLBACK;
    SELECT 2 AS result;
  ELSEIF p_has_password = 0 AND NOT EXISTS(
    -- THREEPID_PROVIDERS.EMAIL
    SELECT 1 FROM ThreePIDs WHERE uid = p_uid AND id != p_tid AND provider != 1
  ) THEN
    -- if we would delete this tpid, the user couldn't login anymore
    ROLLBACK;
    SELECT 3 AS result;
  ELSE
    IF (v_verified_after_deletion = 0 AND v_userlvl <= USERLVL_VERIFIED AND v_userlvl > USERLVL_REGISTERED) THEN
        -- Downgrade from VERIFIED to REGISTERED
        UPDATE Users SET userlvl = USERLVL_REGISTERED WHERE id = p_uid;
        SET v_userlvl = USERLVL_REGISTERED;
    ELSEIF (v_verified_after_deletion = 1 AND v_userlvl = USERLVL_REGISTERED) THEN
        -- Upgrade from REGISTERED to VERIFIED
        UPDATE Users SET userlvl = USERLVL_VERIFIED WHERE id = p_uid;
        SET v_userlvl = USERLVL_VERIFIED;
    END IF;

    -- write into history
    INSERT INTO ThreePIDHistories (
      uid, provider, tpid, normalizedTpid, verified, createdAt
    ) SELECT
      p_uid, provider, tpid, normalizedTpid, verified, createdAt
    FROM ThreePIDs WHERE id = p_tid;

    -- if tpid is banned, only unlink it from user, delete otherwise
    IF EXISTS(
      SELECT 1 FROM ThreePIDBans WHERE tid = p_tid
    ) THEN
      UPDATE ThreePIDs SET uid = NULL WHERE id = p_tid;
    ELSE
      DELETE FROM ThreePIDs WHERE id = p_tid;
    END IF;

    COMMIT;
    SELECT 0 AS result, v_userlvl AS userlvl;
  END IF;
END;;

-- add email to user
CREATE PROCEDURE IF NOT EXISTS ADD_THREEPID_TO_USER(
  IN p_uid INT UNSIGNED,
  IN p_tpid VARCHAR(80) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci,
  IN p_provider TINYINT UNSIGNED,
  IN p_is_verified TINYINT
) NOT DETERMINISTIC MODIFIES SQL DATA
BEGIN
  DECLARE v_tid INT UNSIGNED;
  DECLARE v_existing_uid INT UNSIGNED;

  SELECT MAX(t.id), MAX(u.id) INTO v_tid, v_existing_uid FROM ThreePIDs t
    LEFT JOIN Users u ON t.uid = u.id
  WHERE t.provider = p_provider AND (
    t.tpid = p_tpid OR (
      t.normalizedTpid IS NOT NULL AND
      t.normalizedTpid = NORMALIZE_TPID(p_provider, p_tpid)
  ));

  IF v_existing_uid = p_uid THEN
    -- user has tpid already
    SELECT 1 As result;
  ELSEIF v_existing_uid IS NOT NULL THEN
    -- different user has email already
    SELECT 2 AS result;
  ELSE
    IF v_tid IS NOT NULL THEN
      UPDATE ThreePIDs SET uid = p_uid, verified = p_is_verified WHERE id = v_tid;
    ELSE
      INSERT INTO ThreePIDs (
        uid, verified, provider, tpid
      ) VALUES (
        p_uid, p_is_verified, p_provider, p_tpid
      );
    END IF;

    SELECT 0 AS result;
  END IF;
END;;

-- mark user as hacked
-- resets tpid to oldest available one
-- set password to a notice
CREATE PROCEDURE IF NOT EXISTS MARK_USER_AS_HACKED(
  IN p_uid INT UNSIGNED
) NOT DETERMINISTIC MODIFIES SQL DATA
BEGIN
  DECLARE v_cutoff_date DATETIME;
  DECLARE EXIT HANDLER FOR SQLEXCEPTION
  BEGIN
    ROLLBACK;
    RESIGNAL;
  END;
  START TRANSACTION;

  -- restore all threepids
  INSERT IGNORE INTO ThreePIDs (
    uid, provider, tpid, verified, createdAt, lastSeen
  ) SELECT
    uid, provider, tpid, verified, createdAt, lastSeen
  FROM ThreePIDHistories WHERE uid = p_uid;

  UPDATE Users SET password = 'hacked' WHERE id = p_uid AND password IS NOT NULL;
  DELETE FROM Sessions WHERE uid = p_uid;

  -- get cutoff date
  SELECT DATE_ADD(MIN(createdAt), INTERVAL 7 DAY) INTO v_cutoff_date
  FROM ThreePIDs WHERE uid = p_uid;

  DELETE FROM ThreePIDs WHERE uid = p_uid AND createdAt > v_cutoff_date;
  SELECT ROW_COUNT() AS result;
  COMMIT;
END;;


-- Deleting User
-- - delete DM channels and return affected dmuid, cid in first result set
-- - delete factions that only have this user and nobody else
-- - elevate best other user if deleted user is last sovereign
-- - correct member count of factions the user was a member in
-- - delete user
CREATE PROCEDURE IF NOT EXISTS DELETE_USER(
  IN p_uid INT UNSIGNED
) NOT DETERMINISTIC MODIFIES SQL DATA
BEGIN
  DECLARE EXIT HANDLER FOR SQLEXCEPTION
  BEGIN
    ROLLBACK;
    RESIGNAL;
  END;
  START TRANSACTION;

  CALL DELETE_USER_DMS(p_uid);

  DELETE FROM Channels WHERE id IN (
    SELECT f.cid FROM Factions f
      INNER JOIN UserFactions uf ON uf.fid = f.id
    WHERE uf.uid = p_uid AND NOT EXISTS(
      SELECT 1 FROM UserFactions uff WHERE uff.uid != p_uid AND uff.fid = f.id
    )
  );

  INSERT INTO UserFactionRoles (uid, frid)
    SELECT (
      SELECT ufr.uid FROM UserFactionRoles ufr
        INNER JOIN FactionRoles fr ON ufr.frid = fr.id
        INNER JOIN UserFactions uf ON uf.uid = ufr.uid AND uf.fid = fr.fid
      WHERE fr.fid = t.fid AND ufr.uid != p_uid AND uf.joined IS NOT NULL
      ORDER BY fr.factionlvl DESC, uf.joined ASC LIMIT 1
    ), (
      -- FACTION_PERMISSIONS.SOVEREIGN
      SELECT frs.id FROM FactionRoles frs WHERE frs.fid = t.fid AND frs.factionlvl >= 100 LIMIT 1
    ) FROM (
      SELECT DISTINCT fr.fid FROM FactionRoles fr
        INNER JOIN UserFactionRoles ufr ON ufr.frid = fr.id
      -- FACTION_PERMISSIONS.SOVEREIGN
      WHERE ufr.uid = p_uid AND fr.factionlvl >= 100 AND NOT EXISTS(
        SELECT 1 FROM UserFactionRoles uffr
          INNER JOIN FactionRoles ffr ON uffr.frid = ffr.id
        -- FACTION_PERMISSIONS.SOVEREIGN
        WHERE ffr.fid = fr.fid AND uffr.uid != p_uid AND ffr.factionlvl >= 100 LIMIT 1
      )
    ) AS t;

  UPDATE FactionRoles SET memberCount = memberCount - 1
  WHERE EXISTS (
    SELECT 1 FROM UserFactionRoles ufr WHERE ufr.frid = FactionRoles.id AND ufr.uid = p_uid
  );

  UPDATE Factions SET memberCount = memberCount - 1
  WHERE EXISTS (
    SELECT 1 FROM UserFactions uf WHERE uf.fid = Factions.id AND uf.uid = p_uid
  );

  DELETE FROM Users WHERE id = p_uid;

  COMMIT;
END;;

-- Resolve Session
--   If it can't be removed, no result sets, otherwise...
--
--   1st result set (user info):
--     id, name, username, password (bcrypt hash), userlvl, flags, lastSeen,
--     createdAt, customFlag, avatarId, customRoleFlagId, activeFactionId,
--   2nd result set (active bans):
--     expires, flags
--   3rd result set (chat channels):
--     cid, muted
CREATE PROCEDURE IF NOT EXISTS RESOLVE_SESSION(
  IN p_token char(38) CHARACTER SET ascii COLLATE ascii_bin
) NOT DETERMINISTIC READS SQL DATA
BEGIN
  DECLARE v_uid INT UNSIGNED;

  SELECT uid INTO v_uid FROM Sessions WHERE token = p_token AND (
    expires > NOW() OR expires IS NULL
  ) LIMIT 1;

  IF v_uid IS NOT NULL THEN

    SELECT u.id, u.name, u.username, u.password, u.userlvl, u.flags, u.lastSeen,
      u.createdAt,
      p.customFlag,
      CONCAT(a.shortId, ':', a.extension) AS avatarId,
      CONCAT(frm.shortId, ':', frm.extension) AS customRoleFlagId,
      fr.fid AS activeFactionId
    FROM Users u
      LEFT JOIN Profiles p ON p.uid = u.id
      LEFT JOIN Media a ON a.id = p.avatar
      LEFT JOIN FactionRoles fr ON fr.id = p.activeRole
      LEFT JOIN Media frm ON frm.id = fr.customFlag
    WHERE u.id = v_uid;

    SELECT b.expires, b.flags FROM Bans b WHERE b.id IN (
      SELECT DISTINCT b.id FROM (
        SELECT ub.bid AS id FROM UserBans ub WHERE ub.uid = v_uid
          UNION ALL
        SELECT tb.bid AS id FROM ThreePIDBans tb
          INNER JOIN ThreePIDs t ON tb.tid = t.id
        WHERE t.uid = v_uid
      ) AS b
    ) AND (b.expires > NOW() OR b.expires IS NULL);

    SELECT cid, muted FROM UserChannels WHERE uid = v_uid;
  END IF;
END;;
