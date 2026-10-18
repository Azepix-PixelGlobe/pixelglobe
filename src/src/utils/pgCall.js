/*
 * pgCall — özel arama motoru (sesli arama, görüntülü arama, ekran paylaşımı)
 * ========================================================================
 * Ne yapar?
 *   • DM (özel sohbet) kanalında karşı tarafı arar: çalar, açılınca konuşulur.
 *   • Görüntülü arama: kamera açılır, karşı tarafın görüntüsü panelde çıkar.
 *   • Ekran paylaşımı: N tarayıcıya özel getDisplayMedia ile ekran gönderilir.
 *   • Sohbet penceresi kapansa bile arama DEVAM EDER (durum bu modülde,
 *     pencere değil). Arama yalnızca kullanıcı bitirince ya da karşı taraf
 *     kapatınca sonlanır.
 *
 * Sinyalleşme: mevcut websocket 'wr' mesajları kullanılır (yeni altyapı yok)
 *   ring    → karşı tarafa "çalıyorum" bildirimi (hedefe özel)
 *   join    → WebRTC odasına katılma
 *   signal  → SDP / ICE takası
 *   state   → mikrofon/kamera/ekran durumu
 *   reject / cancel / end → arama sonu bildirimleri
 *
 * Test edilebilirlik: tarayıcı API'leri (getUserMedia, RTCPeerConnection,
 * AudioContext) bağımlılık olarak verilebilir; varsayılanları çalışma anında
 * okunur, böylece modül node tarafında da yüklenebilir.
 */

import socketClient from '../socket/SocketClient.js';
import { api } from './utag.js';

export const CALL_STATE = {
  IDLE: 'idle',
  OUTGOING: 'outgoing',
  INCOMING: 'incoming',
  CONNECTING: 'connecting',
  ACTIVE: 'active',
  ENDED: 'ended',
};

export const CALL_KIND = {
  VOICE: 'voice',
  VIDEO: 'video',
};

export const RING_TIMEOUT = 45000;   // karşı taraf açmazsa arama düşer
export const END_LINGER = 3500;      // "arama bitti" yazısı ne kadar kalsın

export const ICE_SERVERS = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
  ],
};

function defaultMedia() {
  if (typeof navigator === 'undefined') return null;
  return navigator.mediaDevices || null;
}

function defaultRtc() {
  if (typeof window === 'undefined') return null;
  return window.RTCPeerConnection || window.webkitRTCPeerConnection || null;
}

function defaultAudioCtx() {
  if (typeof window === 'undefined') return null;
  return window.AudioContext || window.webkitAudioContext || null;
}

/**
 * DM kanalındaki karşı tarafı getirir (özel arama için uid şart).
 * @return {Promise<{uid:number, name:string, canCall:boolean}|null>}
 */
export async function resolveDmPeer(channelId, fetchImpl) {
  const doFetch = fetchImpl || (typeof fetch === 'function' ? fetch : null);
  if (!doFetch) return null;
  try {
    const response = await doFetch(
      api`/api/dmpeer?cid=${String(channelId)}`,
      { credentials: 'include' },
    );
    if (!response.ok) return null;
    const data = await response.json();
    if (!data || !data.uid) return null;
    return {
      uid: data.uid,
      name: data.name || '',
      canCall: data.canCall !== false,
      reason: data.reason || null,
    };
  } catch (error) {
    return null;
  }
}

export class CallManager {
  constructor(deps = {}) {
    this.deps = {
      socket: deps.socket || socketClient,
      media: 'media' in deps ? deps.media : undefined,
      rtc: 'rtc' in deps ? deps.rtc : undefined,
      audioCtx: 'audioCtx' in deps ? deps.audioCtx : undefined,
      fetchImpl: deps.fetchImpl,
      now: deps.now || (() => Date.now()),
      setTimeout: deps.setTimeout || ((fn, ms) => setTimeout(fn, ms)),
      clearTimeout: deps.clearTimeout || ((id) => clearTimeout(id)),
    };
    this.reset();
    this.listeners = new Set();
    this.installed = false;
  }

  /* -------------------------------------------------------------- durum */

  reset() {
    this.state = CALL_STATE.IDLE;
    this.kind = CALL_KIND.VOICE;
    this.channelId = null;
    this.peer = null;             // { uid, name }
    this.peers = [];              // { uid, name, pc, audioEl, videoStream, video, share, muted }
    this.localStream = null;
    this.screenStream = null;
    this.muted = false;
    this.videoOn = false;
    this.sharing = false;
    this.startedAt = null;
    this.endedReason = null;
    this.ringTimer = null;
    this.lingerTimer = null;
    this.ringing = null;          // çalan ses döngüsü iptali
  }

  snapshot() {
    return {
      state: this.state,
      kind: this.kind,
      channelId: this.channelId,
      peer: this.peer ? { ...this.peer } : null,
      peerCount: this.peers.length,
      remoteVideo: this.peers
        .filter((p) => p.videoStream)
        .map((p) => ({ uid: p.uid, name: p.name, stream: p.videoStream, sharing: !!p.share })),
      muted: this.muted,
      videoOn: this.videoOn,
      sharing: this.sharing,
      startedAt: this.startedAt,
      endedReason: this.endedReason,
    };
  }

  subscribe(listener) {
    this.listeners.add(listener);
    listener(this.snapshot());
    return () => this.listeners.delete(listener);
  }

  emit() {
    const snap = this.snapshot();
    this.listeners.forEach((listener) => {
      try { listener(snap); } catch (error) { /* dinleyici hatası aramayı bozmasın */ }
    });
  }

  setState(state, extra = {}) {
    this.state = state;
    Object.assign(this, extra);
    this.emit();
  }

  /* ------------------------------------------------------------ yardımcı */

  get media() {
    return (this.deps.media === undefined) ? defaultMedia() : this.deps.media;
  }

  get Rtc() {
    return (this.deps.rtc === undefined) ? defaultRtc() : this.deps.rtc;
  }

  get AudioCtx() {
    return (this.deps.audioCtx === undefined) ? defaultAudioCtx() : this.deps.audioCtx;
  }

  /** Soket 'wr' mesajlarını dinlemeye başla (bir kez). */
  install() {
    if (this.installed) return () => {};
    this.installed = true;
    const socket = this.deps.socket;
    if (!socket || typeof socket.addVoiceHandler !== 'function') return () => {};
    this.removeHandler = socket.addVoiceHandler((msg) => this.onMessage(msg));
    return this.removeHandler;
  }

  send(type, to, data) {
    const socket = this.deps.socket;
    if (!socket || typeof socket.sendVoiceSignal !== 'function' || !this.channelId) return;
    socket.sendVoiceSignal(this.channelId, type, to || null, data || null);
  }

  clearTimers() {
    if (this.ringTimer) this.deps.clearTimeout(this.ringTimer);
    if (this.lingerTimer) this.deps.clearTimeout(this.lingerTimer);
    this.ringTimer = null;
    this.lingerTimer = null;
    if (this.ringing) {
      this.ringing();
      this.ringing = null;
    }
  }

  /* -------------------------------------------------------------- ses */

  /**
   * Basit zil/çalma sesi (dosya yok, WebAudio ile üretilir).
   * @param {'ringback'|'ring'|'end'} kind
   */
  playTone(kind = 'ringback') {
    const Ctx = this.AudioCtx;
    if (!Ctx) return () => {};
    let ctx;
    try {
      ctx = new Ctx();
    } catch (error) {
      return () => {};
    }
    const patterns = {
      ringback: { freq: 420, on: 1.0, off: 2.0, gain: 0.05 },
      ring: { freq: 660, on: 0.45, off: 0.35, gain: 0.07 },
      end: { freq: 300, on: 0.18, off: 0.12, gain: 0.05 },
    };
    const cfg = patterns[kind] || patterns.ringback;
    const beep = () => {
      try {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.frequency.value = cfg.freq;
        osc.type = 'sine';
        gain.gain.value = cfg.gain;
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start();
        osc.stop(ctx.currentTime + cfg.on);
      } catch (error) { /* ses çalınamadıysa sorun değil */ }
    };
    beep();
    const id = setInterval(beep, (cfg.on + cfg.off) * 1000);
    return () => {
      clearInterval(id);
      try { ctx.close(); } catch (error) { /* zaten kapalı */ }
    };
  }

  /* ------------------------------------------------------------- kapat */

  stopStreams() {
    [this.localStream, this.screenStream].forEach((stream) => {
      if (stream && typeof stream.getTracks === 'function') {
        stream.getTracks().forEach((track) => {
          try { track.stop(); } catch (error) { /* zaten durmuş */ }
        });
      }
    });
    this.localStream = null;
    this.screenStream = null;
  }

  closePeers() {
    this.peers.forEach((p) => {
      if (p.pc) {
        try { p.pc.close(); } catch (error) { /* zaten kapalı */ }
      }
      if (p.audioEl) {
        try {
          p.audioEl.pause();
          p.audioEl.srcObject = null;
        } catch (error) { /* yut */ }
      }
    });
    this.peers = [];
  }

  /* ------------------------------------------------------------ medya */

  async getLocalStream(kind) {
    const media = this.media;
    if (!media || typeof media.getUserMedia !== 'function') {
      throw new Error('media-unsupported');
    }
    return media.getUserMedia({
      audio: true,
      video: kind === CALL_KIND.VIDEO ? { width: { ideal: 640 }, height: { ideal: 480 } } : false,
    });
  }

  /* ------------------------------------------------------- arama başlat */

  /**
   * Karşı tarafı ara.
   * @param {{channelId:number, peer:object, video?:boolean}} opts
   */
  async startCall({ channelId, peer, video = false, announce = true }) {
    if (this.state !== CALL_STATE.IDLE && this.state !== CALL_STATE.ENDED) {
      return false;
    }
    this.reset();
    this.channelId = channelId;
    this.peer = { uid: peer.uid, name: peer.name || '' };
    this.kind = video ? CALL_KIND.VIDEO : CALL_KIND.VOICE;
    this.videoOn = !!video;
    this.setState(CALL_STATE.OUTGOING);

    try {
      this.localStream = await this.getLocalStream(this.kind);
    } catch (error) {
      this.end('media-denied');
      return false;
    }

    if (this.state !== CALL_STATE.OUTGOING) {  // bu sırada iptal edildi
      this.stopStreams();
      return false;
    }

    if (announce) {
      this.send('ring', this.peer.uid, {
        video: this.kind === CALL_KIND.VIDEO,
        name: this.peerName,
      });
    }
    this.joinRoom();

    this.ringing = this.playTone('ringback');
    this.gen = (this.gen || 0) + 1;
    const gen = this.gen;
    this.ringTimer = this.deps.setTimeout(() => {
      if (this.gen === gen && this.state === CALL_STATE.OUTGOING) {
        this.end('timeout');
      }
    }, RING_TIMEOUT);
    return true;
  }

  get peerName() {
    return (this.peer && this.peer.name) || '';
  }

  joinRoom() {
    this.send('join', null, { video: this.videoOn, share: this.sharing });
  }

  /* --------------------------------------------------------- gelen arama */

  /**
   * Karşı taraf arıyor. Panel "kabul/reddet" gösterir.
   * Başka bir arama sürüyorsa meşgul yanıtı gider.
   */
  async receiveRing(msg) {
    const from = msg.from || {};
    const fromUid = from.uid || msg.fromUser;
    if (!fromUid) return false;

    if (this.state === CALL_STATE.ACTIVE || this.state === CALL_STATE.CONNECTING
      || this.state === CALL_STATE.OUTGOING) {
      this.sendToChannel(msg.channelId, 'reject', fromUid, { busy: true });
      return false;
    }

    this.install();
    this.reset();
    this.channelId = msg.channelId;
    this.peer = { uid: fromUid, name: from.name || '' };
    this.kind = (msg.data && msg.data.video) ? CALL_KIND.VIDEO : CALL_KIND.VOICE;
    this.setState(CALL_STATE.INCOMING);
    this.ringing = this.playTone('ring');
    this.ringTimer = this.deps.setTimeout(() => {
      if (this.state === CALL_STATE.INCOMING) this.end('missed');
    }, RING_TIMEOUT);
    return true;
  }

  /** Kanal bilinmeden (mesaj içindeki channelId ile) hedefli gönderim. */
  sendToChannel(channelId, type, to, data) {
    const socket = this.deps.socket;
    if (!socket || typeof socket.sendVoiceSignal !== 'function') return;
    socket.sendVoiceSignal(channelId, type, to, data || null);
  }

  /** Gelen aramayı kabul et. */
  async acceptCall() {
    if (this.state !== CALL_STATE.INCOMING) return false;
    this.clearTimers();
    this.setState(CALL_STATE.CONNECTING);
    try {
      this.localStream = await this.getLocalStream(this.kind);
    } catch (error) {
      this.end('media-denied');
      return false;
    }
    this.joinRoom();
    return true;
  }

  /** Gelen aramayı reddet. */
  rejectCall() {
    if (this.state !== CALL_STATE.INCOMING) return false;
    this.send('reject', this.peer && this.peer.uid, {});
    this.end('rejected');
    return true;
  }

  /**
   * Aramayı bitir. Sohbeti kapatmak aramayı bitirmez; bu fonksiyon yalnızca
   * kırmızı düğme / karşı tarafın kapatması / zaman aşımı ile çağrılır.
   */
  end(reason = 'ended') {
    const hadCall = this.state !== CALL_STATE.IDLE;
    const peersCopy = this.peers.map((p) => p.uid);
    this.clearTimers();
    if (hadCall) {
      if (reason === 'hangup') {
        this.send('end', this.peer && this.peer.uid, {});
        peersCopy.forEach((uid) => this.send('end', uid, {}));
      }
    }
    this.closePeers();
    this.stopStreams();
    this.muted = false;
    this.videoOn = false;
    this.sharing = false;
    this.startedAt = null;
    this.setState(CALL_STATE.ENDED, {
      endedReason: reason,
      state: CALL_STATE.ENDED,
    });
    this.gen = (this.gen || 0) + 1;
    this.lingerTimer = this.deps.setTimeout(() => {
      if (this.state === CALL_STATE.ENDED) {
        this.reset();
        this.emit();
      }
    }, END_LINGER);
    return hadCall;
  }

  /** Kullanıcının "kapat" düğmesi. */
  hangUp() {
    return this.end('hangup');
  }

  /* ------------------------------------------------------ mikrofon/kamera */

  setMuted(muted) {
    const next = muted === undefined ? !this.muted : !!muted;
    if (this.localStream && typeof this.localStream.getAudioTracks === 'function') {
      this.localStream.getAudioTracks().forEach((track) => { track.enabled = !next; });
    }
    this.muted = next;
    this.send('state', null, { muted: next });
    this.emit();
    return next;
  }

  toggleMute() {
    return this.setMuted(!this.muted);
  }

  /**
   * Kamerayı aç/kapa. Sesli aramada kamerayı sonradan açmak için: yeni video
   * izi alınır ve bağlantılara eklenir; karşı taraf görüntüyü otomatik görür.
   */
  async setVideo(on) {
    const next = on === undefined ? !this.videoOn : !!on;
    if (next === this.videoOn) return this.videoOn;
    const media = this.media;
    if (!media || typeof media.getUserMedia !== 'function') return this.videoOn;

    if (next) {
      try {
        const cam = await media.getUserMedia({ video: { width: { ideal: 640 }, height: { ideal: 480 } } });
        const track = cam.getVideoTracks()[0];
        if (!this.localStream) this.localStream = cam;
        else if (track) this.localStream.addTrack(track);
        const stream = this.localStream;
        this.peers.forEach((p) => {
          const sender = this.videoSender(p);
          if (sender) sender.replaceTrack(track);
          else p.pc.addTrack(track, stream);
        });
        this.kind = CALL_KIND.VIDEO;
        this.videoOn = true;
        this.send('state', null, { video: true });
        this.emit();
        return true;
      } catch (error) {
        return false;
      }
    }

    if (this.localStream) {
      this.localStream.getVideoTracks().forEach((track) => {
        track.stop();
        this.localStream.removeTrack(track);
        this.peers.forEach((p) => {
          const sender = this.videoSender(p);
          if (sender) sender.replaceTrack(null);
        });
      });
    }
    this.videoOn = false;
    this.send('state', null, { video: false });
    this.emit();
    return false;
  }

  toggleVideo() {
    return this.setVideo(!this.videoOn);
  }

  videoSender(peer) {
    if (!peer.pc || typeof peer.pc.getSenders !== 'function') return null;
    return peer.pc.getSenders().find((sender) => sender.track && sender.track.kind === 'video')
      || null;
  }

  /* ---------------------------------------------------- ekran paylaşımı */

  /**
   * Ekran paylaşımını başlat/bitir. Paylaşım sırasında gönderilen video izi
   * ekran görüntüsüyle değiştirilir (kamera varsa yerine geçer).
   */
  async toggleShare(turnOn) {
    const want = turnOn === undefined ? !this.sharing : !!turnOn;
    if (want) return this.startShare();
    return this.stopShare();
  }

  async startShare() {
    const media = this.media;
    if (!media || typeof media.getDisplayMedia !== 'function') return false;
    try {
      const stream = await media.getDisplayMedia({
        video: { frameRate: 15 },
        audio: false,
      });
      const track = stream.getVideoTracks()[0];
      if (!track) return false;
      this.screenStream = stream;
      /* kullanıcı tarayıcı çubuğundan "paylaşımı durdur" derse */
      track.onended = () => this.stopShare();

      this.peers.forEach((p) => {
        const sender = this.videoSender(p);
        if (sender) sender.replaceTrack(track);
        else p.pc.addTrack(track, stream);
      });
      this.sharing = true;
      this.send('state', null, { share: true });
      this.emit();
      return true;
    } catch (error) {
      return false;
    }
  }

  stopShare() {
    const stream = this.screenStream;
    this.screenStream = null;
    if (stream && typeof stream.getTracks === 'function') {
      stream.getTracks().forEach((track) => {
        try { track.stop(); } catch (error) { /* yut */ }
      });
    }
    /* kameraya geri dön */
    const camTrack = this.localStream && typeof this.localStream.getVideoTracks === 'function'
      ? this.localStream.getVideoTracks()[0]
      : null;
    this.peers.forEach((p) => {
      const sender = this.videoSender(p);
      if (sender) sender.replaceTrack(camTrack || null);
    });
    this.sharing = false;
    this.send('state', null, { share: false });
    this.emit();
    return true;
  }

  /* -------------------------------------------------- WebRTC bağlantısı */

  createConnection(uid, isInitiator, name = '') {
    /* 'joined' mesajı yalnızca isim bırakır (pc yok). SDP geldiğinde o boş
     * kayıt gerçek bağlantıya çevrilir — aksi halde teklif yanıtsız kalır. */
    let peer = this.peers.find((p) => p.uid === uid);
    if (peer && peer.pc) return peer;

    const Rtc = this.Rtc;
    if (!Rtc) return null;

    if (!peer) {
      peer = {
        uid, name, pc: null, audioEl: null, videoStream: null, video: false, share: false,
      };
      this.peers.push(peer);
    } else if (name) {
      peer.name = name;
    }
    const pc = new Rtc(ICE_SERVERS);
    peer.pc = pc;

    const stream = this.localStream;
    if (stream && typeof pc.addTrack === 'function') {
      stream.getTracks().forEach((track) => pc.addTrack(track, stream));
    }
    if (this.screenStream) {
      const screenTrack = this.screenStream.getVideoTracks()[0];
      if (screenTrack && typeof pc.addTrack === 'function') {
        const sender = this.videoSender(peer);
        if (sender) sender.replaceTrack(screenTrack);
        else pc.addTrack(screenTrack, this.screenStream);
      }
    }

    pc.ontrack = ({ streams, track }) => {
      const incoming = (streams && streams[0]) || null;
      const mediaStream = incoming || (typeof MediaStream !== 'undefined'
        ? new MediaStream([track])
        : null);
      if (!mediaStream) return;
      if (track && track.kind === 'audio') {
        this.attachAudio(peer, mediaStream);
      } else if (track && track.kind === 'video') {
        peer.videoStream = mediaStream;
        this.emit();
      }
    };

    pc.onicecandidate = ({ candidate }) => {
      if (candidate) {
        this.send('signal', uid, { ice: candidate });
      }
    };

    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'connected') {
        if (!this.startedAt) this.startedAt = this.deps.now();
        this.clearTimers();
        this.setState(CALL_STATE.ACTIVE);
      } else if (pc.connectionState === 'failed' || pc.connectionState === 'disconnected') {
        this.removePeer(uid);
        if (!this.peers.length && this.state === CALL_STATE.ACTIVE) {
          this.end('connection-lost');
        }
      }
    };

    if (isInitiator && typeof pc.createOffer === 'function') {
      pc.createOffer()
        .then((offer) => pc.setLocalDescription(offer))
        .then(() => this.send('signal', uid, { sdp: pc.localDescription }))
        .catch(() => {});
    }
    this.emit();
    return peer;
  }

  attachAudio(peer, stream) {
    if (typeof document === 'undefined') return;
    const audio = document.createElement('audio');
    audio.srcObject = stream;
    audio.autoplay = true;
    if (typeof audio.play === 'function') {
      try {
        const played = audio.play();
        if (played && typeof played.catch === 'function') played.catch(() => {});
      } catch (error) { /* otomatik oynatma engellendi */ }
    }
    peer.audioEl = audio;
  }

  removePeer(uid) {
    const index = this.peers.findIndex((p) => p.uid === uid);
    if (index === -1) return;
    const [peer] = this.peers.splice(index, 1);
    if (peer.pc) {
      try { peer.pc.close(); } catch (error) { /* yut */ }
    }
    if (peer.audioEl) {
      try {
        peer.audioEl.pause();
        peer.audioEl.srcObject = null;
      } catch (error) { /* yut */ }
    }
    this.emit();
  }

  /* -------------------------------------------------------- gelen mesaj */

  async onMessage(msg) {
    if (!msg || !msg.type) return;
    const { type } = msg;

    if (type === 'ring') {
      await this.receiveRing(msg);
      return;
    }

    if (this.channelId && msg.channelId && msg.channelId !== this.channelId) {
      /* eski/başka kanalın sinyali aramayı bozmasın */
      if (type !== 'reject' && type !== 'end') return;
    }

    switch (type) {
      case 'room': {
        const list = msg.peers || [];
        if (this.state === CALL_STATE.CONNECTING || this.state === CALL_STATE.ACTIVE) {
          this.setState(this.peers.length ? this.state : CALL_STATE.CONNECTING);
        }
        list.forEach((p) => {
          if (p.userId === this.selfUid) return;
          const peer = this.createConnection(p.userId, true, p.name);
          if (peer) {
            peer.video = !!p.video;
            peer.share = !!p.share;
          }
        });
        break;
      }
      case 'joined': {
        if (msg.userId === this.selfUid) break;
        if (!this.peers.find((p) => p.uid === msg.userId)) {
          this.peers.push({
            uid: msg.userId,
            name: msg.name,
            pc: null,
            audioEl: null,
            videoStream: null,
            video: !!msg.video,
            share: !!msg.share,
          });
        }
        this.emit();
        break;
      }
      case 'state': {
        const peer = this.peers.find((p) => p.uid === msg.from);
        if (peer && msg.data) {
          if ('video' in msg.data) peer.video = !!msg.data.video;
          if ('share' in msg.data) peer.share = !!msg.data.share;
          this.emit();
        }
        break;
      }
      case 'signal': {
        const from = msg.from;
        /* kayıt yoksa ya da henüz bağlantısı yoksa (joined mesajı) kur */
        let peer = this.peers.find((p) => p.uid === from);
        if (!peer || !peer.pc) peer = this.createConnection(from, false);
        if (!peer || !peer.pc) break;
        const { data } = msg;
        if (data && data.sdp) {
          /* sade nesne yeterli: RTCSessionDescriptionInit her tarayicida kabul */
          peer.pc.setRemoteDescription(data.sdp)
            .then(() => {
              if (data.sdp.type === 'offer') {
                return peer.pc.createAnswer()
                  .then((answer) => peer.pc.setLocalDescription(answer))
                  .then(() => this.send('signal', from, { sdp: peer.pc.localDescription }));
              }
              return null;
            })
            .catch(() => {});
        } else if (data && data.ice && peer.pc.addIceCandidate) {
          peer.pc.addIceCandidate(data.ice).catch(() => {});
        }
        break;
      }
      case 'left': {
        this.removePeer(msg.userId);
        if (!this.peers.length && (this.state === CALL_STATE.ACTIVE
          || this.state === CALL_STATE.CONNECTING)) {
          this.end('peer-left');
        }
        break;
      }
      case 'reject': {
        if (this.state === CALL_STATE.OUTGOING || this.state === CALL_STATE.CONNECTING) {
          this.end((msg.data && msg.data.busy) ? 'busy' : 'rejected');
        }
        break;
      }
      case 'cancel':
      case 'end': {
        if (this.state === CALL_STATE.INCOMING) this.end('missed');
        else if (this.state !== CALL_STATE.IDLE) this.end('peer-ended');
        break;
      }
      default:
        break;
    }
  }

  /** Aramaya katılırken kendi uid'imizi bilmemiz gerekir (oda listesi filtresi). */
  setSelfUid(uid) {
    this.selfUid = uid;
  }
}

/* Modül seviyesinde tek örnek: sohbet penceresi kapansa da yaşar. */
export const call = new CallManager();

export default call;
