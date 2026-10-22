'use strict';
// The crazier ones: a black hole, a Julia set, a hyperspace tunnel, a fractal cathedral,
// the Game of Life, and a lightning storm (which can also visit other worlds).
(function () {
  const C = window.COSMOS;
  const wrap = C.wrap;
  const TAU = Math.PI * 2;
  const pitchCol = (u, deg, l) => C.hsl(C.pcHue(u.pcOf(deg)), 0.85, l || 0.6);
  const degFromY = (u, yN) => {
    const len = u.scale.length;
    return Math.floor(yN * len * 2.2) - Math.floor(len * 0.6);
  };
  const near = (u, x, y) => u._audioSpatial(x, y);

  // ==================================================================== BLACK HOLE
  // Light from the stars behind it bends around it; its disk is brighter on the side turning toward you.
  // Matter you drop in spirals down and sings a rising chirp as it falls.
  class BlackHole {
    constructor(u) {
      this.u = u;
      this.gp = u.world.gp;
      this.simMode = 0;
      this.dustLayer = 0.55;
      this.Rh = this.gp.rh;
      this.spin = this.gp.spin;
      this.flare = 0;
      this.falling = [];
      this.hold = null;
    }
    gpuInit(r, x, y) { r.seedDust(0, 0, 0, 'rings'); }
    enter(d) { if (d) { this.Rh = d.Rh; this.spin = d.spin; } }
    snapshot() { return { Rh: this.Rh, spin: this.spin }; }
    _drop(x, y) {
      const d = Math.hypot(wrap(x), wrap(y));
      this.falling.push({ x, y, r0: Math.max(d, this.Rh * 2), t: 0, dur: 1.2 + d * 0.25, a: Math.atan2(wrap(y), wrap(x)) });
    }
    update(dt, realDt, ticks) {
      this.flare *= Math.exp(-dt * 2.5);
      if (this.hold) { this.hold.t += realDt; this.Rh = Math.min(4.2, this.Rh + realDt * 0.35); }
      // matter falls in: spiralling faster as it nears the horizon, its pitch rising
      for (const f of this.falling) {
        f.t += dt;
        const k = Math.min(1, f.t / f.dur);
        if (!f.sang && this.u.audio.started) {
          f.sang = true;
          const a = this.u.audio, ctx = a.ctx;
          const o = ctx.createOscillator(), g = ctx.createGain(), t0 = ctx.currentTime;
          o.frequency.setValueAtTime(110, t0);
          o.frequency.exponentialRampToValueAtTime(1400, t0 + f.dur);
          g.gain.setValueAtTime(0, t0);
          g.gain.linearRampToValueAtTime(0.06 * this.u.gain, t0 + f.dur * 0.8);
          g.gain.exponentialRampToValueAtTime(0.0005, t0 + f.dur + 0.05);
          o.connect(g); g.connect(a.synthIn);
          o.start(t0); o.stop(t0 + f.dur + 0.1);
        }
        if (k >= 1 && !f.done) {
          f.done = true;
          this.flare = 1;
          this.u.addShock(0, 0, 2.5, 6, 0.6, 1.5, 0.6);
          this.u.addRing(0, 0, this.Rh * 1.4, this.Rh * 4, 1, this.u.palette.accent, 0.04, C.flash.request(0.3));
          this.u.audio.play({ midi: this.u.midiOf(-this.u.scale.length), voice: 'bowl', vel: 0.2 * this.u.gain, dur: 5 });
        }
      }
      this.falling = this.falling.filter((f) => !f.done);
      // the disk hums a slow arpeggio as it turns
      for (const tk of ticks) {
        if (tk.tick % 4 || Math.random() < 0.4) continue;
        const deg = [0, 2, 4, 7][Math.floor(Math.random() * 4)] - (this.Rh > 2.5 ? this.u.scale.length : 0);
        this.u.audio.play({ midi: this.u.midiOf(deg), timbre: 0.15, vel: 0.07 * this.u.gain, pan: Math.sin(tk.tick * 0.7) * 0.6, dur: 3 }, tk.time);
      }
    }
    wells(addWell) { addWell(0, 0, 4 + this.Rh * 3, 1.6, this.Rh * 0.8, 9, 1.57, this.Rh * 0.6); }
    tap(x, y) {
      this._drop(x, y);
      this.u.addRing(x, y, 0.05, 1, 0.6, this.u.palette.hot, 0.05, 0.8);
      this.u._found('bh-drop', 'listen to it fall — the chirp rises as it nears the horizon');
    }
    dragMove(x, y, vx, vy) { this.spin = C.clamp(this.spin + (vx - vy) * 0.002, 0.2, 3); }
    holdStart() { this.hold = { t: 0 }; }
    holdUpdate() { this.u._found('bh-grow', 'it grows as long as you feed it'); }
    holdEnd() { this.hold = null; return 'grow'; }
    key(i) {
      this.flare = 1;
      this.u.audio.play({ midi: this.u.midiOf(i), timbre: 0.12, vel: 0.24, dur: 4 });
    }
    sprites(spr) {
      for (const f of this.falling) {
        const k = Math.min(1, f.t / f.dur);
        const r = f.r0 * (1 - k) + this.Rh * k;
        const a = f.a + k * k * 9;
        spr(Math.cos(a) * r, Math.sin(a) * r * 0.3, 0.05, 0.35, this.u.palette.hot, 1.2 * (1 - k * 0.5), 1, 9);
      }
    }
    field() { return { kind: 5, p1: [0, 0, this.Rh, this.spin], p2: [this.flare, 0, 0, 0], gain: 1, scan: [0, 1, 0, 0] }; }
    pick() { return null; }
    diveObject(x, y) { return Math.hypot(wrap(x), wrap(y)) < this.Rh * 1.6 ? { x: 0, y: 0, r: this.Rh, seed: C.hash(this.u.world.seed, 'singularity'), c2: this.u.palette.accent } : null; }
  }

  // ==================================================================== JULIA SET
  // z -> z^2 + c. Drag to move c and watch the whole shape melt into another one.
  const JULIAS = [[-0.8, 0.156], [0.285, 0.01], [-0.4, 0.6], [-0.70176, -0.3842], [0.355, 0.355], [-0.54, 0.54], [-0.835, -0.2321], [0.37, 0.1], [-0.123, 0.745], [-1.476, 0], [0.3, 0.5], [-0.1, 0.651]];
  class Julia {
    constructor(u) {
      this.u = u;
      this.gp = u.world.gp;
      this.simMode = 0;
      this.dustLayer = 0.2;
      this.c = JULIAS[this.gp.preset].slice();
      this.target = this.c.slice();
      this.t = 0;
      this.hold = null;
      this.voice = null;
    }
    gpuInit(r, x, y) { r.seedDust(x, y, 0, 'uniform'); }
    enter(d) { if (d) { this.c = d.c.slice(); this.target = d.c.slice(); } }
    snapshot() { return { c: this.c.slice() }; }
    update(dt, realDt) {
      this.t += dt;
      if (this.hold) {
        // breathe along the edge of the Mandelbrot set, where the Julia sets are most intricate
        this.hold.a += realDt * 0.3;
        const a = this.hold.a;
        this.target = [0.5 * Math.cos(a) - 0.25 * Math.cos(2 * a) + 0.02, 0.5 * Math.sin(a) - 0.25 * Math.sin(2 * a)];
      }
      const m = this.u.music;
      const wob = m.active ? m.bands.bass * 0.02 : 0;
      this.c[0] += (this.target[0] + Math.sin(this.t * 0.07) * 0.01 + wob - this.c[0]) * C.damp(1.5, dt);
      this.c[1] += (this.target[1] + Math.cos(this.t * 0.05) * 0.01 - this.c[1]) * C.damp(1.5, dt);
      // the shape's parameter is also the chord: c's angle picks the notes
      if (!this.voice && this.u.audio.started) this.voice = this.u.audio.sustain('hum');
      if (this.voice) {
        const ang = Math.atan2(this.c[1], this.c[0]);
        const step = Math.round(((ang + Math.PI) / TAU) * 7);
        const freqs = [0, 2, 4].map((d) => C.midiToFreq(this.u.midiOf(d + step)));
        this.voice.set(freqs, 0.04 * this.u.gain, 0, 0, 700 + Math.hypot(this.c[0], this.c[1]) * 900);
      }
    }
    tap(x, y, yN) {
      this.target = [this.c[0] + (Math.random() - 0.5) * 0.12, this.c[1] + (Math.random() - 0.5) * 0.12];
      this.u.audio.play({ midi: this.u.midiOf(degFromY(this.u, yN)), timbre: 0.45, vel: 0.22, pan: near(this.u, x, y).pan });
    }
    dragMove(x, y, vx, vy) {
      this.target = [C.clamp(this.target[0] + vx * 0.0015, -1.6, 0.6), C.clamp(this.target[1] + vy * 0.0015, -1.1, 1.1)];
      this.u._found('j-drag', 'you are moving c — every point of the plane is a different Julia set');
    }
    holdStart() { this.hold = { a: Math.atan2(this.c[1], this.c[0]) }; }
    holdUpdate() {}
    holdEnd() { this.hold = null; return 'breathe'; }
    key(i) {
      this.target = JULIAS[this.u.pcOf(i)].slice();
      this.u.audio.play({ midi: this.u.midiOf(i), timbre: 0.4, vel: 0.24, dur: 3 });
      this.u._found('j-key', 'every pitch has its own Julia set');
    }
    field() { return { kind: 6, p1: [0, 0, this.gp.scale, 0], p2: [this.c[0], this.c[1], 0, 0], gain: 1, scan: [0, 1, 0, 0] }; }
    pick() { return null; }
    diveObject() { return null; }
    dispose() { if (this.voice) { this.voice.stop(0.4); this.voice = null; } }
  }

  // ==================================================================== HYPERSPACE
  class Tunnel {
    constructor(u) {
      this.u = u;
      this.gp = u.world.gp;
      this.simMode = 0;
      this.dustLayer = 0.6;
      this.depth = 0;
      this.speed = this.gp.speed;
      this.boost = 0;
      this.twist = 0;
      this.sides = this.gp.sides;
      this.pulse = 0;
      this.hold = null;
    }
    gpuInit(r, x, y) { r.seedDust(x, y, 0, 'uniform'); }
    enter() {}
    snapshot() { return null; }
    update(dt, realDt, ticks) {
      const m = this.u.music;
      if (this.hold) { this.hold.t += realDt; this.boost = Math.min(6, this.boost + realDt * 2.5); }
      else this.boost *= Math.exp(-dt * 0.8);
      this.pulse *= Math.exp(-dt * 4);
      if (m.active) for (const ev of m.events) if (ev.type === 'kick') this.pulse = Math.max(this.pulse, ev.strength);
      this.depth += dt * (this.speed + this.boost * 2.2 + (m.active ? m.bands.bass * 1.5 : 0));
      this.twist += dt * 0.05;
      // the faster you travel, the busier the arpeggio of passing gates
      const rate = this.boost > 2 ? 1 : this.boost > 0.5 ? 2 : 4;
      for (const tk of ticks) {
        if (tk.tick % rate) continue;
        const len = this.u.scale.length;
        const deg = Math.floor(((tk.tick / rate) * 3) % (len * 2));
        this.u.audio.play({ midi: this.u.midiOf(deg), timbre: 0.7, vel: 0.06 * this.u.gain * (1 + this.boost * 0.15), pan: Math.sin(tk.tick) * 0.5, dur: 0.6 }, tk.time);
      }
    }
    wells(addWell) { addWell(0, 0, -3 - this.boost * 2, 2, 1, 0, 0, 0); }
    tap(x, y) {
      this.pulse = 1;
      this.boost += 1.5;
      this.u.audio.play({ midi: this.u.midiOf(this.u.scale.length + 2), timbre: 0.5, vel: 0.22, dur: 2 });
    }
    dragMove(x, y, vx, vy) { this.twist += (vx - vy) * 0.002; }
    holdStart() { this.hold = { t: 0, voice: this.u.audio.sustain('charge') }; }
    holdUpdate() {
      const k = Math.min(1, this.hold.t / 4);
      if (this.hold.voice) this.hold.voice.set(80 * Math.pow(2, k * 3), 0.05 + 0.08 * k, 0, 4 * k, 500 + 3000 * k);
      this.u._found('t-warp', 'hyperdrive');
    }
    holdEnd() {
      if (this.hold && this.hold.voice) this.hold.voice.stop(0.3);
      this.hold = null;
      this.pulse = 1;
      return 'warp';
    }
    key(i) {
      this.sides = 3 + (((this.u.pcOf(i) % 6) + 6) % 6);
      this.pulse = 0.8;
      this.u.audio.play({ midi: this.u.midiOf(i), timbre: 0.5, vel: 0.24, dur: 2 });
      this.u._found('t-key', 'each note rebuilds the tunnel with a different number of walls');
    }
    field() { return { kind: 7, p1: [0, 0, this.gp.size, this.depth], p2: [this.sides, this.twist, this.pulse, 0], gain: 1, scan: [0, 1, 0, 0] }; }
    pick() { return null; }
    diveObject(x, y) { return Math.hypot(wrap(x), wrap(y)) < 1.2 ? { x: 0, y: 0, r: 0.5, seed: C.hash(this.u.world.seed, 'end of the tunnel'), c2: this.u.palette.hot } : null; }
  }

  // ==================================================================== FRACTAL CATHEDRAL
  const FOLDS = [[3, 0, 0, 0], [3, 0.12, 0.08, 0], [3, 0.4, 0.2, 0], [3, 0.785, 0, 0], [3, 0.3, 0.6, 0]];
  class Cathedral {
    constructor(u) {
      this.u = u;
      this.gp = u.world.gp;
      this.simMode = 0;
      this.dustLayer = 0.15;
      this.k = FOLDS[this.gp.fold].slice();
      this.target = this.k.slice();
      this.yaw = 0.4;
      this.pitch = 0.3;
      this.band = 99;
      this.hold = null;
      this.t = 0;
    }
    gpuInit(r, x, y) { r.seedDust(x, y, 0, 'uniform'); }
    enter(d) { if (d) { this.k = d.k.slice(); this.target = d.k.slice(); } }
    snapshot() { return { k: this.k.slice() }; }
    update(dt, realDt, ticks) {
      this.t += dt;
      this.yaw += dt * 0.04;
      this.pitch = 0.3 + Math.sin(this.t * 0.03) * 0.25;
      if (this.hold) this.target[1] += realDt * 0.08;
      for (let i = 0; i < 4; i++) this.k[i] += (this.target[i] - this.k[i]) * C.damp(0.8, dt);
      this.band += dt * 4;
      // bells in the nave, slow and far apart
      for (const tk of ticks) {
        if (tk.tick % 8 || Math.random() < 0.5) continue;
        const deg = [0, 4, 7, 9][Math.floor(Math.random() * 4)] - this.u.scale.length;
        this.u.audio.play({ midi: this.u.midiOf(deg), voice: 'bowl', vel: 0.1 * this.u.gain, dur: 7 }, tk.time);
      }
    }
    tap(x, y, yN) {
      this.band = 0;
      this.u.audio.play({ midi: this.u.midiOf(degFromY(this.u, yN)), voice: 'bowl', vel: 0.24, dur: 6 });
      this.u._found('c-light', 'a wave of light travels through the nave');
    }
    dragMove(x, y, vx, vy) { this.yaw += vx * 0.004; this.pitch += vy * 0.003; }
    holdStart() { this.hold = { t: 0 }; }
    holdUpdate() { this.u._found('c-fold', 'holding folds the mirrors into a new building'); }
    holdEnd() { this.hold = null; return 'fold'; }
    key(i) {
      this.target = FOLDS[((this.u.pcOf(i) % FOLDS.length) + FOLDS.length) % FOLDS.length].slice();
      this.band = 0;
      this.u.audio.play({ midi: this.u.midiOf(i), voice: 'bowl', vel: 0.24, dur: 6 });
    }
    field() { return { kind: 8, p1: [0, 0, 0, 0], p2: [this.yaw, this.pitch, 0, this.band], p3: this.k, gain: 1, scan: [0, 1, 0, 0] }; }
    pick() { return null; }
    diveObject() { return null; }
  }

  // ==================================================================== GAME OF LIFE
  // Conway's rule (or a cousin) running on the GPU, one generation per sixteenth note.
  const RULES = [
    ['Conway', [3], [2, 3]], ['HighLife', [3, 6], [2, 3]], ['Day & Night', [3, 6, 7, 8], [3, 4, 6, 7, 8]],
    ['Seeds', [2], []], ['Maze', [3], [1, 2, 3, 4, 5]], ['Coral', [3], [4, 5, 6, 7, 8]], ['2x2', [3, 6], [1, 2, 5]],
  ];
  const mask = (arr) => arr.reduce((m, n) => m | (1 << n), 0);
  class Life {
    constructor(u) {
      this.u = u;
      this.gp = u.world.gp;
      this.simMode = 0;
      this.dustLayer = 0.2;
      this.rule = this.gp.rule;
      this.brushes = [];
      this.brush = new Float32Array(48);
      this.steps = 0;
      this.readT = 0.3;
      this.buf = null;
      this.prev = null;
      this.every = this.gp.every;
    }
    gpuInit(r, x, y) { r.seedDust(x, y, 0, 'uniform'); }
    enter() {}
    snapshot() { return null; }
    _brush(x, y, r, amt) { if (this.brushes.length >= 12) this.brushes.shift(); this.brushes.push([x, y, r, amt]); }
    update(dt, realDt, ticks) {
      for (const tk of ticks) if (tk.tick % this.every === 0) this.steps++;
      this.readT -= realDt;
      if (this.readT <= 0 && this.u.renderer && this.u.gpu && this.u.gpu.life) {
        this.readT = 0.25;
        const b = this.u.renderer.readField('life', this.u.gpu);
        // births in view become notes: the higher on screen, the higher the note
        if (this.prev && this.u.gain > 0.05) {
          const cam = this.u.cam, len = this.u.scale.length;
          let played = 0;
          for (let k = 0; k < 40 && played < 3; k++) {
            const ix = Math.floor(Math.random() * 64), iy = Math.floor(Math.random() * 64);
            const i = (iy * 64 + ix) * 4;
            if (b[i] - this.prev[i] > 0.15) {
              const x = (ix + 0.5) / 64 * C.W - C.W / 2, y = (iy + 0.5) / 64 * C.W - C.W / 2;
              const sp = near(this.u, x, y);
              if (!sp.visible) continue;
              const deg = Math.floor(((wrap(y - cam.y) / cam.viewH) + 0.5) * len * 2);
              this.u.audio.play({ midi: this.u.midiOf(deg), voice: 'marimba', vel: 0.1 * sp.att, pan: sp.pan, dur: 0.8 });
              played++;
            }
          }
        }
        this.prev = b.slice();
      }
      if (this.u.music.active) for (const ev of this.u.music.events) if (ev.type === 'kick') {
        const cam = this.u.cam;
        this._brush(wrap(cam.x + (Math.random() - 0.5) * cam.viewH), wrap(cam.y + (Math.random() - 0.5) * cam.viewH * 0.7), 0.6, 0.5 * ev.strength);
      }
    }
    tap(x, y, yN) {
      this._brush(x, y, 0.7, 0.5);
      this.u.audio.play({ midi: this.u.midiOf(degFromY(this.u, yN)), voice: 'marimba', vel: 0.22, pan: near(this.u, x, y).pan });
      this.u._found('l-seed', 'a random soup — some of it will live');
    }
    dragMove(x, y) { this._brush(x, y, 0.3, 0.7); }
    drawStart(x, y) { this._brush(x, y, 0.5, -1); }
    drawMove(x, y) { this._brush(x, y, 0.5, -1); }
    drawEnd() { return 'erase'; }
    holdStart(x, y) { this.hold = { x, y }; }
    holdUpdate(x, y) { this._brush(x, y, 1.2, 0.35); }
    holdEnd() { this.hold = null; return 'soup'; }
    key(i) {
      this.rule = ((this.u.pcOf(i) % RULES.length) + RULES.length) % RULES.length;
      this.u.audio.play({ midi: this.u.midiOf(i), voice: 'marimba', vel: 0.24 });
      this.u._found('l-rule', 'the laws of life just changed: ' + RULES[this.rule][0]);
    }
    foodAt(x, y) { return this.prev ? C.fieldAt(this.prev, x, y, 0) * 0.5 : 0; }
    graze(x, y, amt) { (this.gz || (this.gz = new C.GrazeMap())).add(x, y, amt); }
    field() {
      this.brush.fill(0);
      this.brushes.forEach((b, i) => this.brush.set(b, i * 4));
      let n = this.brushes.length;
      // only heavy grazing clears cells here (Life's eraser is all or nothing)
      if (this.gz) for (const b of this.gz.brushes(Math.min(3, 12 - n), 40)) if (b[3] <= -0.4) { b[3] = -1; b[2] = 0.45; this.brush.set(b, n * 4); n++; }
      this.brushes = [];
      const steps = Math.min(2, this.steps);
      this.steps = 0;
      const res = C.MOBILE ? 192 : 256;
      return { kind: 9, res, p1: [res, 0, 0, 0], steps, birth: mask(RULES[this.rule][1]), survive: mask(RULES[this.rule][2]), brush: this.brush, nBrush: n, gain: 1, scan: [0, 1, 0, 0] };
    }
    pick() { return null; }
    diveObject() { return null; }
  }

  // ==================================================================== LIGHTNING STORM
  // Charged poles; fractal bolts leap between them on the beat. Light first, thunder later.
  class Storm {
    constructor(u, visitor) {
      this.u = u;
      this.visitor = !!visitor;
      this.simMode = 0;
      this.dustLayer = 0.5;
      this.poles = [];
      this.bolts = [];
      this.hold = null;
      this.drag = null;
    }
    gpuInit(r, x, y) { r.seedDust(x, y, 0, 'uniform'); }
    enter(d) {
      if (d) { this.poles = d.poles.map((p) => Object.assign({}, p)); return; }
      const r = C.rng(this.u.world.seed ^ 0x77e);
      const n = this.visitor ? 2 : 5;
      for (let i = 0; i < n; i++) {
        const a = (i / n) * TAU + r() * 0.5, d = 4 + r() * 6;
        const deg = Math.floor(r() * this.u.scale.length * 2);
        this.poles.push({ x: wrap(Math.cos(a) * d), y: wrap(Math.sin(a) * d), deg, col: pitchCol(this.u, deg, 0.7), glow: 0 });
      }
    }
    snapshot() { return { poles: this.poles.map((p) => Object.assign({}, p)) }; }
    _bolt(ax, ay, bx, by, power, deg) {
      // midpoint displacement with forks
      const segs = [];
      const split = (x0, y0, x1, y1, disp, depth) => {
        if (depth === 0) { segs.push([x0, y0, x1, y1]); return; }
        const mx = (x0 + x1) / 2 + (Math.random() - 0.5) * disp, my = (y0 + y1) / 2 + (Math.random() - 0.5) * disp;
        split(x0, y0, mx, my, disp * 0.55, depth - 1);
        split(mx, my, x1, y1, disp * 0.55, depth - 1);
        if (depth > 2 && Math.random() < 0.35) {
          const a = Math.atan2(y1 - y0, x1 - x0) + (Math.random() - 0.5) * 1.6, l = Math.hypot(x1 - x0, y1 - y0) * 0.6;
          split(mx, my, mx + Math.cos(a) * l, my + Math.sin(a) * l, disp * 0.5, depth - 2);
        }
      };
      const dx = wrap(bx - ax), dy = wrap(by - ay);
      split(ax, ay, ax + dx, ay + dy, Math.hypot(dx, dy) * 0.35, 6);
      this.bolts.push({ segs, life: 0.35, t: 0, power });
      const midX = ax + dx / 2, midY = ay + dy / 2;
      const allow = C.flash.request(0.25 * power);
      for (let k = 0; k < 4; k++) this.u.addShock(wrap(ax + dx * k / 3), wrap(ay + dy * k / 3), 1.2 * power * allow, 5, 0.4, 1.8, 0.3);
      const sp = near(this.u, midX, midY);
      this.u.audio.play({ midi: this.u.midiOf(deg), timbre: 0.6, vel: 0.18 * power * sp.att, pan: sp.pan, dur: 1.5 });
      // thunder: arrives late with distance, and lower
      const delay = 0.15 + Math.hypot(wrap(midX - this.u.cam.x), wrap(midY - this.u.cam.y)) * 0.04;
      const a = this.u.audio;
      if (a.started && sp.att > 0.05) {
        const ctx = a.ctx, t0 = ctx.currentTime + delay;
        const n = ctx.createBufferSource(); n.buffer = a.noiseBuf;
        const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.setValueAtTime(900, t0); lp.frequency.exponentialRampToValueAtTime(90, t0 + 1.6);
        const g = ctx.createGain(); g.gain.setValueAtTime(0, t0); g.gain.linearRampToValueAtTime(0.16 * power * sp.att, t0 + 0.04); g.gain.exponentialRampToValueAtTime(0.0005, t0 + 2.2);
        const p = ctx.createStereoPanner(); p.pan.value = sp.pan;
        n.connect(lp); lp.connect(g); g.connect(p); p.connect(a.synthIn);
        n.start(t0, Math.random()); n.stop(t0 + 2.3);
      }
    }
    update(dt, realDt, ticks) {
      for (const b of this.bolts) b.t += realDt;
      this.bolts = this.bolts.filter((b) => b.t < b.life);
      for (const p of this.poles) p.glow *= Math.exp(-realDt * 3);
      const chance = this.visitor ? 0.06 : 0.22;
      for (const tk of ticks) {
        if (tk.tick % 2 || Math.random() > chance || this.poles.length < 2) continue;
        const a = this.poles[Math.floor(Math.random() * this.poles.length)];
        let b = a;
        while (b === a) b = this.poles[Math.floor(Math.random() * this.poles.length)];
        this.u.pending.push({ t: tk.time, kind: 'fn', fn: () => { a.glow = b.glow = 1; this._bolt(a.x, a.y, b.x, b.y, 0.7, a.deg); } });
      }
      if (this.drag) {
        this.drag.cd -= realDt;
        if (this.drag.cd <= 0) {
          this.drag.cd = 0.09;
          const p = this._nearest(this.drag.x, this.drag.y);
          if (p) { p.glow = 1; this._bolt(p.x, p.y, this.drag.x, this.drag.y, 0.5, p.deg); }
        }
      }
      if (this.u.music.active) for (const ev of this.u.music.events) if (ev.type === 'kick' && this.poles.length > 1) {
        const a = this.poles[Math.floor(Math.random() * this.poles.length)], b = this.poles[Math.floor(Math.random() * this.poles.length)];
        if (a !== b) this._bolt(a.x, a.y, b.x, b.y, 0.6 + ev.strength * 0.6, a.deg);
      }
    }
    _nearest(x, y) {
      let best = null, bd = 1e9;
      for (const p of this.poles) { const d = Math.hypot(wrap(p.x - x), wrap(p.y - y)); if (d < bd) { bd = d; best = p; } }
      return best;
    }
    tap(x, y) {
      const p = this._nearest(x, y);
      if (p) { p.glow = 1; this._bolt(p.x, p.y, x, y, 1, p.deg); }
      this.u._found('s-strike', 'count the seconds between the flash and the thunder');
    }
    dragStart(x, y) { this.drag = { x, y, cd: 0 }; }
    dragMove(x, y) { if (this.drag) { this.drag.x = x; this.drag.y = y; } this.u._found('s-plasma', 'a plasma globe, with your finger on the glass'); }
    dragEnd() { this.drag = null; }
    holdStart(x, y, yN) { this.hold = { x, y, t: 0, deg: degFromY(this.u, yN || 0.5), voice: this.u.audio.sustain('charge') }; }
    holdUpdate(x, y, dt) {
      const h = this.hold;
      h.x = x; h.y = y; h.t += dt;
      const k = Math.min(1, h.t / 2.5);
      if (h.voice) h.voice.set(60 * (1 + k * 3), 0.04 + 0.08 * k, 0, 9 * k, 800 + 3000 * k);
    }
    holdEnd() {
      const h = this.hold;
      this.hold = null;
      if (!h) return null;
      if (h.voice) h.voice.stop(0.05);
      const k = Math.min(1, h.t / 2.5);
      for (const p of this.poles) { p.glow = 1; this._bolt(p.x, p.y, h.x, h.y, 0.6 + k, p.deg); }
      if (k > 0.7 && this.poles.length < 8) {
        this.poles.push({ x: h.x, y: h.y, deg: h.deg, col: pitchCol(this.u, h.deg, 0.7), glow: 1 });
        this.u._found('s-pole', 'a new pole — the storm has another place to strike');
      }
      return 'storm';
    }
    key(i, x, y) {
      const pc = this.u.pcOf(i);
      const src = this.poles.filter((p) => this.u.pcOf(p.deg) === pc);
      const from = src.length ? src : [this._nearest(x, y)];
      for (const p of from) if (p) { p.glow = 1; this._bolt(p.x, p.y, x, y, 0.8, i); }
    }
    ribbons(strip, toRel, cam) {
      for (const b of this.bolts) {
        const k = 1 - b.t / b.life;
        const flick = 0.6 + 0.4 * Math.sin(b.t * 90);
        for (const [x0, y0, x1, y1] of b.segs) {
          const ox = wrap(x0 - cam.x), oy = wrap(y0 - cam.y);
          const pts = new Float32Array([ox, oy, ox + (x1 - x0), oy + (y1 - y0)]);
          strip(pts, 2, () => 0.12 * b.power, () => this.u.palette.accent, () => 0.25 * k * flick);
          strip(pts, 2, () => 0.03, () => [1, 1, 1], () => 1.4 * k * flick);
        }
      }
    }
    sprites(spr, inView) {
      for (const p of this.poles) {
        if (!inView(p.x, p.y, 1)) continue;
        spr(p.x, p.y, 0.05, 1 + p.glow, p.col, 0.25 + p.glow * 0.6, 1, 6);
        spr(p.x, p.y, 0.05, 0.35, [1, 1, 1], 0.8 + p.glow, 1, 20);
      }
    }
    pick(x, y) {
      for (const p of this.poles) if (Math.hypot(wrap(p.x - x), wrap(p.y - y)) < 0.5) return { type: 'pole', obj: p };
      return null;
    }
    diveObject(x, y) {
      const h = this.pick(x, y);
      return h ? { x: h.obj.x, y: h.obj.y, r: 0.4, seed: C.hash(this.u.world.seed, 'pole', Math.round(h.obj.x * 10)), c2: h.obj.col } : null;
    }
    dispose() { if (this.hold && this.hold.voice) this.hold.voice.stop(0.1); }
  }

  Object.assign(C.GENUS_IMPL, { blackhole: BlackHole, julia: Julia, tunnel: Tunnel, cathedral: Cathedral, life: Life, storm: Storm });
})();
