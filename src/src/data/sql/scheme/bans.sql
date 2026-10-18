-- Bans

CREATE TABLE IF NOT EXISTS Bans (
  id bigint unsigned NOT NULL AUTO_INCREMENT,
  uuid binary(16) NOT NULL,
  reason varchar(200) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci,
  flags tinyint unsigned NOT NULL DEFAULT 0,
  expires datetime,
  createdAt datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  muid int unsigned,

  PRIMARY KEY (id),
  UNIQUE KEY uuid (uuid),
  KEY muid (muid),
  CONSTRAINT Bans_ibfk_1 FOREIGN KEY (muid) REFERENCES Users (id) ON DELETE SET NULL ON UPDATE CASCADE
);

-- User-Ban Association

CREATE TABLE IF NOT EXISTS UserBans (
  bid bigint unsigned NOT NULL,
  uid int unsigned NOT NULL,

  PRIMARY KEY (bid,uid),
  KEY uid (uid),
  CONSTRAINT UserBans_ibfk_1 FOREIGN KEY (bid) REFERENCES Bans (id) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT UserBans_ibfk_2 FOREIGN KEY (uid) REFERENCES Users (id) ON DELETE CASCADE ON UPDATE CASCADE
);

-- IP-Ban Association

CREATE TABLE IF NOT EXISTS IPBans (
  bid bigint unsigned NOT NULL,
  ip varbinary(8) NOT NULL,

  PRIMARY KEY (bid,ip),
  KEY ip (ip),
  CONSTRAINT IPBans_ibfk_1 FOREIGN KEY (bid) REFERENCES Bans (id) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT IPBans_ibfk_2 FOREIGN KEY (ip) REFERENCES IPs (ip) ON DELETE CASCADE ON UPDATE CASCADE
);

-- ThreePID-Ban Association

CREATE TABLE IF NOT EXISTS ThreePIDBans (
  bid bigint unsigned NOT NULL,
  tid int unsigned NOT NULL,

  PRIMARY KEY (bid,tid),
  KEY tid (tid),
  CONSTRAINT ThreePIDBans_ibfk_1 FOREIGN KEY (bid) REFERENCES Bans (id) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT ThreePIDBans_ibfk_2 FOREIGN KEY (tid) REFERENCES ThreePIDs (id) ON DELETE CASCADE ON UPDATE CASCADE
);

-- Range Ban (unused)

CREATE TABLE IF NOT EXISTS RangeBans (
  rid int unsigned NOT NULL,
  reason tinyint unsigned NOT NULL,
  expires datetime,
  createdAt datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  muid int unsigned,

  PRIMARY KEY (rid),
  KEY muid (muid),
  CONSTRAINT RangeBans_ibfk_1 FOREIGN KEY (rid) REFERENCES Ranges (id) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT RangeBans_ibfk_2 FOREIGN KEY (muid) REFERENCES Users (id) ON DELETE SET NULL ON UPDATE CASCADE
);

-- Ban History

CREATE TABLE IF NOT EXISTS BanHistories (
  id bigint unsigned NOT NULL,
  uuid binary(16) NOT NULL,
  reason varchar(200) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci,
  flags tinyint unsigned NOT NULL DEFAULT 0,
  started datetime NOT NULL,
  ended datetime,
  liftedAt datetime,
  muid int unsigned,
  lmuid int unsigned,

  PRIMARY KEY (id),
  UNIQUE KEY uuid (uuid),
  KEY muid (muid),
  KEY lmuid (lmuid),
  CONSTRAINT BanHistories_ibfk_1 FOREIGN KEY (muid) REFERENCES Users (id) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT BanHistories_ibfk_2 FOREIGN KEY (lmuid) REFERENCES Users (id) ON DELETE SET NULL ON UPDATE CASCADE
);

-- User-Ban History Association

CREATE TABLE IF NOT EXISTS UserBanHistories (
  bid bigint unsigned NOT NULL,
  uid int unsigned NOT NULL,

  PRIMARY KEY (bid,uid),
  KEY uid (uid),
  CONSTRAINT UserBanHistories_ibfk_1 FOREIGN KEY (bid) REFERENCES BanHistories (id) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT UserBanHistories_ibfk_2 FOREIGN KEY (uid) REFERENCES Users (id) ON DELETE CASCADE ON UPDATE CASCADE
);

-- IP-Ban History Association

CREATE TABLE IF NOT EXISTS IPBanHistories (
  bid bigint unsigned NOT NULL,
  ip varbinary(8) NOT NULL,

  PRIMARY KEY (bid,ip),
  KEY ip (ip),
  CONSTRAINT IPBanHistories_ibfk_1 FOREIGN KEY (bid) REFERENCES BanHistories (id) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT IPBanHistories_ibfk_2 FOREIGN KEY (ip) REFERENCES IPs (ip) ON DELETE CASCADE ON UPDATE CASCADE
) ;

-- ThreePID Ban History Association

CREATE TABLE IF NOT EXISTS ThreePIDBanHistories (
  bid bigint unsigned NOT NULL,
  tid int unsigned NOT NULL,

  PRIMARY KEY (bid,tid),
  KEY tid (tid),
  CONSTRAINT ThreePIDBanHistories_ibfk_1 FOREIGN KEY (bid) REFERENCES BanHistories (id) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT ThreePIDBanHistories_ibfk_2 FOREIGN KEY (tid) REFERENCES ThreePIDs (id) ON DELETE CASCADE ON UPDATE CASCADE
);

-- RangeBan Histories (unused)

CREATE TABLE IF NOT EXISTS RangeBanHistories (
  id int unsigned NOT NULL AUTO_INCREMENT,
  reason tinyint(3) unsigned NOT NULL,
  started datetime NOT NULL,
  ended datetime NOT NULL,
  liftedAt datetime,
  rid int unsigned,
  muid int unsigned,
  lmuid int unsigned,

  PRIMARY KEY (id),
  KEY rid (rid),
  KEY muid (muid),
  KEY lmuid (lmuid),
  CONSTRAINT RangeBanHistories_ibfk_7 FOREIGN KEY (rid) REFERENCES Ranges (id) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT RangeBanHistories_ibfk_8 FOREIGN KEY (muid) REFERENCES Users (id) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT RangeBanHistories_ibfk_9 FOREIGN KEY (lmuid) REFERENCES Users (id) ON DELETE SET NULL ON UPDATE CASCADE
);
