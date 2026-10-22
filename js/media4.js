'use strict';
// Continuous life: Lenia (Bert Chan) and SmoothLife (Stephan Rafler). The Game of Life made smooth:
// cells are not on or off but anywhere between, and each one grows or fades by how full a soft ring of
// neighbours is. From that one rule come gliders that swim, worms, and cells that divide. The edges where
// life is growing are what sings.
(function () {
  const C = window.COSMOS;
  const wrap = C.wrap;
  const near = (u, x, y) => u._audioSpatial(x, y);
  const degFromY = (u, yN) => {
    const len = u.scale.length;
    return Math.floor(yN * len * 2.2) - Math.floor(len * 0.6);
  };

  // Laws that stayed alive from noise patches in the probe (2026-10-22, 64x64 read-back every 1.5-2.5 s for
  // 12-25 s: mass held steady and the field kept changing). Gliders (Orbium) only survived rarely from
  // random seeds, so they are not promised here. mode 0 = Lenia (mu, sigma: growth peak and width),
  // 1 = SmoothLife (Rafler's intervals; dt blends toward the next state).
  C.LENIA_LAWS = [
    { name: 'hollow worms', mode: 0, R: 10, mu: 0.15, sigma: 0.015, dt: 0.1, blobs: 45 },
    { name: 'labyrinth', mode: 0, R: 10, mu: 0.2, sigma: 0.025, dt: 0.1, blobs: 8 },
    { name: 'coral', mode: 0, R: 10, mu: 0.13, sigma: 0.015, dt: 0.1, blobs: 14 },
    { name: 'dividing cells', mode: 0, R: 10, mu: 0.27, sigma: 0.04, dt: 0.12, blobs: 10 },
    { name: 'smooth stripes', mode: 1, R: 9, mu: 0, sigma: 0, dt: 0.15, blobs: 10 },
  ];

  class Lenia {
    constructor(u) {
      this.u = u;
      this.gp = u.world.gp;
      this.simMode = 0;
      this.dustLayer = 0.12;
      this.law = Object.assign({}, C.LENIA_LAWS[this.gp.law % C.LENIA_LAWS.length]);
      this.brushes = [];
      this.brush = new Float32Array(48);
      this.readT = 0.5;
      this.prev = null;
      this.mass = 0.05;
      this.reseed = false;
      this.quietT = 0;
    }
    gpuInit(r, x, y) { r.seedDust(x, y, 0, 'uniform'); }
    enter() {}
    snapshot() { return null; }
    _brush(x, y, r, amt) { if (this.brushes.length >= 12) this.brushes.shift(); this.brushes.push([x, y, r, amt]); }
    update(dt, realDt) {
      const u = this.u;
      // the field steps on simulation time (60 steps per simulated second): slow time slows it, and a
      // 120 Hz screen doesn't double its speed
      this.acc = Math.min(3, (this.acc || 0) + dt * 60);
      // the law of growth breathes over minutes, so a settled pattern never quite freezes
      this.t = (this.t || 0) + dt;
      const base = C.LENIA_LAWS[this.gp.law % C.LENIA_LAWS.length], b = 1 + 0.04 * Math.sin(this.t * 0.05) + 0.02 * Math.sin(this.t * 0.13);
      if (!this.bent) { if (this.law.mode === 0) this.law.mu = base.mu * b; else this.law.dt = base.dt * b; }
      this.readT -= realDt;
      if (this.readT <= 0 && u.renderer && u.gpu && u.gpu.life) {
        this.readT = 0.25;
        const b = u.renderer.readField('life', u.gpu);
        let m = 0;
        for (let i = 0; i < 64 * 64; i++) m += b[i * 4];
        this.mass = m / 4096;
        // a world that died out or boiled over is quietly reborn
        if (this.mass < 0.002 || this.mass > 0.5) {
          this.quietT += 0.25;
          if (this.quietT > 3) { this.reseed = true; this.quietT = 0; u._event('lenia-reborn', 'life came back from almost nothing'); }
        } else this.quietT = 0;
        // growing edges in view become notes: higher on screen, higher note
        if (this.prev && u.gain > 0.05) {
          const cam = u.cam, len = u.scale.length;
          let played = 0;
          for (let k = 0; k < 60 && played < 2; k++) {
            const ix = Math.floor(Math.random() * 64), iy = Math.floor(Math.random() * 64), i = (iy * 64 + ix) * 4;
            if (b[i] - this.prev[i] > 0.12 && b[i] > 0.3) {
              const x = (ix + 0.5) / 64 * C.W - C.W / 2, y = (iy + 0.5) / 64 * C.W - C.W / 2;
              const sp = near(u, x, y);
              if (!sp.visible) continue;
              const deg = Math.floor(((wrap(y - cam.y) / cam.viewH) + 0.5) * len * 2);
              u.audio.play({ midi: u.midiOf(deg), timbre: 0.2 + 0.6 * Math.random(), vel: 0.09 * sp.att, pan: sp.pan, dur: 1.4 });
              played++;
            }
          }
        }
        this.prev = b.slice();
      }
      if (u.music.active) for (const ev of u.music.events) if (ev.type === 'kick') {
        const cam = u.cam;
        this._brush(wrap(cam.x + (Math.random() - 0.5) * cam.viewH), wrap(cam.y + (Math.random() - 0.5) * cam.viewH * 0.7), 0.5, 0.6 * ev.strength);
      }
    }
    tap(x, y, yN) {
      this._brush(x, y, 0.6, 0.9);
      this.u.audio.play({ midi: this.u.midiOf(degFromY(this.u, yN)), timbre: 0.2, vel: 0.2, pan: near(this.u, x, y).pan, dur: 2 });
      this.u._found('lenia-seed', 'a drop of life — watch what it becomes');
    }
    dragMove(x, y) { this._brush(x, y, 0.35, 0.8); }
    drawStart(x, y) { this._brush(x, y, 0.6, -1); }
    drawMove(x, y) { this._brush(x, y, 0.6, -1); }
    drawEnd() { return 'erase'; }
    holdStart(x, y) { this.hold = { x, y, t: 0 }; }
    holdUpdate(x, y, dt) { if (this.hold) { this.hold.t += dt; if (this.hold.t > 0.3) { this.hold.t = 0; this._brush(x, y, 1.1, 0.7); } } }
    holdEnd() { this.hold = null; return 'soup'; }
    // keys nudge the law itself: the creatures change shape (or dissolve) as you play
    key(i) {
      const L = this.law, base = C.LENIA_LAWS[this.gp.law % C.LENIA_LAWS.length];
      const pc = this.u.pcOf(i);
      this.bent = true;
      if (L.mode === 0) L.mu = base.mu * (0.9 + 0.2 * (pc / 11));
      else L.dt = C.clamp(base.dt * (0.6 + 0.8 * (pc / 11)), 0.15, 0.9);
      this.u.audio.play({ midi: this.u.midiOf(i), timbre: 0.15, vel: 0.24, dur: 2.5 });
      this.u._found('lenia-law', 'you bent the law of growth — the creatures change shape');
    }
    field() {
      this.brush.fill(0);
      this.brushes.forEach((b, i) => this.brush.set(b, i * 4));
      const n = this.brushes.length;
      this.brushes = [];
      const res = C.MOBILE ? 128 : 192;
      const scale = res / 192; // the same creatures at phone resolution: a smaller kernel on a smaller grid
      const reseed = this.reseed;
      this.reseed = false;
      const L = this.law;
      return {
        kind: 10, res, p1: [res, 0, 0, 0], steps: this._steps(), R: Math.max(4, L.R * scale), mu: L.mu, sigma: L.sigma, dt: L.dt, mode: L.mode,
        brush: this.brush, nBrush: n, gain: 1, scan: [0, 1, 0, 0], reseed, blobs: L.blobs || 10,
      };
    }
    _steps() { const n = Math.floor(this.acc || 0); this.acc = (this.acc || 0) - n; return n; }
    pick() { return null; }
  }
  C.GENUS_IMPL.lenia = Lenia;
})();
