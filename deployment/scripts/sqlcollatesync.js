/*
 * This script fixes character sets and collates of sql tables
 */
import { createConnection } from 'mariadb';

import {
  MARIADB_HOST, MARIADB_DATABASE, MARIADB_USER, MARIADB_PW, LOG_MARIADB,
} from '../../src/src/core/config.js';

const batchConnection = await createConnection({
  host: MARIADB_HOST,
  user: MARIADB_USER,
  password: MARIADB_PW,
  database: MARIADB_DATABASE,
  logger: {
    query: console.info,
  },
});

(async () => {
  const query =  `ALTER TABLE Badges MODIFY name varchar(32) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL;
ALTER TABLE Badges MODIFY description varchar(200) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL;

ALTER TABLE Bans MODIFY reason varchar(200) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL;

ALTER TABLE BanHistories MODIFY reason varchar(200) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL;

ALTER TABLE Channels MODIFY name varchar(32) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE Configs MODIFY \`key\` varchar(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL;
ALTER TABLE Configs MODIFY value varchar(200) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin;

ALTER TABLE Devices MODIFY hash char(15) CHARACTER SET ascii COLLATE ascii_bin NOT NULL;
ALTER TABLE Devices MODIFY os varchar(20) CHARACTER SET ascii COLLATE ascii_general_ci;
ALTER TABLE Devices MODIFY browser varchar(20) CHARACTER SET ascii COLLATE ascii_general_ci;
ALTER TABLE Devices MODIFY device varchar(20) CHARACTER SET ascii COLLATE ascii_general_ci;
ALTER TABLE Devices MODIFY headerSig char(12) CHARACTER SET ascii COLLATE ascii_bin NOT NULL;

ALTER TABLE Factions DROP COLUMN IF EXISTS uuid;
ALTER TABLE Factions MODIFY name varchar(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL;
ALTER TABLE Factions MODIFY title varchar(32) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL;
ALTER TABLE Factions MODIFY description varchar(1000) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL;

ALTER TABLE FactionBans MODIFY reason varchar(200) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL;

ALTER TABLE FactionInvites MODIFY midId varchar(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL;

ALTER TABLE FactionRoles MODIFY name varchar(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL;

ALTER TABLE Media MODIFY shortId varchar(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL;
ALTER TABLE Media MODIFY extension varchar(12) CHARACTER SET ascii COLLATE ascii_bin NOT NULL;
ALTER TABLE Media MODIFY mimeType varchar(255) CHARACTER SET ascii COLLATE ascii_bin NOT NULL;
ALTER TABLE Media CHANGE \`type\` \`type\` varchar(128) CHARACTER SET ascii COLLATE ascii_bin GENERATED ALWAYS AS (substr(\`mimeType\`,1,locate('/',\`mimeType\`) - 1)) VIRTUAL;

ALTER TABLE Messages DROP COLUMN IF EXISTS flag;
ALTER TABLE Messages MODIFY message varchar(200) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL;

ALTER TABLE OIDCAccessTokens MODIFY token char(80) CHARACTER SET ascii COLLATE ascii_bin NOT NULL;
ALTER TABLE OIDCAccessTokens MODIFY scope varchar(255) CHARACTER SET ascii COLLATE ascii_general_ci NOT NULL;

ALTER TABLE OIDCAuthCodes MODIFY code char(80) CHARACTER SET ascii COLLATE ascii_bin NOT NULL;
ALTER TABLE OIDCAuthCodes MODIFY scope varchar(255) CHARACTER SET ascii COLLATE ascii_general_ci NOT NULL;
ALTER TABLE OIDCAuthCodes MODIFY nonce varchar(255) CHARACTER SET latin1 COLLATE latin1_swedish_ci;
ALTER TABLE OIDCAuthCodes MODIFY pkceChallenge varchar(255) CHARACTER SET latin1 COLLATE latin1_swedish_ci;
ALTER TABLE OIDCAuthCodes MODIFY pkceMethod varchar(10) CHARACTER SET ascii COLLATE ascii_general_ci;

ALTER TABLE OIDCClients MODIFY name varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL;
ALTER TABLE OIDCClients MODIFY secret char(40) CHARACTER SET ascii COLLATE ascii_general_ci NOT NULL;
ALTER TABLE OIDCClients MODIFY redirectUris text CHARACTER SET latin1 COLLATE latin1_swedish_ci NOT NULL;
ALTER TABLE OIDCClients MODIFY scope varchar(255) CHARACTER SET ascii COLLATE ascii_general_ci NOT NULL DEFAULT 'openid profile email';
ALTER TABLE OIDCClients MODIFY defaultScope varchar(255) CHARACTER SET ascii COLLATE ascii_general_ci;
ALTER TABLE OIDCClients MODIFY image varchar(255) CHARACTER SET latin1 COLLATE latin1_swedish_ci;

ALTER TABLE OIDCConsents MODIFY scope varchar(255) CHARACTER SET ascii COLLATE ascii_general_ci NOT NULL;

ALTER TABLE OIDCRefreshTokens MODIFY token char(80) CHARACTER SET ascii COLLATE ascii_bin NOT NULL;
ALTER TABLE OIDCRefreshTokens MODIFY scope varchar(255) CHARACTER SET ascii COLLATE ascii_general_ci NOT NULL;

ALTER TABLE Profiles MODIFY customFlag varchar(2) CHARACTER SET ascii COLLATE ascii_general_ci;

ALTER TABLE Proxies MODIFY type varchar(20) CHARACTER SET latin1 COLLATE latin1_swedish_ci;
ALTER TABLE Proxies MODIFY operator varchar(60) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
ALTER TABLE Proxies MODIFY city varchar(60) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE ProxyWhitelists MODIFY reason varchar(200) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE Ranges MODIFY country char(2) CHARACTER SET ascii COLLATE ascii_general_ci NOT NULL DEFAULT 'xx';
ALTER TABLE Ranges MODIFY org varchar(60) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
ALTER TABLE Ranges MODIFY descr varchar(60) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE Sessions MODIFY token char(38) CHARACTER SET ascii COLLATE ascii_bin NOT NULL;
ALTER TABLE Sessions MODIFY country char(2) CHARACTER SET ascii COLLATE ascii_general_ci NOT NULL DEFAULT 'xx';

ALTER TABLE ThreePIDs MODIFY tpid varchar(80) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL;
ALTER TABLE ThreePIDs CHANGE normalizedTpid normalizedTpid VARCHAR(80) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci GENERATED ALWAYS AS (CASE WHEN provider != 1 THEN NULL WHEN LOCATE(\'@\', tpid) = 0 THEN NULL ELSE LOWER(CONCAT(REPLACE(SUBSTRING_INDEX(SUBSTRING_INDEX(tpid, \'@\', 1), \'+\', 1), \'.\', \'\'),\'@\',(SUBSTRING_INDEX(tpid, \'@\', -1)))) END) STORED;

ALTER TABLE ThreePIDHistories MODIFY tpid varchar(80) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL;
ALTER TABLE ThreePIDHistories MODIFY normalizedTpid varchar(80) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE Users MODIFY username varchar(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL;
ALTER TABLE Users MODIFY name varchar(32) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL;
ALTER TABLE Users MODIFY password char(60) CHARACTER SET ascii COLLATE ascii_bin;

ALTER TABLE WhoisReferrals MODIFY host varchar(60) CHARACTER SET latin1 COLLATE latin1_swedish_ci NOT NULL;

ALTER TABLE UserBadges MODIFY note varchar(200) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
`;
  for (const q of query.split(';').map((q) => q.trim()).filter((q) => q)) {
    if (q) {
      await batchConnection.query(q);
    }
  }

  batchConnection.end();
})();
