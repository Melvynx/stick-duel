// Tiny WebAudio synth: every sound is generated at runtime, no audio files.

import { EXTRA } from './audio-tools.js';

const LOOP_FREQ = [700, 2600, 1300];
const LIMIT_MS = { place: 50, crumble: 90, impact: 40, shot1: 30, hit: 30, land: 80, debris: 60 };

export class Sfx {
  constructor() {
    this.ctx = null;
    this.muted = readMuted();
    this.last = new Map();
    this.loops = [];
    this.earX = 800;
  }

  unlock() {
    if (!this.ctx) {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return;
      const c = new Ctx();
      this.ctx = c;
      this.comp = c.createDynamicsCompressor();
      this.comp.threshold.value = -14;
      this.comp.ratio.value = 6;
      this.master = c.createGain();
      this.master.gain.value = this.muted ? 0 : 0.55;
      this.master.connect(this.comp).connect(c.destination);
      const len = c.sampleRate;
      this.noiseBuf = c.createBuffer(1, len, c.sampleRate);
      const d = this.noiseBuf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      this.loops = [this.makeLoops(), this.makeLoops()];
    }
    if (this.ctx.state === 'suspended') this.ctx.resume();
  }

  setMuted(m) {
    this.muted = m;
    try {
      localStorage.setItem('sd-muted', m ? '1' : '0');
    } catch {}
    if (this.master) this.master.gain.setTargetAtTime(m ? 0 : 0.55, this.ctx.currentTime, 0.02);
  }

  // Pan and loudness relative to the centre of the camera (world px).
  panFor(x) {
    if (x === undefined) return 0;
    return Math.max(-1, Math.min(1, (x - this.earX) / 800)) * 0.6;
  }

  falloff(x) {
    if (x === undefined) return 1;
    const d = Math.abs(x - this.earX);
    return d < 1000 ? 1 : Math.max(0.25, 1 - (d - 1000) / 1400);
  }

  out(pan) {
    const c = this.ctx;
    const g = c.createGain();
    if (pan) {
      const p = c.createStereoPanner();
      p.pan.value = pan;
      g.connect(p).connect(this.master);
    } else {
      g.connect(this.master);
    }
    return g;
  }

  env(g, t, peak, attack, decay) {
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
  }

  noise({ f0 = 1000, f1 = f0, q = 1, type = 'bandpass', gain = 0.4, attack = 0.002, decay = 0.1, pan = 0, delay = 0 }) {
    const c = this.ctx;
    const t = c.currentTime + delay;
    const src = c.createBufferSource();
    src.buffer = this.noiseBuf;
    const f = c.createBiquadFilter();
    f.type = type;
    f.Q.value = q;
    f.frequency.setValueAtTime(f0, t);
    f.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + attack + decay);
    const g = this.out(pan);
    this.env(g, t, gain, attack, decay);
    src.connect(f).connect(g);
    src.start(t, Math.random() * 0.4);
    src.stop(t + attack + decay + 0.05);
  }

  tone({ type = 'sine', f0 = 440, f1 = f0, gain = 0.2, attack = 0.004, decay = 0.1, pan = 0, delay = 0 }) {
    const c = this.ctx;
    const t = c.currentTime + delay;
    const o = c.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + attack + decay);
    const g = this.out(pan);
    this.env(g, t, gain, attack, decay);
    o.connect(g);
    o.start(t);
    o.stop(t + attack + decay + 0.05);
  }

  play(name, x, scale = 1) {
    if (!this.ctx || this.muted || this.ctx.state !== 'running') return;
    const lim = LIMIT_MS[name];
    if (lim) {
      const now = performance.now();
      if (now - (this.last.get(name) || 0) < lim) return;
      this.last.set(name, now);
    }
    const pan = this.panFor(x);
    const s = scale * this.falloff(x);
    switch (name) {
      case 'shot0':
        this.noise({ f0: 2600, f1: 700, q: 0.8, gain: 0.5 * s, decay: 0.09, pan });
        this.tone({ type: 'square', f0: 240, f1: 70, gain: 0.18 * s, decay: 0.07, pan });
        break;
      case 'shot1':
        this.noise({ f0: 3200, f1: 1200, q: 0.9, gain: 0.32 * s, decay: 0.05, pan });
        this.tone({ type: 'square', f0: 300, f1: 110, gain: 0.1 * s, decay: 0.04, pan });
        break;
      case 'shot2':
        this.noise({ f0: 3500, f1: 250, type: 'lowpass', q: 0.7, gain: 0.85 * s, decay: 0.32, pan });
        this.tone({ type: 'sine', f0: 130, f1: 38, gain: 0.6 * s, decay: 0.22, pan });
        this.noise({ f0: 1800, f1: 1800, q: 4, gain: 0.12 * s, decay: 0.05, pan, delay: 0.26 });
        break;
      case 'shot3':
        this.noise({ f0: 700, f1: 2600, q: 1.2, gain: 0.45 * s, decay: 0.32, pan });
        this.tone({ type: 'sawtooth', f0: 95, f1: 50, gain: 0.16 * s, decay: 0.22, pan });
        break;
      case 'shot4':
        this.tone({ type: 'sawtooth', f0: 2600, f1: 110, gain: 0.22 * s, decay: 0.42, pan });
        this.tone({ type: 'sine', f0: 90, f1: 40, gain: 0.5 * s, decay: 0.3, pan });
        this.noise({ f0: 5000, f1: 2000, type: 'highpass', gain: 0.25 * s, decay: 0.2, pan });
        break;
      case 'shot6':
        this.tone({ type: 'square', f0: 170, f1: 40, gain: 0.35 * s, decay: 0.36, pan });
        this.noise({ f0: 1600, f1: 200, type: 'lowpass', gain: 0.6 * s, decay: 0.4, pan });
        break;
      case 'boom': {
        this.noise({ f0: 1400, f1: 55, type: 'lowpass', q: 0.8, gain: 0.95 * s, attack: 0.004, decay: 0.95, pan });
        this.tone({ type: 'sine', f0: 95, f1: 28, gain: 0.85 * s, decay: 0.6, pan });
        this.noise({ f0: 4000, f1: 900, q: 0.6, gain: 0.25 * s, decay: 0.12, pan });
        break;
      }
      case 'pop':
        this.noise({ f0: 1800, f1: 400, q: 1, gain: 0.3, decay: 0.12, pan });
        this.tone({ type: 'triangle', f0: 600, f1: 1200, gain: 0.08, decay: 0.12, pan });
        break;
      case 'nade':
        this.noise({ f0: 900, f1: 2200, q: 2, gain: 0.16, decay: 0.12, pan });
        this.tone({ type: 'square', f0: 1400, f1: 1400, gain: 0.04, decay: 0.02, pan, delay: 0.02 });
        break;
      case 'impact':
        this.noise({ f0: 3200, f1: 1500, q: 1.5, gain: 0.07, decay: 0.035, pan });
        break;
      case 'shield':
        this.tone({ type: 'sine', f0: 1900, f1: 2400, gain: 0.08, decay: 0.08, pan });
        break;
      case 'hit':
        this.tone({ type: 'square', f0: 1350, f1: 1350, gain: 0.08, decay: 0.045 });
        this.tone({ type: 'square', f0: 2000, f1: 2000, gain: 0.05, decay: 0.03, delay: 0.03 });
        break;
      case 'hurt':
        this.tone({ type: 'square', f0: 230, f1: 90, gain: 0.16, decay: 0.12 });
        this.noise({ f0: 900, f1: 300, q: 0.7, gain: 0.2, decay: 0.09 });
        break;
      case 'kill':
        this.tone({ type: 'triangle', f0: 660, f1: 660, gain: 0.16, decay: 0.08 });
        this.tone({ type: 'triangle', f0: 990, f1: 990, gain: 0.16, decay: 0.1, delay: 0.08 });
        this.tone({ type: 'triangle', f0: 1320, f1: 1320, gain: 0.16, decay: 0.18, delay: 0.16 });
        break;
      case 'die':
        this.tone({ type: 'sawtooth', f0: 420, f1: 55, gain: 0.22, decay: 0.55, pan });
        this.noise({ f0: 1200, f1: 120, type: 'lowpass', gain: 0.4, decay: 0.3, pan });
        break;
      case 'jump':
        this.tone({ type: 'sine', f0: 260, f1: 520, gain: 0.07, decay: 0.08, pan });
        break;
      case 'flip':
        this.tone({ type: 'triangle', f0: 380, f1: 950, gain: 0.07, decay: 0.13, pan });
        break;
      case 'land':
        this.noise({ f0: 700, f1: 120, type: 'lowpass', gain: 0.22, decay: 0.07, pan });
        break;
      case 'switch':
        this.tone({ type: 'square', f0: 900, f1: 700, gain: 0.04, decay: 0.03 });
        this.noise({ f0: 4000, f1: 3000, type: 'highpass', gain: 0.06, decay: 0.03, delay: 0.04 });
        break;
      case 'empty':
        this.tone({ type: 'square', f0: 1600, f1: 1600, gain: 0.04, decay: 0.02 });
        break;
      case 'pickup':
        for (const [i, f] of [660, 880, 1320].entries()) this.tone({ type: 'square', f0: f, gain: 0.07, decay: 0.07, delay: i * 0.06, pan });
        break;
      case 'crate':
        this.tone({ type: 'sine', f0: 520, gain: 0.1, decay: 0.2 });
        this.tone({ type: 'sine', f0: 780, gain: 0.1, decay: 0.3, delay: 0.12 });
        break;
      case 'streak':
        // Rising power chord; `scale` pitches it up for bigger multi-kills.
        for (const [i, f] of [392, 523, 659, 784].entries()) {
          this.tone({ type: 'square', f0: f * scale, gain: 0.08, decay: 0.12, delay: i * 0.05 });
          this.tone({ type: 'triangle', f0: f * scale * 2, gain: 0.04, decay: 0.1, delay: i * 0.05 });
        }
        this.tone({ type: 'sawtooth', f0: 1046 * scale, f1: 1568 * scale, gain: 0.06, decay: 0.3, delay: 0.2 });
        break;
      case 'beat':
        // Low heartbeat for critical health: lub-dub.
        this.tone({ type: 'sine', f0: 70, f1: 45, gain: 0.5 * scale, decay: 0.12 });
        this.tone({ type: 'sine', f0: 62, f1: 40, gain: 0.35 * scale, decay: 0.12, delay: 0.16 });
        break;
      case 'beep':
        this.tone({ type: 'square', f0: 440, gain: 0.1, decay: 0.14 });
        break;
      case 'go':
        this.tone({ type: 'square', f0: 880, gain: 0.12, decay: 0.35 });
        this.tone({ type: 'square', f0: 1320, gain: 0.06, decay: 0.35 });
        break;
      case 'spawn':
        this.tone({ type: 'sine', f0: 300, f1: 900, gain: 0.08, decay: 0.2, pan });
        break;
      case 'debris':
        this.noise({ f0: 500, f1: 150, type: 'lowpass', gain: 0.12, decay: 0.12, pan });
        break;
      case 'win':
        for (const [i, f] of [523, 659, 784, 1047].entries()) this.tone({ type: 'square', f0: f, gain: 0.09, decay: 0.16, delay: i * 0.11 });
        break;
      case 'lose':
        for (const [i, f] of [392, 330, 262].entries()) this.tone({ type: 'square', f0: f, gain: 0.09, decay: 0.2, delay: i * 0.14 });
        break;
      default:
        if (EXTRA[name]) EXTRA[name].call(this, pan, s);
        break;
    }
  }

  // Continuous flame and jetpack hiss per player slot.
  makeLoops() {
    const c = this.ctx;
    const mk = (type, freq, q) => {
      const src = c.createBufferSource();
      src.buffer = this.noiseBuf;
      src.loop = true;
      const f = c.createBiquadFilter();
      f.type = type;
      f.frequency.value = freq;
      f.Q.value = q;
      const g = c.createGain();
      g.gain.value = 0;
      const p = c.createStereoPanner();
      src.connect(f).connect(g).connect(p).connect(this.master);
      src.start();
      return { g, p, f };
    };
    return { flame: mk('bandpass', 700, 0.6), jet: mk('lowpass', 420, 0.8) };
  }

  // `tool` tunes the hiss: 0 flamer roar, 1 cutter whine, 2 sand blower.
  setLoops(slot, x, flaming, jet, tool = 0) {
    if (!this.ctx || !this.loops[slot]) return;
    const L = this.loops[slot];
    const t = this.ctx.currentTime;
    const pan = this.panFor(x);
    L.flame.p.pan.setTargetAtTime(pan, t, 0.05);
    L.jet.p.pan.setTargetAtTime(pan, t, 0.05);
    L.flame.f.frequency.setTargetAtTime(LOOP_FREQ[tool] || 700, t, 0.02);
    L.flame.g.gain.setTargetAtTime(flaming ? 0.32 : 0, t, flaming ? 0.02 : 0.06);
    L.jet.g.gain.setTargetAtTime(jet * 0.3, t, 0.04);
  }
}

function readMuted() {
  try {
    return localStorage.getItem('sd-muted') === '1';
  } catch {
    return false;
  }
}
