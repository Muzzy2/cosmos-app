'use strict';
// The other kinds of universe. Each genus brings its own physics, life, sound and meaning for your hands.
// The tide genus (singing jellies) lives in life.js; these plug into the same Universe host.
(function () {
  const C = window.COSMOS;
  const W = C.W;
  const wrap = C.wrap;
  const TAU = Math.PI * 2;
  const dist = (ax, ay, bx, by) => Math.hypot(wrap(ax - bx), wrap(ay - by));
  const pitchCol = (u, deg, l) => C.hsl(C.pcHue(u.pcOf(deg)), 0.8, l || 0.6);
  const degFromY = (u, yN) => {
    const len = u.scale.length;
    return Math.floor(yN * len * 2.2) - Math.floor(len * 0.6);
  };
  // sample a 64x64 read-back field at a world position (channel c)
  const fieldAt = (buf, x, y, c) => {
    if (!buf) return 0;
    const ix = (((Math.floor((x / W + 0.5) * 64)) % 64) + 64) % 64;
    const iy = (((Math.floor((y / W + 0.5) * 64)) % 64) + 64) % 64;
    return buf[(iy * 64 + ix) * 4 + c];
  };

  // ==================================================================== MYCELIUM
  // A slime-mould of a quarter-million agents. Seeds you plant are food; the mould grows veins between them.
  // Every vein that forms pulses light back and forth, and its length sets its rhythm.
  class Mycelium {
    constructor(u) {
      this.u = u;
      this.gp = u.world.gp;
      this.nodes = [];
      this.edges = new Map();
      this.pulses = [];
      this.light = { x: 0, y: 0, s: 0, r: 1 };
      this.hold = null;
      this.readT = 1.5;
      this.buf = null;
      this.fruitT = 15;
      this.food = new Float32Array(96);
      this.simMode = 1;
      this.dustLayer = 0.35;
      this.stroke = null;
      this.nextId = 1;
    }
    gpuInit(r, x, y) {
      r.seedDust(x, y, 0, 'agents');
    }
    enter(data) {
      if (data) {
        this.nodes = data.nodes.map((n) => Object.assign({}, n));
        this.nextId = data.nextId;
        return;
      }
      const r = C.rng(this.u.world.seed ^ 0x77);
      const len = this.u.scale.length;
      for (let i = 0; i < this.gp.nodes; i++) {
        const a = r() * TAU, d = 2.5 + r() * 9;
        this.makeNode(Math.cos(a) * d, Math.sin(a) * d, Math.floor(r() * len * 2), { born: 0 });
      }
    }
    snapshot() {
      return { nodes: this.nodes.map((n) => Object.assign({}, n)), nextId: this.nextId };
    }
    makeNode(x, y, deg, opts) {
      if (this.nodes.length >= 22) {
        const old = this.nodes.find((n) => !n.dying);
        if (old) old.dying = 0.01;
      }
      const n = Object.assign({ id: this.nextId++, x: wrap(x), y: wrap(y), deg, age: 0, life: 220 + Math.random() * 240, glow: 1, born: 0, dying: 0, vx: 0, vy: 0 }, opts || {});
      n.col = pitchCol(this.u, deg, 0.62);
      this.nodes.push(n);
      return n;
    }
    _note(deg, vel, x, y, t, dur) {
      const sp = this.u._audioSpatial(x, y);
      this.u.audio.play({ midi: this.u.midiOf(deg), voice: 'marimba', vel: vel * sp.att, pan: sp.pan, dur: dur || 1.4 }, t);
    }
    tap(x, y, yN) {
      const n = this.makeNode(x, y, degFromY(this.u, yN));
      this._note(n.deg, 0.25, x, y);
      this.u.addRing(x, y, 0.1, 1.8, 1.2, n.col, 0.05, 0.9);
      this.u._found('m-plant', 'a seed — watch the mould reach for it');
    }
    holdStart(x, y) {
      this.hold = { x, y, t: 0, voice: this.u.audio.sustain('charge') };
    }
    holdUpdate(x, y, dt) {
      const h = this.hold;
      if (!h) return;
      h.x = x; h.y = y; h.t += dt;
      const k = Math.min(1, h.t / 2.5);
      this.light = { x, y, s: 0.4 + 1.6 * k, r: 0.8 + 2.4 * k };
      const sp = this.u._audioSpatial(x, y);
      if (h.voice) h.voice.set(C.midiToFreq(this.u.midiOf(this.u.scale.length * 2)) * (1 + k * 0.5), 0.03 + 0.06 * k, sp.pan, 3 * k, 1200 + 2000 * k);
    }
    holdEnd() {
      const h = this.hold;
      if (!h) return null;
      this.hold = null;
      if (h.voice) h.voice.stop(0.4);
      const k = Math.min(1, h.t / 2.5);
      this.u.addShock(h.x, h.y, 2 + 5 * k, 6, 0.8, 1.5, 0.5);
      this.u.addRing(h.x, h.y, 0.2, 2 + 4 * k, 1.2, [1, 1, 1], 0.05, 0.7);
      this.u.audio.burst(0.3 + 0.5 * k, this.u._audioSpatial(h.x, h.y).pan, null);
      this.u._found('m-light', 'it fears the light — and scatters');
      return 'light';
    }
    drawStart(x, y, yN) {
      this.stroke = { pts: [[x, y, yN]], last: [x, y] };
    }
    drawMove(x, y, yN) {
      const s = this.stroke;
      if (!s) return;
      if (dist(x, y, s.last[0], s.last[1]) > 2.2 && s.pts.length < 7) {
        s.pts.push([x, y, yN]);
        s.last = [x, y];
        this.u.addRing(x, y, 0.05, 0.8, 0.6, this.u.palette.accent, 0.05, 0.7);
      }
    }
    drawEnd() {
      const s = this.stroke;
      this.stroke = null;
      if (!s) return null;
      s.pts.forEach(([x, y, yN], i) => {
        const n = this.makeNode(x, y, degFromY(this.u, yN));
        this._note(n.deg, 0.18, x, y, this.u.audio.now() + i * 0.09);
      });
      return 'chain';
    }
    key(i, x, y) {
      const pc = this.u.pcOf(i);
      const hits = this.nodes.filter((n) => !n.dying && this.u.pcOf(n.deg) === pc);
      this._note(i, 0.24, x, y);
      if (!hits.length) {
        this.makeNode(x, y, i);
        this.u.addRing(x, y, 0.1, 1.6, 1, pitchCol(this.u, i), 0.05, 0.9);
        return;
      }
      const g = this.u.audio.nextGrid(0.03);
      for (const n of hits) {
        n.glow = 1.5;
        for (const e of this.edges.values()) if (e.a === n || e.b === n) this._emit(e, n, g.time);
      }
    }
    pick(x, y) {
      for (const n of this.nodes) if (!n.dying && dist(x, y, n.x, n.y) < 0.6) return { type: 'node', obj: n };
      return null;
    }
    diveObject(x, y) {
      const p = this.pick(x, y);
      return p ? { x: p.obj.x, y: p.obj.y, r: 0.5, seed: C.hash(this.u.world.seed, 'node', p.obj.id), c2: p.obj.col } : null;
    }
    _emit(e, from, time) {
      const to = e.a === from ? e.b : e.a;
      const td = this.u.audio.tickDur();
      const travel = Math.max(2, Math.round(e.len * 0.9)) * td;
      this.pulses.push({ e, from, to, t0: time, t1: time + travel });
      this._note(to.deg, 0.13, to.x, to.y, time + travel, 1.1);
      this.u.pending.push({ t: time + travel, kind: 'fn', fn: () => { to.glow = Math.max(to.glow, 1); this.u.addRing(to.x, to.y, 0.1, 0.9, 0.6, to.col, 0.04, 0.7); } });
    }
    // Which seeds does the mould actually join? Flood-fill the dense veins on a coarse read-back grid
    // (veins curve, so straight-line tests miss them), then link each seed to its nearest neighbours
    // in the same vein network.
    _connect() {
      const buf = this.buf, G = 64;
      let mean = 0;
      for (let i = 0; i < G * G; i++) mean += buf[i * 4];
      mean = mean / (G * G) + 1e-4;
      const thr = mean * 1.9;
      const comp = new Int32Array(G * G).fill(-1);
      let nc = 0;
      const stack = [];
      for (let i = 0; i < G * G; i++) {
        if (comp[i] >= 0 || buf[i * 4] < thr) continue;
        comp[i] = nc;
        stack.push(i);
        while (stack.length) {
          const c = stack.pop(), cx = c % G, cy = (c / G) | 0;
          for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
            const nx = (cx + dx + G) % G, ny = (cy + dy + G) % G, ni = ny * G + nx;
            if (comp[ni] < 0 && buf[ni * 4] >= thr) { comp[ni] = nc; stack.push(ni); }
          }
        }
        nc++;
      }
      const compOf = (n) => {
        const cx = Math.floor((n.x / W + 0.5) * G), cy = Math.floor((n.y / W + 0.5) * G);
        let best = -1, bv = 0;
        for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
          const i = (((cy + dy) % G + G) % G) * G + (((cx + dx) % G + G) % G);
          if (comp[i] >= 0 && buf[i * 4] > bv) { bv = buf[i * 4]; best = comp[i]; }
        }
        return best;
      };
      const N = this.nodes.filter((n) => !n.dying && n.born > 0.5);
      const cid = new Map(N.map((n) => [n, compOf(n)]));
      const want = new Set();
      for (const a of N) {
        const ca = cid.get(a);
        if (ca < 0) continue;
        const near = N.filter((b) => b !== a && cid.get(b) === ca).map((b) => [dist(a.x, a.y, b.x, b.y), b]).filter(([d]) => d > 1.2 && d < 15).sort((p, q) => p[0] - q[0]).slice(0, 2);
        for (const [, b] of near) want.add(a.id < b.id ? a.id + ':' + b.id : b.id + ':' + a.id);
      }
      const byId = new Map(N.map((n) => [n.id, n]));
      for (const key of [...this.edges.keys()]) if (!want.has(key)) this.edges.delete(key);
      for (const key of want) {
        const [ia, ib] = key.split(':').map(Number);
        const a = byId.get(ia), b = byId.get(ib);
        const d = dist(a.x, a.y, b.x, b.y);
        const e = this.edges.get(key);
        if (e) e.len = d;
        else {
          const ne = { a, b, len: d, period: C.clamp(Math.round(d * 1.6), 4, 32), offset: Math.floor(Math.random() * 8) };
          this.edges.set(key, ne);
          const sp = this.u._audioSpatial((a.x + wrap(b.x - a.x) / 2), (a.y + wrap(b.y - a.y) / 2));
          this.u.audio.play({ notes: [this.u.midiOf(a.deg), this.u.midiOf(b.deg)], voice: 'marimba', vel: 0.2 * sp.att, pan: sp.pan, dur: 2 });
          this.u.addRing(a.x, a.y, 0.1, 1.4, 1, a.col, 0.05, 0.9);
          this.u.addRing(b.x, b.y, 0.1, 1.4, 1, b.col, 0.05, 0.9);
          a.glow = b.glow = 1.5;
          this.u._found('m-connect', 'two seeds found each other — the vein will keep the rhythm of its length');
        }
      }
      for (const [k, e] of this.edges) if (e.a.dying || e.b.dying || !this.nodes.includes(e.a) || !this.nodes.includes(e.b)) this.edges.delete(k);
    }
    update(dt, realDt, ticks, now) {
      for (const n of this.nodes) {
        n.age += dt;
        n.born = Math.min(1, n.born + dt * 0.8);
        n.glow *= Math.exp(-dt * 2);
        if (n.dying) n.dying += dt / 3;
        else if (n.age > n.life) n.dying = 0.01;
      }
      this.nodes = this.nodes.filter((n) => !(n.dying >= 1));
      if (!this.hold) this.light.s *= Math.exp(-realDt * 2.5);
      this.readT -= realDt;
      if (this.readT <= 0 && this.u.renderer) {
        this.readT = 0.5;
        this.buf = this.u.renderer.readField('mould', this.u.gpu);
        this._connect();
      }
      // every vein beats at a period set by its length: geometry becomes polyrhythm
      let emitted = 0;
      for (const tk of ticks) {
        for (const e of this.edges.values()) {
          if ((tk.tick + e.offset) % e.period !== 0 || emitted >= 3) continue;
          const from = (Math.floor((tk.tick + e.offset) / e.period) & 1) ? e.a : e.b;
          this._emit(e, from, tk.time);
          emitted++;
        }
      }
      this.pulses = this.pulses.filter((p) => now < p.t1 + 0.05);
      // fruiting: well-connected seeds grow new seeds; the network spreads on its own
      this.fruitT -= dt;
      if (this.fruitT <= 0) {
        this.fruitT = 10 + Math.random() * 16;
        const deg = new Map();
        for (const e of this.edges.values()) { deg.set(e.a, (deg.get(e.a) || 0) + 1); deg.set(e.b, (deg.get(e.b) || 0) + 1); }
        const rich = [...deg.entries()].filter(([, c]) => c >= 2).map(([n]) => n);
        const src = rich.length ? rich[Math.floor(Math.random() * rich.length)] : this.nodes[Math.floor(Math.random() * this.nodes.length)];
        if (src && this.nodes.length < 20) {
          const a = Math.random() * TAU, d = 3 + Math.random() * 3;
          const n = this.makeNode(src.x + Math.cos(a) * d, src.y + Math.sin(a) * d, src.deg + [-2, -1, 1, 2, 3][Math.floor(Math.random() * 5)]);
          this.u.addRing(n.x, n.y, 0.1, 1.5, 1.2, n.col, 0.05, 0.8);
          this._note(n.deg, 0.14, n.x, n.y);
        }
      }
      if (this.nodes.length < 3) {
        const a = Math.random() * TAU;
        this.makeNode(this.u.cam.x + Math.cos(a) * 5, this.u.cam.y + Math.sin(a) * 5, Math.floor(Math.random() * 8));
      }
      // music: kicks scatter the mould a little, the beat feeds every seed
      if (this.u.music.active) {
        for (const ev of this.u.music.events) {
          if (ev.type === 'kick') for (const n of this.nodes) n.glow = Math.max(n.glow, 0.6 * ev.strength);
        }
      }
    }
    simParams(sim) {
      const g = this.gp;
      sim.phys.set([g.sensorAngle, g.sensorDist, g.turn, g.speed]);
      sim.light.set([this.light.x, this.light.y, this.light.s, this.light.r]);
    }
    field() {
      let n = 0;
      for (const nd of this.nodes) {
        if (n >= 24) break;
        const s = (1.2 + nd.glow) * nd.born * (nd.dying ? 1 - nd.dying : 1);
        this.food.set([nd.x, nd.y, s, 0.45], n * 4);
        n++;
      }
      return { kind: 1, deposit: this.gp.deposit, decay: this.gp.decay, food: this.food, nFood: n, gain: 0.12, scan: [0, 1, 0, 0] };
    }
    sprites(spr, inView) {
      const now = this.u.audio.now();
      for (const n of this.nodes) {
        if (!inView(n.x, n.y, 2)) continue;
        const a = n.born * (n.dying ? 1 - n.dying : 1);
        spr(n.x, n.y, 0, 1.1, n.col, a * (0.18 + 0.25 * n.glow), 1, 4);
        spr(n.x, n.y, 0, 0.42, n.col, a * (1 + n.glow), 2, 0.6, n.id, 0);
      }
      for (const p of this.pulses) {
        const k = C.clamp((now - p.t0) / (p.t1 - p.t0), 0, 1);
        const x = wrap(p.from.x + wrap(p.to.x - p.from.x) * k), y = wrap(p.from.y + wrap(p.to.y - p.from.y) * k);
        if (!inView(x, y, 1)) continue;
        spr(x, y, 0, 0.5, p.to.col, 0.9 * Math.sin(Math.PI * Math.min(1, k * 1.05 + 0.02)), 1, 8);
      }
      if (this.light.s > 0.02) spr(this.light.x, this.light.y, 0.05, this.light.r * 1.2, [1, 0.95, 0.85], this.light.s * 0.25, 1, 2.5);
    }
  }

  // ==================================================================== ORRERY
  // A music box of gravity. Planets sing whenever they cross one of the sun's gates; their pitch is their
  // distance from the sun, so eccentric orbits play melodies and Kepler's law plays the rhythm.
  class Orrery {
    constructor(u, visitor) {
      this.u = u;
      this.visitor = !!visitor;
      this.gp = u.world.gp;
      this.suns = [];
      this.planets = [];
      this.launch = null;
      this.hold = null;
      this.simMode = 2;
      this.dustLayer = 0.55;
      this.trailMul = 0.45;
      this.gateFlash = new Float32Array(16);
      this.noteBudget = 0;
      this.cometT = 25;
      this.nextId = 1;
    }
    gpuInit(r) {
      const s = this.suns[0] || { x: 0, y: 0 };
      r.seedDust(s.x, s.y, 0, 'rings');
    }
    enter(data) {
      if (data) {
        this.suns = data.suns.map((s) => Object.assign({}, s));
        this.planets = data.planets.map((p) => Object.assign({}, p, { trail: p.trail.slice() }));
        this.nextId = data.nextId;
        return;
      }
      const r = C.rng(this.u.world.seed ^ 0x0e1);
      const g = this.gp;
      this.suns.push(this._sun(0, 0, 1));
      for (let i = 1; i < g.suns; i++) {
        const a = r() * TAU, d = 10 + r() * 4;
        this.suns.push(this._sun(Math.cos(a) * d, Math.sin(a) * d, 0.35 + r() * 0.4));
      }
      for (let i = 0; i < g.planets; i++) {
        const rad = 2 + (i / g.planets) * 9 + r() * 1.2;
        const a = r() * TAU;
        this.spawnPlanet(Math.cos(a) * rad, Math.sin(a) * rad, null, { m: 0.4 + r() * 0.8 });
      }
    }
    snapshot() {
      return { suns: this.suns.map((s) => Object.assign({}, s)), planets: this.planets.map((p) => Object.assign({}, p, { trail: p.trail.slice() })), nextId: this.nextId };
    }
    _sun(x, y, M) {
      const len = this.u.scale.length;
      return { id: this.nextId++, x, y, vx: 0, vy: 0, M, flare: 0, deg: -len * 2 + (this.suns.length ? Math.max(0, this.u.scale.indexOf(this.u._fifth())) : 0), col: C.hsl(0.1 + this.suns.length * 0.07, 0.6, 0.72) };
    }
    _acc(x, y, self) {
      const g = this.gp, p = g.exponent;
      let ax = 0, ay = 0;
      for (const s of this.suns) {
        const dx = wrap(s.x - x), dy = wrap(s.y - y);
        const r = Math.sqrt(dx * dx + dy * dy + 0.09);
        const a = (g.G * s.M) / Math.pow(r, p);
        ax += (dx / r) * a;
        ay += (dy / r) * a;
      }
      for (const o of this.planets) {
        if (o === self) continue;
        const dx = wrap(o.x - x), dy = wrap(o.y - y);
        const r2 = dx * dx + dy * dy + 0.3, r = Math.sqrt(r2);
        const a = (g.G * 0.012 * o.m) / r2;
        ax += (dx / r) * a;
        ay += (dy / r) * a;
      }
      return [ax, ay];
    }
    _nearestSun(x, y) {
      let best = this.suns[0], bd = 1e9;
      for (const s of this.suns) {
        const d = dist(x, y, s.x, s.y);
        if (d < bd) { bd = d; best = s; }
      }
      return best;
    }
    _circular(x, y) {
      const s = this._nearestSun(x, y);
      if (!s) return [0, 0];
      const dx = wrap(x - s.x), dy = wrap(y - s.y), r = Math.hypot(dx, dy) + 1e-3;
      const v = Math.sqrt((this.gp.G * s.M) / Math.pow(r, this.gp.exponent - 1));
      return [(-dy / r) * v + s.vx, (dx / r) * v + s.vy];
    }
    _degAt(x, y) {
      const s = this.suns[0];
      const r = C.clamp(dist(x, y, s.x, s.y), 1.2, 16);
      const len = this.u.scale.length;
      const t = Math.log(r / 1.2) / Math.log(16 / 1.2);
      return Math.round(C.lerp(len * 2.6, -len, t));
    }
    _radiusFor(deg) {
      const len = this.u.scale.length;
      const t = C.clamp((len * 2.6 - deg) / (len * 3.6), 0, 1);
      return 1.2 * Math.pow(16 / 1.2, t);
    }
    spawnPlanet(x, y, vel, opts) {
      if (this.planets.length >= 32) this.planets.shift();
      const v = vel || this._circular(x, y);
      const p = Object.assign({ id: this.nextId++, x: wrap(x), y: wrap(y), vx: v[0], vy: v[1], m: 0.6, born: 0, flare: 1, trail: new Float32Array(80), tT: 0, ang: null }, opts || {});
      for (let i = 0; i < 40; i++) { p.trail[i * 2] = p.x; p.trail[i * 2 + 1] = p.y; }
      p.size = 0.12 + Math.sqrt(p.m) * 0.12;
      this.planets.push(p);
      return p;
    }
    _sing(p, deg, t) {
      if (this.noteBudget > 6) return;
      this.noteBudget++;
      const sp = this.u._audioSpatial(p.x, p.y);
      const vel = 0.17 * sp.att * Math.min(1.3, 0.6 + p.m * 0.5) * (this.u.music.active ? 0.5 : 1);
      if (vel > 0.01) this.u.audio.play({ midi: this.u.midiOf(deg), voice: p.comet ? 'bowl' : 'marimba', vel, pan: sp.pan, dur: p.comet ? 4 : 1.6 }, t);
      p.flare = 1;
      p.lastDeg = deg;
      this.u.lastPc = this.u.pcOf(deg);
      if (sp.visible) this.u.addRing(p.x, p.y, p.size, p.size * 4, 0.8, pitchCol(this.u, deg), 0.04, 0.7);
    }
    tap(x, y) {
      const p = this.spawnPlanet(x, y, null, { m: 0.4 + Math.random() * 0.6 });
      this._sing(p, this._degAt(x, y));
      this.u._found('o-tap', 'a planet, in orbit — it sings each time it crosses a gate');
    }
    key(i) {
      const s = this.suns[0];
      const r = this._radiusFor(i), a = Math.random() * TAU;
      const p = this.spawnPlanet(s.x + Math.cos(a) * r, s.y + Math.sin(a) * r, null, { m: 0.5 });
      this._sing(p, i);
      this.u._found('o-key', 'every note you play becomes an orbit');
    }
    holdStart(x, y) {
      this.hold = { x, y, t: 0, voice: this.u.audio.sustain('charge') };
    }
    holdUpdate(x, y, dt) {
      const h = this.hold;
      if (!h) return;
      h.x = x; h.y = y; h.t += dt;
      const k = Math.min(1, h.t / 3);
      const sp = this.u._audioSpatial(x, y);
      if (h.voice) h.voice.set(55 * (1 + k), 0.06 + 0.1 * k, sp.pan, 2 * k, 400 + 1200 * k);
    }
    holdEnd() {
      const h = this.hold;
      if (!h) return null;
      this.hold = null;
      if (h.voice) h.voice.stop(0.2);
      if (h.t < 0.8) { this.tap(h.x, h.y); return 'planet'; }
      if (this.suns.length >= 4) this.suns.splice(1, 1);
      const s = this._sun(h.x, h.y, 0.3 + Math.min(1, h.t / 3) * 0.9);
      this.suns.push(s);
      this.u.addRing(h.x, h.y, 0.2, 5, 2, s.col, 0.05, C.flash.request(0.6));
      this.u.audio.play({ notes: [this.u.midiOf(s.deg) + 12, this.u.midiOf(s.deg) + 19], voice: 'bowl', vel: 0.3, dur: 7 });
      this.u._found('o-sun', 'a second sun — orbits will never close again');
      return 'sun';
    }
    dragStart(x, y) {
      this.launch = { x0: x, y0: y, x1: x, y1: y, path: null };
    }
    dragMove(x, y) {
      const l = this.launch;
      if (!l) return;
      l.x1 = x; l.y1 = y;
      // predict the orbit so you can aim
      const v = this._launchVel();
      const ghost = { x: l.x0, y: l.y0 };
      let vx = v[0], vy = v[1];
      const path = [];
      for (let i = 0; i < 260; i++) {
        const [ax, ay] = this._acc(ghost.x, ghost.y, ghost);
        vx += ax * 0.03; vy += ay * 0.03;
        ghost.x = wrap(ghost.x + vx * 0.03); ghost.y = wrap(ghost.y + vy * 0.03);
        if (i % 4 === 0) path.push(ghost.x, ghost.y);
        if (this.suns.some((s) => dist(ghost.x, ghost.y, s.x, s.y) < 0.4)) break;
      }
      l.path = path;
    }
    _launchVel() {
      const l = this.launch;
      return [wrap(l.x1 - l.x0) * 1.3, wrap(l.y1 - l.y0) * 1.3];
    }
    dragEnd() {
      const l = this.launch;
      this.launch = null;
      if (!l) return;
      const v = this._launchVel();
      if (Math.hypot(v[0], v[1]) < 0.3) return;
      const p = this.spawnPlanet(l.x0, l.y0, v, { m: 0.5 + Math.random() * 0.5 });
      this._sing(p, this._degAt(p.x, p.y));
      this.u._found('o-fling', 'flung — eccentric orbits sing melodies, not single notes');
    }
    drawStart(x, y) { this.dragStart(x, y); }
    drawMove(x, y) { this.dragMove(x, y); }
    drawEnd() { this.dragEnd(); return 'planet'; }
    pick(x, y) {
      for (const p of this.planets) if (dist(x, y, p.x, p.y) < p.size + 0.3) return { type: 'planet', obj: p };
      for (const s of this.suns) if (dist(x, y, s.x, s.y) < 0.7) return { type: 'sun', obj: s };
      return null;
    }
    diveObject(x, y) {
      const p = this.pick(x, y);
      if (!p) return null;
      const col = p.type === 'sun' ? p.obj.col : pitchCol(this.u, p.obj.lastDeg || 0);
      return { x: p.obj.x, y: p.obj.y, r: 0.5, seed: C.hash(this.u.world.seed, p.type, p.obj.id), c2: col };
    }
    update(dt, realDt, ticks, now) {
      this.noteBudget = Math.max(0, this.noteBudget - realDt * 5);
      const gates = this.gp.gates;
      const s0 = this.suns[0];
      for (const s of this.suns) s.flare *= Math.exp(-dt * 3);
      for (let k = 0; k < 16; k++) this.gateFlash[k] *= Math.exp(-dt * 4);
      const sub = 4, h = dt / sub;
      for (let it = 0; it < sub; it++) {
        for (const p of this.planets) {
          if (p.grabbed) continue;
          const [ax, ay] = this._acc(p.x, p.y, p);
          p.vx += ax * h; p.vy += ay * h;
          const sp = Math.hypot(p.vx, p.vy);
          if (sp > 25) { p.vx *= 25 / sp; p.vy *= 25 / sp; }
        }
        for (const p of this.planets) {
          if (p.grabbed) continue;
          p.x = wrap(p.x + p.vx * h);
          p.y = wrap(p.y + p.vy * h);
        }
      }
      for (const s of this.suns) {
        if (s === s0 || s.grabbed) continue;
        // secondary suns fall around the first
        const dx = wrap(s0.x - s.x), dy = wrap(s0.y - s.y), r = Math.hypot(dx, dy) + 0.5;
        s.vx += (dx / r) * (this.gp.G * s0.M * 0.08) / (r * r) * dt;
        s.vy += (dy / r) * (this.gp.G * s0.M * 0.08) / (r * r) * dt;
        s.x = wrap(s.x + s.vx * dt);
        s.y = wrap(s.y + s.vy * dt);
      }
      const dead = new Set();
      for (const p of this.planets) {
        p.born = Math.min(1, p.born + dt * 2);
        p.flare *= Math.exp(-dt * 4);
        p.tT += dt;
        if (p.tT > 0.06) {
          p.tT = 0;
          p.trail.copyWithin(2, 0, 78);
          p.trail[0] = p.x; p.trail[1] = p.y;
        }
        // gates: crossing a spoke of the primary sun rings the planet at its current distance
        const a = Math.atan2(wrap(p.y - s0.y), wrap(p.x - s0.x));
        if (p.ang != null && !p.grabbed) {
          let da = a - p.ang;
          da -= Math.round(da / TAU) * TAU;
          for (let k = 0; k < gates; k++) {
            const ga = (k / gates) * TAU - Math.PI;
            let d0 = p.ang - ga, d1 = p.ang + da - ga;
            d0 -= Math.round(d0 / TAU) * TAU;
            d1 = d0 + da;
            if (Math.abs(da) < 1 && d0 * d1 < 0) {
              this._sing(p, this._degAt(p.x, p.y), now + 0.01);
              this.gateFlash[k] = 1;
            }
          }
        }
        p.ang = a;
        for (const s of this.suns) {
          if (dist(p.x, p.y, s.x, s.y) < 0.35 + s.M * 0.15) {
            dead.add(p);
            s.flare = 1;
            s.M += p.m * 0.05;
            this.u.addShock(s.x, s.y, 2, 5, 0.6, 1.4, 0.5);
            this.u.addRing(s.x, s.y, 0.2, 3, 1.2, s.col, 0.05, C.flash.request(0.4));
            this.u.audio.burst(0.35, this.u._audioSpatial(s.x, s.y).pan, null);
          }
        }
      }
      // collisions merge planets into a heavier, lower voice
      for (let i = 0; i < this.planets.length; i++) for (let j = i + 1; j < this.planets.length; j++) {
        const a = this.planets[i], b = this.planets[j];
        if (dead.has(a) || dead.has(b) || a.grabbed || b.grabbed) continue;
        if (dist(a.x, a.y, b.x, b.y) < (a.size + b.size) * 0.8) {
          const m = a.m + b.m;
          a.vx = (a.vx * a.m + b.vx * b.m) / m;
          a.vy = (a.vy * a.m + b.vy * b.m) / m;
          a.m = m;
          a.size = 0.12 + Math.sqrt(m) * 0.12;
          a.flare = 1;
          dead.add(b);
          const sp = this.u._audioSpatial(a.x, a.y);
          this.u.addShock(a.x, a.y, 2.5, 5, 0.6, 1.6, 0.5);
          this.u.addRing(a.x, a.y, 0.1, 2.5, 1.2, [1, 0.9, 0.8], 0.05, C.flash.request(0.4));
          this.u.audio.play({ notes: [this.u.midiOf(this._degAt(a.x, a.y)) - 12, this.u.midiOf(this._degAt(a.x, a.y))], voice: 'bowl', vel: 0.22 * sp.att, pan: sp.pan, dur: 5 });
          this.u._found('o-merge', 'two planets became one heavier, lower voice');
        }
      }
      if (dead.size) this.planets = this.planets.filter((p) => !dead.has(p));
      // a comet now and then: a long, slow melody across the whole system
      this.cometT -= dt;
      if (this.cometT <= 0) {
        this.cometT = 30 + Math.random() * 40;
        const a = Math.random() * TAU, r = 13;
        const [cx, cy] = this._circular(s0.x + Math.cos(a) * r, s0.y + Math.sin(a) * r);
        this.spawnPlanet(s0.x + Math.cos(a) * r, s0.y + Math.sin(a) * r, [cx * 0.45, cy * 0.45], { m: 0.25, comet: true });
      }
      if (this.u.music.active) {
        for (const ev of this.u.music.events) if (ev.type === 'kick') for (const s of this.suns) s.flare = Math.max(s.flare, ev.strength);
      }
    }
    simParams(sim) {
      const s = this.suns[0];
      sim.sun.set([s.x, s.y, this.gp.G * s.M, this.gp.ringSpacing]);
      sim.ring.set([this.gp.rings, this.gp.exponent, 0, 0]);
    }
    wells(addWell) {
      for (const s of this.suns.slice(1)) addWell(s.x, s.y, 2.5 * s.M, 0.9, 0.5, 6, 0, 0.12);
      for (const p of this.planets) addWell(p.x, p.y, -0.5 * p.m, 0, 0.25, 0, 0, 0);
    }
    sprites(spr, inView) {
      for (const s of this.suns) {
        if (!inView(s.x, s.y, 4)) continue;
        spr(s.x, s.y, 0, 3.2 + s.M, s.col, 0.12 * (1 + s.flare), 1, 4);
        spr(s.x, s.y, 0, 1.1 + s.M * 0.5, s.col, 1.6 + s.flare, 2, 1.5, 0.3, 0);
      }
      for (const p of this.planets) {
        if (!inView(p.x, p.y, 1)) continue;
        const col = pitchCol(this.u, p.lastDeg != null ? p.lastDeg : this._degAt(p.x, p.y), 0.65);
        spr(p.x, p.y, 0, p.size * 7, col, (0.12 + 0.35 * p.flare) * p.born, 1, 6);
        spr(p.x, p.y, 0, p.size * 2.6, col, (1.4 + p.flare * 1.5) * p.born, 1, 10);
        spr(p.x, p.y, 0, p.size * 1.2, [1, 1, 1], (0.8 + p.flare) * p.born, 1, 30);
      }
      if (this.hold) {
        const k = Math.min(1, this.hold.t / 3);
        spr(this.hold.x, this.hold.y, 0, 0.5 + k * 1.2, [1, 0.85, 0.6], 0.6 + k, 2, k, this.u.time, 0);
      }
    }
    ribbons(strip, toRel, cam) {
      const s0 = this.suns[0];
      for (const p of this.planets) {
        const col = pitchCol(this.u, p.lastDeg != null ? p.lastDeg : 0, 0.6);
        const rel = toRel(p.trail, 40, 2);
        const tail = p.comet ? 1.6 : 1;
        strip(rel, 40, (i) => p.size * 0.35 * tail * (1 - i / 40), () => col, (i) => p.born * (0.35 + p.flare * 0.4) * Math.pow(1 - i / 40, 1.3) * tail);
      }
      // the gates: faint spokes that flash when sung
      const gates = this.gp.gates;
      const sx = wrap(s0.x - cam.x), sy = wrap(s0.y - cam.y);
      for (let k = 0; k < gates; k++) {
        const ga = (k / gates) * TAU - Math.PI;
        const pts = new Float32Array([sx + Math.cos(ga) * 1.2, sy + Math.sin(ga) * 1.2, sx + Math.cos(ga) * 15, sy + Math.sin(ga) * 15]);
        strip(pts, 2, () => 0.025, () => this.u.palette.accent, (i) => (0.06 + this.gateFlash[k] * 0.35) * (1 - i * 0.9));
      }
      if (this.launch && this.launch.path) {
        const path = this.launch.path, n = path.length / 2;
        const rel = new Float32Array(path.length);
        let px = wrap(path[0] - cam.x), py = wrap(path[1] - cam.y);
        rel[0] = px; rel[1] = py;
        for (let i = 1; i < n; i++) {
          px += wrap(path[i * 2] - path[i * 2 - 2]);
          py += wrap(path[i * 2 + 1] - path[i * 2 - 1]);
          rel[i * 2] = px; rel[i * 2 + 1] = py;
        }
        strip(rel, n, () => 0.03, () => [1, 1, 1], (i) => 0.5 * (1 - i / n) * ((i & 1) ? 0.2 : 1));
      }
    }
  }

  // ==================================================================== SKIN
  // Living reaction-diffusion flesh: Turing patterns that grow, divide and heal. A playhead sweeps the
  // view and reads the skin as a score — every spot it crosses is a note.
  class Skin {
    constructor(u) {
      this.u = u;
      this.gp = u.world.gp;
      this.brush = new Float32Array(48);
      this.brushes = [];
      this.hold = null;
      this.readT = 0.5;
      this.buf = null;
      this.prevRow = new Array(12).fill(false);
      this.scanX = 0;
      this.dustLayer = 0.28;
      this.simMode = 0;
      this.trailMul = 0.7;
      this.fk = this.gp.fk.slice();
      this.fkTarget = this.gp.fk.slice();
      this.shiftT = 45;
      this.bloomT = 12;
      this.rows = 12;
    }
    gpuInit(r, x, y) {
      r.seedDust(x, y, 0, 'uniform');
      r.seedSkin(this.u.world.seed);
    }
    enter() {}
    snapshot() { return null; }
    _brush(x, y, r, amt) {
      if (this.brushes.length >= 12) this.brushes.shift();
      this.brushes.push([x, y, r, amt]);
    }
    _drop(deg, x, y, vel, t) {
      const sp = this.u._audioSpatial(x, y);
      this.u.audio.play({ midi: this.u.midiOf(deg), voice: 'drop', vel: vel * sp.att, pan: sp.pan, dur: 0.9 }, t);
    }
    _rowWorld(row) {
      // row 0 = bottom of the view
      const cam = this.u.cam;
      const yRel = (row / (this.rows - 1) - 0.5) * cam.viewH * 0.85;
      return yRel;
    }
    _toWorld(xr, yr) {
      const cam = this.u.cam, c = Math.cos(-cam.roll || 0), s = Math.sin(-cam.roll || 0);
      return [wrap(cam.x + c * xr - s * yr), wrap(cam.y + s * xr + c * yr)];
    }
    tap(x, y, yN) {
      this._brush(x, y, 0.45, 0.9);
      this._drop(degFromY(this.u, yN), x, y, 0.25);
      this.u.addRing(x, y, 0.1, 1.4, 1, this.u.palette.hot, 0.05, 0.8);
      this.u._found('s-feed', 'you fed it — it will grow and divide from there');
    }
    holdStart(x, y) {
      this.hold = { x, y, t: 0, voice: this.u.audio.sustain('grab') };
    }
    holdUpdate(x, y, dt) {
      const h = this.hold;
      if (!h) return;
      h.x = x; h.y = y; h.t += dt;
      const k = Math.min(1, h.t / 3);
      this._brush(x, y, 0.4 + 2.2 * k, 0.25);
      const sp = this.u._audioSpatial(x, y);
      if (h.voice) h.voice.set(C.midiToFreq(this.u.midiOf(0)) * (1 + k), 0.05 + 0.08 * k, sp.pan, 4 * k, 500 + 1500 * k);
    }
    holdEnd() {
      const h = this.hold;
      if (!h) return null;
      this.hold = null;
      if (h.voice) h.voice.stop(0.3);
      this.u.addRing(h.x, h.y, 0.3, 2 + h.t * 1.5, 1.4, this.u.palette.hot, 0.05, 0.8);
      return 'grow';
    }
    dragMove(x, y) {
      this._brush(x, y, 0.35, 0.6);
    }
    drawStart(x, y) { this._brush(x, y, 0.5, -1); }
    drawMove(x, y) { this._brush(x, y, 0.5, -1); this.u._found('s-scar', 'a scar — watch it heal'); }
    drawEnd() { return 'scar'; }
    key(i) {
      // write a note onto the score, just ahead of the playhead
      const len = this.u.scale.length;
      const row = C.clamp(i + Math.floor(len * 0.6), 0, this.rows - 1);
      const [x, y] = this._toWorld(this.scanX + this.u.cam.viewH * 0.06, this._rowWorld(row));
      this._brush(x, y, 0.4, 1);
      this._drop(i, x, y, 0.26);
      this.u.addRing(x, y, 0.1, 1.2, 0.9, pitchCol(this.u, i), 0.05, 0.9);
      this.u._found('s-key', 'you wrote a note on the skin — it will grow its own variations');
    }
    pick() { return null; }
    diveObject() { return null; }
    update(dt, realDt, ticks, now) {
      const cam = this.u.cam, aud = this.u.audio;
      const halfW = (cam.viewH * cam.aspect) / 2;
      const beats = this.gp.scanBeats;
      const phaseAt = (t) => ((((t - aud.clockStart) / aud.beatDur()) % beats) + beats) % beats / beats;
      this.scanX = (phaseAt(now) * 2 - 1) * halfW * 0.95;
      this.readT -= realDt;
      if (this.readT <= 0 && this.u.renderer) {
        this.readT = 0.15;
        this.buf = this.u.renderer.readField('skin', this.u.gpu);
      }
      if (this.buf) {
        for (const tk of ticks) {
          const x = (phaseAt(tk.time) * 2 - 1) * halfW * 0.95;
          let n = 0;
          for (let row = 0; row < this.rows; row++) {
            const [wx, wy] = this._toWorld(x, this._rowWorld(row));
            const v = fieldAt(this.buf, wx, wy, 1);
            const on = v > 0.13;
            if (on && !this.prevRow[row] && n < 3) {
              n++;
              const len = this.u.scale.length;
              const deg = row - Math.floor(len * 0.6);
              this._drop(deg, wx, wy, 0.1 + Math.min(0.12, v * 0.4), tk.time);
              this.u.pending.push({ t: tk.time, kind: 'fn', fn: () => this.u.addRing(wx, wy, 0.05, 0.9, 0.7, pitchCol(this.u, deg), 0.04, 0.8) });
              this.u.lastPc = this.u.pcOf(deg);
            }
            this.prevRow[row] = on;
          }
        }
      }
      // the skin changes character slowly: its chemistry drifts to a new regime now and then
      this.shiftT -= dt;
      if (this.shiftT <= 0) {
        this.shiftT = 40 + Math.random() * 40;
        const R = [[0.0545, 0.062], [0.0367, 0.0649], [0.078, 0.061], [0.03, 0.062], [0.029, 0.057], [0.037, 0.06]];
        const a = R[Math.floor(Math.random() * R.length)];
        this.fkTarget = [a[0], a[1], this.fkTarget[2], this.fkTarget[3]];
      }
      for (let i = 0; i < 4; i++) this.fk[i] += (this.fkTarget[i] - this.fk[i]) * C.damp(0.08, dt);
      this.bloomT -= dt;
      if (this.bloomT <= 0) {
        this.bloomT = 8 + Math.random() * 14;
        const [x, y] = this._toWorld((Math.random() - 0.5) * halfW * 1.6, (Math.random() - 0.5) * cam.viewH * 0.8);
        this._brush(x, y, 0.5 + Math.random() * 0.6, 0.8);
      }
      if (this.u.music.active) {
        for (const ev of this.u.music.events) if (ev.type === 'kick' && Math.random() < 0.5) {
          const [x, y] = this._toWorld((Math.random() - 0.5) * halfW * 1.6, (Math.random() - 0.5) * cam.viewH * 0.8);
          this._brush(x, y, 0.3 + ev.strength * 0.4, 0.7);
        }
      }
    }
    field() {
      const b = this.brushes;
      for (let i = 0; i < b.length; i++) this.brush.set(b[i], i * 4);
      const out = {
        kind: 2, fk: this.fk, iters: this.gp.iters, brush: this.brush, nBrush: b.length,
        feedBoost: this.u.music.active ? this.u.music.bands.bass * 0.004 : 0,
        cymFeed: this.u.V && this.u.V.modes ? 0.014 : 0,
        relief: this.gp.relief, gain: 1, scan: [this.scanX, 0.12 * this.u.cam.viewH / 13, 1, 0],
      };
      this.brushes = [];
      return out;
    }
  }

  // ==================================================================== RESONANCE
  // A Chladni plate. Bowls ring on their own rhythms; every sounding note adds its standing-wave figure,
  // and the sand runs from where the plate shakes to where it is still. You can bow it yourself.
  class Resonance {
    constructor(u, visitor) {
      this.u = u;
      this.visitor = !!visitor;
      this.gp = u.world.gp;
      this.bowls = [];
      this.transients = [];
      this.bow = null;
      this.simMode = 0;
      this.dustLayer = 1.1;
      this.trailMul = 0.3;
      this.nextId = 1;
      this.driftT = 40;
    }
    gpuInit(r, x, y) {
      r.seedDust(x, y, 0, 'uniform');
    }
    enter(data) {
      if (data) { this.bowls = data.bowls.map((b) => Object.assign({}, b)); this.nextId = data.nextId; return; }
      const r = C.rng(this.u.world.seed ^ 0x5a);
      const len = this.u.scale.length;
      for (let i = 0; i < this.gp.bowls; i++) {
        const a = r() * TAU, d = 2 + r() * 5;
        this.makeBowl(Math.cos(a) * d, Math.sin(a) * d, Math.floor(r() * len * 2) - 2, [3, 4, 5, 6, 8][Math.floor(r() * 5)]);
      }
    }
    snapshot() { return { bowls: this.bowls.map((b) => Object.assign({}, b)), nextId: this.nextId }; }
    makeBowl(x, y, deg, period) {
      if (this.bowls.length >= 8) this.bowls.shift();
      const b = { id: this.nextId++, x: wrap(x), y: wrap(y), deg, period: period || 4, offset: Math.floor(Math.random() * 4), amp: 0, born: 0, col: pitchCol(this.u, deg, 0.62), vx: 0, vy: 0 };
      this.bowls.push(b);
      return b;
    }
    modeFor(deg) {
      const midi = this.u.midiOf(deg);
      const pc = ((midi % 12) + 12) % 12;
      const base = C.CHL[pc];
      const oct = C.clamp(Math.floor((midi - 36) / 12), 0, 4);
      const s = 0.7 + this.gp.modeScale * 0.35 + oct * 0.3;
      return [Math.min(14, Math.max(1, Math.round(base[0] * s))), Math.min(15, Math.max(2, Math.round(base[1] * s)))];
    }
    _ring(b, t, vel) {
      const sp = this.u._audioSpatial(b.x, b.y);
      this.u.audio.play({ midi: this.u.midiOf(b.deg), voice: 'bowl', vel: (vel || 0.22) * Math.max(0.35, sp.att), pan: sp.pan, dur: 6 }, t);
      this.u.pending.push({ t: t || 0, kind: 'fn', fn: () => { b.amp = 1; this.u.addRing(b.x, b.y, 0.3, 2.5, 1.6, b.col, 0.04, 0.8); } });
    }
    tap(x, y, yN) {
      const b = this.makeBowl(x, y, degFromY(this.u, yN), [2, 3, 4, 6, 8][Math.floor(Math.random() * 5)]);
      this._ring(b, this.u.audio.now() + 0.01, 0.28);
      this.u._found('r-bowl', 'a singing bowl — it will ring on its own rhythm');
    }
    key(i, x, y) {
      const sp = this.u._audioSpatial(x, y);
      this.u.audio.play({ midi: this.u.midiOf(i), voice: 'bowl', vel: 0.26, pan: sp.pan, dur: 5 });
      this.transients.push({ deg: i, amp: 1 });
      this.u.addRing(x, y, 0.2, 2, 1.2, pitchCol(this.u, i), 0.04, 0.8);
      this.u._found('r-key', 'each note has its own figure — chords draw their sum');
    }
    holdStart(x, y, yN) {
      this.bow = { x, y, t: 0, amp: 0, deg: degFromY(this.u, yN || 0.5), voice: this.u.audio.sustain('hum') };
    }
    holdUpdate(x, y, dt, yN) {
      const b = this.bow;
      if (!b) return;
      b.x = x; b.y = y; b.t += dt;
      if (yN != null) b.deg = degFromY(this.u, yN);
      b.amp = Math.min(1, b.amp + dt * 0.8);
      const f = C.midiToFreq(this.u.midiOf(b.deg));
      const sp = this.u._audioSpatial(x, y);
      if (b.voice) b.voice.set([f, f * 2.0, f * 3.01], 0.08 + 0.1 * b.amp, sp.pan, 0, 1800);
      this.u.lastPc = this.u.pcOf(b.deg);
      this.u._found('r-bow', 'bowing the plate — slide up and down to change the figure');
    }
    holdEnd() {
      const b = this.bow;
      if (!b) return null;
      this.bow = null;
      if (b.voice) b.voice.stop(1.2);
      this.transients.push({ deg: b.deg, amp: b.amp });
      if (b.t > 2.2) {
        const nb = this.makeBowl(b.x, b.y, b.deg, 4);
        this.u.addRing(nb.x, nb.y, 0.2, 2, 1.4, nb.col, 0.05, 0.8);
      }
      return 'bow';
    }
    pick(x, y) {
      for (const b of this.bowls) if (dist(x, y, b.x, b.y) < 0.6) return { type: 'bowl', obj: b };
      return null;
    }
    diveObject(x, y) {
      const p = this.pick(x, y);
      return p ? { x: p.obj.x, y: p.obj.y, r: 0.5, seed: C.hash(this.u.world.seed, 'bowl', p.obj.id), c2: p.obj.col } : null;
    }
    update(dt, realDt, ticks) {
      for (const b of this.bowls) {
        b.amp *= Math.exp(-dt / 3.2);
        b.born = Math.min(1, b.born + dt);
      }
      for (const t of this.transients) t.amp *= Math.exp(-dt / 2.5);
      this.transients = this.transients.filter((t) => t.amp > 0.03);
      for (const tk of ticks) {
        if (tk.tick % 4 !== 0) continue;
        const beat = tk.tick / 4;
        for (const b of this.bowls) if ((beat + b.offset) % b.period === 0) this._ring(b, tk.time);
      }
      this.driftT -= dt;
      if (this.driftT <= 0) {
        this.driftT = 35 + Math.random() * 30;
        const len = this.u.scale.length;
        if (this.bowls.length < 5 || Math.random() < 0.5) {
          const a = Math.random() * TAU;
          this.makeBowl(this.u.cam.x + Math.cos(a) * 4, this.u.cam.y + Math.sin(a) * 4, Math.floor(Math.random() * len * 2) - 2, [3, 4, 6][Math.floor(Math.random() * 3)]);
        } else this.bowls.shift();
      }
      if (this.u.music.active) {
        // your music plays the plate: its strongest pitch classes become figures
        const ch = this.u.music.chroma;
        let best = 0, bi = 0;
        for (let i = 0; i < 12; i++) if (ch[i] > best) { best = ch[i]; bi = i; }
        if (best > 0.6 && Math.random() < 0.05) {
          const len = this.u.scale.length;
          let deg = 0;
          for (let d = 0; d < len * 2; d++) if (this.u.pcOf(d) === bi) { deg = d; break; }
          this.transients.push({ deg, amp: this.u.music.level });
        }
      }
    }
    modes(arr) {
      const src = [];
      for (const b of this.bowls) if (b.amp > 0.02) src.push([b.deg, b.amp]);
      for (const t of this.transients) src.push([t.deg, t.amp]);
      if (this.bow) src.push([this.bow.deg, this.bow.amp * 1.2]);
      src.sort((a, b) => b[1] - a[1]);
      arr.fill(0);
      src.slice(0, 2).forEach(([deg, amp], i) => {
        const [n, m] = this.modeFor(deg);
        arr.set([n, m === n ? m + 1 : m, Math.sqrt(amp), 0], i * 4);
      });
    }
    sprites(spr, inView) {
      for (const b of this.bowls) {
        if (!inView(b.x, b.y, 2)) continue;
        spr(b.x, b.y, 0, 0.42 / 0.8, b.col, b.born * (0.45 + b.amp), 0, 0.07);
        spr(b.x, b.y, 0, 0.9, b.col, b.born * (0.04 + 0.2 * b.amp), 1, 5);
      }
      if (this.bow) spr(this.bow.x, this.bow.y, 0.05, 0.6 + this.bow.amp, pitchCol(this.u, this.bow.deg), 0.4 + this.bow.amp * 0.6, 1, 4);
    }
  }

  C.GENUS_IMPL = { mycelium: Mycelium, orrery: Orrery, skin: Skin, resonance: Resonance };
})();
