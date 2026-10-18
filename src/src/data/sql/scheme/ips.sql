-- IP ranges

CREATE TABLE IF NOT EXISTS Ranges (
  id int unsigned NOT NULL AUTO_INCREMENT,
  `min` varbinary(8) NOT NULL,
  `max` varbinary(8) NOT NULL,
  mask tinyint unsigned NOT NULL,
  country char(2) CHARACTER SET ascii COLLATE ascii_general_ci NOT NULL DEFAULT 'xx',
  org varchar(60) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci,
  descr varchar(60) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci,
  asn int unsigned,
  expires datetime NOT NULL,

  PRIMARY KEY (id),
  UNIQUE KEY `min` (`min`),
  UNIQUE KEY `max` (`max`)
);

-- IP

CREATE TABLE IF NOT EXISTS IPs (
  ip varbinary(8) NOT NULL,
  uuid binary(16) NOT NULL,
  lastSeen datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  rid int unsigned,

  PRIMARY KEY (ip),
  UNIQUE KEY uuid (uuid),
  KEY rid (rid),
  CONSTRAINT IPs_ibfk_1 FOREIGN KEY (rid) REFERENCES Ranges (id) ON DELETE SET NULL ON UPDATE CASCADE
);

-- Whois server cache

CREATE TABLE IF NOT EXISTS WhoisReferrals (
  id int unsigned NOT NULL AUTO_INCREMENT,
  `min` varbinary(8) NOT NULL,
  `max` varbinary(8) NOT NULL,
  mask tinyint unsigned NOT NULL,
  host varchar(60) CHARACTER SET latin1 COLLATE latin1_swedish_ci NOT NULL,
  expires datetime NOT NULL,

  PRIMARY KEY (id),
  UNIQUE KEY `min` (`min`),
  UNIQUE KEY `max` (`max`)
);

-- Proxies

CREATE TABLE IF NOT EXISTS Proxies (
  ip varbinary(8) NOT NULL,

  isProxy tinyint unsigned NOT NULL,
  -- type of proxy: VPN, SOCKS,... or not proxy: Residential, Wireless,...
  type varchar(20) CHARACTER SET latin1 COLLATE latin1_swedish_ci,
  -- operator of VPN if available
  operator varchar(60) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci,
  -- city of ip
  city varchar(60) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci,
  risk tinyint unsigned,
  confidence tinyint unsigned,
  -- how many devices were seen using this ip
  devices int unsigned NOT NULL DEFAULT 1,
  -- how many devices were seen using the same subnet of this ip
  subnetDevices int unsigned NOT NULL DEFAULT 1,
  -- when proxycheck expires
  expires datetime NOT NULL,
  -- howmany times we got the same result in a row, used to decide expiration
  repetition int unsigned NOT NULL DEFAULT 0,

  PRIMARY KEY (ip),
  CONSTRAINT Proxies_ibfk_1 FOREIGN KEY (ip) REFERENCES IPs (ip) ON DELETE CASCADE ON UPDATE CASCADE
);

-- Whitelist for Proxies

CREATE TABLE IF NOT EXISTS ProxyWhitelists (
  ip varbinary(8) NOT NULL,
  reason varchar(200) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci,
  createdAt datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  muid int unsigned,

  PRIMARY KEY (ip),
  KEY muid (muid),
  CONSTRAINT ProxyWhitelists_ibfk_1 FOREIGN KEY (ip) REFERENCES IPs (ip) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT ProxyWhitelists_ibfk_2 FOREIGN KEY (muid) REFERENCES Users (id) ON DELETE SET NULL ON UPDATE CASCADE
);

-- Devices

CREATE TABLE IF NOT EXISTS Devices (
  id int unsigned NOT NULL AUTO_INCREMENT,
  hash char(15) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  os varchar(20) CHARACTER SET ascii COLLATE ascii_general_ci,
  browser varchar(20) CHARACTER SET ascii COLLATE ascii_general_ci,
  device varchar(20) CHARACTER SET ascii COLLATE ascii_general_ci,
  headerSig char(12) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  lastSeen datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,

  PRIMARY KEY (id),
  UNIQUE KEY hash (hash)
);
