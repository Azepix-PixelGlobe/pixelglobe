CREATE TABLE IF NOT EXISTS Sessions (
  id bigint unsigned NOT NULL AUTO_INCREMENT,
  uid int unsigned NOT NULL,
  ip varbinary(8),
  token char(38) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  expires datetime,
  country char(2) CHARACTER SET ascii COLLATE ascii_general_ci NOT NULL DEFAULT 'xx',
  did int unsigned,
  createdAt datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,

  PRIMARY KEY (id),
  UNIQUE KEY token (token),
  KEY uid (uid),
  KEY ip (ip),
  KEY did (did),
  CONSTRAINT Sessions_ibfk_6 FOREIGN KEY (uid) REFERENCES Users (id) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT Sessions_ibfk_7 FOREIGN KEY (ip) REFERENCES IPs (ip) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT Sessions_ibfk_8 FOREIGN KEY (did) REFERENCES Devices (id) ON DELETE SET NULL ON UPDATE CASCADE
);
