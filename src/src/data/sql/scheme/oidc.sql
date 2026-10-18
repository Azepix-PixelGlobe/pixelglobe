-- Clients

CREATE TABLE IF NOT EXISTS OIDCClients (
  id int unsigned NOT NULL AUTO_INCREMENT,
  -- user who created the client
  uid int unsigned,

  name varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  uuid binary(16) NOT NULL,
  secret char(40) CHARACTER SET ascii COLLATE ascii_general_ci NOT NULL,
  -- space seperated list of uris
  redirectUris text CHARACTER SET latin1 COLLATE latin1_swedish_ci NOT NULL,
  -- max scopes that a client is allowed, user then can choose a subset
  scope varchar(255) CHARACTER SET ascii COLLATE ascii_general_ci NOT NULL DEFAULT 'openid profile email',
  -- scopes used when no scope is given
  defaultScope varchar(255) CHARACTER SET ascii COLLATE ascii_general_ci,
  -- whether we automatically grant every request, ONLY use this for own
  -- services on same domain
  autoGrant tinyint NOT NULL DEFAULT 0,
  image varchar(255) CHARACTER SET latin1 COLLATE latin1_swedish_ci,
  lastUsed datetime,

  createdAt datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,

  PRIMARY KEY (id),
  UNIQUE KEY username (name),
  UNIQUE KEY uuid (uuid),
  UNIQUE KEY secret (secret),
  KEY uid (uid),
  CONSTRAINT OIDCClients_ibfk_1 FOREIGN KEY (uid) REFERENCES Users (id) ON DELETE CASCADE ON UPDATE CASCADE
);

-- Consents

CREATE TABLE IF NOT EXISTS OIDCConsents (
  id bigint unsigned NOT NULL AUTO_INCREMENT,
  uid int unsigned NOT NULL,
  cid int unsigned NOT NULL,

  -- scope actually requested for that user (subset of scope of client)
  scope varchar(255) CHARACTER SET ascii COLLATE ascii_general_ci NOT NULL,
  -- user defined
  expires datetime,

  consentedAt datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,

  PRIMARY KEY (id),
  UNIQUE KEY uidcid (uid,cid),
  KEY cid (cid),
  CONSTRAINT OIDCConsents_ibfk_3 FOREIGN KEY (uid) REFERENCES Users (id) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT OIDCConsents_ibfk_4 FOREIGN KEY (cid) REFERENCES OIDCClients (id) ON DELETE CASCADE ON UPDATE CASCADE
);

-- Access Tokens

CREATE TABLE IF NOT EXISTS OIDCAccessTokens (
  id bigint unsigned NOT NULL AUTO_INCREMENT,
  cid bigint unsigned NOT NULL,

  token char(80) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  scope varchar(255) CHARACTER SET ascii COLLATE ascii_general_ci NOT NULL,
  expires datetime NOT NULL,

  createdAt datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,

  PRIMARY KEY (id),
  UNIQUE KEY token (token),
  KEY cid (cid),
  CONSTRAINT OIDCAccessTokens_ibfk_1 FOREIGN KEY (cid) REFERENCES OIDCConsents (id) ON DELETE CASCADE ON UPDATE CASCADE
);

-- Auth Codes

CREATE TABLE IF NOT EXISTS OIDCAuthCodes (
  id int unsigned NOT NULL AUTO_INCREMENT,
  cid bigint unsigned NOT NULL,

  code char(80) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  scope varchar(255) CHARACTER SET ascii COLLATE ascii_general_ci NOT NULL,
  nonce varchar(255) CHARACTER SET latin1 COLLATE latin1_swedish_ci,
  authAge int unsigned,
  pkceChallenge varchar(255) CHARACTER SET latin1 COLLATE latin1_swedish_ci,
  pkceMethod varchar(10) CHARACTER SET ascii COLLATE ascii_general_ci,
  expires datetime NOT NULL,

  createdAt datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,

  PRIMARY KEY (id),
  UNIQUE KEY code (code),
  KEY cid (cid),
  CONSTRAINT OIDCAuthCodes_ibfk_1 FOREIGN KEY (cid) REFERENCES OIDCConsents (id) ON DELETE CASCADE ON UPDATE CASCADE
);

-- Refresh Tokens

CREATE TABLE IF NOT EXISTS OIDCRefreshTokens (
  id bigint unsigned NOT NULL AUTO_INCREMENT,
  cid bigint unsigned NOT NULL,

  token char(80) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  scope varchar(255) CHARACTER SET ascii COLLATE ascii_general_ci NOT NULL,
  -- a month or so, gets rerolled whenever a new refresh token gets requested
  expires datetime NOT NULL,

  createdAt datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,

  PRIMARY KEY (id),
  UNIQUE KEY token (token),
  KEY cid (cid),
  CONSTRAINT OIDCRefreshTokens_ibfk_1 FOREIGN KEY (cid) REFERENCES OIDCConsents (id) ON DELETE CASCADE ON UPDATE CASCADE
);
