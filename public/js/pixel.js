// Pixel-sprite helpers shared by every sprite module.

const PAL = {
  a: '#e8c77e',
  A: '#b8904a',
  v: '#c77dff',
  V: '#7b3fbf',
  k: '#14101c',
  d: '#2c2a3a',
  m: '#4a4a5e',
  l: '#7a7c92',
  w: '#c9ccd8',
  W: '#ffffff',
  c: '#3ee6ff',
  b: '#2b7bff',
  B: '#1a3f9e',
  y: '#ffd23f',
  o: '#ff8a1f',
  r: '#ff3b3b',
  p: '#ff4d9d',
  P: '#b8306e',
  n: '#6b4a2e',
  N: '#a8743f',
  g: '#45d483',
  G: '#2a8a55',
  s: '#e8e2f0',
};

export function make(rows) {
  const h = rows.length;
  const w = Math.max(...rows.map((r) => r.length));
  const cv = document.createElement('canvas');
  cv.width = w;
  cv.height = h;
  const ctx = cv.getContext('2d');
  rows.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) {
      const col = PAL[row[x]];
      if (!col) continue;
      ctx.fillStyle = col;
      ctx.fillRect(x, y, 1, 1);
    }
  });
  return cv;
}

export function gun(rows, grip, fore, muzzle) {
  return { img: make(rows), grip, fore, muzzle };
}

