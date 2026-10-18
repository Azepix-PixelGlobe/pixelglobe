-- Factions

CREATE TABLE IF NOT EXISTS Factions (
  id bigint unsigned NOT NULL AUTO_INCREMENT,
  cid int unsigned,
  avatar bigint unsigned,

  name varchar(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  title varchar(32) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  description varchar(1000) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  flags tinyint unsigned NOT NULL DEFAULT 0,
  memberCount int unsigned NOT NULL DEFAULT 0,

  createdAt datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,

  PRIMARY KEY (id),
  UNIQUE KEY name (name),
  KEY cid (cid),
  KEY avatar (avatar),
  KEY faction_title (title),
  CONSTRAINT Factions_ibfk_1 FOREIGN KEY (cid) REFERENCES Channels (id) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT Factions_ibfk_2 FOREIGN KEY (avatar) REFERENCES Media (id) ON DELETE SET NULL ON UPDATE CASCADE
);

-- Faction Roles

CREATE TABLE IF NOT EXISTS FactionRoles (
  id bigint unsigned NOT NULL AUTO_INCREMENT,
  fid bigint unsigned NOT NULL,
  -- if null, users with this role active will show geo or their own flag
  customFlag bigint unsigned,

  uuid binary(16) NOT NULL,
  name varchar(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  -- from lowest to highest bit:
  --   0: protected, ca not delete
  --   1: assign to new members per default
  flags tinyint unsigned NOT NULL DEFAULT 0,
  factionlvl tinyint(4) NOT NULL DEFAULT 0,
  memberCount int unsigned NOT NULL DEFAULT 0,

  PRIMARY KEY (id),
  UNIQUE KEY uuid (uuid),
  KEY customFlag (customFlag),
  KEY role_fid (fid),
  CONSTRAINT FactionRoles_ibfk_1 FOREIGN KEY (fid) REFERENCES Factions (id) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT FactionRoles_ibfk_2 FOREIGN KEY (customFlag) REFERENCES Media (id) ON DELETE SET NULL ON UPDATE CASCADE
);

-- Faction Invites

CREATE TABLE IF NOT EXISTS FactionInvites (
  id bigint unsigned NOT NULL AUTO_INCREMENT,
  fid bigint unsigned NOT NULL,

  -- short identifier for invate, will be 10 chars usually
  midId varchar(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  -- from lowest to highst bit:
  --   0: is one-time-invite
  flags tinyint unsigned NOT NULL DEFAULT 0,
  -- time to expire, NULL if infinite
  expires datetime,
  -- how many times invite got used
  used int unsigned DEFAULT 0,

  createdAt datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,

  PRIMARY KEY (id),
  UNIQUE KEY midId (midId),
  KEY fid (fid),
  CONSTRAINT FactionInvites_ibfk_1 FOREIGN KEY (fid) REFERENCES Factions (id) ON DELETE CASCADE ON UPDATE CASCADE
);

-- Faction Bans

CREATE TABLE IF NOT EXISTS FactionBans (
  id bigint unsigned NOT NULL AUTO_INCREMENT,
  fid bigint unsigned NOT NULL,
  reason varchar(200) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  expires datetime,
  uuid binary(16) NOT NULL,
  muid int unsigned,

  createdAt datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,

  PRIMARY KEY (id),
  KEY ban_fid (fid),
  KEY FactionBans_muid_foreign_idx (muid),
  CONSTRAINT FactionBans_ibfk_1 FOREIGN KEY (fid) REFERENCES Factions (id) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT FactionBans_muid_foreign_idx FOREIGN KEY (muid) REFERENCES Users (id) ON DELETE SET NULL ON UPDATE CASCADE
);

-- User-Faction Association

CREATE TABLE IF NOT EXISTS UserFactions (
  flags tinyint unsigned NOT NULL DEFAULT 0,
  joined datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  fid bigint unsigned NOT NULL,
  uid int unsigned NOT NULL,

  PRIMARY KEY (fid,uid),
  KEY uid (uid),
  CONSTRAINT UserFactions_ibfk_1 FOREIGN KEY (fid) REFERENCES Factions (id) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT UserFactions_ibfk_2 FOREIGN KEY (uid) REFERENCES Users (id) ON DELETE CASCADE ON UPDATE CASCADE
);

-- User-FactionRole Association

CREATE TABLE IF NOT EXISTS UserFactionRoles (
  frid bigint unsigned NOT NULL,
  uid int unsigned NOT NULL,

  PRIMARY KEY (frid,uid),
  KEY uid (uid),
  CONSTRAINT UserFactionRoles_ibfk_1 FOREIGN KEY (frid) REFERENCES FactionRoles (id) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT UserFactionRoles_ibfk_2 FOREIGN KEY (uid) REFERENCES Users (id) ON DELETE CASCADE ON UPDATE CASCADE
);

-- User-FactionBan Association

CREATE TABLE IF NOT EXISTS UserFactionBans (
  bid bigint unsigned NOT NULL,
  uid int unsigned NOT NULL,

  PRIMARY KEY (bid,uid),
  KEY uid (uid),
  CONSTRAINT UserFactionBans_ibfk_1 FOREIGN KEY (bid) REFERENCES FactionBans (id) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT UserFactionBans_ibfk_2 FOREIGN KEY (uid) REFERENCES Users (id) ON DELETE CASCADE ON UPDATE CASCADE
);

-- IP-FactionBans Association

CREATE TABLE IF NOT EXISTS IPFactionBans (
  bid bigint unsigned NOT NULL,
  ip varbinary(8) NOT NULL,

  PRIMARY KEY (bid,ip),
  KEY ip (ip),
  CONSTRAINT IPFactionBans_ibfk_1 FOREIGN KEY (bid) REFERENCES FactionBans (id) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT IPFactionBans_ibfk_2 FOREIGN KEY (ip) REFERENCES IPs (ip) ON DELETE CASCADE ON UPDATE CASCADE
);
