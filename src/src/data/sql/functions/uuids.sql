DELIMITER ;;

-- functions to convert an uuid to binary or string forms
-- storing them as binaries is preferable

CREATE FUNCTION IF NOT EXISTS UUID_TO_BIN(
  uuid CHAR(36)
) RETURNS BINARY(16) DETERMINISTIC
BEGIN
  RETURN UNHEX(REPLACE(uuid, '-', ''));
END;;

CREATE FUNCTION IF NOT EXISTS BIN_TO_UUID(
  bin_uuid BINARY(16)
) RETURNS CHAR(36) DETERMINISTIC
BEGIN
  DECLARE hex_uuid CHAR(32);
  SET hex_uuid = HEX(bin_uuid);
  RETURN LOWER(CONCAT(
    SUBSTR(hex_uuid, 1, 8), '-',
    SUBSTR(hex_uuid, 9, 4), '-',
    SUBSTR(hex_uuid, 13, 4), '-',
    SUBSTR(hex_uuid, 17, 4), '-',
    SUBSTR(hex_uuid, 21, 12)
  ));
END;;
