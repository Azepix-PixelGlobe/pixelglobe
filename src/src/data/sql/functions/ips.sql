DELIMITER ;;

-- functions to convert ips into a binary form
-- if IPv6, only care about the top /64
-- so a 8 byte result is an IPv6 prefix while 4 byte is IPv4

CREATE FUNCTION IF NOT EXISTS IP_TO_BIN(
  ip VARCHAR(39)
) RETURNS VARBINARY(8) DETERMINISTIC CONTAINS SQL
BEGIN
  DECLARE longBin VARBINARY(16);
  SET longBin = INET6_ATON(ip);
  IF LENGTH(longBin) > 4
    THEN
      RETURN SUBSTRING(longBin, 1, 8);
    ELSE
      RETURN (longBin);
  END IF;
END;;

CREATE FUNCTION IF NOT EXISTS BIN_TO_IP(
  bin VARBINARY(8)
) RETURNS VARCHAR(21) DETERMINISTIC CONTAINS SQL
BEGIN
  RETURN (INET6_NTOA(IF(LENGTH(bin) > 4, CAST(bin as BINARY(16)), bin)));
END;;
