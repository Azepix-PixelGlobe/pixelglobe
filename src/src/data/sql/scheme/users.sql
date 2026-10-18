-- Users

CREATE TABLE IF NOT EXISTS Users (
  id int unsigned NOT NULL AUTO_INCREMENT,

  -- ^[a-z][a-zA-Z0-9._-]+$
  username varchar(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  name varchar(32) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,

  -- bcrypt hash, may be NULL if only ever used oauth loging
  password char(60) CHARACTER SET ascii COLLATE ascii_bin,

  -- permission level of user
  userlvl tinyint unsigned NOT NULL DEFAULT 10,

  -- from lowest to highest bit, USER_FLAGS:
  --   0: blockDm (if account blocks all DMs)
  --   1: priv (if account is private)
  flags tinyint unsigned NOT NULL DEFAULT 0,

  lastSeen datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  createdAt datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,

  PRIMARY KEY (id),
  UNIQUE KEY username (username),
  UNIQUE KEY name (name)
);

-- Trigger validating username, and setting it to pp_id if it is given as '='
-- the user may choose his username if it starts with pp_

DELIMITER ;;
CREATE TRIGGER IF NOT EXISTS set_username
  BEFORE INSERT ON Users FOR EACH ROW
BEGIN
  IF NEW.username IS NULL OR NEW.username = '=' THEN
    SET NEW.username = CONCAT('pp_', (
      SELECT AUTO_INCREMENT FROM INFORMATION_SCHEMA.TABLES
      WHERE TABLE_NAME = 'Users' AND TABLE_SCHEMA = DATABASE()
    ));
  ELSE
    SET NEW.username = REGEXP_REPLACE(NEW.username, '[^a-zA-Z0-9._-]', '');
  END IF;
END;;
DELIMITER ;

-- ThreePIDs

CREATE TABLE IF NOT EXISTS ThreePIDs (
  id int unsigned NOT NULL AUTO_INCREMENT,
  uid int unsigned,
  provider tinyint unsigned NOT NULL,
  tpid varchar(80) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,

  -- only 0 or 1
  verified tinyint NOT NULL DEFAULT 0,

  lastSeen datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  createdAt datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,

  normalizedTpid varchar(80) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci
    GENERATED ALWAYS AS (
      CASE
        WHEN provider != 1 THEN NULL
        WHEN LOCATE('@',tpid) = 0 THEN NULL
        ELSE
          LOWER(CONCAT(REPLACE(
            -- prefix in prefix+postfix@host
            SUBSTRING_INDEX(SUBSTRING_INDEX(tpid,'@',1),'+',1)
            -- remove dots within prefix
            ,'.',''
            -- add @host back
          ),'@',SUBSTRING_INDEX(tpid,'@',-1)))
        END
    ) STORED,

  PRIMARY KEY (id),
  UNIQUE KEY ptpid (provider,tpid),
  UNIQUE KEY pntpid (provider,normalizedTpid),
  KEY uid (uid),
  CONSTRAINT ThreePIDs_ibfk_1 FOREIGN KEY (uid) REFERENCES Users (id) ON DELETE SET NULL ON UPDATE CASCADE
);

-- ThreePID History

CREATE TABLE IF NOT EXISTS ThreePIDHistories (
  id int unsigned NOT NULL AUTO_INCREMENT,
  uid int unsigned NOT NULL,
  provider tinyint unsigned NOT NULL,
  tpid varchar(80) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  normalizedTpid varchar(80) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  verified tinyint NOT NULL,
  lastSeen datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  createdAt datetime NOT NULL,

  PRIMARY KEY (id),
  KEY uid (uid),
  CONSTRAINT ThreePIDHistories_ibfk_1 FOREIGN KEY (uid) REFERENCES Users (id) ON DELETE CASCADE ON UPDATE CASCADE
);

-- User Blocks

CREATE TABLE IF NOT EXISTS UserBlocks (
  uid int unsigned NOT NULL,
  buid int unsigned NOT NULL,

  PRIMARY KEY (uid,buid),
  KEY buid (buid),
  CONSTRAINT UserBlocks_ibfk_1 FOREIGN KEY (uid) REFERENCES Users (id) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT UserBlocks_ibfk_2 FOREIGN KEY (buid) REFERENCES Users (id) ON DELETE CASCADE ON UPDATE CASCADE
);
