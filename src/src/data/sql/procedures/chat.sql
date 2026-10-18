DELIMITER ;;

-- create a dm channel
CREATE PROCEDURE IF NOT EXISTS CREATE_DM_CHANNEL(
  IN p_uid_a INT UNSIGNED,
  IN p_uid_b INT UNSIGNED
) NOT DETERMINISTIC MODIFIES SQL DATA
BEGIN
  DECLARE v_cid INT UNSIGNED;
  DECLARE v_created TINYINT DEFAULT 0;
  DECLARE EXIT HANDLER FOR SQLEXCEPTION
  BEGIN
    ROLLBACK;
    RESIGNAL;
  END;
  START TRANSACTION;

  SELECT c.id INTO v_cid FROM Channels c
    INNER JOIN UserChannels uc1 ON uc1.cid = c.id AND uc1.uid = p_uid_a
    INNER JOIN UserChannels uc2 ON uc2.cid = c.id AND uc2.uid = p_uid_b
  -- CHANNEL_TYPES.DM
  WHERE c.type = 1 LIMIT 1;

  IF v_cid IS NULL THEN
    -- CHANNEL_TYPES.DM
    INSERT INTO Channels (type) VALUES (1);
    SET v_cid = LAST_INSERT_ID();
    SET v_created = 1;
    INSERT INTO UserChannels (cid, uid) VALUES (v_cid, p_uid_a), (v_cid, p_uid_b);
  END IF;
  COMMIT;

  SELECT v_cid AS cid, v_created AS created;
END;;

-- delete a dm channel
CREATE PROCEDURE IF NOT EXISTS DELETE_DM_CHANNEL(
  IN p_uid_a INT UNSIGNED,
  IN p_uid_b INT UNSIGNED
)
NOT DETERMINISTIC MODIFIES SQL DATA
BEGIN
  DECLARE v_cid INT UNSIGNED;

  SELECT c.id INTO v_cid FROM Channels c
    INNER JOIN UserChannels uc1 ON uc1.cid = c.id AND uc1.uid = p_uid_a
    INNER JOIN UserChannels uc2 ON uc2.cid = c.id AND uc2.uid = p_uid_b
  -- CHANNEL_TYPES.DM
  WHERE c.type = 1 LIMIT 1;

  IF v_cid IS NOT NULL THEN
    DELETE FROM Channels WHERE id = v_cid;
  END IF;

  SELECT v_cid AS cid;
END;;

-- leave a channel
-- second result set is uids of affected users
CREATE PROCEDURE IF NOT EXISTS LEAVE_CHANNEL(
  IN p_uid INT UNSIGNED,
  IN p_cid INT UNSIGNED
) NOT DETERMINISTIC MODIFIES SQL DATA
BEGIN
  DECLARE v_member_count INT UNSIGNED;
  DECLARE v_type TINYINT UNSIGNED;

  SELECT type, (
    SELECT COUNT(*) FROM UserChannels WHERE cid = p_cid
  ) AS memberAmount INTO v_type, v_member_count FROM Channels c
    INNER JOIN UserChannels uc ON uc.cid = c.id
  WHERE c.id = p_cid AND uc.uid = p_uid LIMIT 1;

  IF v_type IS NULL THEN
    SELECT 1 AS result;
  -- CHANNEL_TYPES.DM
  -- CHANNEL_TYPES.GROUP
  ELSEIF v_type != 1 AND v_type != 2 THEN
    SELECT 2 AS result;
  ELSEIF v_member_count <= 2 THEN
    SELECT 0 AS result, v_type AS channelType;
    SELECT uid FROM UserChannels WHERE cid = p_cid;
    DELETE FROM Channels WHERE id = p_cid;
  ELSE
    SELECT 0 AS result, v_type AS channelType;
    SELECT p_uid AS uid;
    DELETE FROM UserChannels WHERE uid = p_uid AND cid = p_cid;
  END IF;
END;;

-- get basic chat data of user
--   1st reesult set
--     buid, name of banned users
--   2st result set
--     type, cid, name, lastTs, lastReadTs, muted, avatar
CREATE PROCEDURE IF NOT EXISTS GET_USER_CHANNEL_INFO(
  IN p_uid INT UNSIGNED
) NOT DETERMINISTIC READS SQL DATA
BEGIN
  SELECT ub.buid, u.name FROM UserBlocks ub
    INNER JOIN Users u ON u.id = ub.buid
  WHERE ub.uid = p_uid;

  (
    SELECT
    -- CHANNEL_TYPES.DM
      1 AS type, c.id, dmu.name, UNIX_TIMESTAMP(c.lastMessage) AS lastTs, UNIX_TIMESTAMP(uc.lastRead) AS lastReadTs, uc.muted, CONCAT(a.shortId, ':', a.extension) AS avatarId
    FROM UserChannels uc
      INNER JOIN Channels c ON uc.cid = c.id
      INNER JOIN UserChannels dmuc ON dmuc.cid = c.id AND dmuc.uid != uc.uid
      INNER JOIN Users dmu ON dmu.id = dmuc.uid
      LEFT JOIN Profiles dmp ON dmp.uid = dmu.id
      LEFT JOIN Media a ON a.id = dmp.avatar
    -- CHANNEL_TYPES.DM
    WHERE c.type = 1 AND uc.uid = p_uid
  ) UNION ALL (
    SELECT
    -- CHANNEL_TYPES.FACTION
      3, c.id, c.name, UNIX_TIMESTAMP(c.lastMessage), UNIX_TIMESTAMP(uc.lastRead), uc.muted, CONCAT(a.shortId, ':', a.extension)
    FROM UserFactions uf
      INNER JOIN Factions f ON f.id = uf.fid
      INNER JOIN Media a ON a.id = f.avatar
      INNER JOIN Channels c ON c.id = f.cid
      INNER JOIN UserChannels uc ON uc.cid = c.id AND uc.uid = uf.uid
    WHERE uf.uid = p_uid
  );
END;;
