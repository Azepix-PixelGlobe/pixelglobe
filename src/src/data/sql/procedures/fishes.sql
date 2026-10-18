DELIMITER ;;

-- store Fish
-- since mariadb returns the last_insert_id to my knowledge, this may be
-- irrelevant now
CREATE PROCEDURE IF NOT EXISTS STORE_FISH(
  IN p_uid INT UNSIGNED,
  IN p_type TINYINT UNSIGNED,
  IN p_size FLOAT
) NOT DETERMINISTIC MODIFIES SQL DATA
BEGIN
  INSERT INTO Fishes (uid, type, size, createdAt) VALUES (p_uid, p_type, p_size, NOW());
  SELECT LAST_INSERT_ID() AS id;
END;;
