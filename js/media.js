'use strict';
// More media: strange attractors, fractal flames, particle life and murmurations.
// Same plug-in shape as genera.js: the Universe host calls update / sprites / ribbons / wells / verbs.
(function () {
  const C = window.COSMOS;
  const W = C.W;
  const wrap = C.wrap;
  const TAU = Math.PI * 2;
  const pitchCol = (u, deg, l) => C.hsl(C.pcHue(u.pcOf(deg)), 0.8, l || 0.6);
  const degFromY = (u, yN) => {
    const len = u.scale.length;
    return Math.floor(yN * len * 2.2) - Math.floor(len * 0.6);
  };

  // ==================================================================== STRANGE ATTRACTOR
  // A Clifford attractor made of 262k grains, each flowing toward its own image under the map.
  // A single point also walks the true orbit on the CPU, and that walk is the melody you hear.
  const SHAPES = [[-1.4, 1.6, 1.0, 0.7], [1.7, 1.7, 0.6, 1.2], [-1.7, 1.3, -0.1, -1.2], [-1.7, 1.8, -1.9, -0.4], [-1.8, -2.0, -0.5, -0.9], [1.5, -1.8, 1.6, 0.9],
    [-1.24, -1.25, -1.81, -1.91], [1.6, -0.6, -1.2, 1.6], [-1.3, -1.3, -1.8, -1.9], [1.1, -1.32, -1.03, 1.54], [-1.9, -1.9, -1.9, -1.0], [1.4, 1.56, 1.4, -6.56 / 10]];
  class Attractor {
    constructor(u) {
      this.u = u;
      this.gp = u.world.gp;
      this.simMode = 3;
      this.dustLayer = 1;
      this.dustGain = 0.4;
      this.trailMul = 1.4;
      this.p = this.gp.base.slice();
      this.target = this.gp.base.slice();
      this.offset = [0, 0];
      this.orbit = [0.1, 0.2];
      this.spark = { x: 0, y: 0, a: 0 };
      this.hold = null;
      this.t = 0;
      this.sc = 6.5;
    }
    gpuInit(r, x, y) { r.seedDust(x, y, 7, 'cloud'); }
    enter(d) { if (d) { this.p = d.p.slice(); this.target = d.target.slice(); } }
    snapshot() { return { p: this.p.slice(), target: this.target.slice() }; }
    params() {
      const m = this.u.music;
      const dr = this.gp.drift;
      return [
        this.p[0] + Math.sin(this.t * 0.05) * dr + this.offset[0],
        this.p[1] + Math.cos(this.t * 0.043) * dr + this.offset[1],
        this.p[2] + (m.active ? m.bands.bass * 0.25 : 0),
        this.p[3] + Math.sin(this.t * 0.031) * dr * 0.5,
      ];
    }
    update(dt, realDt, ticks, now) {
      this.t += dt;
      for (let i = 0; i < 4; i++) this.p[i] += (this.target[i] - this.p[i]) * C.damp(0.6, dt);
      this.offset[0] *= Math.exp(-dt * 0.08);
      this.offset[1] *= Math.exp(-dt * 0.08);
      const [a, b, c, d] = this.params();
      const len = this.u.scale.length;
      for (const tk of ticks) {
        if (tk.tick % 2) continue;
        let [x, y] = this.orbit;
        for (let k = 0; k < 5; k++) {
          const nx = Math.sin(a * y) + c * Math.cos(a * x), ny = Math.sin(b * x) + d * Math.cos(b * y);
          x = nx; y = ny;
        }
        this.orbit = [x, y];
        if (Math.random() < 0.38) continue; // breaths between notes
        const ext = 1 + Math.abs(d);
        const deg = Math.round(C.lerp(-len * 0.5, len * 2.2, C.clamp((y / ext + 1) / 2, 0, 1)));
        const wx = wrap(x * this.sc), wy = wrap(y * this.sc);
        const sp = this.u._audioSpatial(wx, wy);
        if (sp.att > 0.01) this.u.audio.play({ midi: this.u.midiOf(deg), timbre: x > 0 ? 0.12 : 0.5, vel: 0.14 * Math.max(0.4, sp.att), pan: sp.pan, dur: 2.4 }, tk.time);
        this.u.pending.push({ t: tk.time, kind: 'fn', fn: () => {
          this.spark = { x: wx, y: wy, a: 1 };
          this.u.addRing(wx, wy, 0.1, 1.6, 0.9, pitchCol(this.u, deg), 0.04, 0.8);
          this.u.lastPc = this.u.pcOf(deg);
        } });
      }
      this.spark.a *= Math.exp(-realDt * 3);
      if (this.hold) this.hold.t += realDt;
    }
    simParams(sim) { sim.attr.set(this.params()); }
    tap(x, y, yN) {
      this.target[2] += (Math.random() - 0.5) * 0.3;
      this.target[3] += (Math.random() - 0.5) * 0.3;
      this.u.addShock(x, y, 2.5, 6, 0.6, 1.5, 0.4);
      const sp = this.u._audioSpatial(x, y);
      this.u.audio.play({ midi: this.u.midiOf(degFromY(this.u, yN)), timbre: 0.45, vel: 0.22, pan: sp.pan });
      this.u._found('a-pluck', 'plucked — the whole shape shivers into a new one');
    }
    dragMove(x, y, vx, vy) {
      this.offset[0] = C.clamp(this.offset[0] + vx * 0.0016, -0.9, 0.9);
      this.offset[1] = C.clamp(this.offset[1] + vy * 0.0016, -0.9, 0.9);
      this.u._found('a-sculpt', 'you are sculpting the attractor itself');
    }
    holdStart(x, y) { this.hold = { x, y, t: 0, voice: this.u.audio.sustain('charge') }; }
    holdUpdate(x, y, dt) {
      const h = this.hold;
      if (!h) return;
      h.x = x; h.y = y;
      const k = Math.min(1, h.t / 2.5);
      const sp = this.u._audioSpatial(x, y);
      if (h.voice) h.voice.set(110 * Math.pow(2, k * 2), 0.05 + 0.1 * k, sp.pan, 5 * k, 600 + 2400 * k);
    }
    holdEnd() {
      const h = this.hold;
      if (!h) return null;
      this.hold = null;
      if (h.voice) h.voice.stop(0.05);
      const k = Math.min(1, h.t / 2.5);
      this.u.addShock(h.x, h.y, 3 + 6 * k, 7, 0.8, 2, 0.6);
      this.u.addRing(h.x, h.y, 0.1, 3 + 5 * k, 1.3, this.u.palette.hot, 0.06, C.flash.request(0.5 + k));
      this.u.audio.burst(k, this.u._audioSpatial(h.x, h.y).pan, [0, 2, 4].map((i) => this.u.midiOf(i)), 0.3);
      return 'burst';
    }
    key(i) {
      const pc = this.u.pcOf(i);
      this.target = SHAPES[pc].map((v) => v + (Math.random() - 0.5) * 0.05);
      this.u.audio.play({ midi: this.u.midiOf(i), timbre: 0.2, vel: 0.24, dur: 3 });
      this.u._found('a-key', 'every pitch has its own shape');
    }
    wells(addWell) {
      if (this.hold) addWell(this.hold.x, this.hold.y, 0.6 + 6 * Math.min(1, this.hold.t / 2.5), 1.4, 0.4, 0, 0, 0);
    }
    sprites(spr) {
      if (this.spark.a > 0.02) spr(this.spark.x, this.spark.y, 0.05, 0.9, [1, 1, 1], this.spark.a, 1, 12);
      if (this.hold) spr(this.hold.x, this.hold.y, 0, 0.4 + Math.min(1, this.hold.t / 2.5), this.u.palette.hot, 0.8, 2, 1, this.t, 0);
    }
    pick() { return null; }
    diveObject() { return null; }
  }

  // ==================================================================== FRACTAL FLAME
  // Draves & Reckase's fractal flame, as a living thing: each grain plays the chaos game, the
  // transforms slowly turn, and a CPU copy of the game picks which branch sings.
  class Flame {
    constructor(u) {
      this.u = u;
      this.gp = u.world.gp;
      this.simMode = 4;
      this.dustLayer = 1.15;
      this.dustGain = 0.7;
      this.trailMul = 1.8;
      this.xf = this.gp.xforms.map((x) => Object.assign({}, x, { vars: x.vars.slice() }));
      this.twist = 0;
      this.t = 0;
      this.pt = [0.1, 0.1];
      this.scalePulse = 0;
      this.hold = null;
    }
    gpuInit(r, x, y) { r.seedDust(x, y, 0, 'uniform'); }
    enter(d) { if (d) this.xf = d.xf.map((x) => Object.assign({}, x, { vars: x.vars.slice() })); }
    snapshot() { return { xf: this.xf.map((x) => Object.assign({}, x, { vars: x.vars.slice() })) }; }
    _affine(i) {
      const x = this.xf[i];
      const ph = Math.sin(this.t * 0.05 + i * 1.7) * 0.22 + this.twist * (i % 2 ? 1 : -0.7);
      const c = Math.cos(ph), s = Math.sin(ph);
      return [c * x.a - s * x.c, c * x.b - s * x.d, s * x.a + c * x.c, s * x.b + c * x.d];
    }
    _apply(i, p) {
      const [a, b, c, d] = this._affine(i), x = this.xf[i];
      const qx = a * p[0] + b * p[1] + x.e, qy = c * p[0] + d * p[1] + x.f;
      const r2 = qx * qx + qy * qy + 1e-6, r = Math.sqrt(r2), th = Math.atan2(qx, qy), v = x.vars;
      let ox = v[0] * qx + v[1] * Math.sin(qx) + v[2] * qx / r2 + v[3] * (qx * Math.sin(r2) - qy * Math.cos(r2)) + v[4] * (qx - qy) * (qx + qy) / r + v[5] * th / Math.PI + v[6] * r * Math.sin(th * r) + v[7] * th / Math.PI * Math.sin(Math.PI * r) + v[8] * (Math.cos(th) + Math.sin(r)) / r + v[9] * Math.sqrt(r) * Math.cos(th / 2);
      let oy = v[0] * qy + v[1] * Math.sin(qy) + v[2] * qy / r2 + v[3] * (qx * Math.cos(r2) + qy * Math.sin(r2)) + v[4] * 2 * qx * qy / r + v[5] * (r - 1) - v[6] * r * Math.cos(th * r) + v[7] * th / Math.PI * Math.cos(Math.PI * r) + v[8] * (Math.sin(th) - Math.cos(r)) / r + v[9] * Math.sqrt(r) * Math.sin(th / 2);
      if (!isFinite(ox) || !isFinite(oy) || Math.abs(ox) > 40 || Math.abs(oy) > 40) { ox = Math.random() * 2 - 1; oy = Math.random() * 2 - 1; }
      return [ox, oy];
    }
    update(dt, realDt, ticks) {
      this.t += dt;
      this.twist *= Math.exp(-dt * 0.05);
      this.scalePulse *= Math.exp(-dt * 1.5);
      if (this.hold) { this.hold.t += realDt; this.scalePulse = Math.min(0.6, this.hold.t * 0.25); }
      const len = this.u.scale.length;
      const chord = [0, 2, 4, 6, 7, 9];
      for (const tk of ticks) {
        if (tk.tick % 2) continue;
        // the CPU walks the same chaos game; the branch it takes is the note
        let rr = Math.random(), k = 0;
        for (let i = 0; i < this.xf.length; i++) { k = i; rr -= this.xf[i].w; if (rr <= 0) break; }
        this.pt = this._apply(k, this.pt);
        if (Math.random() < 0.42) continue;
        const r = Math.hypot(this.pt[0], this.pt[1]);
        const deg = chord[k % chord.length] + (r < 0.6 ? len : r > 1.6 ? -len : 0);
        const sp = this.u._audioSpatial(this.pt[0] * this.gp.scale, this.pt[1] * this.gp.scale);
        this.u.audio.play({ midi: this.u.midiOf(deg), timbre: 0.4 + 0.2 * (k % 2), vel: 0.12 * Math.max(0.5, sp.att), pan: C.clamp(this.pt[0] * 0.4, -0.8, 0.8), dur: 2.2 }, tk.time);
        this.u.lastPc = this.u.pcOf(deg);
      }
    }
    simParams(sim) {
      let wc = 0;
      sim.xf.fill(0);
      this.xf.forEach((x, i) => {
        wc += x.w;
        const [a, b, c, d] = this._affine(i);
        sim.xf.set([a, b, c, d, x.e, x.f, i === this.xf.length - 1 ? 1.01 : wc, x.col, x.vars[0], x.vars[1], x.vars[2], x.vars[3], x.vars[4], x.vars[5], x.vars[6], x.vars[7], x.vars[8], x.vars[9], 0, 0], i * 20);
      });
      sim.nxf = this.xf.length;
      const bass = this.u.music.active ? this.u.music.bands.bass * 0.12 : 0;
      sim.flame.set([this.gp.scale * (1 + this.scalePulse + bass), this.t * this.gp.spin, 0, 0]);
    }
    tap(x, y, yN) {
      const k = Math.floor(Math.random() * this.xf.length);
      this.xf[k].e = (Math.random() - 0.5) * 1.6;
      this.xf[k].f = (Math.random() - 0.5) * 1.6;
      const sp = this.u._audioSpatial(x, y);
      this.u.audio.play({ midi: this.u.midiOf(degFromY(this.u, yN)), timbre: 0.5, vel: 0.22, pan: sp.pan, dur: 3 });
      this.u.addRing(x, y, 0.1, 2.5, 1.2, this.u.palette.accent, 0.05, 0.8);
      this.u._found('f-tap', 'a branch of the flame regrew somewhere else');
    }
    dragMove(x, y, vx, vy) {
      this.twist = C.clamp(this.twist + (vx - vy) * 0.0012, -2, 2);
      this.u._found('f-twist', 'twisting the flame');
    }
    holdStart(x, y) { this.hold = { x, y, t: 0, voice: this.u.audio.sustain('hum') }; }
    holdUpdate(x, y) {
      const h = this.hold;
      if (!h) return;
      const k = Math.min(1, h.t / 3);
      if (h.voice) h.voice.set([0, 4, 7].map((d) => C.midiToFreq(this.u.midiOf(d))), 0.06 + 0.1 * k, 0, 0, 800 + 2000 * k);
    }
    holdEnd() {
      const h = this.hold;
      if (!h) return null;
      this.hold = null;
      if (h.voice) h.voice.stop(0.8);
      this.u.addShock(h.x, h.y, 4, 7, 0.8, 1.5, 0.5);
      return 'breathe';
    }
    key(i) {
      const k = ((i % this.xf.length) + this.xf.length) % this.xf.length;
      const v = new Array(10).fill(0);
      v[0] = 0.2;
      v[1 + (((this.u.pcOf(i) % 9) + 9) % 9)] = 0.9;
      this.xf[k].vars = v;
      this.u.audio.play({ midi: this.u.midiOf(i), timbre: 0.5, vel: 0.24, dur: 3 });
      this.u._found('f-key', 'each note bends one branch into a new law');
    }
    sprites() {}
    pick() { return null; }
    diveObject() { return null; }
  }

  // ==================================================================== PARTICLE LIFE
  // Species that feel asymmetric attraction or repulsion for each other (Ventrella / Mohr style).
  // From one small rule table: cells, membranes, worms, predators. Each species is a pitch.
  class PLife {
    constructor(u) {
      this.u = u;
      this.gp = u.world.gp;
      this.simMode = 0;
      this.dustLayer = 0.18;
      const N = (this.N = this.gp.count), T = (this.T = this.gp.types);
      this.x = new Float32Array(N); this.y = new Float32Array(N);
      this.vx = new Float32Array(N); this.vy = new Float32Array(N);
      this.t = new Uint8Array(N);
      this.M = this.gp.matrix.map((r) => r.slice());
      this.rMax = this.gp.rMax;
      this.cell = this.rMax;
      this.G = Math.floor(W / this.cell);
      this.cs = W / this.G;
      this.heads = new Int32Array(this.G * this.G);
      this.next = new Int32Array(N);
      const len = u.scale.length;
      this.degs = Array.from({ length: T }, (_, i) => Math.round((i / T) * len * 2) - 1);
      this.cols = this.degs.map((d) => pitchCol(u, d, 0.6));
      this.flash = new Float32Array(T);
      this.hold = null;
      this.pull = null;
    }
    gpuInit(r, x, y) { r.seedDust(x, y, 0, 'uniform'); }
    enter(d) {
      if (d) { this.x.set(d.x); this.y.set(d.y); this.t.set(d.t); this.M = d.M.map((r) => r.slice()); return; }
      for (let i = 0; i < this.N; i++) {
        const a = Math.random() * TAU, rr = Math.sqrt(Math.random()) * 14;
        this.x[i] = wrap(Math.cos(a) * rr); this.y[i] = wrap(Math.sin(a) * rr);
        this.t[i] = i % this.T;
      }
    }
    snapshot() { return { x: this.x.slice(), y: this.y.slice(), t: this.t.slice(), M: this.M.map((r) => r.slice()) }; }
    update(dt, realDt, ticks) {
      dt = Math.min(dt, 0.033);
      const N = this.N, G = this.G, cs = this.cs, rMax = this.rMax, beta = 0.3, F = this.gp.force;
      this.heads.fill(-1);
      for (let i = 0; i < N; i++) {
        const gx = Math.floor((this.x[i] + W / 2) / cs) % G, gy = Math.floor((this.y[i] + W / 2) / cs) % G;
        const c = ((gy + G) % G) * G + ((gx + G) % G);
        this.next[i] = this.heads[c];
        this.heads[c] = i;
      }
      const fric = Math.pow(0.5, dt / 0.09);
      const cur = this.u.cursor;
      for (let i = 0; i < N; i++) {
        const xi = this.x[i], yi = this.y[i], ti = this.t[i], row = this.M[ti];
        let ax = 0, ay = 0;
        const gx = Math.floor((xi + W / 2) / cs), gy = Math.floor((yi + W / 2) / cs);
        for (let oy = -1; oy <= 1; oy++) for (let ox = -1; ox <= 1; ox++) {
          let j = this.heads[((((gy + oy) % G) + G) % G) * G + ((((gx + ox) % G) + G) % G)];
          while (j >= 0) {
            if (j !== i) {
              const dx = wrap(this.x[j] - xi), dy = wrap(this.y[j] - yi);
              const d2 = dx * dx + dy * dy;
              if (d2 < rMax * rMax && d2 > 1e-8) {
                const d = Math.sqrt(d2), r = d / rMax;
                const f = r < beta ? r / beta - 1 : row[this.t[j]] * (1 - Math.abs(2 * r - 1 - beta) / (1 - beta));
                ax += (dx / d) * f;
                ay += (dy / d) * f;
              }
            }
            j = this.next[j];
          }
        }
        ax *= F * rMax; ay *= F * rMax;
        if (this.pull) {
          const dx = wrap(this.pull.x - xi), dy = wrap(this.pull.y - yi), d = Math.hypot(dx, dy) + 0.5;
          ax += (dx / d) * this.pull.s * 6 / (1 + d * 0.2);
          ay += (dy / d) * this.pull.s * 6 / (1 + d * 0.2);
        }
        if (cur.active && cur.speed > 10) {
          const dx = wrap(xi - cur.x), dy = wrap(yi - cur.y), d2 = dx * dx + dy * dy;
          if (d2 < 4) { ax += dx * 20; ay += dy * 20; }
        }
        this.vx[i] = this.vx[i] * fric + ax * dt;
        this.vy[i] = this.vy[i] * fric + ay * dt;
      }
      for (let i = 0; i < N; i++) {
        this.x[i] = wrap(this.x[i] + this.vx[i] * dt);
        this.y[i] = wrap(this.y[i] + this.vy[i] * dt);
      }
      for (let k = 0; k < this.T; k++) this.flash[k] *= Math.exp(-realDt * 3);
      // sound: a random grain listens to its crowd; dense crowds of one species sing its note
      const cam = this.u.cam;
      for (const tk of ticks) {
        if (tk.tick % 2) continue;
        for (let tries = 0; tries < 6; tries++) {
          const i = Math.floor(Math.random() * N);
          if (Math.abs(wrap(this.x[i] - cam.x)) > cam.viewH * cam.aspect * 0.5 || Math.abs(wrap(this.y[i] - cam.y)) > cam.viewH * 0.5) continue;
          let same = 0;
          const gx = Math.floor((this.x[i] + W / 2) / cs), gy = Math.floor((this.y[i] + W / 2) / cs);
          let j = this.heads[((((gy) % G) + G) % G) * G + ((((gx) % G) + G) % G)];
          while (j >= 0) { if (this.t[j] === this.t[i]) same++; j = this.next[j]; }
          if (same < 5) continue;
          const ti = this.t[i];
          const sp = this.u._audioSpatial(this.x[i], this.y[i]);
          this.u.audio.play({ midi: this.u.midiOf(this.degs[ti]), voice: 'marimba', vel: Math.min(0.2, 0.05 + same * 0.008) * Math.max(0.4, sp.att), pan: sp.pan, dur: 1.2 }, tk.time);
          const x = this.x[i], y = this.y[i];
          this.u.pending.push({ t: tk.time, kind: 'fn', fn: () => { this.flash[ti] = Math.max(this.flash[ti], 0.6); this.u.addRing(x, y, 0.1, 1.2, 0.7, this.cols[ti], 0.04, 0.7); } });
          this.u.lastPc = this.u.pcOf(this.degs[ti]);
          break;
        }
      }
    }
    _typeAt(yN) { return C.clamp(Math.floor(yN * this.T), 0, this.T - 1); }
    tap(x, y, yN) {
      const ty = this._typeAt(yN);
      for (let k = 0; k < 40; k++) {
        const i = Math.floor(Math.random() * this.N);
        const a = Math.random() * TAU, r = Math.random() * 0.8;
        this.x[i] = wrap(x + Math.cos(a) * r); this.y[i] = wrap(y + Math.sin(a) * r);
        this.vx[i] = this.vy[i] = 0; this.t[i] = ty;
      }
      this.flash[ty] = 1;
      const sp = this.u._audioSpatial(x, y);
      this.u.audio.play({ midi: this.u.midiOf(this.degs[ty]), voice: 'marimba', vel: 0.24, pan: sp.pan });
      this.u.addRing(x, y, 0.1, 1.5, 0.9, this.cols[ty], 0.05, 0.9);
      this.u._found('p-drop', 'a handful of one species — watch what it becomes');
    }
    holdStart(x, y) { this.hold = { x, y, t: 0 }; this.pull = { x, y, s: 0.3 }; }
    holdUpdate(x, y, dt) {
      if (!this.hold) return;
      this.hold.t += dt;
      this.pull = { x, y, s: Math.min(2, 0.3 + this.hold.t) };
    }
    holdEnd() {
      const h = this.hold;
      this.hold = null;
      this.pull = null;
      if (!h) return null;
      for (let i = 0; i < this.N; i++) {
        const dx = wrap(this.x[i] - h.x), dy = wrap(this.y[i] - h.y), d = Math.hypot(dx, dy) + 0.3;
        if (d < 5) { this.vx[i] += (dx / d) * 12 * (1 - d / 5); this.vy[i] += (dy / d) * 12 * (1 - d / 5); }
      }
      this.u.addShock(h.x, h.y, 3, 6, 0.7, 1.4, 0.5);
      this.u.audio.burst(0.5, this.u._audioSpatial(h.x, h.y).pan, null);
      return 'scatter';
    }
    dragMove(x, y, vx, vy) {
      for (let i = 0; i < this.N; i++) {
        const dx = wrap(this.x[i] - x), dy = wrap(this.y[i] - y);
        if (dx * dx + dy * dy < 1.2) { this.vx[i] += vx * 0.08; this.vy[i] += vy * 0.08; }
      }
    }
    drawMove(x, y, yN) {
      const ty = this._typeAt(yN);
      for (let i = 0; i < this.N; i++) {
        const dx = wrap(this.x[i] - x), dy = wrap(this.y[i] - y);
        if (dx * dx + dy * dy < 0.5) this.t[i] = ty;
      }
      this.flash[ty] = 0.8;
    }
    drawEnd() { return 'paint'; }
    key(i) {
      const ty = ((Math.round(i) % this.T) + this.T) % this.T;
      for (let j = 0; j < this.T; j++) this.M[ty][j] = Math.random() * 2 - 1;
      this.flash[ty] = 1.5;
      this.u.audio.play({ midi: this.u.midiOf(this.degs[ty]), voice: 'marimba', vel: 0.26 });
      this.u.audio.play({ midi: this.u.midiOf(this.degs[ty] + 2), voice: 'marimba', vel: 0.18 }, this.u.audio.now() + 0.12);
      this.u._found('p-key', 'one species changed its mind about all the others');
    }
    sprites(spr, inView) {
      const T = this.T;
      for (let i = 0; i < this.N; i++) {
        const x = this.x[i], y = this.y[i];
        if (!inView(x, y, 0.5)) continue;
        const t = this.t[i];
        spr(x, y, 0, 0.2, this.cols[t], 0.55 + this.flash[t] * 0.8, 1, 5);
      }
    }
    pick() { return null; }
    diveObject() { return null; }
  }

  // ==================================================================== MURMURATION
  // Reynolds boids by the thousand. You are the hawk: the flock folds around you.
  class Murmur {
    constructor(u) {
      this.u = u;
      this.gp = u.world.gp;
      this.simMode = 0;
      this.dustLayer = 0.45;
      const N = (this.N = this.gp.count);
      this.x = new Float32Array(N); this.y = new Float32Array(N);
      this.vx = new Float32Array(N); this.vy = new Float32Array(N);
      this.turn = new Float32Array(N);
      this.cs = 1.25;
      this.G = Math.floor(W / this.cs);
      this.cs = W / this.G;
      this.heads = new Int32Array(this.G * this.G);
      this.next = new Int32Array(N);
      this.align = this.gp.align;
      this.hold = null;
      this.lead = null;
      this.home = { x: 0, y: 0 };
      this.t = 0;
      this.gust = 0;
    }
    gpuInit(r, x, y) { r.seedDust(x, y, 0, 'uniform'); }
    enter(d) {
      if (d) { this.x.set(d.x); this.y.set(d.y); this.vx.set(d.vx); this.vy.set(d.vy); return; }
      for (let i = 0; i < this.N; i++) {
        this.x[i] = wrap(C.gauss(Math.random) * 4); this.y[i] = wrap(C.gauss(Math.random) * 3);
        const a = Math.random() * TAU;
        this.vx[i] = Math.cos(a) * 3; this.vy[i] = Math.sin(a) * 3;
      }
    }
    snapshot() { return { x: this.x.slice(), y: this.y.slice(), vx: this.vx.slice(), vy: this.vy.slice() }; }
    update(dt, realDt, ticks) {
      dt = Math.min(dt, 0.033);
      this.t += dt;
      const N = this.N, G = this.G, cs = this.cs, gp = this.gp;
      this.heads.fill(-1);
      for (let i = 0; i < N; i++) {
        const gx = Math.floor((this.x[i] + W / 2) / cs) % G, gy = Math.floor((this.y[i] + W / 2) / cs) % G;
        const c = ((gy + G) % G) * G + ((gx + G) % G);
        this.next[i] = this.heads[c];
        this.heads[c] = i;
      }
      // the flock's home wanders, so the murmuration travels and folds on its own
      this.home.x = Math.sin(this.t * 0.07) * 8 + Math.sin(this.t * 0.19) * 3;
      this.home.y = Math.cos(this.t * 0.05) * 6 + Math.sin(this.t * 0.23) * 2;
      const cur = this.u.cursor;
      const maxS = gp.speed * 1.4, minS = gp.speed * 0.55;
      let sumS = 0, inView = 0;
      const cam = this.u.cam;
      for (let i = 0; i < N; i++) {
        const xi = this.x[i], yi = this.y[i];
        let sx = 0, sy = 0, ax = 0, ay = 0, cx = 0, cy = 0, n = 0;
        const gx = Math.floor((xi + W / 2) / cs), gy = Math.floor((yi + W / 2) / cs);
        for (let oy = -1; oy <= 1; oy++) for (let ox = -1; ox <= 1; ox++) {
          let j = this.heads[((((gy + oy) % G) + G) % G) * G + ((((gx + ox) % G) + G) % G)];
          let cnt = 0;
          while (j >= 0 && cnt < 12) {
            if (j !== i) {
              const dx = wrap(this.x[j] - xi), dy = wrap(this.y[j] - yi), d2 = dx * dx + dy * dy;
              if (d2 < cs * cs) {
                if (d2 < 0.12) { sx -= dx / (d2 + 0.01); sy -= dy / (d2 + 0.01); }
                ax += this.vx[j]; ay += this.vy[j]; cx += dx; cy += dy; n++; cnt++;
              }
            }
            j = this.next[j];
          }
        }
        let fx = sx * 0.6, fy = sy * 0.6;
        if (n) {
          fx += (ax / n - this.vx[i]) * this.align + (cx / n) * gp.cohere * 2;
          fy += (ay / n - this.vy[i]) * this.align + (cy / n) * gp.cohere * 2;
        }
        const hx = wrap(this.home.x - xi), hy = wrap(this.home.y - yi);
        fx += hx * 0.12; fy += hy * 0.12;
        if (cur.active) {
          const dx = wrap(xi - cur.x), dy = wrap(yi - cur.y), d2 = dx * dx + dy * dy;
          if (d2 < 9) { const k = 30 / (d2 + 0.5); fx += dx * k; fy += dy * k; }
        }
        if (this.hold) {
          const dx = wrap(this.hold.x - xi), dy = wrap(this.hold.y - yi), d = Math.hypot(dx, dy) + 0.3;
          fx += (dx / d) * 6 + (-dy / d) * 5; fy += (dy / d) * 6 + (dx / d) * 5;
        }
        if (this.lead) {
          const dx = wrap(this.lead.x - xi), dy = wrap(this.lead.y - yi), d = Math.hypot(dx, dy) + 0.5;
          fx += (dx / d) * 7; fy += (dy / d) * 7;
        }
        const ovx = this.vx[i], ovy = this.vy[i];
        let vx = ovx + fx * dt, vy = ovy + fy * dt;
        const s = Math.hypot(vx, vy) + 1e-6;
        const cl = C.clamp(s, minS, maxS);
        vx *= cl / s; vy *= cl / s;
        this.turn[i] = Math.abs(ovx * vy - ovy * vx) / (cl * cl);
        this.vx[i] = vx; this.vy[i] = vy;
        sumS += cl;
        if (Math.abs(wrap(xi - cam.x)) < cam.viewH * cam.aspect * 0.5 && Math.abs(wrap(yi - cam.y)) < cam.viewH * 0.5) inView++;
      }
      for (let i = 0; i < N; i++) {
        this.x[i] = wrap(this.x[i] + this.vx[i] * dt);
        this.y[i] = wrap(this.y[i] + this.vy[i] * dt);
      }
      if (this.lead) this.lead.life -= realDt;
      if (this.lead && this.lead.life <= 0) this.lead = null;
      // the sound of thousands of wings, and a chirp when one turns hard
      this.gust += ((inView / N) * (sumS / N) - this.gust) * C.damp(2, realDt);
      if (this.u.gain > 0.05) this.u.audio.setStir(this.gust * 4 * this.u.gain, 0);
      for (const tk of ticks) {
        if (Math.random() > 0.45) continue;
        let best = -1, bt = 0.25;
        for (let k = 0; k < 30; k++) {
          const i = Math.floor(Math.random() * N);
          if (this.turn[i] > bt && Math.abs(wrap(this.x[i] - cam.x)) < cam.viewH * cam.aspect * 0.5 && Math.abs(wrap(this.y[i] - cam.y)) < cam.viewH * 0.5) { bt = this.turn[i]; best = i; }
        }
        if (best < 0) continue;
        const len = this.u.scale.length;
        const deg = len + Math.floor(Math.random() * len * 1.5);
        const sp = this.u._audioSpatial(this.x[best], this.y[best]);
        this.u.audio.play({ midi: this.u.midiOf(deg), timbre: 0.08, vel: 0.07 * Math.max(0.4, sp.att), pan: sp.pan, dur: 0.9 }, tk.time);
      }
    }
    tap(x, y, yN) {
      for (let i = 0; i < this.N; i++) {
        const dx = wrap(this.x[i] - x), dy = wrap(this.y[i] - y), d = Math.hypot(dx, dy) + 0.2;
        if (d < 4) { this.vx[i] += (dx / d) * 10; this.vy[i] += (dy / d) * 10; }
      }
      const sp = this.u._audioSpatial(x, y);
      this.u.audio.play({ midi: this.u.midiOf(degFromY(this.u, yN)), timbre: 0.1, vel: 0.2, pan: sp.pan });
      this.u.addRing(x, y, 0.1, 3, 1, this.u.palette.hot, 0.04, 0.7);
      this.u._found('b-startle', 'startled — watch the shape fold back together');
    }
    holdStart(x, y) { this.hold = { x, y, t: 0, voice: this.u.audio.sustain('hum') }; }
    holdUpdate(x, y, dt) {
      const h = this.hold;
      if (!h) return;
      h.x = x; h.y = y; h.t += dt;
      const k = Math.min(1, h.t / 3);
      if (h.voice) h.voice.set([0, 2, 4].map((d) => C.midiToFreq(this.u.midiOf(d + this.u.scale.length))), 0.04 + 0.07 * k, 0, 2, 900 + 1500 * k);
      this.u._found('b-roost', 'they are coming to roost around you');
    }
    holdEnd() {
      const h = this.hold;
      this.hold = null;
      if (h && h.voice) h.voice.stop(0.6);
      return 'release';
    }
    dragMove(x, y) { this.lead = { x, y, life: 1.5 }; }
    key(i) {
      this.align = 0.25 + ((((this.u.pcOf(i) % 5) + 5) % 5) * 0.35);
      this.u.audio.play({ midi: this.u.midiOf(i + this.u.scale.length), timbre: 0.1, vel: 0.22, dur: 2 });
      this.u._found('b-key', 'each note changes how tightly they fly');
    }
    ribbons(strip, toRel, cam) {
      const hw = (cam.viewH * cam.aspect) / 2 + 1, hh = cam.viewH / 2 + 1;
      const pts = new Float32Array(4);
      const pal = this.u.palette;
      for (let i = 0; i < this.N; i++) {
        const rx = wrap(this.x[i] - cam.x), ry = wrap(this.y[i] - cam.y);
        if (Math.abs(rx) > hw || Math.abs(ry) > hh) continue;
        pts[0] = rx; pts[1] = ry; pts[2] = rx - this.vx[i] * 0.05; pts[3] = ry - this.vy[i] * 0.05;
        const col = this.turn[i] > 0.2 ? pal.hot : pal.mid;
        strip(pts, 2, () => 0.035, () => col, (k) => (k ? 0.1 : 0.9));
      }
    }
    sprites(spr) {
      if (this.hold) spr(this.hold.x, this.hold.y, 0, 1 + Math.min(1, this.hold.t / 3), this.u.palette.accent, 0.3, 1, 3);
    }
    pick() { return null; }
    diveObject() { return null; }
  }

  Object.assign(C.GENUS_IMPL, { attractor: Attractor, flame: Flame, plife: PLife, murmur: Murmur });
})();
