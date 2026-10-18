/*
 * Coin system, shop items, and daily goal operations.
 */
import pool from './mariadb.js';
import { USERLVL } from '../../core/constants.js';

let tablesReady = false;

async function ensureCoinTables() {
  if (tablesReady) return;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS UserCoins (
      uid INT UNSIGNED NOT NULL PRIMARY KEY,
      coins INT UNSIGNED NOT NULL DEFAULT 0,
      CONSTRAINT UserCoins_ibfk_1 FOREIGN KEY (uid) REFERENCES Users (id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS UserItems (
      uid INT UNSIGNED NOT NULL,
      itemId VARCHAR(64) NOT NULL,
      active TINYINT(1) NOT NULL DEFAULT 0,
      PRIMARY KEY (uid, itemId),
      CONSTRAINT UserItems_ibfk_1 FOREIGN KEY (uid) REFERENCES Users (id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS DailyGoalProgress (
      uid INT UNSIGNED NOT NULL,
      goalId VARCHAR(64) NOT NULL,
      progress INT UNSIGNED NOT NULL DEFAULT 0,
      completed TINYINT(1) NOT NULL DEFAULT 0,
      rewarded TINYINT(1) NOT NULL DEFAULT 0,
      goalDate DATE NOT NULL,
      PRIMARY KEY (uid, goalId, goalDate),
      CONSTRAINT DailyGoalProgress_ibfk_1 FOREIGN KEY (uid) REFERENCES Users (id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
  tablesReady = true;
}

/*
 * Hardcoded shop items. Must match SHOP_ITEMS on the client.
 *
 * İki tür kozmetik var:
 *   name_effect  — sohbette ismin görünümü
 *   frame_effect — avatarının etrafındaki HAREKETLİ çerçeve (DarkNitro tarzı)
 *
 * Fiyatlar bilerek kademeli: günde çarktan ~130, görevlerden ~115 GCoin
 * kazanılıyor. Yani en ucuz çerçeve 2-3 günlük, en pahalısı ~3 haftalık
 * birikim. Ne bedava ne imkânsız.
 */
export const SHOP_ITEMS = [
  {
    id: 'rainbow_name',
    name: 'RGB Animasyonlu İsim',
    description: 'Chat\'te ismin renk değiştiren RGB animasyonla görünür.',
    price: 250,
    type: 'name_effect',
    effect: 'rainbow',
    tier: 'common',
  },

  /* ------------------------------------------------------ hareketli çerçeveler */
  {
    id: 'frame_frost',
    name: 'Buz Çerçevesi',
    description: 'Buz kristalleri döner, üstünde soğuk bir parıltı gezer.',
    price: 800,
    type: 'frame_effect',
    effect: 'frost',
    tier: 'common',
  },
  {
    id: 'frame_flame',
    name: 'Alev Çerçevesi',
    description: 'Alevler sürekli kıvılcım atar, çerçeve alev alev yanar.',
    price: 950,
    type: 'frame_effect',
    effect: 'flame',
    tier: 'common',
  },
  {
    id: 'frame_toxic',
    name: 'Zehir Çerçevesi',
    description: 'Radyoaktif yeşil baloncuklar yükselir, kenarda ışıma nabız atar.',
    price: 1300,
    type: 'frame_effect',
    effect: 'toxic',
    tier: 'rare',
  },
  {
    id: 'frame_glitch',
    name: 'Glitch Çerçevesi',
    description: 'RGB kanalları kayar, çerçeve bozulup yeniden toplanır.',
    price: 1500,
    type: 'frame_effect',
    effect: 'glitch',
    tier: 'rare',
  },
  {
    id: 'frame_neon',
    name: 'Neon Çerçevesi',
    description: 'Neon mor-mavi ışık nabız gibi atar, kenar komşuya ışık verir.',
    price: 1800,
    type: 'frame_effect',
    effect: 'neon',
    tier: 'rare',
  },
  {
    id: 'frame_storm',
    name: 'Şimşek Çerçevesi',
    description: 'Elektrik arkları atlar, arada bir çerçeve tamamen parlar.',
    price: 2400,
    type: 'frame_effect',
    effect: 'storm',
    tier: 'epic',
  },
  {
    id: 'frame_galaxy',
    name: 'Galaksi Çerçevesi',
    description: 'Yıldızlar ters yönde döner, arkasında nebula bulutu akar.',
    price: 3200,
    type: 'frame_effect',
    effect: 'galaxy',
    tier: 'epic',
  },
  {
    id: 'frame_gold',
    name: 'Şampiyon Çerçevesi',
    description: 'Altın halka döner, üstünden parlama geçer — kazanan havası.',
    price: 3800,
    type: 'frame_effect',
    effect: 'gold',
    tier: 'epic',
  },
  {
    id: 'frame_void',
    name: 'Kara Delik Çerçevesi',
    description: 'Karanlık madde döner, kenarda mor bir çekim halkası nabız atar.',
    price: 5000,
    type: 'frame_effect',
    effect: 'void',
    tier: 'legendary',
  },
  {
    id: 'frame_prisma',
    name: 'Prizma Çerçevesi',
    description: 'Tüm renk tayfı sürekli kayar; en havalı, en nadir çerçeve.',
    price: 6000,
    type: 'frame_effect',
    effect: 'prisma',
    tier: 'legendary',
  },
];

/** Çerçeve kademeleri — mağaza rozetleri ve sıralama için. */
export const FRAME_TIERS = ['common', 'rare', 'epic', 'legendary'];

/** Sadece hareketli çerçeveler (mağazadaki "Çerçeveler" sekmesi bunu kullanır). */
export const FRAME_ITEMS = SHOP_ITEMS.filter((item) => item.type === 'frame_effect');

/*
 * Hardcoded daily goals. Must match DAILY_GOALS on the client.
 */
export const DAILY_GOALS = [
  {
    id: 'pixels_5k',
    name: '5000 pixel at',
    description: 'Canvas\'a bugün 5000 pixel yerleştir.',
    target: 5000,
    reward: 80,
    unit: 'pixel',
  },
  {
    id: 'online_10m',
    name: '10 dakika sitede kal',
    description: 'Bugün 10 dakika boyunca çevrimiçi ol.',
    target: 10,
    reward: 20,
    unit: 'minute',
  },
  {
    id: 'chat_1',
    name: 'Chat\'e 1 mesaj yaz',
    description: 'Bugün chat\'e en az 1 mesaj gönder.',
    target: 1,
    reward: 15,
    unit: 'message',
  },
];

/**
 * Get coin balance of a user.
 * @param uid
 * @return coins number (admin returns null = unlimited)
 */
export async function getCoins(uid, userlvl = 0) {
  if (userlvl >= USERLVL.ADMIN) return null; // unlimited
  try {
    await ensureCoinTables();
    const [row] = await pool.query(
      'SELECT coins FROM UserCoins WHERE uid = ?',
      [uid],
    );
    return row ? row.coins : 0;
  } catch (err) {
    console.error('SQL Error on getCoins:', err.message);
    return 0;
  }
}

/**
 * Add coins to a user's balance.
 * @param uid
 * @param amount positive integer
 */
export async function addCoins(uid, amount) {
  if (!uid || amount <= 0) return false;
  try {
    await pool.query(
      `INSERT INTO UserCoins (uid, coins) VALUES (?, ?)
       ON DUPLICATE KEY UPDATE coins = coins + VALUES(coins)`,
      [uid, amount],
    );
    return true;
  } catch (err) {
    console.error('SQL Error on addCoins:', err.message);
    return false;
  }
}

/**
 * Spend coins from a user's balance.
 * @param uid
 * @param amount positive integer
 * @return {success: boolean, newBalance: number}
 */
export async function spendCoins(uid, amount) {
  if (!uid || amount <= 0) return { success: false, newBalance: 0 };
  let conn;
  try {
    conn = await pool.getConnection();
    await conn.query('START TRANSACTION');
    const [row] = await conn.query(
      'SELECT coins FROM UserCoins WHERE uid = ? FOR UPDATE',
      [uid],
    );
    const current = row ? row.coins : 0;
    if (current < amount) {
      await conn.query('ROLLBACK');
      return { success: false, newBalance: current };
    }
    const newBalance = current - amount;
    await conn.query(
      'UPDATE UserCoins SET coins = ? WHERE uid = ?',
      [newBalance, uid],
    );
    await conn.query('COMMIT');
    return { success: true, newBalance };
  } catch (err) {
    if (conn) await conn.query('ROLLBACK').catch(() => {});
    console.error('SQL Error on spendCoins:', err.message);
    return { success: false, newBalance: 0 };
  } finally {
    if (conn) conn.release();
  }
}

/**
 * Get items owned by a user.
 * @param uid
 * @return [{itemId, active}]
 */
export async function getOwnedItems(uid) {
  try {
    await ensureCoinTables();
    return await pool.query(
      'SELECT itemId, active FROM UserItems WHERE uid = ?',
      [uid],
    );
  } catch (err) {
    console.error('SQL Error on getOwnedItems:', err.message);
    return [];
  }
}

/**
 * Check if a user owns a specific item.
 */
export async function hasItem(uid, itemId) {
  try {
    const [row] = await pool.query(
      'SELECT 1 FROM UserItems WHERE uid = ? AND itemId = ?',
      [uid, itemId],
    );
    return !!row;
  } catch (err) {
    console.error('SQL Error on hasItem:', err.message);
    return false;
  }
}

/**
 * Buy an item. Spends coins unless admin.
 * @return { success, errors: [string], newBalance }
 */
export async function buyItem(uid, itemId, userlvl = 0) {
  await ensureCoinTables();
  const shopItem = SHOP_ITEMS.find((i) => i.id === itemId);
  if (!shopItem) return { success: false, errors: ['Item not found'] };

  const isAdmin = userlvl >= USERLVL.ADMIN;

  // check if already owned
  if (await hasItem(uid, itemId)) {
    return { success: false, errors: ['You already own this item'] };
  }

  let newBalance = null;
  if (!isAdmin) {
    const result = await spendCoins(uid, shopItem.price);
    if (!result.success) {
      return { success: false, errors: ['Not enough coins'] };
    }
    newBalance = result.newBalance;
  }

  try {
    await pool.query(
      'INSERT IGNORE INTO UserItems (uid, itemId, active) VALUES (?, ?, 0)',
      [uid, itemId],
    );
    return { success: true, errors: [], newBalance };
  } catch (err) {
    console.error('SQL Error on buyItem:', err.message);
    // refund coins if DB insert failed
    if (!isAdmin && newBalance !== null) {
      await addCoins(uid, shopItem.price);
    }
    return { success: false, errors: ['Server error'] };
  }
}

/**
 * Activate an item. Deactivates other items of the same type.
 * @return { success, nameEffect, frameEffect }
 */
export async function activateItem(uid, itemId) {
  const shopItem = SHOP_ITEMS.find((i) => i.id === itemId);
  if (!shopItem) return { success: false };

  const owned = await hasItem(uid, itemId);
  if (!owned) return { success: false };

  let conn;
  try {
    conn = await pool.getConnection();
    await conn.query('START TRANSACTION');

    // deactivate items of same type
    const sameTypeIds = SHOP_ITEMS
      .filter((i) => i.type === shopItem.type)
      .map((i) => i.id);
    if (sameTypeIds.length > 0) {
      await conn.query(
        `UPDATE UserItems SET active = 0
         WHERE uid = ? AND itemId IN (${sameTypeIds.map(() => '?').join(',')})`,
        [uid, ...sameTypeIds],
      );
    }

    // activate this item
    await conn.query(
      'UPDATE UserItems SET active = 1 WHERE uid = ? AND itemId = ?',
      [uid, itemId],
    );

    await conn.query('COMMIT');

    // return new effects
    const effects = await getActiveItemEffects(uid);
    return { success: true, ...effects };
  } catch (err) {
    if (conn) await conn.query('ROLLBACK').catch(() => {});
    console.error('SQL Error on activateItem:', err.message);
    return { success: false };
  } finally {
    if (conn) conn.release();
  }
}

/**
 * Deactivate a specific item.
 */
export async function deactivateItem(uid, itemId) {
  try {
    await pool.query(
      'UPDATE UserItems SET active = 0 WHERE uid = ? AND itemId = ?',
      [uid, itemId],
    );
    return { success: true, ...await getActiveItemEffects(uid) };
  } catch (err) {
    console.error('SQL Error on deactivateItem:', err.message);
    return { success: false };
  }
}

/**
 * Get the currently active effects for a user.
 * @return { nameEffect: string|null, frameEffect: string|null }
 */
export async function getActiveItemEffects(uid) {
  try {
    const rows = await pool.query(
      `SELECT ui.itemId FROM UserItems ui
       WHERE ui.uid = ? AND ui.active = 1`,
      [uid],
    );
    let nameEffect = null;
    let frameEffect = null;
    for (const { itemId } of rows) {
      const shopItem = SHOP_ITEMS.find((i) => i.id === itemId);
      if (!shopItem) continue;
      if (shopItem.type === 'name_effect') nameEffect = shopItem.effect;
      else if (shopItem.type === 'frame_effect') frameEffect = shopItem.effect;
    }
    return { nameEffect, frameEffect };
  } catch (err) {
    console.error('SQL Error on getActiveItemEffects:', err.message);
    return { nameEffect: null, frameEffect: null };
  }
}

export async function getNameStyle(uid) {
  if (!uid) return 'none';
  const effects = await getActiveItemEffects(uid);
  return effects.nameEffect || 'none';
}

/**
 * Birden fazla oyuncunun AKTİF kozmetiklerini tek sorguda çözer.
 * Sohbetteki isim renkleri ve avatar çerçeveleri buradan beslenir; yani
 * çerçeveyi HERKES görür (sohbet geçmişi + websocket yayını bu haritayı kullanır).
 *
 * @return { styles: {uid: nameEffect}, frames: {uid: frameEffect} }
 */
export async function getActiveStyles(uids) {
  const styles = {};
  const frames = {};
  const unique = [...new Set((uids || []).map(Number).filter(Boolean))];
  if (!unique.length) return { styles, frames };
  try {
    await ensureCoinTables();
    const rows = await pool.query(
      `SELECT ui.uid, ui.itemId FROM UserItems ui
       WHERE ui.uid IN (${unique.map(() => '?').join(',')})
         AND ui.active = 1`,
      unique,
    );
    for (const row of rows) {
      const item = SHOP_ITEMS.find((i) => i.id === row.itemId);
      if (!item) continue;
      if (item.type === 'name_effect') styles[row.uid] = item.effect;
      else if (item.type === 'frame_effect') frames[row.uid] = item.effect;
    }
  } catch (err) {
    console.error('SQL Error on getActiveStyles:', err.message);
  }
  return { styles, frames };
}

/** Geriye dönük uyumluluk: sadece isim efektleri. */
export async function getNameStyles(uids) {
  const { styles } = await getActiveStyles(uids);
  return styles;
}

/** Geriye dönük uyumluluk: sadece çerçeveler. */
export async function getFrameStyles(uids) {
  const { frames } = await getActiveStyles(uids);
  return frames;
}

/**
 * Get today's goal progress for a user.
 * @return [{goalId, progress, completed, rewarded}]
 */
export async function getTodayGoalProgress(uid) {
  try {
    await ensureCoinTables();
    const rows = await pool.query(
      `SELECT goalId, progress, completed, rewarded
       FROM DailyGoalProgress
       WHERE uid = ? AND goalDate = CURDATE()`,
      [uid],
    );
    // merge with DAILY_GOALS definition
    return DAILY_GOALS.map((goal) => {
      const row = rows.find((r) => r.goalId === goal.id);
      return {
        ...goal,
        progress: row ? row.progress : 0,
        completed: row ? !!row.completed : false,
        rewarded: row ? !!row.rewarded : false,
      };
    });
  } catch (err) {
    console.error('SQL Error on getTodayGoalProgress:', err.message);
    return DAILY_GOALS.map((g) => ({
      ...g, progress: 0, completed: false, rewarded: false,
    }));
  }
}

/**
 * Add pixel count to today's pixel goals.
 * @param uid
 * @param count pixels placed
 */
export async function updatePixelGoals(uid, count) {
  if (!uid || count <= 0) return;
  try {
    await ensureCoinTables();
    await pool.query(
      `INSERT INTO DailyGoalProgress (uid, goalId, progress, completed, goalDate)
       VALUES (?, 'pixels_5k', ?, 0, CURDATE())
       ON DUPLICATE KEY UPDATE
         progress = LEAST(progress + VALUES(progress), 5000),
         completed = (LEAST(progress + VALUES(progress), 5000) >= 5000)`,
      [uid, count],
    );
  } catch (err) {
    console.error('SQL Error on updatePixelGoals:', err.message);
  }
}

/**
 * Add online minutes to today's online goal.
 * @param uid
 * @param minutes minutes to add
 */
export async function addOnlineMinutes(uid, minutes) {
  if (!uid || minutes <= 0) return;
  try {
    await ensureCoinTables();
    await pool.query(
      `INSERT INTO DailyGoalProgress (uid, goalId, progress, completed, goalDate)
       VALUES (?, 'online_10m', ?, 0, CURDATE())
       ON DUPLICATE KEY UPDATE
         progress = LEAST(progress + VALUES(progress), 10),
         completed = (LEAST(progress + VALUES(progress), 10) >= 10)`,
      [uid, minutes],
    );
  } catch (err) {
    console.error('SQL Error on addOnlineMinutes:', err.message);
  }
}

/**
 * Count one chat message toward today's chat goal.
 */
export async function updateChatGoal(uid) {
  if (!uid) return;
  try {
    await ensureCoinTables();
    await pool.query(
      `INSERT INTO DailyGoalProgress (uid, goalId, progress, completed, goalDate)
       VALUES (?, 'chat_1', 1, 1, CURDATE())
       ON DUPLICATE KEY UPDATE progress = 1, completed = 1`,
      [uid],
    );
  } catch (err) {
    console.error('SQL Error on updateChatGoal:', err.message);
  }
}

/**
 * Claim a completed goal reward.
 * @return { success, errors, coinsAwarded, newBalance }
 */
export async function claimGoalReward(uid, goalId) {
  const goalDef = DAILY_GOALS.find((g) => g.id === goalId);
  if (!goalDef) return { success: false, errors: ['Goal not found'] };

  let conn;
  try {
    await ensureCoinTables();
    conn = await pool.getConnection();
    await conn.query('START TRANSACTION');

    const [row] = await conn.query(
      `SELECT progress, completed, rewarded
       FROM DailyGoalProgress
       WHERE uid = ? AND goalId = ? AND goalDate = CURDATE()
       FOR UPDATE`,
      [uid, goalId],
    );

    if (!row || !row.completed) {
      await conn.query('ROLLBACK');
      return { success: false, errors: ['Goal not completed yet'] };
    }
    if (row.rewarded) {
      await conn.query('ROLLBACK');
      return { success: false, errors: ['Reward already claimed'] };
    }

    // mark as rewarded
    await conn.query(
      `UPDATE DailyGoalProgress SET rewarded = 1
       WHERE uid = ? AND goalId = ? AND goalDate = CURDATE()`,
      [uid, goalId],
    );

    // add coins
    await conn.query(
      `INSERT INTO UserCoins (uid, coins) VALUES (?, ?)
       ON DUPLICATE KEY UPDATE coins = coins + VALUES(coins)`,
      [uid, goalDef.reward],
    );

    const [coinRow] = await conn.query(
      'SELECT coins FROM UserCoins WHERE uid = ?',
      [uid],
    );

    await conn.query('COMMIT');
    return {
      success: true,
      errors: [],
      coinsAwarded: goalDef.reward,
      newBalance: coinRow ? coinRow.coins : goalDef.reward,
    };
  } catch (err) {
    if (conn) await conn.query('ROLLBACK').catch(() => {});
    console.error('SQL Error on claimGoalReward:', err.message);
    return { success: false, errors: ['Server error'] };
  } finally {
    if (conn) conn.release();
  }
}
