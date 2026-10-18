DELIMITER ;;

-- add captcha
CREATE PROCEDURE IF NOT EXISTS REGISTER_CAPTCHA(
  IN p_id char(11) CHARACTER SET ascii COLLATE ascii_bin,
  IN p_solution char(4) CHARACTER SET ascii COLLATE ascii_general_ci,
  IN p_browser_hash char(15) CHARACTER SET ascii COLLATE ascii_bin,
  IN p_ipString VARCHAR(39)
) NOT DETERMINISTIC MODIFIES SQL DATA
BEGIN
  DECLARE v_need_challenge TINYINT UNSIGNED DEFAULT 1;
  DECLARE EXIT HANDLER FOR SQLEXCEPTION
  BEGIN
    DELETE FROM CaptchaSolutions WHERE expires < NOW();
    RESIGNAL;
  END;

  INSERT INTO CaptchaSolutions (
    id, ip, browserHash, solution, expires
  ) VALUES (
    p_id, IP_TO_BIN(p_ipString), p_browser_hash, p_solution, NOW() + INTERVAL 3 MINUTE
  );

  SELECT 0 INTO v_need_challenge FROM IPTrusts WHERE ip = IP_TO_BIN(p_ipString) AND (
    expires IS NULL OR expires > NOW()
  );
  SELECT v_need_challenge AS needChallenge;
END;;

-- add challenge
CREATE PROCEDURE IF NOT EXISTS REGISTER_CHALLENGE(
  IN p_solution INT,
  IN p_browser_hash char(15) CHARACTER SET ascii COLLATE ascii_bin,
  IN p_ipString VARCHAR(39)
) NOT DETERMINISTIC MODIFIES SQL DATA
BEGIN
  DECLARE v_need_captcha TINYINT UNSIGNED DEFAULT 1;
  DECLARE EXIT HANDLER FOR SQLEXCEPTION
  BEGIN
    DELETE FROM ChallengeSolutions WHERE expires < NOW();
    RESIGNAL;
  END;

  INSERT INTO ChallengeSolutions (
    solution, ip, browserHash, expires
  ) VALUES (
    p_solution, IP_TO_BIN(p_ipString), p_browser_hash, NOW() + INTERVAL 6 MINUTE
  );

  SELECT 0 INTO v_need_captcha FROM IPHumans WHERE ip = IP_TO_BIN(p_ipString) AND (
    expires IS NULL OR expires > NOW()
  );
  SELECT v_need_captcha AS needCaptcha;
END;;

-- check solutions
CREATE PROCEDURE IF NOT EXISTS CHECK_VERIFICATION_SOLUTIONS(
  IN p_captcha_id char(11) CHARACTER SET ascii COLLATE ascii_bin,
  IN p_captcha_solution char(4) CHARACTER SET ascii COLLATE ascii_general_ci,
  IN p_challenge_solution INT,
  IN p_browser_hash char(15) CHARACTER SET ascii COLLATE ascii_bin,
  IN p_ipString VARCHAR(39),
  IN p_is_one_time tinyint unsigned,
  -- duration captcha is valid in minutes
  IN p_captcha_duration int unsigned,
  -- duration challenge is valid in hours
  IN p_challenge_duration int unsigned
) NOT DETERMINISTIC MODIFIES SQL DATA
BEGIN
  DECLARE v_i INT;
  DECLARE v_user_char CHAR(1) CHARACTER SET ascii;
  DECLARE v_stored_char CHAR(1) CHARACTER SET ascii;

  DECLARE v_stored_captcha_solution CHAR(4) CHARACTER SET ascii;
  DECLARE v_stored_captcha_expiration datetime;
  DECLARE v_stored_captcha_browser_hash CHAR(15) CHARACTER SET ascii COLLATE ascii_bin;
  DECLARE v_stored_challenge_expiration datetime;
  DECLARE v_stored_challenge_browser_hash CHAR(15) CHARACTER SET ascii COLLATE ascii_bin;
  -- 0: success
  -- 1: not asked
  -- 2: not found
  -- 3: expired
  -- 4: different device
  -- 5: wrong
  DECLARE v_captcha_return tinyint;
  -- 0: success
  -- 1: not asked
  -- 2: not found or wrong
  -- 3: expired
  -- 4: different device
  DECLARE v_challenge_return tinyint;

  IF p_captcha_solution IS NULL OR p_captcha_id IS NULL THEN
    SET v_captcha_return = 1;
  ELSE
    SELECT solution, expires, browserHash INTO
      v_stored_captcha_solution,
      v_stored_captcha_expiration,
      v_stored_captcha_browser_hash
    FROM CaptchaSolutions WHERE id = p_captcha_id LIMIT 1;

    IF v_stored_captcha_solution IS NULL THEN
      SET v_captcha_return = 2;
    ELSEIF v_stored_captcha_expiration IS NOT NULL AND v_stored_captcha_expiration < NOW() THEN
      SET v_captcha_return = 3;
    ELSEIF p_browser_hash IS NOT NULL AND v_stored_captcha_browser_hash != p_browser_hash THEN
      SET v_captcha_return = 4;
    ELSE
      SET v_captcha_return = 0;

      SET v_i = 1;
      WHILE v_i <= 4
      DO
        SET v_user_char = SUBSTRING(p_captcha_solution, v_i, 1);
        SET v_stored_char = SUBSTRING(v_stored_captcha_solution, v_i, 1);
        -- grace characters
        SET v_user_char = CASE v_user_char
          WHEN 'I' THEN 'l'
          WHEN 'j' THEN 'i'
          WHEN '0' THEN 'o'
          ELSE v_user_char
        END;
        SET v_stored_char = CASE v_stored_char
          WHEN 'I' THEN 'l'
          WHEN 'j' THEN 'i'
          WHEN '0' THEN 'o'
          ELSE v_stored_char
        END;
        IF LOWER(v_user_char) != LOWER(v_stored_char) THEN
          SET v_captcha_return = 5;
        END IF;
        SET v_i = v_i + 1;
      END WHILE;

      DELETE FROM CaptchaSolutions WHERE id = p_captcha_id;

      IF v_captcha_return = 0 AND p_is_one_time = 0 THEN
        INSERT INTO IPHumans (ip, expires) VALUES (IP_TO_BIN(p_ipString), NOW() + INTERVAL p_captcha_duration MINUTE) ON DUPLICATE KEY UPDATE expires = VALUES(expires);
      END IF;
    END IF;
  END IF;

  IF p_challenge_solution IS NULL THEN
    SET v_challenge_return = 1;
  ELSE
    SELECT expires, browserHash INTO
      v_stored_challenge_expiration,
      v_stored_challenge_browser_hash
    FROM ChallengeSolutions WHERE solution = p_challenge_solution LIMIT 1;

    IF v_stored_challenge_browser_hash IS NULL THEN
      SET v_challenge_return = 2;
    ELSEIF v_stored_challenge_expiration IS NOT NULL AND v_stored_challenge_expiration < NOW() THEN
      SET v_challenge_return = 3;
    ELSEIF p_browser_hash IS NOT NULL AND v_stored_challenge_browser_hash != p_browser_hash THEN
      SET v_challenge_return = 4;
    ELSE
      SET v_challenge_return = 0;

      DELETE FROM ChallengeSolutions WHERE solution = p_challenge_solution;

      IF p_is_one_time = 0 THEN
        INSERT INTO IPTrusts (ip, expires) VALUES (IP_TO_BIN(p_ipString), NOW() + INTERVAL p_challenge_duration HOUR) ON DUPLICATE KEY UPDATE expires = VALUES(expires);
      END IF;
    END IF;
  END IF;

  SELECT
    v_captcha_return AS captchaReturn,
    v_challenge_return AS challengeReturn,
    v_stored_captcha_browser_hash AS captchaBrowserHash,
    v_stored_challenge_browser_hash AS challengeBrowserHash,
    IF(
      t.ip IS NOT NULL,
      UNIX_TIMESTAMP(t.expires) * 1000,
      0
    ) AS challengeExpiresTs,
    IF(
      h.ip IS NOT NULL,
      UNIX_TIMESTAMP(h.expires) * 1000,
      0
    ) AS captchaExpiresTs
    FROM (SELECT IP_TO_BIN(p_ipString) AS ip ) AS dummy
      LEFT JOIN IPHumans h ON h.ip = dummy.ip
      LEFT JOIN IPTrusts t ON t.ip = dummy.ip;
END;;
