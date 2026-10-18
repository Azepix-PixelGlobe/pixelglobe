/*
  * play sounds using the HTML5 AudioContext
  */


// iPhone needs this
const AudioContext = window.AudioContext || window.webkitAudioContext;
const context = AudioContext && new AudioContext();

export default (store) => (next) => (action) => {
  const state = store.getState();
  const { mute, chatNotify } = state.gui;

  if (!mute && context) {
    /*
     * Browsers may suspend AudioContext while the tab is backgrounded. Resume
     * it on the next user-visible event so cooldown and placement sounds do
     * not silently disappear after a long wait.
     */
    if (context.state === 'suspended') {
      context.resume().catch(() => {});
    }
    switch (action.type) {
      case 'SELECT_COLOR': {
        const oscillatorNode = context.createOscillator();
        const gainNode = context.createGain();
        const { currentTime } = context;

        oscillatorNode.type = 'sine';
        oscillatorNode.detune.value = -600;

        oscillatorNode.frequency.setValueAtTime(600, currentTime);
        oscillatorNode.frequency.setValueAtTime(700, currentTime + 0.1);


        gainNode.gain.setValueAtTime(0.3, currentTime);
        gainNode.gain.exponentialRampToValueAtTime(
          0.2,
          currentTime + 0.1,
        );

        oscillatorNode.connect(gainNode);
        gainNode.connect(context.destination);

        oscillatorNode.start();
        oscillatorNode.stop(currentTime + 0.2);
        break;
      }

      case 'SET_NOTIFICATION': {
        const { notification } = action;
        if (typeof notification !== 'string') {
          break;
        }
        const oscillatorNode = context.createOscillator();
        const gainNode = context.createGain();
        const { currentTime } = context;

        oscillatorNode.type = 'sine';
        oscillatorNode.detune.value = -1200;

        oscillatorNode.frequency.setValueAtTime(500, currentTime);
        oscillatorNode.frequency.setValueAtTime(600, currentTime + 0.1);

        gainNode.gain.setValueAtTime(0.3, currentTime);
        gainNode.gain.exponentialRampToValueAtTime(
          0.2,
          currentTime + 0.1,
        );

        oscillatorNode.connect(gainNode);
        gainNode.connect(context.destination);

        oscillatorNode.start();
        oscillatorNode.stop(currentTime + 0.2);
        break;
      }

      case 'ALERT': {
        const oscillatorNode = context.createOscillator();
        const gainNode = context.createGain();
        const { currentTime } = context;

        if (action.alertType === 'captcha') {
          oscillatorNode.type = 'sine';
          oscillatorNode.detune.value = -600;
          oscillatorNode.start(currentTime);
          oscillatorNode.frequency.setValueAtTime(1479.98, currentTime);
          oscillatorNode.frequency.exponentialRampToValueAtTime(
            493.88,
            currentTime + 0.01,
          );
          oscillatorNode.stop(currentTime + 0.1);
          gainNode.gain.setValueAtTime(0.5, currentTime);
          gainNode.gain.setTargetAtTime(0, currentTime, 0.1);
          oscillatorNode.connect(gainNode);
          gainNode.connect(context.destination);
        } else if (action.alertType === 'info') {
          oscillatorNode.type = 'sine';
          oscillatorNode.detune.value = -500;
          oscillatorNode.start(currentTime);
          oscillatorNode.frequency.setValueAtTime(1000, currentTime);
          oscillatorNode.frequency.exponentialRampToValueAtTime(
            600,
            currentTime + 0.01,
          );
          oscillatorNode.stop(currentTime + 0.1);
          gainNode.gain.setValueAtTime(0.5, currentTime);
          gainNode.gain.setTargetAtTime(0, currentTime, 0.1);
          oscillatorNode.connect(gainNode);
          gainNode.connect(context.destination);
        } else {
          oscillatorNode.type = 'sine';
          oscillatorNode.detune.value = -900;
          oscillatorNode.start(currentTime);
          oscillatorNode.frequency.setValueAtTime(600, currentTime);
          oscillatorNode.frequency.setValueAtTime(
            1400,
            currentTime + 0.025,
          );
          oscillatorNode.frequency.setValueAtTime(
            1200,
            currentTime + 0.05,
          );
          oscillatorNode.frequency.setValueAtTime(
            900,
            currentTime + 0.075,
          );
          oscillatorNode.stop(currentTime + 0.3);
          const lfo = context.createOscillator();
          lfo.type = 'sine';
          lfo.start(currentTime);
          lfo.frequency.setValueAtTime(2.0, currentTime);
          lfo.stop(currentTime + 0.3);
          lfo.connect(gainNode);
          gainNode.gain.setValueAtTime(1.0, currentTime);
          gainNode.gain.setTargetAtTime(0, currentTime, 3);
          oscillatorNode.connect(gainNode);
          gainNode.connect(context.destination);
        }
        break;
      }

      case 'REC_SET_PXLS': {
        switch (action.retCode) {
          case 0: {
            // successfully placed pixel
            const { palette, selectedColor: color } = state.canvas;
            const colorsAmount = palette.colors.length;

            const clrFreq = 100 + Math.log(color / colorsAmount + 1) * 300;
            const oscillatorNode = context.createOscillator();
            const gainNode = context.createGain();
            const { currentTime } = context;

            oscillatorNode.type = 'sine';
            oscillatorNode.start(currentTime);
            oscillatorNode.frequency.setValueAtTime(clrFreq, currentTime);
            oscillatorNode.frequency.exponentialRampToValueAtTime(
              1400,
              currentTime + 0.2,
            );
            oscillatorNode.stop(currentTime + 0.1);
            gainNode.gain.setValueAtTime(0.5, currentTime);
            gainNode.gain.setTargetAtTime(0, currentTime, 0.1);
            oscillatorNode.connect(gainNode);
            gainNode.connect(context.destination);
            break;
          }
          case 9: {
            // pixelstack used up
            const oscillatorNode = context.createOscillator();
            const gainNode = context.createGain();
            const { currentTime } = context;

            oscillatorNode.type = 'sine';
            oscillatorNode.start(currentTime);
            oscillatorNode.frequency.setValueAtTime(1479.98, currentTime);
            oscillatorNode.frequency.exponentialRampToValueAtTime(
              493.88,
              currentTime + 0.01,
            );
            oscillatorNode.stop(currentTime + 0.1);
            gainNode.gain.setValueAtTime(0.5, currentTime);
            gainNode.gain.setTargetAtTime(0, currentTime, 0.1);
            oscillatorNode.connect(gainNode);
            gainNode.connect(context.destination);
            break;
          }
          default:
            // nothing
        }
        break;
      }

      case 'COOLDOWN_END': {
        // do not play sound if last cooldown end was <5s ago
        const { lastCoolDownEnd } = state.user;
        if (lastCoolDownEnd && lastCoolDownEnd + 5000 > Date.now()) {
          break;
        }

        const oscillatorNode = context.createOscillator();
        const gainNode = context.createGain();
        const { currentTime } = context;

        oscillatorNode.type = 'sine';
        oscillatorNode.frequency.setValueAtTime(349.23, currentTime);
        oscillatorNode.frequency.setValueAtTime(
          523.25,
          currentTime + 0.1,
        );
        oscillatorNode.frequency.setValueAtTime(
          698.46,
          currentTime + 0.2,
        );

        gainNode.gain.setValueAtTime(0.5, currentTime);
        gainNode.gain.exponentialRampToValueAtTime(
          0.2,
          currentTime + 0.15,
        );

        oscillatorNode.connect(gainNode);
        gainNode.connect(context.destination);

        oscillatorNode.start();
        oscillatorNode.stop(currentTime + 0.3);
        break;
      }

      case 's/REC_CHAT_MESSAGE': {
        if (!chatNotify || !action.notify) break;

        const oscillatorNode = context.createOscillator();
        const gainNode = context.createGain();
        const { currentTime } = context;

        oscillatorNode.type = 'sine';
        oscillatorNode.frequency.setValueAtTime(310, currentTime);
        oscillatorNode.frequency.exponentialRampToValueAtTime(
          355,
          currentTime + 0.025,
        );

        gainNode.gain.setValueAtTime(0.1, currentTime);
        gainNode.gain.exponentialRampToValueAtTime(
          0.1,
          currentTime + 0.1,
        );

        oscillatorNode.connect(gainNode);
        gainNode.connect(context.destination);

        oscillatorNode.start();
        oscillatorNode.stop(currentTime + 0.075);
        break;
      }

      case 'FISH_APPEARS': {
        // Create noise buffer (like water movement)
        const bufferSize = context.sampleRate * 0.5;
        const noiseBuffer = context.createBuffer(
          1, bufferSize, context.sampleRate,
        );
        const output = noiseBuffer.getChannelData(0);

        // Generate pink noise (more natural than white noise)
        for (let i = 0; i < bufferSize; i++) {
          output[i] = (Math.random() * 2 - 1) * (1 - (i / bufferSize)) ** 1.5;
        }

        // Create three bubbles in sequence
        for (let i = 0; i < 3; i++) {
          const time = context.currentTime + i * 0.22;

          // Noise source (water sound)
          const noise = context.createBufferSource();
          noise.buffer = noiseBuffer;

          // Tone source (bubble resonance)
          const tone = context.createOscillator();
          tone.type = 'sine';
          tone.frequency.setValueAtTime(150 + Math.random() * 30, time);
          tone.frequency.exponentialRampToValueAtTime(50, time + 0.4);

          // Create filters for watery effect
          const bandpass = context.createBiquadFilter();
          bandpass.type = 'bandpass';
          bandpass.frequency.setValueAtTime(300 + Math.random() * 200, time);
          bandpass.Q.value = 1;

          const lowpass = context.createBiquadFilter();
          lowpass.type = 'lowpass';
          lowpass.frequency.setValueAtTime(800, time);
          lowpass.frequency.exponentialRampToValueAtTime(200, time + 0.4);

          // Envelopes
          const noiseEnv = context.createGain();
          noiseEnv.gain.setValueAtTime(0, time);
          noiseEnv.gain.linearRampToValueAtTime(0.7, time + 0.05);
          noiseEnv.gain.exponentialRampToValueAtTime(0.001, time + 0.3);

          const toneEnv = context.createGain();
          toneEnv.gain.setValueAtTime(0, time);
          toneEnv.gain.linearRampToValueAtTime(0.4, time + 0.1);
          toneEnv.gain.exponentialRampToValueAtTime(0.001, time + 0.5);

          // Connect nodes
          noise.connect(bandpass).connect(lowpass).connect(noiseEnv);
          tone.connect(toneEnv);

          // Merge and control volume
          const merger = context.createGain();
          merger.gain.value = 0.4;

          noiseEnv.connect(merger);
          toneEnv.connect(merger);
          merger.connect(context.destination);

          // Start/stop
          noise.start(time);
          tone.start(time);
          noise.stop(time + 0.5);
          tone.stop(time + 0.7);
        }
        break;
      }

      default:
        // nothing
    }
  }

  return next(action);
};
