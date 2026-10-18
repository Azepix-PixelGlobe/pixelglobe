ALTER TABLE CaptchaSolutions DROP FOREIGN KEY IF EXISTS CaptchaSolutions_ibfk_1;
ALTER TABLE ChallengeSolutions DROP FOREIGN KEY IF EXISTS ChallengeSolutions_ibfk_1;
ALTER TABLE CaptchaSolutions DROP INDEX IF EXISTS ip;
ALTER TABLE ChallengeSolutions DROP INDEX IF EXISTS ip;

CREATE TABLE IF NOT EXISTS CanvasModLogs (
  id int unsigned NOT NULL AUTO_INCREMENT,
  type tinyint unsigned NOT NULL,
  -- affected canvas area
  canvasIdent VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  x int signed NOT NULL,
  y int signed NOT NULL,
  width int unsigned NOT NULL,
  height int unsigned NOT NULL,
  -- json array of parameters
  params JSON NOT NULL CHECK (JSON_TYPE(params) = 'ARRAY'),
  -- uid of mod
  muid int unsigned,
  -- userlvl required to see log
  -- USERLVL.ANONYM
  accessUserlvl tinyint unsigned NOT NULL DEFAULT 0,
  createdAt datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

  PRIMARY KEY (id),
  KEY muid (muid),
  CONSTRAINT CanvasModLogs_ibfk_1 FOREIGN KEY (muid) REFERENCES Users (id) ON DELETE SET NULL ON UPDATE CASCADE
);

-- table for moderation logs

CREATE TABLE IF NOT EXISTS ModLogs (
  id int unsigned NOT NULL AUTO_INCREMENT,
  type tinyint unsigned NOT NULL,
  -- json array of parameters
  params JSON NOT NULL CHECK (JSON_TYPE(params) = 'ARRAY'),
  -- uid of mod
  muid int unsigned,
  -- userlvl required to see log
  -- USERLVL.ADMIN
  accessUserlvl tinyint unsigned NOT NULL DEFAULT 100,
  createdAt datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

  PRIMARY KEY (id),
  KEY muid (muid),
  CONSTRAINT ModLogs_ibfk_1 FOREIGN KEY (muid) REFERENCES Users (id) ON DELETE SET NULL ON UPDATE CASCADE
);

-- table for user auth logs

CREATE TABLE IF NOT EXISTS AuthLogs (
  id int unsigned NOT NULL AUTO_INCREMENT,
  type tinyint unsigned NOT NULL,
  -- json array of parameters
  params JSON NOT NULL CHECK (JSON_TYPE(params) = 'ARRAY'),
  -- uid of user
  uid int unsigned,
  createdAt datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

  PRIMARY KEY (id),
  KEY uid (uid)
);
