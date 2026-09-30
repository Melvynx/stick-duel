// Extra synth voices for the sandbox tools and progression. Called with `this` = Sfx,
// `pan` in [-1, 1] and `s` the distance-scaled loudness.
export const EXTRA = {
  // 5 flamer ignition (the roar itself is the loop).
  shot5(pan, s) {
    this.noise({ f0: 400, f1: 1400, q: 0.7, gain: 0.2 * s, decay: 0.12, pan });
  },
  // 7 cutter strike.
  shot7(pan, s) {
    this.tone({ type: 'sawtooth', f0: 1800, f1: 2600, gain: 0.08 * s, decay: 0.1, pan });
  },
  // 8 builder: pneumatic thunk.
  shot8(pan, s) {
    this.tone({ type: 'square', f0: 240, f1: 120, gain: 0.1 * s, decay: 0.06, pan });
    this.noise({ f0: 900, f1: 300, type: 'lowpass', gain: 0.14 * s, decay: 0.05, pan });
  },
  shot9(pan, s) {
    this.noise({ f0: 1600, f1: 900, q: 0.5, gain: 0.08 * s, decay: 0.08, pan });
  },
  // 10 c4 toss.
  shot10(pan, s) {
    this.noise({ f0: 700, f1: 1500, q: 2, gain: 0.14 * s, decay: 0.1, pan });
    this.tone({ type: 'square', f0: 2200, gain: 0.04 * s, decay: 0.03, pan, delay: 0.05 });
  },
  // 11 quake: deep thump.
  shot11(pan, s) {
    this.tone({ type: 'sine', f0: 140, f1: 45, gain: 0.5 * s, decay: 0.35, pan });
    this.noise({ f0: 900, f1: 120, type: 'lowpass', gain: 0.45 * s, decay: 0.3, pan });
  },
  // 12 sniper: sharp crack with a rolling boom behind it.
  shot12(pan, s) {
    this.noise({ f0: 5200, f1: 1800, q: 0.8, gain: 0.34 * s, decay: 0.06, pan });
    this.tone({ type: 'square', f0: 900, f1: 120, gain: 0.14 * s, decay: 0.08, pan });
    this.noise({ f0: 420, f1: 60, type: 'lowpass', gain: 0.4 * s, decay: 0.55, pan, delay: 0.02 });
  },
  // 13 M4: tight rifle crack.
  shot13(pan, s) {
    this.noise({ f0: 2600, f1: 900, q: 0.9, gain: 0.2 * s, decay: 0.05, pan });
    this.tone({ type: 'square', f0: 420, f1: 160, gain: 0.07 * s, decay: 0.04, pan });
  },
  // F shove: a dull punch into the terrain.
  punch(pan, s) {
    this.tone({ type: 'sine', f0: 180, f1: 60, gain: 0.35 * s, decay: 0.1, pan });
    this.noise({ f0: 900, f1: 220, type: 'lowpass', gain: 0.25 * s, decay: 0.09, pan });
  },
  // Headshot confirmation.
  headshot() {
    this.tone({ type: 'square', f0: 1568, gain: 0.07, decay: 0.06 });
    this.tone({ type: 'square', f0: 2093, gain: 0.07, decay: 0.12, delay: 0.06 });
  },
  // C4 detonator click.
  det(pan) {
    this.tone({ type: 'square', f0: 2400, gain: 0.07, decay: 0.03, pan });
    this.tone({ type: 'square', f0: 1200, gain: 0.07, decay: 0.05, pan, delay: 0.05 });
  },
  place(pan, s) {
    this.noise({ f0: 1200, f1: 500, q: 1.4, gain: 0.1 * s, decay: 0.04, pan });
  },
  // Rumble of a terrain collapse or quake.
  rumble(pan, s) {
    this.noise({ f0: 260, f1: 50, type: 'lowpass', q: 0.7, gain: 0.7 * s, attack: 0.05, decay: 1.2, pan });
    this.tone({ type: 'sine', f0: 55, f1: 30, gain: 0.4 * s, attack: 0.05, decay: 1, pan });
  },
  crumble(pan, s) {
    this.noise({ f0: 380, f1: 110, type: 'lowpass', gain: 0.18 * s, decay: 0.18, pan });
  },
  // New weapon unlocked: bright arpeggio.
  unlock() {
    for (const [i, f] of [523, 784, 1047, 1568].entries()) this.tone({ type: 'square', f0: f, gain: 0.08, decay: 0.14, delay: i * 0.07 });
    this.tone({ type: 'triangle', f0: 2093, gain: 0.06, decay: 0.4, delay: 0.3 });
  },
  lock() {
    this.tone({ type: 'square', f0: 180, gain: 0.08, decay: 0.08 });
    this.tone({ type: 'square', f0: 140, gain: 0.08, decay: 0.1, delay: 0.08 });
  },
  ammo(pan) {
    this.tone({ type: 'square', f0: 700, gain: 0.06, decay: 0.05, pan });
    this.noise({ f0: 3000, f1: 2000, q: 2, gain: 0.1, decay: 0.05, pan, delay: 0.05 });
  },
  sprint(pan) {
    this.noise({ f0: 600, f1: 1500, q: 1, gain: 0.06, decay: 0.1, pan });
  },
};
