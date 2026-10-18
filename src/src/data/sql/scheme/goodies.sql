
-- Badges

CREATE TABLE IF NOT EXISTS Badges (
  id int unsigned NOT NULL AUTO_INCREMENT,
  name varchar(32) NOT NULL,
  description varchar(200) NOT NULL,

  PRIMARY KEY (id),
  UNIQUE KEY name (name)
) DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- UserBadge Association

CREATE TABLE IF NOT EXISTS UserBadges (
  id int unsigned NOT NULL AUTO_INCREMENT,
  bid int unsigned,
  uid int unsigned,
  note varchar(200) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci,
  createdAt datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,

  PRIMARY KEY (id),
  UNIQUE KEY UserBadges_uid_bid_unique (bid,uid),
  KEY uid (uid),
  CONSTRAINT UserBadges_ibfk_3 FOREIGN KEY (bid) REFERENCES Badges (id) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT UserBadges_ibfk_4 FOREIGN KEY (uid) REFERENCES Users (id) ON DELETE CASCADE ON UPDATE CASCADE
);

-- Fishes

CREATE TABLE IF NOT EXISTS Fishes (
  id int unsigned NOT NULL AUTO_INCREMENT,
  uid int unsigned NOT NULL,
  type tinyint unsigned NOT NULL,
  size float NOT NULL,
  createdAt datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,

  PRIMARY KEY (id),
  KEY uid (uid),
  CONSTRAINT Fishes_ibfk_1 FOREIGN KEY (uid) REFERENCES Users (id) ON DELETE CASCADE ON UPDATE CASCADE
);
