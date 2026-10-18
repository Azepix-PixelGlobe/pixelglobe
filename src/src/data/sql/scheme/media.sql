-- Media

CREATE TABLE IF NOT EXISTS Media (
  id bigint unsigned NOT NULL AUTO_INCREMENT,

  -- sha256 hash of the file
  hash binary(32) NOT NULL,
  -- short identifier for file, will be 6 chars usually, but can be more
  shortId varchar(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  extension varchar(12) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  mimeType varchar(255) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,

  -- image, audio, video, etc.
  type varchar(128) CHARACTER SET ascii COLLATE ascii_bin
    GENERATED ALWAYS AS (SUBSTR(mimeType, 1, INSTR('/',mimeType) - 1)) VIRTUAL,

  -- file size in bytes
  size int unsigned,
  -- dimensions
  width int unsigned,
  height int unsigned,
  -- average color as a 32bit RGB
  avgColor int unsigned,
  -- from lowest to highest bit:
  --   0: registeredUsersOnly (if only registered users can view it)
  --   1: allowCORS (if allowing cors)
  --   2: needsApproval
  flags tinyint unsigned NOT NULL DEFAULT 0,
  -- count active references, may or may not be used
  refCounter int unsigned NOT NULL DEFAULT 0,
  -- time to expire, NULL if infinite
  expires datetime,

  lastUpload datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,

  PRIMARY KEY (id),
  UNIQUE KEY hash (hash),
  -- shortid and extension combines into the filename, the same shortid can
  -- have multiple extensions
  UNIQUE KEY filename (shortId,extension)
);

-- Image Hashes

CREATE TABLE IF NOT EXISTS ImageHashes (
  mid bigint unsigned NOT NULL,

  -- perceptual hash 64bit integer
  pHash bigint unsigned NOT NULL,

  PRIMARY KEY (mid),
  KEY phash (pHash),
  CONSTRAINT ImageHashes_ibfk_1 FOREIGN KEY (mid) REFERENCES Media (id) ON DELETE CASCADE ON UPDATE CASCADE
);

-- Media Bans

CREATE TABLE IF NOT EXISTS MediaBans (
  id bigint unsigned NOT NULL AUTO_INCREMENT,
  muid int unsigned,
  uuid binary(16) NOT NULL,
  -- according to MEDIA_BAN_REASONS
  --   1: gore,
  --   2: csam,
  --   3: degeneracy,
  --   4: scam,
  --   5: terrorism,
  --   6: propaganda,
  --   7: doxing,
  reason tinyint unsigned NOT NULL,
  pHash bigint unsigned,
  hash binary(32),

  createdAt datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,

  PRIMARY KEY (id),
  UNIQUE KEY uuid (uuid),
  UNIQUE KEY phash (pHash),
  UNIQUE KEY hash (hash),
  KEY muid (muid),
  CONSTRAINT MediaBans_ibfk_1 FOREIGN KEY (muid) REFERENCES Users (id) ON DELETE NO ACTION ON UPDATE CASCADE
);

-- User-Media Association

CREATE TABLE IF NOT EXISTS UserMedia (
  mid bigint unsigned NOT NULL,
  uid int unsigned NOT NULL,

  PRIMARY KEY (mid,uid),
  KEY uid (uid),
  CONSTRAINT UserMedia_ibfk_1 FOREIGN KEY (mid) REFERENCES Media (id) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT UserMedia_ibfk_2 FOREIGN KEY (uid) REFERENCES Users (id) ON DELETE CASCADE ON UPDATE CASCADE
);

-- IP-Media Association

CREATE TABLE IF NOT EXISTS IPMedia (
  mid bigint unsigned NOT NULL,
  ip varbinary(8) NOT NULL,

  PRIMARY KEY (mid,ip),
  KEY ip (ip),
  CONSTRAINT IPMedia_ibfk_1 FOREIGN KEY (mid) REFERENCES Media (id) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT IPMedia_ibfk_2 FOREIGN KEY (ip) REFERENCES IPs (ip) ON DELETE CASCADE ON UPDATE CASCADE
);

-- Message Attachments

CREATE TABLE IF NOT EXISTS MessageMedia (
  mid bigint unsigned NOT NULL,
  sid bigint unsigned NOT NULL,

  PRIMARY KEY (mid,sid),
  KEY sid (sid),
  CONSTRAINT MessageMedia_ibfk_1 FOREIGN KEY (mid) REFERENCES Media (id) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT MessageMedia_ibfk_2 FOREIGN KEY (sid) REFERENCES Messages (id) ON DELETE CASCADE ON UPDATE CASCADE
);
