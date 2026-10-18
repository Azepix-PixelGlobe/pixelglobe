/*
 * callSignaling — özel arama (WebRTC) sinyal yardımcıları.
 * =====================================================================
 * SocketServer içindeki 'wr' (WebRTC) mesajlarının hedefleme kuralları bu
 * modülde saf fonksiyonlar olarak durur; böylece sunucu kodu kısa kalır ve
 * kurallar bağımsız test edilebilir.
 *
 * Sinyal türleri
 *   join   → odaya katıl (aynı kanaldaki herkesle bağlantı kurulur)
 *   leave  → odadan çık
 *   signal → SDP/ICE takası (yalnızca hedef oyuncuya)
 *   ring   → "seni arıyorum" bildirimi (hedef çevrimiçiyse, odada olmasa da)
 *   state  → mikrofon / kamera / ekran paylaşımı durumu (odadaki herkese)
 *   reject / cancel / end → arama bitti bildirimleri (yalnızca hedefe)
 */

/* Hedef oyuncuya (odada olmasa da) gönderilen türler */
export const TARGETED_CALL_TYPES = ['ring', 'reject', 'cancel', 'end'];

/* Odaya yayılan türler */
export const ROOM_CALL_TYPES = ['join', 'leave', 'signal', 'state'];

/** Kullanıcı mesajında verilen oda bayraklarını (kamera/ekran) normalize et. */
export function roomFlags(data) {
  const src = (data && typeof data === 'object') ? data : {};
  return {
    video: !!src.video,
    share: !!src.share,
  };
}

/** Oda listesine gönderilecek üye özeti. */
export function memberSummary(member) {
  return {
    userId: member.userId,
    name: member.name,
    video: !!member.video,
    share: !!member.share,
  };
}

/**
 * Yeni katılan oyuncuyu odadaki diğerlerine duyururken kullanılacak mesaj.
 */
export function joinedNotice(user, channelId, flags) {
  return {
    type: 'joined',
    channelId,
    userId: user.id,
    name: user.name,
    video: !!flags.video,
    share: !!flags.share,
  };
}

/**
 * Hedefli mesaj gövdesi üretir (ring / reject / cancel / end).
 * @return {object|null} gönderilecek nesne ya da null (geçersiz tür)
 */
export function targetedNotice(type, user, val) {
  if (!TARGETED_CALL_TYPES.includes(type)) return null;
  const base = {
    type,
    channelId: val.channelId,
    from: user.id,
    data: val.data || null,
  };
  if (type === 'ring') {
    return {
      ...base,
      /* arayan tarafın bilgisi panelde görünür */
      from: { uid: user.id, name: user.name },
      fromUser: user.id,
    };
  }
  return base;
}

/**
 * Hedef oyuncu kimliği: ring/reject/cancel/end mesajlarında kullanılır.
 * Bazı istemciler `to`, bazıları `uid` gönderir.
 */
export function targetUid(type, val) {
  if (!TARGETED_CALL_TYPES.includes(type)) return null;
  const raw = (val && (val.to || val.uid));
  const uid = parseInt(raw, 10);
  return Number.isNaN(uid) ? null : uid;
}

/**
 * 'state' mesajı geldiğinde odadaki gönderenin bayraklarını güncelle.
 * @return {boolean} bir şey değiştiyse true
 */
export function applyMemberState(room, ws, data) {
  if (!room || !data || typeof data !== 'object') return false;
  let changed = false;
  room.forEach((member) => {
    if (member.ws !== ws) return;
    if ('video' in data) {
      member.video = !!data.video;
      changed = true;
    }
    if ('share' in data) {
      member.share = !!data.share;
      changed = true;
    }
  });
  return changed;
}

export default {
  TARGETED_CALL_TYPES,
  ROOM_CALL_TYPES,
  roomFlags,
  memberSummary,
  joinedNotice,
  targetedNotice,
  targetUid,
  applyMemberState,
};
