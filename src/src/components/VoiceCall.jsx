/*
 * WebRTC Voice Call component for faction/channel chats
 */
import { useState, useEffect, useRef, useCallback } from 'preact/hooks';
import { memo } from 'preact/compat';
import { useSelector } from '../store/react-redux/index.js';
import socketClient from '../socket/SocketClient.js';

const ICE_SERVERS = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
  ],
};

const VoiceCall = ({ channelId, onClose }) => {
  const [peers, setPeers] = useState([]);
  const [isMuted, setIsMuted] = useState(false);
  const [status, setStatus] = useState('connecting');
  const localStreamRef = useRef(null);
  const connectionsRef = useRef(new Map());

  const myUserId = useSelector((state) => state.user.id);

  const closeConnection = useCallback((userId) => {
    const pc = connectionsRef.current.get(userId);
    if (pc) {
      if (pc._audioEl) {
        pc._audioEl.pause();
        pc._audioEl.srcObject = null;
      }
      pc.close();
      connectionsRef.current.delete(userId);
    }
  }, []);

  const createConnection = useCallback((userId, isInitiator) => {
    let pc = connectionsRef.current.get(userId);
    if (pc) return pc;

    pc = new RTCPeerConnection(ICE_SERVERS);
    connectionsRef.current.set(userId, pc);

    const stream = localStreamRef.current;
    if (stream) {
      stream.getTracks().forEach((track) => pc.addTrack(track, stream));
    }

    pc.ontrack = ({ streams }) => {
      const audio = document.createElement('audio');
      audio.srcObject = streams[0];
      audio.autoplay = true;
      audio.play().catch(() => {});
      pc._audioEl = audio;
    };

    pc.onicecandidate = ({ candidate }) => {
      if (candidate) {
        socketClient.sendVoiceSignal(channelId, 'signal', userId, { ice: candidate });
      }
    };

    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'failed' || pc.connectionState === 'disconnected') {
        closeConnection(userId);
        setPeers((prev) => prev.filter((p) => p.userId !== userId));
      }
    };

    if (isInitiator) {
      pc.createOffer()
        .then((offer) => pc.setLocalDescription(offer))
        .then(() => {
          socketClient.sendVoiceSignal(channelId, 'signal', userId, {
            sdp: pc.localDescription,
          });
        })
        .catch((err) => console.error('VoiceCall offer error:', err));
    }

    return pc;
  }, [channelId, closeConnection]);

  const handleVoiceMessage = useCallback((msg) => {
    if (msg.channelId !== channelId) return;

    switch (msg.type) {
      case 'room': {
        const roomPeers = msg.peers || [];
        setPeers(roomPeers);
        setStatus('connected');
        roomPeers.forEach(({ userId }) => {
          createConnection(userId, true);
        });
        break;
      }
      case 'joined': {
        setPeers((prev) => {
          if (prev.find((p) => p.userId === msg.userId)) return prev;
          return [...prev, { userId: msg.userId, name: msg.name }];
        });
        break;
      }
      case 'left': {
        setPeers((prev) => prev.filter((p) => p.userId !== msg.userId));
        closeConnection(msg.userId);
        break;
      }
      case 'signal': {
        const { from, data } = msg;
        if (data.sdp) {
          let pc = connectionsRef.current.get(from);
          if (!pc) {
            pc = createConnection(from, false);
          }
          pc.setRemoteDescription(new RTCSessionDescription(data.sdp))
            .then(() => {
              if (data.sdp.type === 'offer') {
                return pc.createAnswer()
                  .then((ans) => pc.setLocalDescription(ans))
                  .then(() => {
                    socketClient.sendVoiceSignal(channelId, 'signal', from, {
                      sdp: pc.localDescription,
                    });
                  });
              }
              return null;
            })
            .catch((err) => console.error('VoiceCall SDP error:', err));
        } else if (data.ice) {
          const pc = connectionsRef.current.get(from);
          if (pc) {
            pc.addIceCandidate(new RTCIceCandidate(data.ice))
              .catch((err) => console.error('VoiceCall ICE error:', err));
          }
        }
        break;
      }
      default:
        break;
    }
  }, [channelId, createConnection, closeConnection]);

  useEffect(() => {
    let active = true;

    navigator.mediaDevices.getUserMedia({ audio: true, video: false })
      .then((stream) => {
        if (!active) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        localStreamRef.current = stream;
        socketClient.sendVoiceSignal(channelId, 'join', null, null);
      })
      .catch((err) => {
        console.error('Mikrofon erişimi reddedildi:', err);
        if (active) onClose();
      });

    const removeHandler = socketClient.addVoiceHandler(handleVoiceMessage);

    return () => {
      active = false;
      removeHandler();
      socketClient.sendVoiceSignal(channelId, 'leave', null, null);
      localStreamRef.current?.getTracks().forEach((t) => t.stop());
      connectionsRef.current.forEach((pc) => {
        if (pc._audioEl) {
          pc._audioEl.pause();
          pc._audioEl.srcObject = null;
        }
        pc.close();
      });
      connectionsRef.current.clear();
    };
  }, [channelId, handleVoiceMessage, onClose]);

  const toggleMute = useCallback(() => {
    const stream = localStreamRef.current;
    if (stream) {
      stream.getAudioTracks().forEach((track) => {
        track.enabled = !track.enabled;
      });
      setIsMuted((m) => !m);
    }
  }, []);

  const peerText = peers.length === 0
    ? 'Aramada kimse yok'
    : `Aramada: ${peers.map((p) => p.name).join(', ')}`;

  return (
    <div style={{
      background: 'rgba(30,30,50,0.95)',
      borderRadius: 8,
      padding: '6px 10px',
      margin: '4px 0',
      display: 'flex',
      alignItems: 'center',
      gap: 8,
      fontSize: 12,
      color: '#eee',
      border: '1px solid #4a4a6a',
    }}>
      <span title="Sesli Arama">🎙️</span>
      <span style={{ flexGrow: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {status === 'connecting' ? 'Bağlanıyor...' : peerText}
      </span>
      <button
        type="button"
        onClick={toggleMute}
        title={isMuted ? 'Sesi Aç' : 'Sesi Kapat'}
        style={{
          background: isMuted ? '#c0392b' : '#27ae60',
          color: '#fff',
          border: 'none',
          borderRadius: 4,
          padding: '2px 7px',
          cursor: 'pointer',
          fontSize: 13,
          lineHeight: 1.4,
        }}
      >
        {isMuted ? '🔇' : '🔊'}
      </button>
      <button
        type="button"
        onClick={onClose}
        title="Aramadan Çık"
        style={{
          background: '#c0392b',
          color: '#fff',
          border: 'none',
          borderRadius: 4,
          padding: '2px 7px',
          cursor: 'pointer',
          fontSize: 13,
          lineHeight: 1.4,
        }}
      >
        ✕
      </button>
    </div>
  );
};

export default memo(VoiceCall);
