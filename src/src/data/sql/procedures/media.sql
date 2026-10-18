DELIMITER ;;

-- get close image by perceptive hash
CREATE PROCEDURE IF NOT EXISTS GET_CLOSE_IMAGE(
  IN p_pHash CHAR(16)
) READS SQL DATA
BEGIN
  DECLARE i_pHash BIGINT UNSIGNED;
  SET i_pHash = CONV(p_pHash, 16, 10);
  SELECT extension, shortId, mimeType, type, width, height, avgColor FROM ImageHashes ih
    INNER JOIN Media m ON m.id = ih.mid
  WHERE BIT_COUNT(pHash ^ i_pHash) < 2 LIMIT 1;
END;;

-- check if image is banned based on perceptive hash
CREATE PROCEDURE IF NOT EXISTS GET_CLOSE_BANNED_IMAGE(
  IN p_pHash CHAR(16)
) READS SQL DATA
BEGIN
  DECLARE i_pHash BIGINT UNSIGNED;
  SET i_pHash = CONV(p_pHash, 16, 10);
  SELECT BIN_TO_UUID(uuid) AS mbid, LOWER(HEX(hash)) AS hash, reason FROM MediaBans WHERE BIT_COUNT(pHash ^ i_pHash) < 9 LIMIT 1;
END;;
