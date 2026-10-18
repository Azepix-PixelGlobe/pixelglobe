/*
 * search api
 */
import { searchFaction } from '../../data/sql/Faction.js';
import { searchUser } from '../../data/sql/User.js';

/*
 * LIKE joker karakterlerini etkisiz hale getirir: saldırgan "%a%" yerine
 * "%%%%" gönderip tüm tabloyu tarayamaz.
 */
function escapeLike(value) {
  return value.replace(/[\\%_]/g, (m) => `\\${m}`);
}

export default async function search(req, res) {
  /*
   * GÜVENLİK: arama ucu oturum GEREKTİRMEZ (giriş öncesi bağlanır), o yüzden
   * hem maliyeti yüksek tutulur (dakikada ~60 arama) hem de terim kısaltılır.
   */
  req.tickRateLimiter(10000);
  const { body: { type, term } } = req;

  if (typeof term === 'string' && (term.length < 2 || term.length > 48)) {
    throw new Error('Search term must be 2-48 characters long');
  }

  if (!term || typeof term !== 'string') {
    throw new Error('No search term given');
  }
  if (!type || typeof type !== 'string') {
    throw new Error('No search type given');
  }

  /* joker karakterleri etkisiz hale getirilmis guvenli terim */
  const cleanTerm = escapeLike(term);

  let columnIds;
  let types;
  let uniqueColumnKey;
  const rows = [];
  switch (type) {
    case 'factions': {
      columnIds = ['avatar', 'title', 'description', 'ispublic', 'members'];
      types = ['mediaId', 'faction', 'string', 'bool', 'number'];
      uniqueColumnKey = 1;
      const factionResults = await searchFaction(cleanTerm);
      for (let i = 0; i < factionResults.length; i += 1) {
        const {
          name, title, description, isPublic, memberCount, avatarId,
        } = factionResults[i];
        rows.push([
          avatarId, `${title},${name}`, description, isPublic, memberCount,
        ]);
      }
      break;
    }
    case 'users': {
      columnIds = ['avatar', 'name', 'role', 'joined'];
      types = ['mediaId', 'user', 'flagId', 'ts'];
      uniqueColumnKey = 1;
      const userResults = await searchUser(cleanTerm);
      for (let i = 0; i < userResults.length; i += 1) {
        const {
          name, username, customFlagId, ts, avatarId,
        } = userResults[i];
        rows.push([
          avatarId, `${name},${username}`, customFlagId, ts,
        ]);
      }
      break;
    }
    default:
      throw new Error('Unknown search type');
  }

  res.json({
    columnIds,
    types,
    rows,
    uniqueColumnKey,
  });
}
