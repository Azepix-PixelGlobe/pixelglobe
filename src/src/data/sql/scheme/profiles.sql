-- Profiles

CREATE TABLE IF NOT EXISTS Profiles (
  uid int unsigned NOT NULL,
  avatar bigint unsigned,
  -- custom flag set by user, as country code
  customFlag varchar(2) CHARACTER SET ascii COLLATE ascii_general_ci,
  -- id of active faction role
  -- have to manually ensure on changes that this role is from a faction the
  -- user is actually a member of.
  -- If this role has a flag set, use that instead of ours.
  activeRole bigint unsigned,

  PRIMARY KEY (uid),
  KEY activeRole (activeRole),
  KEY avatar (avatar),
  CONSTRAINT Profiles_ibfk_1 FOREIGN KEY (uid) REFERENCES Users (id) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT Profiles_ibfk_2 FOREIGN KEY (activeRole) REFERENCES FactionRoles (id) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT Profiles_ibfk_3 FOREIGN KEY (avatar) REFERENCES Media (id) ON DELETE SET NULL ON UPDATE CASCADE
);
