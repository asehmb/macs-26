// Web Audio API sound generator for FaceTime-style ringtone and ringback tones

let audioCtx: AudioContext | null = null;
let ringInterval: number | null = null;
let activeOscillators: OscillatorNode[] = [];

function getAudioContext(): AudioContext {
  if (!audioCtx) {
    const AudioContextClass = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    audioCtx = new AudioContextClass();
  }
  if (audioCtx.state === "suspended") {
    audioCtx.resume().catch(() => undefined);
  }
  return audioCtx;
}

/**
 * Plays a pleasant Apple FaceTime-like marimba chime pattern on a loop.
 */
export function startIncomingRingtone(): void {
  stopAllSounds();

  try {
    const ctx = getAudioContext();

    const playChimeSequence = () => {
      if (!audioCtx || audioCtx.state === "closed") return;
      const now = ctx.currentTime;
      // Notes: E5, G#5, B5, E6, B5
      const notes = [
        { freq: 659.25, time: 0.0, dur: 0.18 },
        { freq: 830.61, time: 0.12, dur: 0.18 },
        { freq: 987.77, time: 0.24, dur: 0.22 },
        { freq: 1318.51, time: 0.42, dur: 0.35 },
        { freq: 987.77, time: 0.72, dur: 0.35 },
      ];

      for (const note of notes) {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();

        osc.type = "sine";
        osc.frequency.setValueAtTime(note.freq, now + note.time);

        // Soft bell envelope
        gain.gain.setValueAtTime(0, now + note.time);
        gain.gain.linearRampToValueAtTime(0.25, now + note.time + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.001, now + note.time + note.dur);

        osc.connect(gain);
        gain.connect(ctx.destination);

        osc.start(now + note.time);
        osc.stop(now + note.time + note.dur + 0.05);
        activeOscillators.push(osc);
      }
    };

    playChimeSequence();
    ringInterval = window.setInterval(playChimeSequence, 2400);
  } catch {
    // Audio autoplay might be blocked until user interacts
  }
}

/**
 * Plays standard phone ringback tone ("ringing...") for outgoing calls.
 */
export function startRingbackTone(): void {
  stopAllSounds();

  try {
    const ctx = getAudioContext();

    const playRingbackBurst = () => {
      if (!audioCtx || audioCtx.state === "closed") return;
      const now = ctx.currentTime;

      // 440 Hz + 480 Hz US standard ringback frequencies
      const freqs = [440, 480];
      for (const freq of freqs) {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();

        osc.type = "sine";
        osc.frequency.setValueAtTime(freq, now);

        gain.gain.setValueAtTime(0.08, now);
        gain.gain.setValueAtTime(0.08, now + 1.6);
        gain.gain.linearRampToValueAtTime(0.001, now + 1.8);

        osc.connect(gain);
        gain.connect(ctx.destination);

        osc.start(now);
        osc.stop(now + 1.85);
        activeOscillators.push(osc);
      }
    };

    playRingbackBurst();
    ringInterval = window.setInterval(playRingbackBurst, 4000);
  } catch {
    // Autoplay restrictions
  }
}

/**
 * Stops all active sounds and intervals.
 */
export function stopAllSounds(): void {
  if (ringInterval !== null) {
    window.clearInterval(ringInterval);
    ringInterval = null;
  }
  for (const osc of activeOscillators) {
    try {
      osc.stop();
      osc.disconnect();
    } catch {
      // Ignored
    }
  }
  activeOscillators = [];
  // A running context keeps iOS's audio session in playback mode, which interferes with starting the camera and
  // mic for the call. Suspend rather than close so the context stays unlocked for the next ring.
  if (audioCtx?.state === "running") audioCtx.suspend().catch(() => undefined);
}
