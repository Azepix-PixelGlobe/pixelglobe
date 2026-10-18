-- Coin system, shop items, daily goals

CREATE TABLE IF NOT EXISTS UserCoins (
  uid int unsigned NOT NULL,
  coins int unsigned NOT NULL DEFAULT 0,
  PRIMARY KEY (uid),
  CONSTRAINT UserCoins_ibfk_1 FOREIGN KEY (uid) REFERENCES Users (id)
    ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE IF NOT EXISTS UserItems (
  id int unsigned NOT NULL AUTO_INCREMENT,
  uid int unsigned NOT NULL,
  itemId varchar(32) CHARACTER SET ascii NOT NULL,
  active tinyint NOT NULL DEFAULT 0,
  boughtAt datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uid_item (uid, itemId),
  KEY uid (uid),
  CONSTRAINT UserItems_ibfk_1 FOREIGN KEY (uid) REFERENCES Users (id)
    ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE IF NOT EXISTS DailyGoalProgress (
  id int unsigned NOT NULL AUTO_INCREMENT,
  uid int unsigned NOT NULL,
  goalId varchar(32) CHARACTER SET ascii NOT NULL,
  progress int unsigned NOT NULL DEFAULT 0,
  completed tinyint NOT NULL DEFAULT 0,
  rewarded tinyint NOT NULL DEFAULT 0,
  goalDate date NOT NULL DEFAULT (CURDATE()),
  PRIMARY KEY (id),
  UNIQUE KEY uid_goal_date (uid, goalId, goalDate),
  KEY uid (uid),
  CONSTRAINT DailyGoalProgress_ibfk_1 FOREIGN KEY (uid) REFERENCES Users (id)
    ON DELETE CASCADE ON UPDATE CASCADE
);
