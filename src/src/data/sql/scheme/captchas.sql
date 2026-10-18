-- Captcha status

CREATE TABLE IF NOT EXISTS IPHumans (
  ip varbinary(8) NOT NULL,
  expires datetime,

  PRIMARY KEY (ip),
  INDEX iphumans_ip_expires (ip, expires)
);

-- JS Challenge status

CREATE TABLE IF NOT EXISTS IPTrusts (
  ip varbinary(8) NOT NULL,
  expires datetime,

  PRIMARY KEY (ip),
  INDEX iptrusts_ip_expires (ip, expires)
);

-- temporary captcha solution storage

CREATE TABLE IF NOT EXISTS CaptchaSolutions (
  -- id is given to the client together with the captcha
  id char(11) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  ip varbinary(8) NOT NULL,

  -- 4 character captcha solution
  solution char(4) CHARACTER SET ascii COLLATE ascii_general_ci NOT NULL,
  -- hash that should temporarily match for a specific browser
  browserHash char(15) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  -- when it expires, usually only a few minutes
  expires datetime NOT NULL,

  PRIMARY KEY (id)
);

-- temporary js challenge solution storage

CREATE TABLE IF NOT EXISTS ChallengeSolutions (
  --  the solution of the challenge as signed 32bit integer
  solution INT,
  ip varbinary(8) NOT NULL,

  -- hash that should temporarily match for a specific browser
  browserHash char(15) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  -- when it expires, usually only a few minutes
  expires datetime NOT NULL,

  PRIMARY KEY (solution)
);
