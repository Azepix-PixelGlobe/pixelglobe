DELIMITER ;;

-- remove ban
-- @param p_bid id of the ban
-- @param p_muid the mod that removes the ban
CREATE PROCEDURE IF NOT EXISTS REMOVE_BAN(
  IN p_bid BIGINT UNSIGNED,
  IN p_muid INT UNSIGNED
) NOT DETERMINISTIC MODIFIES SQL DATA
BEGIN
  DECLARE EXIT HANDLER FOR SQLEXCEPTION
  BEGIN
    ROLLBACK;
    RESIGNAL;
  END;
  START TRANSACTION;

  INSERT INTO BanHistories (
    id, uuid, reason, flags, started,
    muid, lmuid, ended, liftedAt
  ) SELECT
    id, uuid, reason, flags, createdAt,
    muid, p_muid, expires,
    IF(expires > CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, NULL)
  FROM Bans WHERE id = p_bid;

  INSERT INTO IPBanHistories (bid, ip)
    SELECT bid, ip FROM IPBans WHERE bid = p_bid;

  INSERT INTO UserBanHistories (bid, uid)
    SELECT bid, uid FROM UserBans WHERE bid = p_bid;

  INSERT INTO ThreePIDBanHistories (bid, tid)
    SELECT bid, tid FROM ThreePIDBans WHERE bid = p_bid;

  DELETE FROM Bans WHERE id = p_bid;
  COMMIT;
END;;

-- clean up expired bans
CREATE PROCEDURE IF NOT EXISTS CLEAN_BANS() NOT DETERMINISTIC MODIFIES SQL DATA
BEGIN
  DECLARE v_bid BIGINT UNSIGNED;
  DECLARE v_done INT DEFAULT FALSE;

  DECLARE v_cursor CURSOR FOR
    SELECT id FROM Bans WHERE expires IS NOT NULL AND expires < NOW();
  DECLARE CONTINUE HANDLER FOR NOT FOUND
    SET v_done = TRUE;

  OPEN v_cursor;
  read_loop: LOOP
    FETCH v_cursor INTO v_bid;
    IF v_done THEN LEAVE read_loop; END IF;
    CALL REMOVE_BAN(v_bid, NULL);
  END LOOP;
  CLOSE v_cursor;
END;;

-- ban
-- add a ban, the IID (UUID) for the ban comes from the client
CREATE PROCEDURE IF NOT EXISTS BAN(
  IN p_new_uuid CHAR(36),
  IN p_ips_json JSON,
  IN p_uids_json JSON,
  IN p_iids_json JSON,
  IN p_flags TINYINT UNSIGNED,
  IN p_reason varchar(200) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci,
  IN p_expires DATETIME,
  IN p_muid INT UNSIGNED
) NOT DETERMINISTIC MODIFIES SQL DATA
BEGIN
  DECLARE v_bid BIGINT UNSIGNED;
  DECLARE v_inserted_bans INT UNSIGNED DEFAULT 0;
  DECLARE EXIT HANDLER FOR SQLEXCEPTION
  BEGIN
    ROLLBACK;
    RESIGNAL;
  END;
  START TRANSACTION;

  INSERT INTO Bans (
    uuid, reason, flags, expires, muid
  ) VALUES (
    UUID_TO_BIN(p_new_uuid), p_reason, p_flags, p_expires, p_muid
  );
  SET v_bid = LAST_INSERT_ID();

  IF p_ips_json IS NOT NULL AND JSON_LENGTH(p_ips_json) > 0 THEN
    INSERT INTO IPBans (bid, ip)
      SELECT v_bid, IP_TO_BIN(j.ip) FROM JSON_TABLE(
        p_ips_json,
        '$[*]' COLUMNS (ip VARCHAR(45) PATH '$')
      ) AS j;

    SET v_inserted_bans = v_inserted_bans + ROW_COUNT();
  END IF;

  IF p_iids_json IS NOT NULL AND JSON_LENGTH(p_iids_json) > 0 THEN
    INSERT INTO IPBans (bid, ip)
      SELECT v_bid, i.ip FROM IPs i
        INNER JOIN JSON_TABLE(
          p_iids_json,
          '$[*]' COLUMNS (uuid CHAR(36) PATH '$')
        ) AS j ON i.uuid = UUID_TO_BIN(j.uuid);

    SET v_inserted_bans = v_inserted_bans + ROW_COUNT();
  END IF;

  IF p_uids_json IS NOT NULL AND JSON_LENGTH(p_uids_json) > 0 THEN
    INSERT INTO UserBans (bid, uid)
      SELECT v_bid, j.uid FROM JSON_TABLE(
        p_uids_json,
        '$[*]' COLUMNS (uid INT UNSIGNED PATH '$')
      ) AS j;

    SET v_inserted_bans = v_inserted_bans + ROW_COUNT();

    INSERT INTO ThreePIDBans (bid, tid)
      SELECT v_bid, t.id FROM ThreePIDs t
        INNER JOIN JSON_TABLE(
          p_uids_json,
          '$[*]' COLUMNS (uid INT UNSIGNED PATH '$')
        ) AS j ON t.uid = j.uid;

    SET v_inserted_bans = v_inserted_bans + ROW_COUNT();
  END IF;

  IF v_inserted_bans = 0 THEN
    SELECT 1 AS result;
    ROLLBACK;
  ELSE
    SELECT 0 AS result;
    SELECT BIN_TO_IP(ip) AS ip FROM IPBans WHERE bid = v_bid;
    SELECT uid FROM UserBans WHERE bid = v_bid;
    COMMIT;
  END IF;
END;;

-- remove range ban
-- @param p_bid id of the ban
-- @param p_muid the mod that removes the ban
CREATE PROCEDURE IF NOT EXISTS REMOVE_RANGE_BAN(
  IN p_bid INT UNSIGNED,
  IN p_muid INT UNSIGNED
) NOT DETERMINISTIC MODIFIES SQL DATA
BEGIN
  DECLARE EXIT HANDLER FOR SQLEXCEPTION
  BEGIN
    ROLLBACK;
    RESIGNAL;
  END;
  START TRANSACTION;

  INSERT INTO RangeBanHistories (
    rid, reason, started,
    muid, lmuid, ended, liftedAt
  ) SELECT
    rid, reason, createdAt,
    muid, p_muid, expires,
    IF(expires > CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, NULL)
  FROM RangeBans WHERE id = p_bid;

  DELETE FROM RangeBans WHERE id = p_bid;
  COMMIT;
END;;

-- clean up expired range bans
CREATE PROCEDURE IF NOT EXISTS CLEAN_RANGE_BANS() NOT DETERMINISTIC MODIFIES SQL DATA
BEGIN
  DECLARE v_rid INT UNSIGNED;
  DECLARE v_done INT DEFAULT FALSE;

  DECLARE v_cursor CURSOR FOR
    SELECT rid FROM RangeBans WHERE expires IS NOT NULL AND expires < NOW();
  DECLARE CONTINUE HANDLER FOR NOT FOUND
    SET v_done = TRUE;

  OPEN v_cursor;
  read_loop: LOOP
    FETCH v_cursor INTO v_rid;
    IF v_done THEN LEAVE read_loop; END IF;
    CALL REMOVE_RANGE_BAN(v_rid, NULL);
  END LOOP;
  CLOSE v_cursor;
END;;
