-- Channels

CREATE TABLE IF NOT EXISTS Channels (
  id int unsigned NOT NULL AUTO_INCREMENT,
  name varchar(32) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci,
  type tinyint unsigned NOT NULL,
  lastMessage datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  createdAt datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,

  PRIMARY KEY (id)
);

-- Messages

CREATE TABLE IF NOT EXISTS Messages (
  id bigint unsigned NOT NULL AUTO_INCREMENT,
  cid int unsigned NOT NULL,
  uid int unsigned NOT NULL,
  message varchar(200) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  createdAt datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,

  PRIMARY KEY (id),
  KEY messages_cid_id_desc (cid,id DESC),
  KEY uid (uid),
  CONSTRAINT Messages_ibfk_1 FOREIGN KEY (cid) REFERENCES Channels (id) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT Messages_ibfk_2 FOREIGN KEY (uid) REFERENCES Users (id) ON DELETE CASCADE ON UPDATE CASCADE
);

-- User-Channel Association

CREATE TABLE IF NOT EXISTS UserChannels (
  uid int unsigned NOT NULL,
  cid int unsigned NOT NULL,
  muted tinyint NOT NULL DEFAULT 0,
  lastRead datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,

  PRIMARY KEY (uid,cid),
  KEY cid (cid),
  CONSTRAINT UserChannels_ibfk_1 FOREIGN KEY (uid) REFERENCES Users (id) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT UserChannels_ibfk_2 FOREIGN KEY (cid) REFERENCES Channels (id) ON DELETE CASCADE ON UPDATE CASCADE
);
