export function mulberry32(seed) {
  let a = seed >>> 0;
  return function rand() {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Deterministic per-shot randomness so client tracers match server pellets.
export function shotRng(slot, seq) {
  return mulberry32((Math.imul(seq | 0, 2654435761) ^ Math.imul(slot + 1, 40503)) >>> 0);
}

export function randomSeed() {
  return (Math.random() * 0xffffffff) >>> 0;
}
