'use strict';
// Shared helpers. Everything hangs off one global namespace so the app runs from file:// too.
const C = (window.COSMOS = window.COSMOS || {});

C.W = 40; // the world is a 40x40 torus: pan forever, never hit an edge
C.found = new Set(); // discoveries, shared by every world
C.uiEvents = []; // messages from the worlds to the interface

C.clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
C.lerp = (a, b, t) => a + (b - a) * t;
C.smooth = (e0, e1, x) => {
  const t = C.clamp((x - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
};
// shortest signed distance on the torus
C.wrap = (d) => d - C.W * Math.floor(d / C.W + 0.5);
C.damp = (rate, dt) => 1 - Math.exp(-rate * dt);

C.rng = function (seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

C.hash = (...xs) => {
  let h = 2166136261 >>> 0;
  for (const x of xs) {
    const s = String(x);
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    h ^= 0x9e3779b9;
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
};

C.gauss = (r) => {
  const u = Math.max(1e-9, r()), v = r();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(6.2831853 * v);
};

C.toLin = (c) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
// HSL (0..1) -> linear RGB
C.hsl = (h, s, l) => {
  h = ((h % 1) + 1) % 1;
  const a = s * Math.min(l, 1 - l);
  const f = (n) => {
    const k = (n + h * 12) % 12;
    return l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
  };
  return [C.toLin(f(0)), C.toLin(f(8)), C.toLin(f(4))];
};
C.cssColor = (lin, mul = 1) => {
  const g = (c) => Math.round(255 * C.clamp(Math.pow(C.clamp(c * mul, 0, 1), 1 / 2.2), 0, 1));
  return `rgb(${g(lin[0])},${g(lin[1])},${g(lin[2])})`;
};

// Pitch class -> hue around the circle of fifths, so consonant notes get neighbouring colours.
C.pcHue = (pc) => ((((pc * 7) % 12) + 12) % 12) / 12;

C.NOTE_NAMES = ['C', 'C♯', 'D', 'E♭', 'E', 'F', 'F♯', 'G', 'A♭', 'A', 'B♭', 'B'];
C.midiToFreq = (m) => 440 * Math.pow(2, (m - 69) / 12);

// Consonance of an interval (semitones mod 12): +1 sweet ... -1 harsh. Drives flocking.
C.CONSONANCE = [1.0, -0.6, 0.15, 0.55, 0.65, 0.8, -0.8, 0.9, 0.6, 0.55, 0.0, -0.5];

// Tileable gradient-noise texture (4 independent fbm channels), periodic so the torus has no seams.
C.makeNoiseTexData = function (size) {
  const out = new Float32Array(size * size * 4);
  const fade = (t) => t * t * t * (t * (t * 6 - 15) + 10);
  for (let ch = 0; ch < 4; ch++) {
    const rng = C.rng(1234 + ch * 7919);
    const base = [3, 4, 5, 6][ch];
    let amp = 1;
    for (let o = 0; o < 4; o++) {
      const P = base << o;
      const gx = new Float32Array(P * P), gy = new Float32Array(P * P);
      for (let i = 0; i < P * P; i++) {
        const a = rng() * Math.PI * 2;
        gx[i] = Math.cos(a);
        gy[i] = Math.sin(a);
      }
      for (let py = 0; py < size; py++) {
        const y = (py / size) * P, iy = Math.floor(y), fy = y - iy, v = fade(fy);
        const iy0 = iy % P, iy1 = (iy + 1) % P;
        for (let px = 0; px < size; px++) {
          const x = (px / size) * P, ix = Math.floor(x), fx = x - ix, u = fade(fx);
          const ix0 = ix % P, ix1 = (ix + 1) % P;
          const g00 = iy0 * P + ix0, g10 = iy0 * P + ix1, g01 = iy1 * P + ix0, g11 = iy1 * P + ix1;
          const n00 = gx[g00] * fx + gy[g00] * fy;
          const n10 = gx[g10] * (fx - 1) + gy[g10] * fy;
          const n01 = gx[g01] * fx + gy[g01] * (fy - 1);
          const n11 = gx[g11] * (fx - 1) + gy[g11] * (fy - 1);
          const nx0 = n00 + (n10 - n00) * u, nx1 = n01 + (n11 - n01) * u;
          out[(py * size + px) * 4 + ch] += (nx0 + (nx1 - nx0) * v) * amp;
        }
      }
      amp *= 0.5;
    }
    let mx = 1e-6;
    for (let i = ch; i < out.length; i += 4) mx = Math.max(mx, Math.abs(out[i]));
    for (let i = ch; i < out.length; i += 4) out[i] /= mx;
  }
  return out;
};

// Flash budget: bright events ask for brightness and get scaled down when many land together.
C.flash = {
  budget: 0,
  guard: 1, // 1 = strong, 0.5 = standard
  update(dt) {
    this.budget *= Math.exp(-dt * 1.2);
  },
  request(amount) {
    const allowed = 1 / (1 + this.budget * (0.8 + this.guard * 1.6));
    this.budget += amount;
    return allowed;
  },
};

C.storage = {
  get(k, d) {
    try {
      const v = localStorage.getItem('cosmos.' + k);
      return v == null ? d : JSON.parse(v);
    } catch (e) {
      return d;
    }
  },
  set(k, v) {
    try {
      localStorage.setItem('cosmos.' + k, JSON.stringify(v));
    } catch (e) {}
  },
};
