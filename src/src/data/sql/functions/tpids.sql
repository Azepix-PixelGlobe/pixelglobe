DELIMITER ;;

-- converts an email to a normalized form that removes +postfixes and dots
-- because those resolve to the same mailbox on most popular providers

CREATE FUNCTION IF NOT EXISTS NORMALIZE_TPID(
  provider TINYINT(4) UNSIGNED,
  tip VARCHAR(80)
) RETURNS VARCHAR(80) DETERMINISTIC CONTAINS SQL
BEGIN
  DECLARE atPos TINYINT UNSIGNED;
  -- THREEPID_PROVIDERS.DM
  IF provider != 1 THEN
    RETURN NULL;
  END IF;
  SET atPos = LOCATE('@', tip);
  IF atPos = 0 THEN
    RETURN NULL;
  END IF;
  RETURN (LOWER(CONCAT(REPLACE(SUBSTRING_INDEX(
    SUBSTRING_INDEX(tip, '@', 1), '+', 1
  ), '.', ''),'@',(SUBSTRING_INDEX(tip, '@', -1)))));
END;;
