'use strict';
// Three more media, made for touch: a real fluid, a ripple tank, and a world that is its own oscilloscope.
(function () {
  const C = window.COSMOS;
  const wrap = C.wrap;
  const TAU = Math.PI * 2;
  const pitchCol = (u, deg, l) => C.hsl(C.pcHue(u.pcOf(deg)), 0.85, l || 0.6);
  const degFromY = (u, yN) => {
    const len = u.scale.length;
    return Math.floor(yN * len * 2.2) - Math.floor(len * 0.6);
  };

  // ==================================================================== FLUID
  // Navier-Stokes on the GPU (Stam's stable fluids). Your finger pushes the fluid and pours ink;
  // vortices are kept alive (vorticity confinement), and the dust is carried by the same flow.
  class Fluid {
    constructor(u) {
      this.u = u;
      this.gp = u.world.gp;
      this.simMode = 5;
      this.dustLayer = 0.45;
      this.queue = [];
      this.splat = new Float32Array(32);
      this.splatV = new Float32Array(32);
      this.splatC = new Float32Array(32);
      this.hold = null;
      this.t = 0;
      this.autoT = 0.5;
      this.hue = Math.random();
    }
    gpuInit(r, x, y) { r.seedDust(x, y, 0, 'uniform'); }
    enter() {}
    snapshot() { return null; }
    _ink(deg, k) {
      const c = pitchCol(this.u, deg, 0.55);
      return c.map((v) => v * (k || 1) * 2.2);
    }
    add(x, y, vx, vy, col, r) {
      if (this.queue.length >= 8) this.queue.shift();
      this.queue.push([x, y, r || 0.7, vx, vy, col]);
    }
    update(dt, realDt, ticks) {
      this.t += dt;
      const cam = this.u.cam;
      // the fluid is never still: soft currents arrive on their own
      this.autoT -= dt;
      if (this.autoT <= 0) {
        this.autoT = 0.8 + Math.random() * 1.6;
        const a = Math.random() * TAU, x = wrap(cam.x + (Math.random() - 0.5) * cam.viewH * 1.2), y = wrap(cam.y + (Math.random() - 0.5) * cam.viewH * 0.9);
        const deg = Math.floor(Math.random() * this.u.scale.length * 2);
        this.add(x, y, Math.cos(a) * 9, Math.sin(a) * 9, this._ink(deg, 0.5), 0.9);
      }
      if (this.hold) {
        const h = this.hold;
        h.t += realDt;
        const a = h.t * 5;
        const k = Math.min(1, h.t / 2);
        this.add(h.x + Math.cos(a) * 0.4, h.y + Math.sin(a) * 0.4, -Math.sin(a) * 18 * k, Math.cos(a) * 18 * k, this._ink(h.deg + Math.floor(h.t * 2) % 3, 0.35 + k * 0.4), 0.6);
      }
      if (this.u.music.active) {
        for (const ev of this.u.music.events) if (ev.type === 'kick' || (ev.type === 'onset' && Math.random() < 0.3)) {
          const a = Math.random() * TAU;
          const x = wrap(cam.x + (Math.random() - 0.5) * cam.viewH), y = wrap(cam.y + (Math.random() - 0.5) * cam.viewH * 0.8);
          let pc = 0, best = 0;
          for (let i = 0; i < 12; i++) if (this.u.music.chroma[i] > best) { best = this.u.music.chroma[i]; pc = i; }
          this.add(x, y, Math.cos(a) * 14 * ev.strength, Math.sin(a) * 14 * ev.strength, C.hsl(C.pcHue(pc), 0.85, 0.55).map((v) => v * 0.7), 1);
        }
      }
    }
    tap(x, y, yN) {
      const deg = degFromY(this.u, yN);
      for (let k = 0; k < 5; k++) {
        const a = (k / 5) * TAU + Math.random();
        this.add(x, y, Math.cos(a) * 16, Math.sin(a) * 16, this._ink(deg + (k % 2) * 2, 0.6), 0.45);
      }
      const sp = this.u._audioSpatial(x, y);
      this.u.audio.play({ midi: this.u.midiOf(deg), voice: 'drop', vel: 0.24, pan: sp.pan, dur: 1.2 });
      this.u._found('fl-tap', 'ink, dropped into a living fluid');
    }
    dragMove(x, y, vx, vy) {
      this.hue = (this.hue + 0.004) % 1;
      this.add(x, y, vx * 1.2, vy * 1.2, C.hsl(this.hue, 0.85, 0.55).map((v) => v * 0.9), 0.55);
    }
    holdStart(x, y, yN) { this.hold = { x, y, t: 0, deg: degFromY(this.u, yN || 0.5), voice: this.u.audio.sustain('hum') }; }
    holdUpdate(x, y, dt) {
      const h = this.hold;
      if (!h) return;
      h.x = x; h.y = y;
      if (h.voice) h.voice.set([0, 2, 4].map((d) => C.midiToFreq(this.u.midiOf(h.deg + d))), 0.04 + 0.06 * Math.min(1, h.t / 2), 0, 3, 600 + 1200 * Math.min(1, h.t / 2));
      this.u._found('fl-hold', 'a whirlpool, stirred by your hand');
    }
    holdEnd() {
      if (this.hold && this.hold.voice) this.hold.voice.stop(0.8);
      this.hold = null;
      return 'whirl';
    }
    key(i, x, y) {
      const a = Math.random() * TAU;
      this.add(x, y, Math.cos(a) * 22, Math.sin(a) * 22, this._ink(i, 0.9), 0.5);
      this.u.audio.play({ midi: this.u.midiOf(i), voice: 'drop', vel: 0.24, dur: 1.4 });
    }
    field() {
      const q = this.queue;
      this.splat.fill(0); this.splatV.fill(0); this.splatC.fill(0);
      q.forEach(([x, y, r, vx, vy, col], i) => {
        this.splat.set([x, y, r, 0], i * 4);
        this.splatV.set([vx, vy, 0, 0], i * 4);
        this.splatC.set([col[0], col[1], col[2], 0], i * 4);
      });
      const n = q.length;
      this.queue = [];
      const m = C.MOBILE;
      return {
        kind: 3, res: m ? 128 : 192, dyeRes: m ? 384 : 640, iters: m ? 14 : 22, curl: this.gp.curl,
        velDiss: 0.25, dyeDiss: this.gp.dyeDiss, splat: this.splat, splatV: this.splatV, splatC: this.splatC, nSplat: n, gain: 1, scan: [0, 1, 0, 0],
      };
    }
    pick() { return null; }
    diveObject() { return null; }
  }

  // ==================================================================== RIPPLE TANK
  // The 2D wave equation. Every source sings a note and rings the water at a rate tied to its pitch,
  // so a chord becomes an interference pattern. Drag a finger for a wake.
  class Ripple {
    constructor(u) {
      this.u = u;
      this.gp = u.world.gp;
      this.simMode = 6;
      this.dustLayer = 0.3;
      this.sources = [];
      this.drops = [];
      this.srcs = new Float32Array(32);
      this.hold = null;
      this.t = 0;
      this.rainT = 1;
    }
    gpuInit(r, x, y) { r.seedDust(x, y, 0, 'uniform'); }
    enter(d) {
      if (d) { this.sources = d.sources.map((s) => Object.assign({}, s, { voice: null })); return; }
      const r = C.rng(this.u.world.seed ^ 0x21);
      for (let i = 0; i < 2; i++) this._source((r() - 0.5) * 6, (r() - 0.5) * 6, Math.floor(r() * this.u.scale.length * 1.5), 999);
    }
    snapshot() { return { sources: this.sources.map((s) => Object.assign({}, s, { voice: null })) }; }
    _freq(deg) { return 0.55 * Math.pow(2, deg / this.u.scale.length); }
    _source(x, y, deg, life) {
      if (this.sources.length >= 6) { const old = this.sources.shift(); if (old.voice) old.voice.stop(0.5); }
      const s = { x: wrap(x), y: wrap(y), deg, f: this._freq(deg), amp: 0, target: 1, life, age: 0, phase: Math.random() * TAU, voice: null, col: pitchCol(this.u, deg, 0.62) };
      this.sources.push(s);
      return s;
    }
    _drop(x, y, amp, r) { if (this.drops.length < 6) this.drops.push([x, y, r || 0.3, amp]); }
    update(dt, realDt, ticks) {
      this.t += dt;
      const g = this.u.gain;
      for (const s of this.sources) {
        s.age += dt;
        s.phase += TAU * s.f * dt;
        if (s.age > s.life) s.target = 0;
        s.amp += (s.target - s.amp) * C.damp(1.2, dt);
        // each source also sings, softly, as long as it rings the water
        if (!s.voice && this.u.audio.started) s.voice = this.u.audio.sustain('hum');
        if (s.voice) {
          const sp = this.u._audioSpatial(s.x, s.y);
          const f = C.midiToFreq(this.u.midiOf(s.deg));
          s.voice.set([f, f * 2.0, f * 1.5], 0.035 * s.amp * Math.max(0.3, sp.att) * g, sp.pan, 0, 900);
        }
      }
      const dead = this.sources.filter((s) => s.target === 0 && s.amp < 0.02);
      for (const s of dead) if (s.voice) s.voice.stop(0.3);
      if (dead.length) this.sources = this.sources.filter((s) => !dead.includes(s));
      // rain: a drop now and then, so the surface is never glass
      this.rainT -= dt;
      if (this.rainT <= 0) {
        this.rainT = 0.6 + Math.random() * 2.5;
        const cam = this.u.cam;
        const x = wrap(cam.x + (Math.random() - 0.5) * cam.viewH * 1.4), y = wrap(cam.y + (Math.random() - 0.5) * cam.viewH);
        this._drop(x, y, -0.5, 0.25);
        const len = this.u.scale.length;
        const sp = this.u._audioSpatial(x, y);
        if (Math.random() < 0.6) this.u.audio.play({ midi: this.u.midiOf(len + Math.floor(Math.random() * len)), voice: 'drop', vel: 0.08 * Math.max(0.3, sp.att), pan: sp.pan, dur: 0.8 });
      }
      if (this.hold) this.hold.t += realDt;
      if (this.u.music.active) for (const ev of this.u.music.events) if (ev.type === 'kick') {
        const cam = this.u.cam;
        this._drop(wrap(cam.x + (Math.random() - 0.5) * cam.viewH), wrap(cam.y + (Math.random() - 0.5) * cam.viewH * 0.7), -0.9 * ev.strength, 0.45);
      }
    }
    tap(x, y, yN) {
      const deg = degFromY(this.u, yN);
      this._drop(x, y, -1.1, 0.35);
      const sp = this.u._audioSpatial(x, y);
      this.u.audio.play({ midi: this.u.midiOf(deg), voice: 'drop', vel: 0.25, pan: sp.pan, dur: 1.2 });
      this.u._found('rp-tap', 'a drop — hold to make a source that rings');
    }
    holdStart(x, y, yN) {
      const deg = degFromY(this.u, yN || 0.5);
      this.hold = { t: 0, s: this._source(x, y, deg, 999) };
    }
    holdUpdate(x, y, dt, yN) {
      const h = this.hold;
      if (!h) return;
      h.s.x = x; h.s.y = y;
      if (yN != null) {
        const deg = degFromY(this.u, yN);
        if (deg !== h.s.deg) { h.s.deg = deg; h.s.f = this._freq(deg); h.s.col = pitchCol(this.u, deg, 0.62); }
      }
      h.s.target = 1.4;
      this.u._found('rp-hold', 'two sources, two notes — their interference is the chord');
    }
    holdEnd() {
      const h = this.hold;
      this.hold = null;
      if (h) { h.s.target = 1; h.s.life = h.s.age + 30; }
      return 'source';
    }
    dragMove(x, y, vx, vy) {
      if (Math.hypot(vx, vy) > 1) this._drop(x, y, -0.25, 0.25);
      this.u._found('rp-wake', 'a wake — the same shape a duck leaves');
    }
    key(i, x, y) {
      const s = this._source(x, y, i, 14);
      s.amp = 0.5;
      this.u.audio.play({ midi: this.u.midiOf(i), voice: 'drop', vel: 0.22, dur: 1.5 });
    }
    field() {
      this.srcs.fill(0);
      let n = 0;
      for (const s of this.sources) {
        if (n >= 8) break;
        this.srcs.set([s.x, s.y, 0.3, Math.sin(s.phase) * 0.05 * s.amp], n * 4);
        n++;
      }
      for (const d of this.drops) {
        if (n >= 8) break;
        this.srcs.set([d[0], d[1], d[2], d[3] * 0.35], n * 4);
        n++;
      }
      this.drops = [];
      return { kind: 4, res: C.MOBILE ? 256 : 384, steps: 3, c2: 0.22, damp: this.gp.damp, srcs: this.srcs, nSrc: n, gain: 1, relief: 7, scan: [0, 1, 0, 0] };
    }
    sprites(spr, inView) {
      for (const s of this.sources) {
        if (!inView(s.x, s.y, 1)) continue;
        spr(s.x, s.y, 0.05, 0.35 / 0.8, s.col, 0.4 + 0.4 * Math.max(0, Math.sin(s.phase)) * s.amp, 0, 0.12);
        spr(s.x, s.y, 0.05, 0.6, s.col, 0.25 * s.amp, 1, 6);
      }
    }
    pick(x, y) {
      for (const s of this.sources) if (Math.hypot(wrap(s.x - x), wrap(s.y - y)) < 0.5) return { type: 'source', obj: s };
      return null;
    }
    diveObject() { return null; }
    dispose() { for (const s of this.sources) if (s.voice) { s.voice.stop(0.3); s.voice = null; } }
  }

  // ==================================================================== OSCILLOSCOPE
  // A world that draws its own sound: left channel = x, right channel = y (as on a scope in X-Y mode).
  // Two notes a fifth apart draw a 3:2 figure; a chord is a knot. With your song playing it draws the
  // song itself (and for mono sources, the song's phase portrait: the signal against itself, delayed).
  class Scope {
    constructor(u) {
      this.u = u;
      this.gp = u.world.gp;
      this.simMode = 0;
      this.dustLayer = 0.25;
      this.pairs = [];
      this.N = 1024;
      this.L = new Float32Array(2048);
      this.R = new Float32Array(2048);
      this.frames = [];
      this.twist = 0;
      this.pluck = 0;
      this.knot = 0;
      this.hold = false;
      this.norm = 0.2;
      this.degs = this.gp.degs.slice();
    }
    gpuInit(r, x, y) { r.seedDust(x, y, 0, 'uniform'); }
    enter(d) { if (d) this.degs = d.degs.slice(); }
    snapshot() { return { degs: this.degs.slice() }; }
    _freqs() {
      const base = C.midiToFreq(this.u.midiOf(this.degs[0]) - 12);
      const other = C.midiToFreq(this.u.midiOf(this.degs[1]) - 12);
      return [base, other];
    }
    update(dt, realDt) {
      const a = this.u.audio;
      if (!a.started) return;
      if (!this.voice) this.voice = a.scopeVoice();
      const g = this.u.gain;
      const [fx, fy] = this._freqs();
      this.twist *= Math.exp(-dt * 0.3);
      this.pluck *= Math.exp(-dt * 2.5);
      this.knot += ((this.hold ? 1 : 0) - this.knot) * C.damp(2, dt);
      // a hair of detune makes the figure slowly turn, like a 3D object rotating
      this.voice.set(fx, fy * (1 + 0.0006 + this.twist * 0.002), (0.05 + this.pluck * 0.08) * g, this.knot * 0.6);
      // your song: read what is actually sounding. The world's own tones: draw their exact figure,
      // the same curve a real scope would trace from these two sine waves.
      const m = this.u.music;
      let haveMusic = false;
      if (m.active && m.readStereo) haveMusic = m.readStereo(this.L, this.R);
      if (!haveMusic) {
        this.phase = (this.phase || 0) + realDt * TAU * (fy * (0.0006 + this.twist * 0.002));
        const span = 3 / fx, amp = 1 + this.pluck * 0.6;
        for (let i = 0; i < this.N; i++) {
          const t = (i / this.N) * span;
          this.L[i] = Math.sin(TAU * fx * t) * amp;
          this.R[i] = (Math.sin(TAU * fy * t + this.phase) + this.knot * 0.6 * Math.sin(TAU * fx * 3 * t)) * amp;
        }
      }
      let mx = 1e-4;
      for (let i = 0; i < this.N; i++) mx = Math.max(mx, Math.abs(this.L[i]), Math.abs(this.R[i]));
      this.norm += (mx - this.norm) * C.damp(4, realDt);
      const sc = 8.5 / Math.max(this.norm, 0.02);
      const pts = new Float32Array(this.N * 2);
      for (let i = 0; i < this.N; i++) { pts[i * 2] = this.L[i] * sc; pts[i * 2 + 1] = this.R[i] * sc; }
      this.frames.unshift(pts);
      if (this.frames.length > 3) this.frames.pop();
    }
    tap(x, y, yN) {
      this.pluck = 1;
      this.u.addShock(0, 0, 2, 5, 0.6, 1.2, 0.3);
      const sp = this.u._audioSpatial(x, y);
      this.u.audio.play({ midi: this.u.midiOf(degFromY(this.u, yN)), timbre: 0.1, vel: 0.2, pan: sp.pan });
      this.u._found('sc-tap', 'what you see is exactly what you hear');
    }
    dragMove(x, y, vx, vy) {
      this.twist = C.clamp(this.twist + (vx + vy) * 0.01, -3, 3);
      this.u._found('sc-twist', 'detuning one note makes the figure turn');
    }
    holdStart() { this.hold = true; }
    holdUpdate() { this.u._found('sc-knot', 'a third tone ties the figure into a knot'); }
    holdEnd() { this.hold = false; return 'knot'; }
    key(i) {
      this.degs = [this.degs[0], i];
      this.pluck = 0.8;
      this.u.audio.play({ midi: this.u.midiOf(i), timbre: 0.1, vel: 0.2, dur: 2 });
      this.u._found('sc-key', 'each interval draws its own figure — the octave a circle, the fifth a 3:2 knot');
    }
    ribbons(strip, toRel, cam) {
      const ox = wrap(0 - cam.x), oy = wrap(0 - cam.y);
      const pal = this.u.palette;
      this.frames.forEach((pts, fi) => {
        const n = pts.length / 2;
        const rel = new Float32Array(pts.length);
        for (let i = 0; i < n; i++) { rel[i * 2] = pts[i * 2] + ox; rel[i * 2 + 1] = pts[i * 2 + 1] + oy; }
        const fade = [1, 0.45, 0.2][fi];
        // phosphor: equal energy per instant, so where the beam lingers the overlap glows by itself
        strip(rel, n, () => 0.05, (i) => (i % 64 < 32 ? pal.hot : pal.accent), () => fade * 0.13);
      });
    }
    pick() { return null; }
    diveObject() { return null; }
    dispose() { if (this.voice) { this.voice.stop(); this.voice = null; } }
  }

  Object.assign(C.GENUS_IMPL, { fluid: Fluid, ripple: Ripple, scope: Scope });
})();
