/*
 * ChaosEvent
 * ----------
 * Her saat başı 30 dakika boyunca tüm canvas'larda piksel cooldown
 * neredeyse sıfırlanır (15ms) — çok fazla piksel atılabilir.
 * Süre bitince normal cooldown'a dönülür.
 *
 * - setChaosCooldowns mode absolute: canvas bcd/pcd yerine sabit düşük değer
 * - broadcastChaos: client banner + sayaç
 * - SharedState: restart sonrası restore
 * - /api/me chaosEnd: sayfa yenilemede banner geri gelir
 */

import logger from './logger.js';
import socketEvents from '../socket/socketEvents.js';
import chatProvider from './ChatProvider.js';
import { HourlyCron } from '../utils/cron.js';
import { setState, getState } from './SharedState.js';

const CHAOS_DURATION_MS = 30 * 60 * 1000; // 30 dakika
const CHAOS_PIXEL_MS = 15;                // neredeyse sınırsız boyama (~15ms/px)
const STATE_KEY = 'chaosEnd';

let chaosActive = false;
let chaosEndTs = null;
let chaosEndTimeout = null;

function clearEndTimer() {
  if (chaosEndTimeout) {
    clearTimeout(chaosEndTimeout);
    chaosEndTimeout = null;
  }
}

function broadcastChat(message) {
  try {
    if (
      socketEvents.important
      && chatProvider.enChannelId
      && chatProvider.eventUserId
    ) {
      chatProvider.broadcastChatMessage(
        'event',
        message,
        chatProvider.enChannelId,
        chatProvider.eventUserId,
      );
    }
  } catch (err) {
    logger.warn(`ChaosEvent chat broadcast failed: ${err.message}`);
  }
}

/**
 * Chaos'u bitir — cooldown sıfırla, client'lara bildir
 */
function endChaos() {
  if (!chaosActive && chaosEndTs == null) return;

  chaosActive = false;
  chaosEndTs = null;
  clearEndTimer();

  try {
    socketEvents.setChaosCooldowns({ bcd: null, pcd: null });
  } catch (err) {
    logger.warn(`ChaosEvent setChaosCooldowns(null) failed: ${err.message}`);
  }

  try {
    setState(STATE_KEY, null);
  } catch (err) {
    logger.warn(`ChaosEvent setState(null) failed: ${err.message}`);
  }

  try {
    if (typeof socketEvents.broadcastChaos === 'function') {
      socketEvents.broadcastChaos(null);
    }
  } catch (err) {
    logger.warn(`ChaosEvent broadcastChaos(null) failed: ${err.message}`);
  }

  logger.info('ChaosEvent ENDED — cooldowns restored');
  broadcastChat('🕊️ Chaos sona erdi! Cooldown normale döndü.');
}

/**
 * Chaos'u başlat — cooldown ~15ms (frenzy), 30 dk sonra bitir
 */
function startChaos() {
  if (chaosActive) {
    logger.info('ChaosEvent start ignored — already active');
    return;
  }

  chaosActive = true;
  chaosEndTs = Date.now() + CHAOS_DURATION_MS;

  try {
    socketEvents.setChaosCooldowns({
      bcd: CHAOS_PIXEL_MS,
      pcd: CHAOS_PIXEL_MS,
      mode: 'absolute',
    });
  } catch (err) {
    logger.error(`ChaosEvent setChaosCooldowns failed: ${err.message}`);
  }

  try {
    setState(STATE_KEY, chaosEndTs);
  } catch (err) {
    logger.warn(`ChaosEvent setState failed: ${err.message}`);
  }

  try {
    if (typeof socketEvents.broadcastChaos === 'function') {
      socketEvents.broadcastChaos(chaosEndTs);
    }
  } catch (err) {
    logger.warn(`ChaosEvent broadcastChaos failed: ${err.message}`);
  }

  clearEndTimer();
  chaosEndTimeout = setTimeout(endChaos, CHAOS_DURATION_MS);

  logger.info(
    `ChaosEvent STARTED — absolute ${CHAOS_PIXEL_MS}ms/px for ${CHAOS_DURATION_MS / 60000} min (ends ${new Date(chaosEndTs).toISOString()})`,
  );
  broadcastChat(
    '🔥 CHAOS ETKİNLİĞİ BAŞLADI! 30 dakika boyunca cooldown neredeyse sıfır — istediğin kadar piksel at!',
  );
}

/**
 * /api/me ve client hydrate için
 * @returns {number|null} bitiş timestamp (ms) veya null
 */
export function getChaosEndTs() {
  if (!chaosActive || !chaosEndTs) return null;
  if (Date.now() >= chaosEndTs) {
    // Süresi dolmuş ama timer henüz çalışmamış olabilir
    endChaos();
    return null;
  }
  return chaosEndTs;
}

/**
 * Sunucu açılışında çağrılır (server.js)
 */
export async function initialize() {
  // Restart sonrası SharedState'ten restore
  try {
    const saved = await getState(STATE_KEY);
    if (typeof saved === 'number' && saved > Date.now()) {
      chaosActive = true;
      chaosEndTs = saved;

      socketEvents.setChaosCooldowns({
        bcd: CHAOS_PIXEL_MS,
        pcd: CHAOS_PIXEL_MS,
        mode: 'absolute',
      });

      const remaining = saved - Date.now();
      clearEndTimer();
      chaosEndTimeout = setTimeout(endChaos, remaining);

      logger.info(
        `ChaosEvent RESTORED — ${Math.round(remaining / 60000)} min left`,
      );

      if (typeof socketEvents.broadcastChaos === 'function') {
        socketEvents.broadcastChaos(chaosEndTs);
      }
    } else if (saved) {
      // Eski / geçersiz kayıt
      await setState(STATE_KEY, null);
    }
  } catch (err) {
    logger.warn(`ChaosEvent restore failed: ${err.message}`);
  }

  // Her saat başı (sadece important shard)
  HourlyCron.hook(() => {
    if (socketEvents.important) {
      startChaos();
    }
  });

  logger.info(
    'ChaosEvent ready — hourly absolute 15ms/px frenzy for 30 minutes',
  );
}

export default {
  initialize,
  getChaosEndTs,
  // test / admin için
  startChaos,
  endChaos,
};
