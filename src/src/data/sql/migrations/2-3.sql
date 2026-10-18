CREATE TABLE IF NOT EXISTS IPHumans (
  ip varbinary(8) NOT NULL,
  expires datetime,
  PRIMARY KEY (ip),
  INDEX iphumans_ip_expires (ip, expires)
);

CREATE TABLE IF NOT EXISTS IPTrusts (
  ip varbinary(8) NOT NULL,
  expires datetime,
  PRIMARY KEY (ip),
  INDEX iptrusts_ip_expires (ip, expires)
);

CREATE TABLE IF NOT EXISTS CaptchaSolutions (
  id char(11) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  ip varbinary(8) NOT NULL,
  solution char(4) CHARACTER SET ascii COLLATE ascii_general_ci NOT NULL,
  browserHash char(15) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  expires datetime NOT NULL,
  PRIMARY KEY (id),
  KEY ip (ip),
  CONSTRAINT CaptchaSolutions_ibfk_1 FOREIGN KEY (ip) REFERENCES IPs (ip) ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE IF NOT EXISTS ChallengeSolutions (
  solution INT,
  ip varbinary(8) NOT NULL,
  browserHash char(15) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  expires datetime NOT NULL,
  PRIMARY KEY (solution),
  KEY ip (ip),
  CONSTRAINT ChallengeSolutions_ibfk_1 FOREIGN KEY (ip) REFERENCES IPs (ip) ON DELETE CASCADE ON UPDATE CASCADE
);
