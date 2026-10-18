DELIMITER ;;

-- store chat message
-- return the inserted message id or 0 if the channel doesn't exist
-- If second result set exists, it is data for attached media
-- @param p_cid channel id
-- @param p_uid user id
-- @param p_message message
-- @param p_media_json JSON array with {shortId, extension} of attached media

CREATE PROCEDURE IF NOT EXISTS STORE_CHAT_MESSAGE(
  IN p_cid INT UNSIGNED,
  IN p_uid INT UNSIGNED,
  IN p_message VARCHAR(200) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci,
  IN p_media_json JSON
) NOT DETERMINISTIC MODIFIES SQL DATA
BEGIN
  DECLARE v_mid BIGINT UNSIGNED;
  DECLARE v_fk_error TINYINT UNSIGNED;
  DECLARE EXIT HANDLER FOR SQLEXCEPTION
  BEGIN
    ROLLBACK;
    RESIGNAL;
  END;
  START TRANSACTION;

  BEGIN
    DECLARE CONTINUE HANDLER FOR 1452
    BEGIN
      SET v_fk_error = 1;
    END;

    INSERT INTO Messages (message, uid, cid, createdAt) VALUES (p_message, p_uid, p_cid, NOW());
  END;

  IF v_fk_error = 1 THEN
    ROLLBACK;
    SELECT 1 AS result;
  ELSE
    SELECT LAST_INSERT_ID() INTO v_mid;

    SELECT 0 AS result, v_mid AS id;
    IF p_media_json IS NOT NULL THEN
      INSERT INTO MessageMedia (sid, mid) SELECT DISTINCT v_mid, m.id FROM Media m
        INNER JOIN JSON_TABLE(
          p_media_json,
          '$[*]' COLUMNS(
            shortId VARCHAR(16) PATH '$[0]',
            extension VARCHAR(12) PATH '$[1]'
          )
        ) AS j ON (m.shortId = j.shortId AND m.extension = j.extension);

        SELECT CONCAT(b.shortId, ':', b.extension) AS mediaId,
        b.type AS mediaType, b.size AS mediaSize, b.width AS mediaWidth, b.height AS mediaHeight,
        b.avgColor AS mediaAvgColor FROM Media b
          INNER JOIN MessageMedia mm ON mm.mid = b.id
        WHERE mm.sid = v_mid;
    END IF;
    COMMIT;

    UPDATE Channels SET lastMessage = NOW() WHERE id = p_cid;
  END IF;
END;;
