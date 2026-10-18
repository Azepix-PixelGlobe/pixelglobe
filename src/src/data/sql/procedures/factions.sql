DELIMITER ;;

-- create a faction
-- uuids for roles are given by the client
CREATE PROCEDURE IF NOT EXISTS CREATE_FACTION(
  IN p_uid INT UNSIGNED,
  IN p_name VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin,
  IN p_title VARCHAR(32) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci,
  IN p_description VARCHAR(1000) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci,
  IN p_flags TINYINT UNSIGNED,
  IN p_avatar_id VARCHAR(29),
  IN p_sovereign_uuid CHAR(36),
  IN p_peasant_uuid CHAR(36)
) NOT DETERMINISTIC MODIFIES SQL DATA
BEGIN
  DECLARE v_mid BIGINT UNSIGNED;
  DECLARE v_cid INT UNSIGNED;
  DECLARE v_fid BIGINT UNSIGNED;
  DECLARE v_joined_count INT UNSIGNED;
  DECLARE v_owned_count INT UNSIGNED;
  DECLARE EXIT HANDLER FOR SQLEXCEPTION
  BEGIN
    ROLLBACK;
    RESIGNAL;
  END;
  START TRANSACTION;

  SELECT MAX(id) INTO v_mid  FROM Media m
    WHERE LOCATE(':', p_avatar_id) > 0
      AND m.type = 'image'
      AND m.shortId = SUBSTRING_INDEX(p_avatar_id, ':', 1)
      AND m.extension = SUBSTRING_INDEX(p_avatar_id, ':', -1);

  SELECT COUNT(*), SUM(isOwner) INTO v_joined_count, v_owned_count
  FROM (
    SELECT EXISTS(
      SELECT 1 FROM UserFactionRoles ufr
        INNER JOIN FactionRoles fr ON ufr.frid = fr.id
      -- FACTION_PERMISSIONS.SOVEREIGN
      WHERE ufr.uid = uf.uid AND fr.fid = uf.fid AND fr.factionlvl >= 100
    ) AS isOwner
    FROM UserFactions uf WHERE uf.uid = p_uid
  ) AS ufc;

  -- MAX_FACTIONS_PER_USER
  IF v_joined_count >= 20 THEN
    ROLLBACK;
    SELECT 1 AS result;
  -- MAX_OWNED_FACTIONS_PER_USER
  ELSEIF v_owned_count >= 10 THEN
    ROLLBACK;
    SELECT 2 AS result;
  ELSEIF NOT EXISTS(
    SELECT 1 FROM Users WHERE id = p_uid AND createdAt < NOW() - INTERVAL 14 DAY
  ) THEN
    ROLLBACK;
    SELECT 3 AS result;
  ELSEIF v_mid IS NULL THEN
    ROLLBACK;
    SELECT 4 AS result;
  ELSEIF EXISTS(
    SELECT 1 FROM Factions WHERE name = p_name
  ) THEN
    ROLLBACK;
    SELECT 5 AS result;
  ELSE
    INSERT INTO Channels (
      name, type, lastMessage, createdAt
    ) VALUES (
      -- CHANNEL_TYPES.FACTION
      p_name, 3, NOW(), NOW()
    );
    SELECT LAST_INSERT_ID() INTO v_cid;
    INSERT INTO Factions (
      name, title, description, avatar, flags, memberCount, createdAt, cid
    ) VALUES (
      p_name, p_title, p_description, v_mid, p_flags, 1, NOW(), v_cid
    );
    SELECT LAST_INSERT_ID() INTO v_fid;
    INSERT INTO FactionRoles (
      uuid, fid, name, memberCount, factionlvl, flags
    ) VALUES (
      -- FACTION_PERMISSIONS.SOVEREIGN
      -- FACTION_ROLE_FLAGS.PROTECTED
      UUID_TO_BIN(p_sovereign_uuid), v_fid, 'Sovereign', 1, 100, (1 << 0)
    ), (
      -- FACTION_PERMISSIONS.PEASANT
      -- FACTION_ROLE_FLAGS.DEFAULT
      -- FACTION_ROLE_FLAGS.PROTECTED
      UUID_TO_BIN(p_peasant_uuid), v_fid, 'Peasant', 1, 0, (1 << 1) | (1 << 0)
    );
    INSERT INTO UserFactions (uid, fid, joined) VALUES (p_uid, v_fid, NOW());
    INSERT INTO UserFactionRoles (uid, frid)
      SELECT p_uid, fr.id FROM FactionRoles fr WHERE fr.fid = v_fid;
    INSERT INTO UserChannels (uid, cid, lastRead) VALUES (p_uid, v_cid, NOW());
    COMMIT;
    SELECT 0 AS result;
  END IF;
END;;

-- delete a faction
-- If success, then second result set is users with [uid, hadFactionActive]
-- @param p_initiator_uid uid of initiator
-- @param p_faction_name faction name
CREATE PROCEDURE IF NOT EXISTS DELETE_FACTION(
  IN p_initiator_uid INT UNSIGNED,
  IN p_faction_name VARCHAR(32) CHARACTER SET ascii
) NOT DETERMINISTIC MODIFIES SQL DATA
BEGIN
  DECLARE v_fid BIGINT UNSIGNED;
  DECLARE v_initiator_powerlvl TINYINT;
  DECLARE v_faction_channel_id INT UNSIGNED;
  DECLARE EXIT HANDLER FOR SQLEXCEPTION
  BEGIN
    ROLLBACK;
    RESIGNAL;
  END;
  START TRANSACTION;

  SELECT MAX(id), MAX(cid) INTO v_fid, v_faction_channel_id FROM Factions WHERE name = p_faction_name;

  IF v_fid IS NULL THEN
    ROLLBACK;
    SELECT 1 AS result;
  ELSEIF NOT EXISTS(
    SELECT 1 FROM UserFactions WHERE uid = p_initiator_uid AND fid = v_fid LIMIT 1
  ) THEN
    ROLLBACK;
    SELECT 2 AS result;
  ELSE
    SELECT IFNULL(MAX(factionlvl), 0) INTO v_initiator_powerlvl FROM FactionRoles fr
      INNER JOIN UserFactionRoles ufr ON ufr.frid = fr.id
    WHERE fr.fid = v_fid AND ufr.uid = p_initiator_uid;

    -- FACTION_PERMISSIONS.DELETE_FACTION
    IF v_initiator_powerlvl < 100 THEN
      ROLLBACK;
      SELECT 3 AS result;
    ELSE
      SELECT 0 AS result, v_faction_channel_id AS factionChannelId;
      SELECT uf.uid, fr.id IS NOT NULL AS hadFactionActive FROM UserFactions uf
        LEFT JOIN Profiles p ON uf.uid = p.uid
        LEFT JOIN FactionRoles fr ON p.activeRole = fr.id AND fr.fid = uf.fid
      WHERE uf.fid = v_fid;
      DELETE FROM Channels WHERE id = v_faction_channel_id;
      COMMIT;
    END IF;
  END IF;
END;;

-- create a faction role
CREATE PROCEDURE IF NOT EXISTS CREATE_FACTION_ROLE(
  IN p_faction_name VARCHAR(32) CHARACTER SET ascii,
  IN p_factionrole_uuid CHAR(36),
  IN p_name VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin,
  IN p_factionlvl TINYINT SIGNED,
  IN p_custom_flag_id VARCHAR(29),
  IN p_flags TINYINT UNSIGNED
) NOT DETERMINISTIC MODIFIES SQL DATA
BEGIN
  DECLARE v_fid BIGINT UNSIGNED;
  DECLARE v_mid BIGINT UNSIGNED;
  DECLARE v_role_count INT UNSIGNED;

  SELECT MAX(id) INTO v_fid FROM Factions WHERE name = p_faction_name;
  IF v_fid IS NULL THEN
    SELECT 1 AS result;
  ELSE
    SELECT COUNT(*) INTO v_role_count FROM FactionRoles WHERE fid = v_fid;
    SELECT MAX(id) INTO v_mid  FROM Media m
      WHERE LOCATE(':', p_custom_flag_id) > 0
        AND m.type = 'image'
        AND m.shortId = SUBSTRING_INDEX(p_custom_flag_id, ':', 1)
        AND m.extension = SUBSTRING_INDEX(p_custom_flag_id, ':', -1);

    IF p_custom_flag_id IS NOT NULL AND v_mid IS NULL THEN
      SELECT 2 AS result;
    -- MAX_ROLES_PER_FACTION
    ELSEIF v_role_count >= 20 THEN
      SELECT 3 AS result;
    ELSE
      INSERT INTO FactionRoles (
        uuid, fid, customFlag, name, factionlvl, flags
      ) VALUES (
        UUID_TO_BIN(p_factionrole_uuid), v_fid, v_mid, p_name, p_factionlvl, p_flags
      );
      SELECT 0 AS result;
    END IF;
  END IF;
END;;

-- delete a fuaction role
CREATE PROCEDURE IF NOT EXISTS DELETE_FACTION_ROLE(
  IN p_initiator_uid INT UNSIGNED,
  IN p_faction_role_uuid CHAR(36)
) NOT DETERMINISTIC MODIFIES SQL DATA
BEGIN
  DECLARE v_frid BIGINT UNSIGNED;
  DECLARE v_fid BIGINT UNSIGNED;
  DECLARE v_faction_name VARCHAR(32) CHARACTER SET ascii;
  DECLARE v_role_powerlvl TINYINT;
  DECLARE v_initiator_powerlvl TINYINT;
  DECLARE v_flags TINYINT UNSIGNED;

  SELECT MAX(fr.id), MAX(fr.fid), MAX(fr.factionlvl), MAX(fr.flags), MAX(f.name)
    INTO v_frid, v_fid, v_role_powerlvl, v_flags, v_faction_name
  FROM FactionRoles fr INNER JOIN Factions f ON fr.fid = f.id
  WHERE fr.uuid = UUID_TO_BIN(p_faction_role_uuid);

  IF v_fid IS NULL THEN
    SELECT 1 AS result;
  -- FACTION_PERMISSIONS.SOVEREIGN
  ELSEIF v_role_powerlvl >= 100 THEN
    SELECT 2 AS result;
  -- FACTION_ROLE_FLAGS.PROTECTED
  ELSEIF (v_flags & (1 << 0)) != 0 THEN
    SELECT 3 AS result;
  ELSEIF NOT EXISTS(
    SELECT 1 FROM UserFactions WHERE uid = p_initiator_uid AND fid = v_fid LIMIT 1
  ) THEN
    SELECT 4 AS result;
  ELSE
    SELECT IFNULL(MAX(factionlvl), 0) INTO v_initiator_powerlvl FROM FactionRoles fr
      INNER JOIN UserFactionRoles ufr ON ufr.frid = fr.id
    WHERE fr.fid = v_fid AND ufr.uid = p_initiator_uid;

    -- FACTION_PERMISSIONS.CREATE_ROLES
    IF v_initiator_powerlvl < 75 THEN
      SELECT 5 AS result;
    ELSEIF v_role_powerlvl > v_initiator_powerlvl THEN
      SELECT 6 AS result;
    -- FACTION_PERMISSIONS.MANAGE_YOURSELF
    ELSEIF v_role_powerlvl = v_initiator_powerlvl AND v_initiator_powerlvl < 99 THEN
      SELECT 7 AS result;
    ELSE
      SELECT 0 AS result, v_faction_name AS factionName;
      SELECT uf.uid, p.activeRole = v_frid AS hadRoleActive FROM UserFactions uf
        LEFT JOIN Profiles p ON uf.uid = p.uid
      WHERE fid = v_fid;

      DELETE FROM FactionRoles WHERE id = v_frid;
    END IF;
  END IF;
END;;

-- remove role rom user
CREATE PROCEDURE IF NOT EXISTS LEAVE_FACTION_ROLE(
  IN p_initiator_uid INT UNSIGNED,
  IN p_subject_uid INT UNSIGNED,
  IN p_faction_role_uuid CHAR(36)
) NOT DETERMINISTIC MODIFIES SQL DATA
BEGIN
  DECLARE v_frid BIGINT UNSIGNED;
  DECLARE v_fid BIGINT UNSIGNED;
  DECLARE v_role_powerlvl TINYINT;
  DECLARE v_faction_name VARCHAR(32) CHARACTER SET ascii;
  DECLARE v_initiator_powerlvl TINYINT;
  DECLARE v_subject_powerlvl TINYINT;
  DECLARE v_is_active_role TINYINT;
  DECLARE EXIT HANDLER FOR SQLEXCEPTION
  BEGIN
    ROLLBACK;
    RESIGNAL;
  END;
  START TRANSACTION;

  SELECT MAX(fr.id), MAX(fr.fid), MAX(fr.factionlvl), MAX(f.name)
    INTO v_frid, v_fid, v_role_powerlvl, v_faction_name
  FROM FactionRoles fr INNER JOIN Factions f ON fr.fid = f.id
  WHERE fr.uuid = UUID_TO_BIN(p_faction_role_uuid);

  IF v_fid IS NULL THEN
    ROLLBACK;
    SELECT 1 AS result;
  ELSEIF NOT EXISTS(
    SELECT 1 FROM UserFactions WHERE uid = p_initiator_uid AND fid = v_fid LIMIT 1
  ) THEN
    ROLLBACK;
    SELECT 2 AS result;
  ELSE
    SELECT IFNULL(MAX(factionlvl), 0) INTO v_initiator_powerlvl FROM FactionRoles fr
      INNER JOIN UserFactionRoles ufr ON ufr.frid = fr.id
    WHERE fr.fid = v_fid AND ufr.uid = p_initiator_uid;

    -- FACTION_PERMISSIONS.ASSIGN_ROLES
    IF v_initiator_powerlvl < 60 THEN
      ROLLBACK;
      SELECT 3 AS result;
    ELSEIF NOT EXISTS(
      SELECT 1 FROM UserFactions uf
        INNER JOIN UserFactionRoles ufr ON ufr.uid = uf.uid
      WHERE uf.uid = p_subject_uid AND uf.fid = v_fid AND ufr.frid = v_frid LIMIT 1
    ) THEN
      ROLLBACK;
      SELECT 4 AS result;
    ELSE
      SELECT IFNULL(MAX(factionlvl), 0) INTO v_subject_powerlvl FROM FactionRoles fr
        INNER JOIN UserFactionRoles ufr ON ufr.frid = fr.id
      WHERE fr.fid = v_fid AND ufr.uid = p_subject_uid;

      IF v_subject_powerlvl >= v_initiator_powerlvl AND p_initiator_uid != p_subject_uid THEN
        ROLLBACK;
        SELECT 5 AS result;
      -- FACTION_PERMISSIONS.SOVEREIGN
      ELSEIF v_role_powerlvl >= 100 AND NOT EXISTS(
        SELECT 1 FROM UserFactionRoles WHERE uid != p_subject_uid AND frid = v_frid
      ) THEN
        ROLLBACK;
        SELECT 6 AS result;
      ELSE
        DELETE FROM UserFactionRoles WHERE uid = p_subject_uid AND frid = v_frid;

        UPDATE Profiles SET activeRole = NULL WHERE uid = p_subject_uid AND activeRole = v_frid;
        SET v_is_active_role = (ROW_COUNT() > 0);

        UPDATE FactionRoles SET memberCount = memberCount - 1 WHERE id = v_frid;

        COMMIT;
        SELECT 0 AS result, v_is_active_role AS hadRoleActive, v_faction_name AS factionName;
      END IF;
    END IF;
  END IF;
END;;

-- create an invite
CREATE PROCEDURE IF NOT EXISTS CREATE_FACTION_INVITE(
  IN p_initiator_uid INT UNSIGNED,
  IN p_faction_name VARCHAR(32) CHARACTER SET ascii,
  IN p_midId VARCHAR(16) CHARACTER SET ascii,
  IN p_flags TINYINT UNSIGNED,
  IN p_expires DATETIME
) NOT DETERMINISTIC MODIFIES SQL DATA
BEGIN
  DECLARE v_fid BIGINT UNSIGNED;
  DECLARE v_initiator_powerlvl TINYINT;
  DECLARE v_invite_count INT UNSIGNED;

  SELECT MAX(id) INTO v_fid FROM Factions WHERE name = p_faction_name;

  IF v_fid IS NULL THEN
    SELECT 1 AS result;
  ELSEIF NOT EXISTS(
    SELECT 1 FROM UserFactions WHERE uid = p_initiator_uid AND fid = v_fid LIMIT 1
  ) THEN
    SELECT 2 AS result;
  ELSE
    SELECT IFNULL(MAX(factionlvl), 0) INTO v_initiator_powerlvl FROM FactionRoles fr
      INNER JOIN UserFactionRoles ufr ON ufr.frid = fr.id
    WHERE fr.fid = v_fid AND ufr.uid = p_initiator_uid;

    SELECT COUNT(*) INTO v_invite_count FROM FactionRoles WHERE fid = v_fid;

    -- FACTION_PERMISSIONS.MANAGE_INVITES
    IF v_initiator_powerlvl < 49 THEN
      SELECT 3 AS result;
    ELSEIF v_invite_count >= 20 THEN
      SELECT 4 AS result;
    ELSEIF EXISTS(
      SELECT 1 FROM FactionInvites WHERE midId = p_midId
    ) THEN
      SELECT 5 AS result;
    ELSE
      INSERT INTO FactionInvites (
        fid, midId, flags, expires, used, createdAt
      ) VALUES (
        v_fid, p_midId, p_flags, p_expires, 0, NOW()
      );
      SELECT 0 AS result;
    END IF;
  END IF;
END;;

-- delete an invite
CREATE PROCEDURE IF NOT EXISTS DELETE_FACTION_INVITE(
  IN p_initiator_uid INT UNSIGNED,
  IN p_midId VARCHAR(16) CHARACTER SET ascii
) NOT DETERMINISTIC MODIFIES SQL DATA
BEGIN
  DECLARE v_fid BIGINT UNSIGNED;
  DECLARE v_initiator_powerlvl TINYINT;

  SELECT MAX(fid) INTO v_fid FROM FactionInvites WHERE midId = p_midId;

  IF v_fid IS NULL THEN
    SELECT 1 AS result;
  ELSEIF NOT EXISTS(
    SELECT 1 FROM UserFactions WHERE uid = p_initiator_uid AND fid = v_fid LIMIT 1
  ) THEN
    SELECT 2 AS result;
  ELSE
    SELECT IFNULL(MAX(factionlvl), 0) INTO v_initiator_powerlvl FROM FactionRoles fr
      INNER JOIN UserFactionRoles ufr ON ufr.frid = fr.id
    WHERE fr.fid = v_fid AND ufr.uid = p_initiator_uid;

    -- FACTION_PERMISSIONS.MANAGE_INVITES
    IF v_initiator_powerlvl < 49 THEN
      SELECT 3 AS result;
    ELSE
      DELETE FROM FactionInvites WHERE midId = p_midId;
      SELECT 0 AS result;
    END IF;
  END IF;
END;;

-- join a faction
CREATE PROCEDURE IF NOT EXISTS JOIN_FACTION(
  IN p_uid INT UNSIGNED,
  IN p_ipString VARCHAR(39),
  IN p_fid BIGINT UNSIGNED,
  IN p_faction_name VARCHAR(32) CHARACTER SET ascii,
  IN p_invite_id BIGINT UNSIGNED,
  IN p_is_on_time_invite TINYINT UNSIGNED
) NOT DETERMINISTIC MODIFIES SQL DATA
BEGIN
  DECLARE v_ip VARBINARY(8);
  DECLARE v_joined_count INT UNSIGNED;
  DECLARE EXIT HANDLER FOR SQLEXCEPTION
  BEGIN
    ROLLBACK;
    RESIGNAL;
  END;
  SET v_ip = IP_TO_BIN(p_ipString);

  START TRANSACTION;

  SELECT COUNT(*) INTO v_joined_count FROM UserFactions WHERE uid = p_uid;
  -- MAX_FACTIONS_PER_USER
  IF v_joined_count >= 20 THEN
    SELECT 2 AS result;
    ROLLBACK;
  ELSEIF EXISTS(
    SELECT 1 FROM FactionBans fb
      LEFT JOIN UserFactionBans ufb ON ufb.bid = fb.id AND ufb.uid = p_uid
      LEFT JOIN IPFactionBans ifb ON ifb.bid = fb.id AND ifb.ip = v_ip
    WHERE fb.fid = p_fid AND (fb.expires > NOW() OR fb.expires IS NULL) AND (ufb.uid IS NOT NULL OR ifb.ip IS NOT NULL)
    LIMIT 1
  ) THEN
    SELECT 3 AS result;
    ROLLBACK;
  ELSEIF EXISTS(
    SELECT 1 FROM UserFactions WHERE uid = p_uid AND fid = p_fid
  ) THEN
    SELECT 4 AS result;
    ROLLBACK;
  ELSEIF EXISTS(
    SELECT 1 FROM Factions WHERE id = p_fid AND memberCount >= 10000
  ) THEN
    SELECT 5 AS result;
    ROLLBACK;
  ELSE
    INSERT INTO UserFactions (uid, fid, joined, flags) SELECT p_uid, p_fid, NOW(),
      -- USER_FLAGS.PRIV
      -- USER_FACTION_FLAGS.HIDDEN
      IF((u.flags & (1 << 1)) != 0, (1 << 0), 0)
    FROM Users u WHERE u.id = p_uid;
    INSERT INTO UserFactionRoles (uid, frid)
      -- FACTION_ROLE_FLAGS.DEFAULT
      SELECT p_uid, fr.id FROM FactionRoles fr WHERE fr.fid = p_fid AND (fr.flags & (1 << 1)) != 0;
    INSERT INTO UserChannels (uid, cid, lastRead)
      SELECT p_uid, f.cid, NOW() FROM Factions f WHERE f.id = p_fid AND f.cid IS NOT NULL;

    UPDATE FactionRoles SET memberCount = memberCount + 1
    WHERE EXISTS (
      SELECT 1 FROM UserFactionRoles ufr WHERE ufr.frid = FactionRoles.id AND ufr.uid = p_uid
    ) AND fid = p_fid;
    UPDATE Factions SET memberCount = memberCount + 1 WHERE id = p_fid;

    IF p_invite_id IS NOT NULL THEN
      IF p_is_on_time_invite != 0 THEN
        DELETE FROM FactionInvites WHERE id = p_invite_id;
      ELSE
        UPDATE FactionInvites SET used = used + 1 WHERE id = p_invite_id;
      END IF;
    END IF;

    COMMIT;
    SELECT 0 AS result, p_faction_name AS factionName;
  END IF;
END;;

-- join a public faction
CREATE PROCEDURE IF NOT EXISTS JOIN_FACTION_PUBLIC(
  IN p_uid INT UNSIGNED,
  IN p_ipString VARCHAR(39),
  IN p_faction_name VARCHAR(32) CHARACTER SET ascii
) NOT DETERMINISTIC MODIFIES SQL DATA
BEGIN
  DECLARE v_fid BIGINT UNSIGNED;

  SELECT MAX(id) INTO v_fid FROM Factions WHERE name = p_faction_name;
  IF v_fid IS NULL THEN
    SELECT 1 AS result;
  ELSEIF EXISTS(
    -- FACTION_FLAGS.PUBLIC
    SELECT 1 FROM Factions WHERE id = v_fid AND (flags & (1 << 1)) = 0
  ) THEN
    SELECT 6 AS result;
  ELSE
    CALL JOIN_FACTION(p_uid, p_ipString, v_fid, p_faction_name, NULL, NULL);
  END IF;
END;;

-- join faction with invite
CREATE PROCEDURE IF NOT EXISTS JOIN_FACTION_WITH_INVITE(
  IN p_uid INT UNSIGNED,
  IN p_ipString VARCHAR(39),
  IN p_invite_midId VARCHAR(16) CHARACTER SET ascii
) NOT DETERMINISTIC MODIFIES SQL DATA
BEGIN
  DECLARE v_fid BIGINT UNSIGNED;
  DECLARE v_iid BIGINT UNSIGNED;
  DECLARE v_faction_name VARCHAR(32) CHARACTER SET ascii;
  DECLARE v_is_on_time_invite TINYINT UNSIGNED;

  -- INVITE_FLAGS.ONE_TIME
  SELECT MAX(i.fid), MAX(f.name), MAX(i.id), (MAX(i.flags) & (1 << 0)) != 0
    INTO v_fid, v_faction_name, v_iid, v_is_on_time_invite
  FROM FactionInvites i
    INNER JOIN Factions f ON f.id = i.fid
  WHERE midId = p_invite_midId;

  IF v_fid IS NULL THEN
    SELECT 1 AS result;
  ELSE
    CALL JOIN_FACTION(p_uid, p_ipString, v_fid, v_faction_name, v_iid, v_is_on_time_invite);
  END IF;
END;;

-- leave a faction
CREATE PROCEDURE IF NOT EXISTS LEAVE_FACTION(
  IN p_uid INT UNSIGNED,
  IN p_faction_name VARCHAR(32) CHARACTER SET ascii
) NOT DETERMINISTIC MODIFIES SQL DATA
BEGIN
  DECLARE v_fid BIGINT UNSIGNED;
  DECLARE v_is_active_role TINYINT;
  DECLARE EXIT HANDLER FOR SQLEXCEPTION
  BEGIN
    ROLLBACK;
    RESIGNAL;
  END;
  START TRANSACTION;

  SELECT MAX(id) INTO v_fid FROM Factions WHERE name = p_faction_name;
  IF v_fid IS NULL THEN
    SELECT 1 AS result;
    ROLLBACK;
  ELSEIF NOT EXISTS(
    SELECT 1 FROM UserFactionRoles ufr
      INNER JOIN FactionRoles fr ON ufr.frid = fr.id
    -- FACTION_PERMISSIONS.SOVEREIGN
    WHERE fr.fid = v_fid AND ufr.uid != p_uid AND fr.factionlvl >= 100 LIMIT 1
  ) THEN
    SELECT 2 AS result;
    ROLLBACK;
  ELSE
    DELETE FROM UserFactions WHERE uid = p_uid AND fid = v_fid;
    IF ROW_COUNT() > 0 THEN
      UPDATE FactionRoles SET memberCount = memberCount - 1
      WHERE EXISTS (
        SELECT 1 FROM UserFactionRoles ufr WHERE ufr.frid = FactionRoles.id AND ufr.uid = p_uid LIMIT 1
      ) AND fid = v_fid;
      UPDATE Factions SET memberCount = memberCount - 1 WHERE id = v_fid;

      UPDATE Profiles SET activeRole = NULL WHERE uid = p_uid AND EXISTS(
        SELECT 1 FROM FactionRoles fr WHERE fr.id = Profiles.activeRole AND fr.fid = v_fid LIMIT 1
      );
      SET v_is_active_role = (ROW_COUNT() > 0);

      DELETE uc FROM UserChannels uc
        INNER JOIN Factions f ON f.cid = uc.cid
      WHERE uc.uid = p_uid AND f.id = v_fid;
      DELETE ufr FROM UserFactionRoles ufr
        INNER JOIN FactionRoles fr ON fr.id = ufr.frid
      WHERE ufr.uid = p_uid  AND fr.fid = v_fid;
    END IF;
    COMMIT;
    SELECT 0 AS result, v_is_active_role as hadRoleActive;
  END IF;
END;;

-- transfer a faction
CREATE PROCEDURE IF NOT EXISTS TRANSFER_FACTION(
  p_faction_name VARCHAR(32) CHARACTER SET ascii,
  IN p_uid INT UNSIGNED
) NOT DETERMINISTIC MODIFIES SQL DATA
BEGIN
  DECLARE v_fid BIGINT UNSIGNED;
  DECLARE v_sovereign_frid BIGINT UNSIGNED;
  DECLARE v_old_uid INT UNSIGNED;
  DECLARE EXIT HANDLER FOR SQLEXCEPTION
  BEGIN
    ROLLBACK;
    RESIGNAL;
  END;
  START TRANSACTION;

  SELECT MAX(fr.fid), MAX(fr.id), MAX(ufr.uid)
  INTO v_fid, v_sovereign_frid, v_old_uid FROM FactionRoles fr
    INNER JOIN Factions f ON f.id = fr.fid
    LEFT JOIN UserFactionRoles ufr ON ufr.frid = fr.id
  -- FACTION_PERMISSIONS.SOVEREIGN
  WHERE f.name = p_faction_name AND fr.factionlvl >= 100;

  IF v_sovereign_frid IS NOT NULL THEN
    UPDATE Profiles SET activeRole = NULL WHERE activeRole = v_sovereign_frid;
    DELETE FROM UserFactions WHERE fid = v_fid AND EXISTS(
      SELECT 1 FROM UserFactionRoles WHERE frid = v_sovereign_frid AND uid = UserFactions.uid
    );
    DELETE FROM UserFactionRoles WHERE frid = v_sovereign_frid;
    INSERT INTO UserFactionRoles (uid, frid) VALUES (p_uid, v_sovereign_frid);
    INSERT IGNORE INTO UserFactions (uid, fid, joined, flags) VALUES (p_uid, v_fid, NOW(), 0);
  END IF;
  COMMIT;
END;;
