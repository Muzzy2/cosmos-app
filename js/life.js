'use strict';
// The living universe: singers (pitched jellies), pulsars, serpents, orbs, nutrient light, shockwaves.
(function () {
  const C = window.COSMOS;
  const W = C.W;
  const wrap = C.wrap;
  const NG = 64; // nutrient grid
  const TR = 14; // trail points per singer
  const MAX_SINGERS = 220;
  const MAX_SPRITES = 4200;
  const MAX_RIBBON_VERTS = 60000;
  const SERP_N = 40;
  const TAU = Math.PI * 2;

  // Chladni modes (n, m) per pitch class: each note draws its own figure in the dust.
  const CHL = [[2, 5], [3, 7], [1, 6], [4, 9], [3, 5], [2, 7], [5, 8], [1, 4], [3, 8], [2, 9], [4, 7], [5, 11]];
  C.CHL = CHL;

  class Universe {
    constructor(audio, music) {
      this.audio = audio;
      this.music = music;
      this.time = 0;
      this.nut = new Float32Array(NG * NG);
      this.nutBase = new Float32Array(NG * NG);
      this._nutTmp = new Float32Array(NG * NG);
      this.singers = [];
      this.stars = [];
      this.serpents = [];
      this.orbs = [];
      this.rings = [];
      this.shocks = [];
      this.stirs = [];
      this.pending = [];
      this.spawnQueue = [];
      this.events = [];
      this.flowT = 0;
      this.nextId = 1;
      this.depth = 0;
      this.cache = new Map();
      this.parents = new Map();
      this.orbOverride = new Map();
      this.intro = 1;
      this.introTarget = 1;
      this.bangFrame = false;
      this.introCenter = [0, 0];
      this.charge = null;
      this.stroke = null;
      this.cursor = { x: 0, y: 0, active: false, speed: 0 };
      this.cam = { x: 0, y: 0, viewH: 13, aspect: 16 / 9 };
      this.lastPc = 2;
      this.chl = { a: CHL[2], b: CHL[2], mix: 1 };
      this.callCount = new Array(12).fill(0);
      this.callTime = new Array(12).fill(0);
      this.autoTimer = 25;
      this.popFloorTimer = 0;
      this.stats = { births: 0, deaths: 0, fusions: 0, supernovas: 0 };
      this.found = new Set();
      this.cellSize = 2.5;
      this.gridN = Math.round(W / this.cellSize);
      this.grid = Array.from({ length: this.gridN * this.gridN }, () => []);
      this.singerBuf = new Float32Array(MAX_SINGERS * 16);
      this.spriteBuf = new Float32Array(MAX_SPRITES * 12);
      this.ribbonBuf = new Float32Array(MAX_RIBBON_VERTS * 8);
      this.sim = {
        law: new Float32Array(4), law2: new Float32Array(4),
        wells: new Float32Array(64), wellsB: new Float32Array(64), nWells: 0,
        shocks: new Float32Array(96), shocksB: new Float32Array(96), nShocks: 0,
        stirs: new Float32Array(32), nStirs: 0, stirR: 1,
        cursor: new Float32Array(4), audio: new Float32Array(4), intro: new Float32Array(4),
        modes: new Float32Array(16), mode: 0, phys: new Float32Array(4), light: new Float32Array(4),
        sun: new Float32Array(4), ring: new Float32Array(4), flowT: 0, respawn: 0.004,
      };
      this.palette = null;
      this.shockMul = 1;
      this.eventT = 45 + Math.random() * 60; // cosmic events: meteor showers, gravity turning inside out
      this.meteors = [];
      this.flipT = 0;
      this.gain = 1; // this world's share of the soundscape (two worlds crossfade while you zoom between them)
      this.drone = null;
      this.gpu = null;
      this.V = null;
      Object.assign(this.sim, { attr: new Float32Array(4), cymSense: 0, xf: new Float32Array(80), nxf: 0, flame: new Float32Array(4), tilt: new Float32Array(2) });
    }

    // Fade this world's whole voice in or out.
    setGain(g) {
      this.gain = g;
      if (this.drone) this.drone.setGain(g * (1 - this.intro));
      if (g < 0.01) for (const o of this.orbs) if (o.voice) o.voice.set(o.chord.map((m) => C.midiToFreq(m)), 0, 0, 0);
    }
    dispose() {
      if (this.drone) { this.drone.stop(); this.drone = null; }
      for (const m of [this.G, this.V]) if (m && m.dispose) m.dispose();
      for (const o of this.orbs) if (o.voice) { o.voice.stop(0.3); o.voice = null; }
    }
    _droneKey() {
      if (this.drone) this.drone.setKey(this._rootMidi() - 24, this._fifth());
    }

    // ------------------------------------------------------------------ worlds
    load(world, snap) {
      for (const o of this.orbs) if (o.voice) o.voice.stop(0.5);
      this.world = world;
      const parent = this.parents.get(world.seed);
      if (parent != null) world.parentSeed = parent.seed;
      const ov = this.orbOverride.get(world.seed);
      if (ov) world.orbSeeds = ov.slice();
      this.scale = snap ? snap.scale.slice() : world.scale.slice();
      this.root = snap ? snap.root : world.root;
      this.scaleName = snap ? snap.scaleName : world.scaleName;
      this.law = world.law;
      this.genus = world.genus || 'tide';
      this.G = this.genus === 'tide' ? null : new C.GENUS_IMPL[this.genus](this);
      this.V = world.visitor === 'orrery' ? new C.GENUS_IMPL.orrery(this, true) : world.visitor === 'bowls' ? new C.GENUS_IMPL.resonance(this, true) : world.visitor === 'storm' ? new C.GENUS_IMPL.storm(this, true) : null;
      this.style = world.style || 0;
      this.singers = [];
      this.stars = [];
      this.serpents = [];
      this.orbs = [];
      this.rings = [];
      this.shocks = [];
      this.pending = [];
      this.spawnQueue = [];
      this.charge = null;
      this.stroke = null;
      this._makePalette();
      // nutrient landscape from the world's noise channel
      const nd = C.noiseData, ch = world.seed % 4, ox = world.seed % 97, oy = (world.seed >>> 8) % 89;
      for (let y = 0; y < NG; y++) for (let x = 0; x < NG; x++) {
        const v = nd[((((y * 4 + oy) % 256) * 256 + ((x * 4 + ox) % 256)) * 4) + ch];
        this.nutBase[y * NG + x] = 0.08 + 0.6 * C.smooth(-0.35, 0.8, v);
      }
      if (snap) {
        this.nut.set(snap.nut);
        for (const s of snap.singers) this.singers.push(Object.assign({}, s, { trail: s.trail.slice(), g: Object.assign({}, s.g, { degrees: s.g.degrees.slice() }), grabbed: false }));
        for (const s of snap.stars) this.stars.push(Object.assign({}, s, { grabbed: false }));
        for (const s of snap.serpents) this.serpents.push(Object.assign({}, s, { pts: s.pts.slice(), glow: s.glow.slice() }));
        for (const o of snap.orbs) this.orbs.push(this._makeOrb(o.x, o.y, o.seed, o.r, o));
        this.singers.forEach((s) => this._look(s));
      } else {
        this.nut.set(this.nutBase);
        const r = C.rng(world.seed ^ 0xabc);
        world.orbSeeds.forEach((seed, i) => {
          const a = (i / world.orbSeeds.length) * TAU + r() * 0.8;
          const d = 7 + r() * 6;
          this.orbs.push(this._makeOrb(Math.cos(a) * d, Math.sin(a) * d, seed, 0.9 + r() * 0.45));
        });
      }
      if (this.G) this.G.enter(snap && snap.genusData);
      if (this.V) this.V.enter(snap && snap.visitorData);
      this._droneKey();
      if (!this.music.active || !this.music.tempo) this.audio.setBpm(world.bpm * (this.slowFactor || 1));
    }

    // Prepare GPU state for this genus when arriving (dust layout, fields).
    gpuInit(renderer, x, y) {
      if (this.G) this.G.gpuInit(renderer, x, y);
      else renderer.seedDust(x, y, 2.2);
    }

    snapshot() {
      return {
        scale: this.scale.slice(), root: this.root, scaleName: this.scaleName,
        nut: this.nut.slice(),
        singers: this.singers.filter((s) => !s.dying).map((s) => Object.assign({}, s, { trail: s.trail.slice(), g: Object.assign({}, s.g, { degrees: s.g.degrees.slice() }), grabbed: false })),
        stars: this.stars.map((s) => Object.assign({}, s, { grabbed: false })),
        serpents: this.serpents.map((s) => Object.assign({}, s, { pts: s.pts.slice(), glow: s.glow.slice() })),
        orbs: this.orbs.map((o) => ({ x: o.x, y: o.y, seed: o.seed, r: o.r, vx: o.vx, vy: o.vy, user: o.user })),
        genusData: this.G ? this.G.snapshot() : null,
        visitorData: this.V ? this.V.snapshot() : null,
      };
    }

    // What lies under (x, y) if you keep zooming in? Every thing holds a world; so does empty space.
    diveTarget(x, y) {
      for (const o of this.orbs) if (Math.hypot(wrap(o.x - x), wrap(o.y - y)) < o.r) return o;
      if (this.G && this.G.diveObject) {
        const t = this.G.diveObject(x, y);
        if (t) return t;
      } else {
        const h = this.pick(x, y);
        if (h && h.type === 'singer') return { x: h.obj.x, y: h.obj.y, r: h.obj.size, seed: C.hash(this.world.seed, 'singer', h.obj.id), c2: h.obj.col };
        if (h && h.type === 'star') return { x: h.obj.x, y: h.obj.y, r: 0.5, seed: C.hash(this.world.seed, 'star', h.obj.id), c2: h.obj.col };
      }
      return { x, y, r: 0.6, seed: C.hash(this.world.seed, 'fabric', Math.round(x * 1.5), Math.round(y * 1.5)), c2: this.palette.hot };
    }

    // Spawn the founding species in a wave expanding from (cx, cy).
    populate(cx, cy, waveSpeed) {
      const r = C.rng(this.world.seed ^ 0x51ed);
      for (const sp of this.world.species) {
        const a = r() * TAU, d = 3 + r() * 14;
        const hx = cx + Math.cos(a) * d, hy = cy + Math.sin(a) * d;
        for (let i = 0; i < sp.count; i++) {
          const x = wrap(hx + C.gauss(r) * 1.6), y = wrap(hy + C.gauss(r) * 1.6);
          const dist = Math.hypot(wrap(x - cx), wrap(y - cy));
          this.spawnQueue.push({ t: this.time + 0.3 + dist / waveSpeed, x, y, g: this._mutate(this._genomeFrom(sp), r, 0.3) });
        }
      }
    }

    diveInto(orb) {
      this.cache.set(this.world.seed, this.snapshot());
      const child = C.makeWorld(orb.seed, { notGenus: [this.genus] });
      if (!this.parents.has(orb.seed)) this.parents.set(orb.seed, { seed: this.world.seed, x: orb.x, y: orb.y });
      this.depth += 1;
      const snap = this.cache.get(orb.seed);
      this.load(child, snap);
      return !snap;
    }

    ascend() {
      const cur = this.world;
      this.cache.set(cur.seed, this.snapshot());
      let link = this.parents.get(cur.seed);
      if (link == null) {
        // above any world there is always another universe that contains it
        const pSeed = C.hash(cur.seed, 'outside', this.depth);
        const pw = C.makeWorld(pSeed, { notGenus: [this.genus] });
        const seeds = pw.orbSeeds.slice();
        seeds[0] = cur.seed;
        this.orbOverride.set(pSeed, seeds);
        link = { seed: pSeed, x: null, y: null };
        this.parents.set(cur.seed, link);
      }
      const parent = C.makeWorld(link.seed, { notGenus: [this.genus] });
      this.depth -= 1;
      const snap = this.cache.get(link.seed);
      this.load(parent, snap);
      const orb = this.orbs.find((o) => o.seed === cur.seed);
      const at = orb || (link.x != null ? { x: link.x, y: link.y, r: 0.6, c2: this.palette.hot } : this.orbs[0] || { x: 0, y: 0, r: 1, c2: this.palette.hot });
      return { orb: at, fresh: !snap };
    }

    _makePalette() {
      const p = this.world.palette;
      const mix = (a, b, t) => [C.lerp(a[0], b[0], t), C.lerp(a[1], b[1], t), C.lerp(a[2], b[2], t)];
      this.basePalette = {
        deep: p.deep, mid: p.mid, hot: p.hot, accent: p.accent,
        dust0: p.mid.map((c) => c * 0.8),
        dust1: mix(p.mid, p.hot, 0.35),
        dust2: mix(p.hot, [1, 1, 1], 0.35),
        dust3: p.accent,
      };
      this.palette = Object.assign({}, this.basePalette);
    }

    _rootMidi() {
      return 48 + this.root;
    }
    _fifth() {
      return this.scale.includes(7) ? 7 : this.scale.includes(6) ? 6 : 8;
    }
    midiOf(deg) {
      return C.degreeToMidi(deg, this.scale, this.root);
    }
    pcOf(deg) {
      return C.degreeToPc(deg, this.scale, this.root);
    }

    // Your music is heard: retune to the root + scale that best covers the notes actually present.
    // (Key names are ambiguous — A minor and C major share every note — but coverage is what keeps us in tune.)
    fitKey(chroma, hint) {
      const len = this.scale.length;
      if (len === 6) return null;
      const fams = len === 5 ? ['major pentatonic', 'minor pentatonic', 'yo', 'hirajoshi'] : ['ionian', 'dorian', 'aeolian', 'mixolydian', 'lydian'];
      let total = 0, mx = 1e-9;
      for (let i = 0; i < 12; i++) { total += chroma[i]; mx = Math.max(mx, chroma[i]); }
      if (total <= 0) return null;
      let best = null;
      for (const fam of fams) {
        const sc = C.SCALES[fam];
        for (let r = 0; r < 12; r++) {
          const pcs = new Set(sc.map((s) => (s + r) % 12));
          let inside = 0, maxOut = 0;
          for (let i = 0; i < 12; i++) { if (pcs.has(i)) inside += chroma[i]; else maxOut = Math.max(maxOut, chroma[i]); }
          let score = inside / total - 0.6 * (maxOut / mx) + 0.06 * (chroma[r] / mx);
          if (hint && r === hint.root) score += 0.03;
          if (!best || score > best.score) best = { score, fam, r };
        }
      }
      this.setKey(best.r, best.fam);
      return { root: best.r, scaleName: best.fam, name: C.NOTE_NAMES[best.r] + ' ' + best.fam };
    }

    setKey(rootPc, scaleName) {
      let r = rootPc;
      while (r - this.root > 6) r -= 12;
      while (this.root - r > 6) r += 12;
      // nearest to where we were, but never drifting out of the home register after many retunes
      while (r > 11) r -= 12;
      while (r < -6) r += 12;
      this.root = r;
      if (scaleName && scaleName !== this.scaleName) {
        this.scaleName = scaleName;
        const ns = C.SCALES[this.scaleName];
        // keep each creature at the same relative position in its scale
        const ratio = ns.length / this.scale.length;
        for (const s of this.singers) s.g.degrees = s.g.degrees.map((d) => Math.round(d * ratio));
        for (const s of this.serpents) s.melody = s.melody.map((d) => Math.round(d * ratio));
        this.scale = ns.slice();
      }
      for (const s of this.singers) this._look(s);
      this._droneKey();
    }

    // ------------------------------------------------------------------ genomes and creatures
    _genomeFrom(sp) {
      return {
        degrees: sp.degrees ? sp.degrees.slice() : [sp.degree],
        timbre: sp.timbre, lobes: sp.lobes, rhythm: sp.rhythm, speed: sp.speed,
        social: sp.social, spike: sp.spike,
      };
    }
    _mutate(g, r, rate) {
      r = r || Math.random;
      const n = Object.assign({}, g, { degrees: g.degrees.slice() });
      const len = this.scale.length;
      n.degrees = n.degrees.map((d) => {
        const x = r();
        if (x < 0.55 * rate) return d + (r() < 0.5 ? -1 : 1);
        if (x < 0.75 * rate) return d + (r() < 0.5 ? -2 : 2);
        if (x < 0.85 * rate) return d + (r() < 0.5 ? -len : len);
        return d;
      }).map((d) => C.clamp(d, -len * 2, len * 3));
      n.timbre = C.clamp(n.timbre + (r() - 0.5) * 0.16 * rate, 0, 1);
      if (r() < 0.25 * rate) n.lobes = C.clamp(n.lobes + (r() < 0.5 ? -1 : 1), 3, 12);
      if (r() < 0.12 * rate) n.rhythm = [2, 3, 4, 6, 8][Math.floor(r() * 5)];
      n.speed = C.clamp(n.speed * (1 + (r() - 0.5) * 0.2 * rate), 0.4, 2);
      n.social = C.clamp(n.social + (r() - 0.5) * 0.2 * rate, 0, 1);
      n.spike = C.clamp(n.spike + (r() - 0.5) * 0.2 * rate, 0, 1);
      return n;
    }

    spawnSinger(x, y, g, opts) {
      if (this.singers.length >= MAX_SINGERS) return null;
      opts = opts || {};
      const s = {
        id: this.nextId++, x: wrap(x), y: wrap(y), vx: opts.vx || 0, vy: opts.vy || 0,
        heading: Math.random() * TAU, g, energy: opts.energy || 1.0, age: 0,
        life: opts.life || 160 + Math.random() * 220, phase: Math.random(), pulse: 0, born: 0, dying: 0,
        glow: 0, hover: 0, trail: new Float32Array(TR * 2), tN: 0, tTimer: 0,
        answerAt: 0, seek: 0, seekX: 0, seekY: 0, grabbed: false, thrown: 0, mateCd: 8 + Math.random() * 10,
        col: [1, 1, 1], size: 0.4, big: opts.big || 1,
      };
      for (let i = 0; i < TR; i++) { s.trail[i * 2] = s.x; s.trail[i * 2 + 1] = s.y; }
      this._look(s);
      this.singers.push(s);
      this.stats.births++;
      return s;
    }

    _look(s) {
      const d0 = s.g.degrees[0];
      const pc = this.pcOf(d0);
      s.pcs = s.g.degrees.map((d) => this.pcOf(d));
      const pcol = C.hsl(C.pcHue(pc), 0.78, 0.55), wm = this.palette ? this.palette.mid : pcol;
      // a newcomer from another world keeps a little of its home's colour
      s.col = s.fcol ? pcol.map((c, i) => c * 0.6 + s.fcol[i] * 0.4) : pcol.map((c, i) => c * 0.8 + wm[i] * 0.2);
      const len = this.scale.length;
      s.size = C.clamp(0.33 * Math.pow(2, -d0 / (len * 1.4)), 0.11, 0.7) * (1 + 0.22 * (s.g.degrees.length - 1)) * (s.big || 1);
    }

    _killSinger(s, quiet) {
      if (s.dying) return;
      s.dying = 0.001;
      this.stats.deaths++;
      if (!quiet) {
        this._addNut(s.x, s.y, 0.35 * s.size + 0.1);
        this.addShock(s.x, s.y, 0.5 * s.size, 3, 0.4, 1.2, 0.3);
        this.addRing(s.x, s.y, s.size * 0.4, s.size * 3, 1.4, s.col, 0.05, 0.6);
      }
    }

    _makeOrb(x, y, seed, r, from) {
      const pv = C.previewWorld(seed, this.genus, this.world.style);
      const o = {
        x, y, r, seed, vx: (from && from.vx) || 0, vy: (from && from.vy) || 0, user: from && from.user,
        name: pv.name, lawName: pv.lawName, pv,
        c1: pv.palette.deep.map((c) => c * 4 + 0.02), c2: pv.palette.mid, c3: pv.palette.hot,
        seedF: (seed % 1000) / 37, hover: 0, born: from && from.born != null ? from.born : 1, voice: null, grabbed: false,
      };
      o.chord = [0, 2, 4].map((i) => 60 + pv.root + pv.scale[i % pv.scale.length] + (i >= pv.scale.length ? 12 : 0));
      return o;
    }

    makeStar(x, y, mass) {
      if (this.stars.length >= 7) this.stars[0].life = Math.min(this.stars[0].life, this.stars[0].age);
      const len = this.scale.length;
      const fifthIdx = Math.max(0, this.scale.indexOf(this._fifth()));
      const st = {
        id: this.nextId++, x: wrap(x), y: wrap(y), vx: 0, vy: 0, mass, age: 0, life: 55 + mass * 30,
        axis: Math.random() * Math.PI, spin: Math.random() * TAU,
        beat: mass > 2.2 ? 4 : mass > 1.3 ? 2 : 1, offset: Math.floor(Math.random() * 4),
        degree: (Math.random() < 0.6 ? 0 : fifthIdx) - len, flare: 0, born: 0, grabbed: false,
      };
      st.col = C.hsl(C.pcHue(this.pcOf(st.degree)), 0.7, 0.7);
      this.stars.push(st);
      return st;
    }

    // ------------------------------------------------------------------ effects
    addShock(x, y, amp, speed, width, heat, zkick) {
      const s = { x, y, r: 0, amp, speed: speed || 4, w: width || 0.5, heat: heat == null ? 1 : heat, z: zkick || 0.3 };
      if (this.shocks.length < 24) this.shocks.push(s);
      else {
        let mi = 0;
        for (let i = 1; i < this.shocks.length; i++) if (this.shocks[i].amp < this.shocks[mi].amp) mi = i;
        if (this.shocks[mi].amp < amp) this.shocks[mi] = s;
      }
    }
    addRing(x, y, r0, r1, dur, col, thick, alpha) {
      if (this.rings.length > 260) this.rings.shift();
      this.rings.push({ x, y, r0, r1, dur, t: 0, col, thick: thick || 0.06, alpha: alpha == null ? 1 : alpha });
    }
    _addNut(x, y, amount, radius) {
      radius = radius || 1;
      const cx = (x / W + 0.5) * NG - 0.5, cy = (y / W + 0.5) * NG - 0.5;
      const cr = (radius / W) * NG;
      const R = Math.ceil(cr * 2);
      for (let dy = -R; dy <= R; dy++) for (let dx = -R; dx <= R; dx++) {
        const ix = ((Math.round(cx) + dx) % NG + NG) % NG, iy = ((Math.round(cy) + dy) % NG + NG) % NG;
        const w = Math.exp(-(dx * dx + dy * dy) / (cr * cr + 0.5));
        this.nut[iy * NG + ix] = Math.min(1.6, this.nut[iy * NG + ix] + amount * w);
      }
    }
    nutAt(x, y) {
      const gx = (x / W + 0.5) * NG - 0.5, gy = (y / W + 0.5) * NG - 0.5;
      const ix = Math.floor(gx), iy = Math.floor(gy), fx = gx - ix, fy = gy - iy;
      const i0 = ((ix % NG) + NG) % NG, i1 = (i0 + 1) % NG, j0 = ((iy % NG) + NG) % NG, j1 = (j0 + 1) % NG;
      const n = this.nut;
      return (n[j0 * NG + i0] * (1 - fx) + n[j0 * NG + i1] * fx) * (1 - fy) + (n[j1 * NG + i0] * (1 - fx) + n[j1 * NG + i1] * fx) * fy;
    }
    _eat(x, y, amount) {
      const ix = ((Math.round((x / W + 0.5) * NG - 0.5) % NG) + NG) % NG;
      const iy = ((Math.round((y / W + 0.5) * NG - 0.5) % NG) + NG) % NG;
      const i = iy * NG + ix;
      const take = Math.min(this.nut[i], amount);
      this.nut[i] -= take;
      return take;
    }

    _audioSpatial(x, y) {
      const cam = this.cam;
      const dx = wrap(x - cam.x), dy = wrap(y - cam.y);
      const hw = (cam.viewH * cam.aspect) / 2, hh = cam.viewH / 2;
      const dn = Math.hypot(dx / hw, dy / hh);
      const att = dn < 1 ? 1 : Math.exp(-(dn - 1) * 2.8);
      const zoom = C.clamp(Math.pow(11 / cam.viewH, 0.6), 0.45, 1.25);
      return { att: att * zoom * this.gain, pan: C.clamp(dx / hw, -1, 1) * 0.75, visible: dn < 1.25 };
    }

    // A creature sings: quantised sound, and the visual lands exactly when the sound does.
    _pulse(s, boost) {
      const sp = this._audioSpatial(s.x, s.y);
      const duck = this.music.active ? 0.55 : 1;
      const vel = 0.16 * sp.att * duck * (0.65 + 0.35 * Math.min(1.5, s.energy)) * (boost || 1);
      let t = null;
      if (vel > 0.012) {
        const notes = s.g.degrees.map((d) => this.midiOf(d));
        t = this.audio.requestNote({ notes, timbre: s.g.timbre, vel, pan: sp.pan });
        if (t != null) this.lastPc = s.pcs[0];
      }
      if (t == null) t = this.audio.nextGrid(0.03).time;
      this.pending.push({ t, kind: 'pulse', s, vis: sp.visible });
    }

    // ------------------------------------------------------------------ user verbs
    ping(x, y, yN) {
      if (this.G) return this.G.tap(x, y, yN);
      const len = this.scale.length;
      const deg = Math.floor(yN * len * 2.2) - Math.floor(len * 0.6);
      const midi = this.midiOf(deg);
      const sp = this._audioSpatial(x, y);
      this.audio.play({ midi, timbre: 0.45, vel: 0.22, pan: sp.pan });
      this.lastPc = this.pcOf(deg);
      const col = C.hsl(C.pcHue(this.lastPc), 0.8, 0.65);
      this.addRing(x, y, 0.1, 2.2, 1.1, col, 0.05, 0.9);
      this.addShock(x, y, 1.2, 5, 0.45, 1.4, 0.4);
      this._startle(x, y, 2.5, 2);
    }

    startCharge(x, y, yN) {
      if (this.G) return this.G.holdStart(x, y, yN);
      this.charge = { x, y, t: 0, voice: this.audio.sustain('charge'), ignited: false };
    }
    updateCharge(x, y, dt, yN) {
      if (this.G) return this.G.holdUpdate(x, y, dt, yN);
      const c = this.charge;
      if (!c) return;
      c.x = x; c.y = y;
      c.t += dt;
      const k = Math.min(1, c.t / 2.6);
      if (c.voice) {
        const sp = this._audioSpatial(x, y);
        c.voice.set(110 * Math.pow(2, k * 2.2), 0.05 + 0.12 * k, sp.pan, k * 6, 600 + k * 3000);
      }
      if (!c.ignited && c.t > 1.2) {
        c.ignited = true;
        this.addRing(x, y, 0.2, 1.4, 0.8, this.palette.hot, 0.04, 0.9);
        this.audio.play({ midi: this.midiOf(0) + 12, timbre: 0.1, vel: 0.14, dur: 1.5 });
      }
    }
    releaseCharge() {
      if (this.G) return this.G.holdEnd();
      const c = this.charge;
      if (!c) return null;
      this.charge = null;
      if (c.voice) c.voice.stop(0.05);
      const sp = this._audioSpatial(c.x, c.y);
      if (c.t >= 1.2) {
        const mass = Math.min(3, 0.75 + (c.t - 1.2) * 0.55);
        const st = this.makeStar(c.x, c.y, mass);
        const allow = C.flash.request(0.6);
        this.addRing(c.x, c.y, 0.2, 3.5, 1.8, this.palette.hot, 0.05, allow);
        this.addShock(c.x, c.y, 1.5, 4, 0.6, 1.5, 0.5);
        this.audio.play({ notes: [this.midiOf(st.degree) + 12, this.midiOf(st.degree) + 19], timbre: 0.5, vel: 0.22, pan: sp.pan, dur: 5 });
        this._event('star', 'a pulsar is born — it keeps the beat');
        return 'star';
      }
      const k = Math.min(1, c.t / 1.2);
      const allow = C.flash.request(0.5 + k);
      this.addShock(c.x, c.y, (2.5 + 6 * k) * this.shockMul, 7, 0.7, 2.0 * allow, 0.8);
      this.addRing(c.x, c.y, 0.1, 3 + 4 * k, 1.2, this.palette.hot, 0.07, allow);
      this.addRing(c.x, c.y, 0.1, 1.5 + 2 * k, 0.8, this.palette.accent, 0.04, allow * 0.8);
      this._addNut(c.x, c.y, 0.3 + 0.4 * k, 2);
      this._startle(c.x, c.y, 4 + 3 * k, 5 + 6 * k);
      const chord = [0, 2, 4].map((i) => this.midiOf(i + Math.floor(k * 3)));
      this.audio.burst(k, sp.pan, chord, 0.2);
      return 'burst';
    }

    _startle(x, y, radius, kick) {
      for (const s of this.singers) {
        const dx = wrap(s.x - x), dy = wrap(s.y - y), d = Math.hypot(dx, dy);
        if (d < radius && d > 1e-3) {
          const f = (1 - d / radius) * kick;
          s.vx += (dx / d) * f;
          s.vy += (dy / d) * f;
          s.glow = Math.min(1.5, s.glow + 0.5);
        }
      }
    }

    dragStart(x, y) {
      if (this.G && this.G.dragStart) this.G.dragStart(x, y);
    }
    dragMove(x, y, vx, vy) {
      if (this.G && this.G.dragMove) {
        this.G.dragMove(x, y, vx, vy);
        if (!this.G.dragStart) this.pushStir(x, y, vx, vy);
        return;
      }
      this.pushStir(x, y, vx, vy);
    }
    dragEnd(vx, vy) {
      if (this.G && this.G.dragEnd) this.G.dragEnd(vx, vy);
    }
    pushStir(x, y, vx, vy) {
      if (this.stirs.length >= 8) this.stirs.shift();
      this.stirs.push({ x, y, vx, vy, life: 0.12 });
    }

    pick(x, y) {
      if (this.G) {
        const h = this.G.pick(x, y);
        if (h) return h;
        for (const o of this.orbs) if (Math.hypot(wrap(o.x - x), wrap(o.y - y)) < o.r) return { type: 'orb', obj: o };
        return null;
      }
      let best = null, bd = 1e9;
      for (const s of this.singers) {
        if (s.dying) continue;
        const d = Math.hypot(wrap(s.x - x), wrap(s.y - y));
        if (d < s.size * 1.4 + 0.15 && d < bd) { bd = d; best = { type: 'singer', obj: s }; }
      }
      if (best) return best;
      for (const st of this.stars) {
        const d = Math.hypot(wrap(st.x - x), wrap(st.y - y));
        if (d < 0.45 + st.mass * 0.12 && d < bd) { bd = d; best = { type: 'star', obj: st }; }
      }
      if (best) return best;
      for (const o of this.orbs) {
        const d = Math.hypot(wrap(o.x - x), wrap(o.y - y));
        if (d < o.r && d < bd) { bd = d; best = { type: 'orb', obj: o }; }
      }
      return best;
    }

    hover(x, y, active) {
      const h = active ? this.pick(x, y) : null;
      for (const s of this.singers) s.hoverT = 0;
      for (const o of this.orbs) o.hoverT = 0;
      if (h && h.type === 'singer') h.obj.hoverT = 1;
      if (h && h.type === 'orb') h.obj.hoverT = 1;
      return h;
    }

    grab(target) {
      const o = target.obj;
      o.grabbed = true;
      if (target.type === 'singer') {
        target.startDeg = o.g.degrees[0];
        target.voice = this.audio.sustain('grab');
        target.lastDeg = o.g.degrees[0];
        this.audio.play({ notes: o.g.degrees.map((d) => this.midiOf(d)), timbre: o.g.timbre, vel: 0.14 });
      }
      return target;
    }
    moveGrab(target, x, y, dt, stepsUp, speed) {
      const o = target.obj;
      const k = C.damp(target.type === 'singer' ? 18 : 10, dt);
      const dx = wrap(x - o.x), dy = wrap(y - o.y);
      o.x = wrap(o.x + dx * k);
      o.y = wrap(o.y + dy * k);
      if (target.type === 'singer') {
        const nd = C.clamp(target.startDeg + stepsUp, -this.scale.length * 2, this.scale.length * 3);
        if (nd !== target.lastDeg) {
          const shift = nd - o.g.degrees[0];
          o.g.degrees = o.g.degrees.map((d) => d + shift);
          target.lastDeg = nd;
          this._look(o);
          this.addRing(o.x, o.y, o.size, o.size * 2.2, 0.5, o.col, 0.04, 0.8);
          this._found('retune', 'carry a creature up or down to retune it — its children inherit the note');
        }
        if (target.voice) {
          const sp = this._audioSpatial(o.x, o.y);
          target.voice.set(C.midiToFreq(this.midiOf(o.g.degrees[0])), 0.11, sp.pan, Math.min(14, speed * 0.6), 900 + Math.min(4000, speed * 120));
        }
        o.glow = 1;
        o.pulse = Math.max(o.pulse, 0.25);
      }
    }
    releaseGrab(target, vx, vy) {
      const o = target.obj;
      o.grabbed = false;
      const sp = Math.hypot(vx, vy), cap = target.type === 'orb' ? 3 : 14;
      if (sp > cap) { vx *= cap / sp; vy *= cap / sp; }
      o.vx = vx;
      o.vy = vy;
      if (target.type === 'singer') {
        o.thrown = sp > 3 ? 1.5 : 0;
        if (target.voice) target.voice.stop(0.15);
      }
    }

    // draw a living melody
    startDraw(x, y, yN, fromStar) {
      if (this.G) { this._gDraw = true; if (this.G.drawStart) this.G.drawStart(x, y, yN); return; }
      this._gDraw = false;
      this.stroke = { pts: [x, y], lastX: x, lastY: y, degs: [], lastDeg: null, fromStar, len: 0 };
      this._drawNote(yN);
    }
    _drawNote(yN) {
      const st = this.stroke;
      const len = this.scale.length;
      const deg = Math.floor(yN * len * 2.2) - Math.floor(len * 0.6) - (st.fromStar ? len : 0);
      st.curDeg = deg;
      if (deg !== st.lastDeg) {
        st.lastDeg = deg;
        const sp = this._audioSpatial(st.lastX, st.lastY);
        this.audio.play({ midi: this.midiOf(deg), timbre: 0.7, vel: 0.13, pan: sp.pan, dur: 0.7 });
      }
    }
    addDraw(x, y, yN) {
      if (this._gDraw) { if (this.G && this.G.drawMove) this.G.drawMove(x, y, yN); else this.pushStir(x, y, 0, 0); return; }
      const st = this.stroke;
      if (!st) return;
      const n = st.pts.length;
      const px = st.pts[n - 2], py = st.pts[n - 1];
      const ux = px + wrap(x - wrap(px)), uy = py + wrap(y - wrap(py));
      const d = Math.hypot(ux - px, uy - py);
      if (d < 0.08) return;
      st.pts.push(ux, uy);
      st.len += d;
      st.lastX = x; st.lastY = y;
      this._drawNote(yN);
      st.degs.push(st.curDeg);
    }
    endDraw() {
      if (this._gDraw) { this._gDraw = false; return this.G && this.G.drawEnd ? this.G.drawEnd() : null; }
      const st = this.stroke;
      this.stroke = null;
      if (!st || st.len < 1.2 || st.pts.length < 8) return null;
      const pts = st.pts, n = pts.length / 2;
      const fx = pts[0], fy = pts[1], lx = pts[pts.length - 2], ly = pts[pts.length - 1];
      let minx = 1e9, maxx = -1e9, miny = 1e9, maxy = -1e9, cx = 0, cy = 0;
      for (let i = 0; i < n; i++) {
        const x = pts[i * 2], y = pts[i * 2 + 1];
        minx = Math.min(minx, x); maxx = Math.max(maxx, x); miny = Math.min(miny, y); maxy = Math.max(maxy, y);
        cx += x; cy += y;
      }
      cx /= n; cy /= n;
      const span = Math.max(maxx - minx, maxy - miny);
      const closed = Math.hypot(lx - fx, ly - fy) < Math.max(0.9, st.len * 0.12) && st.len > 4 && span > 1.6;
      if (closed && !st.fromStar) {
        // a closed loop becomes a doorway: a brand new world
        let h = 2166136261;
        for (let i = 0; i < pts.length; i += 6) h = C.hash(h, Math.round(pts[i] * 10));
        const r = C.clamp(span * 0.32, 0.8, 1.6);
        this._birthOrb(wrap(cx), wrap(cy), h, r);
        this._found('loop', 'you drew a door — a new world is inside');
        return 'orb';
      }
      // resample into the serpent's body (head = where the pen ended)
      const body = new Float32Array(SERP_N * 2);
      const cum = [0];
      for (let i = 1; i < n; i++) cum.push(cum[i - 1] + Math.hypot(pts[i * 2] - pts[i * 2 - 2], pts[i * 2 + 1] - pts[i * 2 - 1]));
      const total = cum[n - 1];
      let j = n - 1;
      for (let k = 0; k < SERP_N; k++) {
        const target = total * (1 - k / (SERP_N - 1));
        while (j > 0 && cum[j - 1] > target) j--;
        const i0 = Math.max(0, j - 1), seg = cum[j] - cum[i0] || 1;
        const t = C.clamp((target - cum[i0]) / seg, 0, 1);
        body[k * 2] = wrap(C.lerp(pts[i0 * 2], pts[j * 2], t));
        body[k * 2 + 1] = wrap(C.lerp(pts[i0 * 2 + 1], pts[j * 2 + 1], t));
      }
      const degs = st.degs.length ? st.degs : [0];
      const melody = [];
      for (let k = 0; k < 8; k++) melody.push(degs[Math.floor((k / 8) * degs.length)]);
      const hx = pts[pts.length - 2] - pts[pts.length - 6 >= 0 ? pts.length - 6 : 0];
      const hy = pts[pts.length - 1] - pts[pts.length - 5 >= 0 ? pts.length - 5 : 1];
      const serp = {
        id: this.nextId++, pts: body, heading: Math.atan2(hy, hx), seg: C.clamp(total / SERP_N, 0.07, 0.28),
        speed: 1.1, melody, step: -1, glow: new Float32Array(SERP_N), age: 0, life: 120 + Math.random() * 60,
        timbre: st.fromStar ? 0.12 : 0.72, born: 0, dying: 0, thick: st.fromStar ? 1.6 : 1,
      };
      if (this.serpents.length >= 5) this.serpents[0].life = Math.min(this.serpents[0].life, this.serpents[0].age);
      this.serpents.push(serp);
      if (st.fromStar) {
        const i = this.stars.indexOf(st.fromStar);
        if (i >= 0) this.stars.splice(i, 1);
        this._found('unravel', 'the star unravelled into a song');
      } else this._found('serpent', 'your melody is alive — it will sing until it dissolves into seeds');
      return 'serpent';
    }

    _birthOrb(x, y, seed, r) {
      if (this.orbs.length >= 7) {
        const victim = this.orbs.find((o) => o.user) || this.orbs[0];
        victim.dying = true;
      }
      const o = this._makeOrb(x, y, seed, r, { born: 0, user: true });
      this.orbs.push(o);
      const allow = C.flash.request(0.8);
      this.addRing(x, y, 0.2, r * 4, 2.2, o.c2, 0.06, allow);
      this.addShock(x, y, 3 * this.shockMul, 5, 0.8, 1.5, 0.6);
      this.audio.burst(0.5, this._audioSpatial(x, y).pan, o.chord, 0.25);
      return o;
    }

    // keyboard: you sing, they answer
    playKey(i, x, y) {
      if (this.G) return this.G.key(i, x, y);
      const len = this.scale.length;
      const deg = i;
      const midi = this.midiOf(deg);
      const pc = this.pcOf(deg);
      const sp = this._audioSpatial(x, y);
      this.audio.play({ midi, timbre: 0.18, vel: 0.26, pan: sp.pan, dur: 2.5 });
      this.lastPc = pc;
      const col = C.hsl(C.pcHue(pc), 0.85, 0.62);
      this.addRing(x, y, 0.15, 2.8, 1.4, col, 0.045, 0.9);
      this.addShock(x, y, 0.9, 5, 0.4, 1.0, 0.3);
      const resp = [];
      for (const s of this.singers) {
        if (s.dying || !s.pcs.includes(pc)) continue;
        const d = Math.hypot(wrap(s.x - x), wrap(s.y - y));
        if (d < 12) resp.push([d, s]);
      }
      resp.sort((a, b) => a[0] - b[0]);
      const now = this.audio.now(), bd = this.audio.beatDur();
      resp.slice(0, 7).forEach(([d, s], k) => {
        s.answerAt = now + bd * (1 + k * 0.25) + 0.01;
        s.seek = 4;
        s.seekX = x; s.seekY = y;
        s.glow = 1;
      });
      if (resp.length) {
        this.callCount[pc] = 0;
        this._found('answer', 'they answered you');
      } else {
        const t = this.time;
        this.callCount[pc] = t - this.callTime[pc] < 5 ? this.callCount[pc] + 1 : 1;
        this.callTime[pc] = t;
        if (this.callCount[pc] >= 3) {
          this.callCount[pc] = 0;
          const g = { degrees: [deg], timbre: Math.random(), lobes: 3 + Math.floor(Math.random() * 8), rhythm: 4, speed: 1, social: 0.7, spike: Math.random() };
          const s = this.spawnSinger(x, y, g, { energy: 1.4 });
          if (s) {
            this.addRing(x, y, 0.1, 3, 1.6, col, 0.06, 1);
            this._found('summon', 'call a note three times into the silence and something is born');
          }
        }
      }
    }

    _event(key, text) {
      if (this.gain < 0.71) return; // only the world you are mostly in may speak to you (0.71 = halfway, equal-power)
      C.uiEvents.push({ key, text });
    }
    _found(key, text) {
      if (this.gain < 0.71 || C.found.has(key)) return;
      C.found.add(key);
      this._event(key, text);
    }

    // ------------------------------------------------------------------ simulation
    update(dt, realDt, ticks) {
      this.time += dt;
      const now = this.audio.now();
      const music = this.music;
      const mActive = music.active;
      const len = this.scale.length;

      this.intro += (this.introTarget - this.intro) * C.damp(this.introTarget < this.intro ? 1.4 : 4, realDt);

      // spawn waves
      if (this.spawnQueue.length) {
        this.spawnQueue = this.spawnQueue.filter((q) => {
          if (q.t > this.time) return true;
          const s = this.spawnSinger(q.x, q.y, q.g);
          if (s) this.addRing(q.x, q.y, 0.05, s.size * 2.5, 1.0, s.col, 0.05, 0.7);
          return false;
        });
      }

      // --- clock ticks: pulsars and serpents play on the grid
      const td = this.audio.tickDur();
      for (const tk of ticks) {
        if (tk.tick % 4 === 0) {
          const beat = tk.tick / 4;
          for (const st of this.stars) {
            if ((beat + st.offset) % st.beat !== 0) continue;
            const sp = this._audioSpatial(st.x, st.y);
            if (!mActive) this.audio.thump(tk.time, C.midiToFreq(this.midiOf(st.degree) - 12), 0.32 * sp.att * Math.min(1.3, 0.6 + st.mass * 0.3), sp.pan);
            if (!mActive) this.pending.push({ t: tk.time, kind: 'star', st, strength: 1 });
          }
        }
        if (tk.tick % 2 === 0) {
          for (const sp of this.serpents) {
            if (sp.dying) continue;
            sp.step = (sp.step + 1) % 8;
            const deg = sp.melody[sp.step];
            const k = Math.round((sp.step / 7) * (SERP_N - 1));
            const px = sp.pts[k * 2], py = sp.pts[k * 2 + 1];
            const a = this._audioSpatial(px, py);
            const vel = 0.15 * a.att * (mActive ? 0.5 : 1) * Math.min(1, sp.born * 2);
            if (vel > 0.012) this.audio.play({ midi: this.midiOf(deg), timbre: sp.timbre, vel, pan: a.pan, dur: sp.timbre < 0.3 ? 1.6 : 0.6 }, tk.time);
            this.pending.push({ t: tk.time, kind: 'serp', sp, k, deg });
          }
        }
      }

      // --- your music: weather
      if (mActive) {
        const b = music.bands;
        for (const ev of music.events) {
          if (ev.type === 'kick') {
            const amp = (1.2 + 2.2 * ev.strength) * this.shockMul;
            if (this.stars.length) {
              for (const st of this.stars) this.pending.push({ t: now, kind: 'star', st, strength: ev.strength });
            } else {
              const cx = this.cam.x + (Math.random() - 0.5) * this.cam.viewH, cy = this.cam.y + (Math.random() - 0.5) * this.cam.viewH * 0.6;
              this.addShock(wrap(cx), wrap(cy), amp, 6, 0.6, 1.2, 0.5);
            }
            if (music.tempoConf > 0.3) this.audio.nudgePhase(ev.time, 0.12);
          } else if (ev.type === 'onset') {
            // singers whose notes are in the music sing along
            let n = 0;
            for (const s of this.singers) {
              if (s.dying || s.grabbed) continue;
              const c = music.chroma[s.pcs[0]];
              if (c > 0.72 && Math.random() < 0.35 * ev.strength && n < 6) {
                n++;
                this._pulse(s, 0.7);
              }
            }
            if (Math.random() < 0.3) {
              const x = wrap(this.cam.x + (Math.random() - 0.5) * this.cam.viewH * 1.6), y = wrap(this.cam.y + (Math.random() - 0.5) * this.cam.viewH);
              this._addNut(x, y, 0.12 * ev.strength + 0.04, 1.5);
            }
          }
        }
        const cen = music.centroid;
        const bp = this.basePalette;
        this.palette.dust1 = bp.dust1.map((c, i) => C.lerp(c, bp.dust3[i], C.smooth(0.45, 0.85, cen) * 0.6));
        this.palette.dust0 = bp.dust0.map((c) => c * (1 + b.bass * 0.5));
      } else if (this.palette !== this.basePalette) {
        this.palette.dust1 = this.basePalette.dust1;
        this.palette.dust0 = this.basePalette.dust0;
      }

      // --- nutrient field: regrow, diffuse
      {
        const n = this.nut, base = this.nutBase, tmp = this._nutTmp;
        const regen = 0.0045 * dt;
        const D = Math.min(0.2, 0.6 * dt);
        for (let y = 0; y < NG; y++) {
          const ym = ((y - 1 + NG) % NG) * NG, yp = ((y + 1) % NG) * NG, yc = y * NG;
          for (let x = 0; x < NG; x++) {
            const xm = (x - 1 + NG) % NG, xp = (x + 1) % NG;
            const i = yc + x;
            const lap = n[yc + xm] + n[yc + xp] + n[ym + x] + n[yp + x] - 4 * n[i];
            tmp[i] = n[i] + lap * D * 0.25 + (base[i] - n[i]) * regen;
          }
        }
        n.set(tmp);
      }

      // --- singers
      this._updateSingers(dt, now);

      // --- pending visual events, fired exactly when their sound lands
      if (this.pending.length) {
        const keep = [];
        for (const p of this.pending) {
          if (p.t > now) { keep.push(p); continue; }
          if (p.kind === 'pulse') {
            const s = p.s;
            if (s.dying && s.dying > 0.5) continue;
            s.pulse = 1;
            const hx = Math.cos(s.heading), hy = Math.sin(s.heading);
            const thrust = 1.1 * s.g.speed * (s.seek > 0 ? 1.4 : 1);
            s.vx += hx * thrust;
            s.vy += hy * thrust;
            s.energy -= 0.012;
            if (p.vis) {
              this.addShock(s.x, s.y, 0.45 * s.size * this.shockMul, 3.2, 0.35, 1.1, 0.25);
              this.addRing(s.x, s.y, s.size * 0.9, s.size * 2.6, 0.9, s.col, 0.04, 0.55);
            }
          } else if (p.kind === 'star') {
            const st = p.st;
            if (!this.stars.includes(st)) continue;
            st.flare = 1;
            const allow = C.flash.request(0.15);
            this.addShock(st.x, st.y, (0.9 + 0.6 * st.mass) * p.strength * this.shockMul, 6, 0.55, 0.9 * allow, 0.6);
            this.addRing(st.x, st.y, 0.3, 2 + st.mass, 0.9, st.col, 0.035, 0.6 * allow);
          } else if (p.kind === 'fn') {
            p.fn();
          } else if (p.kind === 'serp') {
            const sp = p.sp;
            for (let d = -3; d <= 3; d++) {
              const k = p.k + d;
              if (k >= 0 && k < SERP_N) sp.glow[k] = Math.max(sp.glow[k], 1 - Math.abs(d) / 4);
            }
            const px = sp.pts[p.k * 2], py = sp.pts[p.k * 2 + 1];
            this.addShock(px, py, 0.5 * this.shockMul, 3, 0.35, 1.0, 0.2);
            this.lastPc = this.pcOf(p.deg);
          }
        }
        this.pending = keep;
      }

      this._updateStars(dt);
      this._updateSerpents(dt);
      this._updateOrbs(dt, realDt);

      // --- shocks, rings, stirs
      for (const s of this.shocks) {
        s.r += s.speed * dt;
        s.amp *= Math.exp(-dt * 1.4);
      }
      this.shocks = this.shocks.filter((s) => s.amp > 0.03 && s.r < 16);
      for (const r of this.rings) r.t += realDt;
      this.rings = this.rings.filter((r) => r.t < r.dur);
      for (const s of this.stirs) s.life -= realDt;
      this.stirs = this.stirs.filter((s) => s.life > 0);

      // --- cymatics: the last note heard picks the figure
      const want = CHL[this.lastPc];
      if (this.chl.mix >= 1 && want !== this.chl.b) {
        this.chl.a = this.chl.b;
        this.chl.b = want;
        this.chl.mix = 0;
      }
      this.chl.mix = Math.min(1, this.chl.mix + dt * 0.7);

      // --- autonomous life: the universe does things on its own
      this.autoTimer -= dt;
      if (this.autoTimer <= 0 && this.intro < 0.1 && !this.G) {
        this.autoTimer = 35 + Math.random() * 45;
        this._autonomous();
      }
      this.popFloorTimer -= dt;
      const alive = this.singers.length;
      if (this.G) this.G.update(dt, realDt, ticks, now);
      if (this.V) this.V.update(dt, realDt, ticks, now);
      this._cosmicEvents(dt);
      if (!this.drone && this.audio.started) {
        this.drone = this.audio.createDrone();
        this.drone.setTimbre(this.genus);
        this._droneKey();
      }
      if (this.drone) {
        this.drone.setGain(this.gain * (1 - this.intro));
        this.drone.setBright(C.clamp(this.singers.length / 140, 0, 1) * 0.6 + (music.active ? music.bands.mid * 0.4 : 0.15));
      }
      if ((!this.G || this.world.visitor === 'singers') && alive < (this.G ? 6 : 14) && this.popFloorTimer <= 0 && this.intro < 0.1 && !this.spawnQueue.length) {
        this.popFloorTimer = 2.5;
        this._spores(1 + Math.floor(Math.random() * 2));
      }

      this.flowT += dt * this.law.flow * (1 + (mActive ? music.bands.mid * 0.8 : 0));
    }

    _cosmicEvents(dt) {
      this.eventT -= dt;
      this.flipT = Math.max(0, this.flipT - dt);
      if (this.eventT <= 0 && this.intro < 0.1 && this.gain > 0.71) {
        this.eventT = 70 + Math.random() * 90;
        const ev = Math.random();
        const door = this.orbs.filter((o) => !o.dying && !o.grabbed && o.born >= 1);
        if (ev < 0.3 && door.length) this._rift(door[Math.floor(Math.random() * door.length)]);
        else if (ev < 0.72) {
          const cam = this.cam, a = Math.random() * TAU;
          for (let i = 0; i < 14; i++) {
            const sx = cam.x - Math.cos(a) * cam.viewH + (Math.random() - 0.5) * cam.viewH * 1.5;
            const sy = cam.y - Math.sin(a) * cam.viewH + (Math.random() - 0.5) * cam.viewH * 1.2;
            const sp = cam.viewH * (0.9 + Math.random() * 0.6);
            this.meteors.push({ x: sx, y: sy, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, age: -i * 0.3 - Math.random() * 0.3, life: 2.4, rang: false, deg: this.scale.length + Math.floor(Math.random() * this.scale.length * 1.5) });
          }
          this._event('meteors', 'a meteor shower');
        } else {
          this.flipT = 12;
          this.audio.whoosh(1.2, false);
          this._event('flip', 'gravity has turned inside out');
        }
      }
      for (const m of this.meteors) {
        m.age += dt;
        if (m.age < 0) continue;
        m.x += m.vx * dt;
        m.y += m.vy * dt;
        if (!m.rang && m.age > m.life * 0.45) {
          m.rang = true;
          const sp = this._audioSpatial(m.x, m.y);
          this.audio.play({ midi: this.midiOf(m.deg), timbre: 0.1, vel: 0.12 * sp.att, pan: sp.pan, dur: 2.5 });
          this.addShock(wrap(m.x), wrap(m.y), 1.2, 6, 0.4, 1.6, 0.3);
          this.addRing(wrap(m.x), wrap(m.y), 0.05, 1.4, 0.8, this.palette.accent, 0.04, 0.8);
        }
      }
      this.meteors = this.meteors.filter((m) => m.age < m.life);
      if (this.rift) this._updateRift(dt);
    }

    // Two worlds bleed into each other: an orb swells and tears, and the creatures of the world inside it
    // pour out into this one, carrying their own notes (and their world's key bends this one for a while).
    _rift(orb) {
      const inside = C.makeWorld(orb.seed, { notGenus: [this.genus], notStyle: [this.world.style] });
      this.rift = { orb, t: 0, life: 22, n: 0, max: 10 + Math.floor(Math.random() * 8), species: inside.species, root: inside.root, scale: inside.scale, name: inside.name };
      orb.rift = 1;
      this.audio.whoosh(1.6, true);
      const sp = this._audioSpatial(orb.x, orb.y);
      this.audio.burst(0.5, sp.pan, orb.chord, 0.3);
      const allow = C.flash.request(0.7);
      this.rift.allow = allow; // the halo keeps to the brightness the flash budget allowed
      this.addRing(orb.x, orb.y, orb.r, orb.r * 5, 2.4, orb.c3, 0.06, allow);
      this._event('rift', 'a rift has opened to ' + inside.name + ' — its creatures are pouring through');
    }
    _updateRift(dt) {
      const R = this.rift, o = R.orb;
      R.t += dt;
      if (!this.orbs.includes(o) || R.t > R.life) { o.rift = 0; this.rift = null; return; }
      o.rift = Math.min(1, R.t / 2) * (1 - C.smooth(R.life - 3, R.life, R.t)) * R.allow;
      // creatures spill out over the first part of the rift, each one born of the other world's species
      if (R.t > 1.5 && R.n < R.max && Math.random() < dt * 1.6) {
        const sp = R.species[Math.floor(Math.random() * R.species.length)];
        const g = this._mutate(this._genomeFrom(sp), null, 0.6);
        // their notes are written in the other world's scale: retranslate into this world's degrees
        const midi = C.degreeToMidi(g.degrees[0], R.scale, R.root);
        let best = 0, bd = 1e9;
        for (let d = -this.scale.length * 2; d <= this.scale.length * 3; d++) { const e = Math.abs(this.midiOf(d) - midi); if (e < bd) { bd = e; best = d; } }
        g.degrees = [best];
        const a = Math.random() * TAU;
        const s = this.spawnSinger(o.x + Math.cos(a) * o.r * 1.1, o.y + Math.sin(a) * o.r * 1.1, g, { vx: Math.cos(a) * 3, vy: Math.sin(a) * 3, energy: 1.6 });
        if (s) {
          s.foreign = o.seed;
          s.fcol = o.c3;
          this._look(s);
          R.n++;
          this.addRing(s.x, s.y, 0.05, 1.4, 0.9, o.c3, 0.05, 0.8 * C.flash.request(0.08));
        }
      }
    }

    _autonomous() {
      const r = Math.random();
      if (r < 0.45) this._spores(3 + Math.floor(Math.random() * 4));
      else if (r < 0.75 && this.stars.length < 3) {
        // a star condenses where the light is richest
        let best = 0, bi = 0;
        for (let i = 0; i < NG * NG; i++) if (this.nut[i] > best) { best = this.nut[i]; bi = i; }
        const x = ((bi % NG) + 0.5) / NG * W - W / 2, y = (Math.floor(bi / NG) + 0.5) / NG * W - W / 2;
        this._addNut(x, y, -0.5, 2);
        this.makeStar(x, y, 0.9 + Math.random() * 0.8);
        this.addRing(x, y, 0.1, 3, 2, this.palette.hot, 0.05, 0.8);
      } else if (r < 0.9) {
        // a leviathan drifts through, slow and low
        const len = this.scale.length;
        const a = Math.random() * TAU;
        const x = wrap(this.cam.x + Math.cos(a) * 14), y = wrap(this.cam.y + Math.sin(a) * 14);
        const s = this.spawnSinger(x, y, { degrees: [-len * 2 + 2 * Math.floor(Math.random() * 2)], timbre: 0.08, lobes: 9, rhythm: 8, speed: 0.6, social: 0.1, spike: 0.1 }, { big: 2.4, life: 140, energy: 3 });
        if (s) { s.vx = -Math.cos(a) * 0.8; s.vy = -Math.sin(a) * 0.8; s.leviathan = true; }
      } else this._spores(2);
    }

    _spores(n) {
      const src = this.orbs.length ? this.orbs[Math.floor(Math.random() * this.orbs.length)] : { x: this.cam.x, y: this.cam.y, r: 1 };
      const sp = this.world.species[Math.floor(Math.random() * this.world.species.length)];
      const g0 = this._mutate(this._genomeFrom(sp), null, 1.5);
      for (let i = 0; i < n; i++) {
        const a = Math.random() * TAU;
        const s = this.spawnSinger(src.x + Math.cos(a) * src.r * 1.2, src.y + Math.sin(a) * src.r * 1.2, this._mutate(g0, null, 0.3), { vx: Math.cos(a) * 2, vy: Math.sin(a) * 2 });
        if (s) this.addRing(s.x, s.y, 0.05, 1.2, 0.8, s.col, 0.05, 0.7);
      }
    }

    _updateSingers(dt, now) {
      const S = this.singers;
      const cs = this.cellSize, GN = this.gridN;
      for (const cell of this.grid) cell.length = 0;
      for (let i = 0; i < S.length; i++) {
        const s = S[i];
        if (!isFinite(s.x) || !isFinite(s.y) || !isFinite(s.vx) || !isFinite(s.vy) || !isFinite(s.energy)) {
          // never let one bad number poison the world
          s.x = s.y = s.vx = s.vy = 0;
          s.energy = 0.5;
          s.dying = s.dying || 0.001;
        }
        const gx = Math.floor((s.x + W / 2) / cs) % GN, gy = Math.floor((s.y + W / 2) / cs) % GN;
        s._cell = ((gy + GN) % GN) * GN + ((gx + GN) % GN);
        this.grid[s._cell].push(i);
      }
      const music = this.music, mActive = music.active;
      const cur = this.cursor;
      const beat = this.audio.beatDur();
      const cap = 140;
      const births = [];
      const len = this.scale.length;

      for (let i = 0; i < S.length; i++) {
        const s = S[i];
        if (s.dying) {
          s.dying += dt / 1.6;
          continue;
        }
        s.age += dt;
        s.born = Math.min(1, s.born + dt * 1.5);
        s.pulse *= Math.exp(-dt * 4.5);
        s.glow *= Math.exp(-dt * 1.5);
        s.hover += ((s.hoverT || 0) - s.hover) * C.damp(10, dt);
        s.mateCd -= dt;
        s.thrown = Math.max(0, s.thrown - dt);
        s.seek = Math.max(0, s.seek - dt);

        // trail
        s.tTimer += dt;
        if (s.tTimer > 0.055) {
          s.tTimer = 0;
          s.trail.copyWithin(2, 0, TR * 2 - 2);
          s.trail[0] = s.x;
          s.trail[1] = s.y;
        }

        if (s.grabbed) continue;

        let fx = 0, fy = 0, ax = 0, ay = 0, an = 0, dph = 0, kn = 0;
        const gx = s._cell % GN, gy = Math.floor(s._cell / GN);
        for (let oy = -1; oy <= 1; oy++) for (let ox = -1; ox <= 1; ox++) {
          const cell = this.grid[(((gy + oy) % GN + GN) % GN) * GN + (((gx + ox) % GN + GN) % GN)];
          for (const j of cell) {
            if (j === i) continue;
            const o = S[j];
            if (o.dying) continue;
            const dx = wrap(o.x - s.x), dy = wrap(o.y - s.y);
            const r2 = dx * dx + dy * dy;
            if (r2 > 6.25 || r2 < 1e-6) continue;
            const r = Math.sqrt(r2);
            const min = (s.size + o.size) * 1.5;
            if (r < min) {
              const push = (min - r) * 3.5;
              fx -= (dx / r) * push;
              fy -= (dy / r) * push;
            }
            const cons = C.CONSONANCE[(((o.pcs[0] - s.pcs[0]) % 12) + 12) % 12];
            const w = cons * s.g.social;
            fx += dx * w * 0.25;
            fy += dy * w * 0.25;
            if (cons > 0.3) { ax += o.vx; ay += o.vy; an++; }
            // firefly sync: matching rhythms pull each other's phase together
            if (o.g.rhythm === s.g.rhythm) {
              let d = o.phase - s.phase;
              d -= Math.round(d);
              dph += Math.sin(d * TAU) * (1 - r / 2.5);
              kn++;
            }
            // thrown into another: fusion into a chord
            if (s.thrown > 0 && r < (s.size + o.size) * 0.9 && s.g.degrees.length + o.g.degrees.length <= 3 && !o.grabbed) {
              this._fuse(s, o);
            } else if (!s.thrown && s.mateCd <= 0 && o.mateCd <= 0 && s.energy > 1.55 && o.energy > 1.55 && cons > 0.45 && r < (s.size + o.size) * 1.2 && S.length + births.length < cap) {
              births.push([s, o]);
              s.mateCd = o.mateCd = 18 + Math.random() * 14;
              s.energy -= 0.55;
              o.energy -= 0.55;
            }
          }
        }
        if (an) {
          fx += (ax / an - s.vx) * 0.6;
          fy += (ay / an - s.vy) * 0.6;
        }

        // food gradient
        const h = 0.7;
        const gxn = this.nutAt(s.x + h, s.y) - this.nutAt(s.x - h, s.y);
        const gyn = this.nutAt(s.x, s.y + h) - this.nutAt(s.x, s.y - h);
        fx += gxn * 4;
        fy += gyn * 4;

        // wander
        const wa = s.id * 1.7 + this.time * 0.23;
        fx += Math.cos(wa + Math.sin(this.time * 0.11 + s.id)) * 0.35;
        fy += Math.sin(wa * 1.3) * 0.35;

        // the intro seed holds its first creatures close
        if (this.intro > 0.05) {
          const dx = wrap(this.introCenter[0] - s.x), dy = wrap(this.introCenter[1] - s.y), d = Math.hypot(dx, dy) + 1e-3;
          fx += (dx / d) * Math.max(0, d - 2.5) * this.intro * 2;
          fy += (dy / d) * Math.max(0, d - 2.5) * this.intro * 2;
        }

        // you: curiosity when slow, panic when fast
        if (cur.active) {
          const dx = wrap(cur.x - s.x), dy = wrap(cur.y - s.y), d = Math.hypot(dx, dy) + 1e-3;
          if (cur.speed > 12 && d < 2.5) {
            fx -= (dx / d) * 9 * (1 - d / 2.5);
            fy -= (dy / d) * 9 * (1 - d / 2.5);
            s.glow = Math.min(1.2, s.glow + dt * 4);
          } else if (d < 5 && d > s.size * 3) {
            fx += (dx / d) * 0.5 * s.g.social;
            fy += (dy / d) * 0.5 * s.g.social;
          }
        }
        if (s.seek > 0) {
          const dx = wrap(s.seekX - s.x), dy = wrap(s.seekY - s.y), d = Math.hypot(dx, dy) + 1e-3;
          if (d > 1) { fx += (dx / d) * 3.5; fy += (dy / d) * 3.5; }
        }

        // stars: pulled, but wary of their hearts
        for (const st of this.stars) {
          const dx = wrap(st.x - s.x), dy = wrap(st.y - s.y), r2 = dx * dx + dy * dy, r = Math.sqrt(r2) + 1e-3;
          fx += (dx / r) * st.mass * 0.6 / (r2 + 1);
          fy += (dy / r) * st.mass * 0.6 / (r2 + 1);
          const fear = 1.0 + st.mass * 0.35;
          if (r < fear) {
            fx -= (dx / r) * (fear - r) * 6;
            fy -= (dy / r) * (fear - r) * 6;
          }
        }
        for (const o of this.orbs) {
          const dx = wrap(o.x - s.x), dy = wrap(o.y - s.y), r = Math.hypot(dx, dy) + 1e-3;
          if (r < o.r + s.size + 0.3) {
            fx -= (dx / r) * 5;
            fy -= (dy / r) * 5;
          }
        }

        // steer the bell toward where it wants to go
        const desired = Math.atan2(fy, fx);
        let dh = desired - s.heading;
        dh -= Math.round(dh / TAU) * TAU;
        const fmag = Math.hypot(fx, fy);
        s.heading += dh * C.damp(1.5 + Math.min(fmag, 4), dt);
        s.vx += fx * dt * 0.5 + Math.cos(s.heading) * 0.25 * s.g.speed * dt;
        s.vy += fy * dt * 0.5 + Math.sin(s.heading) * 0.25 * s.g.speed * dt;
        const drag = s.thrown > 0 ? 0.6 : 1.4;
        s.vx *= Math.exp(-drag * dt);
        s.vy *= Math.exp(-drag * dt);
        const maxV = 4 * s.g.speed * (s.thrown > 0 ? 4 : 1);
        const v = Math.hypot(s.vx, s.vy);
        if (v > maxV) { s.vx *= maxV / v; s.vy *= maxV / v; }
        s.x = wrap(s.x + s.vx * dt);
        s.y = wrap(s.y + s.vy * dt);

        // metabolism: eat light, and your music if it carries my note
        const food = this._eat(s.x, s.y, 0.22 * s.size * dt);
        s.energy += food * 2.4;
        if (mActive) {
          let c = 0;
          for (const pc of s.pcs) c = Math.max(c, music.chroma[pc]);
          s.energy += c * c * music.level * 0.09 * dt;
          s.glow = Math.max(s.glow, c * c * music.level * 0.8);
        }
        s.energy -= dt * (0.018 + 0.028 * s.size);
        if (s.energy <= 0 || s.age > s.life) this._killSinger(s);
        else if (s.energy > 2.7 && S.length + births.length < cap && s.age > 12) {
          births.push([s, null]);
          s.energy *= 0.5;
        }

        // the pulse oscillator: natural rhythm + firefly coupling
        const period = s.g.rhythm * beat;
        s.phase += dt / period + (kn ? (dph / kn) * 0.22 * dt : 0);
        if (s.answerAt && now >= s.answerAt - 0.03) {
          s.answerAt = 0;
          s.phase = 0;
          this._pulse(s, 1.3);
        } else if (s.phase >= 1 && this.intro < 0.5) {
          s.phase -= 1;
          this._pulse(s);
        } else if (s.phase >= 1) s.phase -= 1;
      }

      for (const [a, b] of births) {
        let g;
        if (b) {
          g = { degrees: (Math.random() < 0.5 ? a : b).g.degrees.slice() };
          for (const k of ['timbre', 'lobes', 'rhythm', 'speed', 'social', 'spike']) g[k] = (Math.random() < 0.5 ? a : b).g[k];
          g = this._mutate(g, null, 1);
        } else g = this._mutate(a.g, null, 1);
        const mx = b ? a.x + wrap(b.x - a.x) / 2 : a.x, my = b ? a.y + wrap(b.y - a.y) / 2 : a.y;
        const c = this.spawnSinger(mx, my, g, { energy: 1.0, vx: a.vx, vy: a.vy });
        if (c) {
          const sp = this._audioSpatial(mx, my);
          if (sp.visible) {
            this.addRing(mx, my, c.size * 0.5, c.size * 3, 1.2, c.col, 0.05, 0.8);
            const notes = (b ? [a.g.degrees[0], b.g.degrees[0], c.g.degrees[0]] : [a.g.degrees[0], c.g.degrees[0]]).map((d) => this.midiOf(d));
            this.audio.requestNote({ notes, timbre: c.g.timbre, vel: 0.13 * sp.att, pan: sp.pan });
          }
        }
      }

      // clear out the dead
      for (const s of S) if (s.dying >= 1) s.dead = true;
      if (S.some((s) => s.dead)) this.singers = S.filter((s) => !s.dead);
    }

    _fuse(a, b) {
      const degs = [...new Set(a.g.degrees.concat(b.g.degrees))].sort((x, y) => x - y).slice(0, 3);
      a.g = Object.assign({}, a.g, { degrees: degs, lobes: Math.max(a.g.lobes, b.g.lobes) });
      a.energy += b.energy;
      a.thrown = 0;
      a.vx *= 0.3; a.vy *= 0.3;
      a.life += 60;
      this._look(a);
      b.dying = 0.9;
      b.dead = false;
      this.stats.fusions++;
      const sp = this._audioSpatial(a.x, a.y);
      const allow = C.flash.request(0.4);
      this.addRing(a.x, a.y, a.size * 0.5, a.size * 4, 1.4, a.col, 0.06, allow);
      this.addShock(a.x, a.y, 1.6 * this.shockMul, 4, 0.5, 1.6, 0.5);
      this.audio.play({ notes: degs.map((d) => this.midiOf(d)), timbre: a.g.timbre, vel: 0.24, pan: sp.pan, dur: 3 });
      this._found('fusion', degs.length === 3 ? 'a triad — three voices, one body' : 'two voices became a chord');
    }

    _updateStars(dt) {
      const S = this.stars;
      for (const st of S) {
        st.age += dt;
        st.born = Math.min(1, st.born + dt * 2);
        st.flare *= Math.exp(-dt * 5);
        st.spin += dt * 0.15;
        st.axis += dt * 0.05;
        if (st.age > st.life) st.mass *= Math.exp(-dt * 0.18);
        if (st.grabbed) continue;
        for (const o of S) {
          if (o === st) continue;
          const dx = wrap(o.x - st.x), dy = wrap(o.y - st.y), r2 = dx * dx + dy * dy + 0.4, r = Math.sqrt(r2);
          const f = (o.mass * 1.6) / r2;
          st.vx += (dx / r) * f * dt;
          st.vy += (dy / r) * f * dt;
        }
        st.vx *= Math.exp(-dt * 0.08);
        st.vy *= Math.exp(-dt * 0.08);
        st.x = wrap(st.x + st.vx * dt);
        st.y = wrap(st.y + st.vy * dt);
      }
      // collisions: two stars become a supernova and a world is born in the wreckage
      for (let i = 0; i < S.length; i++) for (let j = i + 1; j < S.length; j++) {
        const a = S[i], b = S[j];
        if (a.dead || b.dead) continue;
        const d = Math.hypot(wrap(a.x - b.x), wrap(a.y - b.y));
        if (d < 0.35 + (a.mass + b.mass) * 0.1) this._supernova(a, b);
      }
      for (const st of S) {
        if (!st.dead && st.mass < 0.3) {
          st.dead = true;
          this.addRing(st.x, st.y, 2, 0.1, 1.5, st.col, 0.04, 0.6);
          this._addNut(st.x, st.y, 0.4, 1.5);
        }
      }
      if (S.some((s) => s.dead)) this.stars = S.filter((s) => !s.dead);
    }

    _supernova(a, b) {
      a.dead = b.dead = true;
      const x = a.x + wrap(b.x - a.x) / 2, y = a.y + wrap(b.y - a.y) / 2;
      const m = a.mass + b.mass;
      this.stats.supernovas++;
      const allow = C.flash.request(1.5);
      this.addShock(x, y, (5 + m * 2) * this.shockMul, 6, 1.0, 2.2 * allow, 1.2);
      this.addShock(x, y, (3 + m) * this.shockMul, 3.5, 0.8, 1.2 * allow, 0.8);
      this.addRing(x, y, 0.2, 9, 2.6, a.col, 0.05, allow);
      this.addRing(x, y, 0.2, 6, 2.0, b.col, 0.07, allow);
      this.addRing(x, y, 0.2, 4, 1.4, [1, 1, 1], 0.04, allow * 0.7);
      this._addNut(x, y, 0.9, 3.5);
      this._startle(x, y, 7, 10);
      const sp = this._audioSpatial(x, y);
      const len = this.scale.length;
      this.audio.burst(1, sp.pan, [a.degree + len, b.degree + len, a.degree + 2 * len + 2, b.degree + 2 * len + 4].map((d) => this.midiOf(d)), 0.4);
      // seeds of life carrying the stars' notes
      for (let k = 0; k < 7; k++) {
        const ang = (k / 7) * TAU;
        const g = { degrees: [(k % 2 ? a.degree : b.degree) + len + Math.floor(Math.random() * 3) * 2], timbre: Math.random(), lobes: 3 + Math.floor(Math.random() * 9), rhythm: [2, 4, 4, 8][k % 4], speed: 1.1, social: 0.6, spike: Math.random() };
        this.spawnSinger(x + Math.cos(ang) * 0.8, y + Math.sin(ang) * 0.8, g, { vx: Math.cos(ang) * 6, vy: Math.sin(ang) * 6, energy: 1.5 });
      }
      this._birthOrb(wrap(x), wrap(y), C.hash(a.id, b.id, this.world.seed), 0.8 + Math.min(0.7, m * 0.12));
      this._found('supernova', 'two stars collided — a new world was born in the wreckage');
    }

    _updateSerpents(dt) {
      for (const sp of this.serpents) {
        sp.age += dt;
        sp.born = Math.min(1, sp.born + dt * 1.2);
        for (let k = 0; k < SERP_N; k++) sp.glow[k] *= Math.exp(-dt * 3);
        if (sp.dying) {
          sp.dying += dt / 1.5;
          continue;
        }
        if (sp.age > sp.life) {
          sp.dying = 0.01;
          // dissolve into seeds carrying the melody
          for (let k = 0; k < 4; k++) {
            const idx = Math.floor((k / 4) * SERP_N);
            const g = { degrees: [sp.melody[k * 2]], timbre: sp.timbre, lobes: 4 + k, rhythm: 4, speed: 1, social: 0.7, spike: 0.5 };
            this.spawnSinger(sp.pts[idx * 2], sp.pts[idx * 2 + 1], g, { energy: 1.3 });
          }
          continue;
        }
        const P = sp.pts;
        sp.heading += (Math.sin(this.time * 0.9 + sp.id) * 0.9 + Math.sin(this.time * 0.37 + sp.id * 3) * 0.6) * dt;
        for (const st of this.stars) {
          const dx = wrap(st.x - P[0]), dy = wrap(st.y - P[1]), d = Math.hypot(dx, dy);
          if (d < 2.5) {
            const away = Math.atan2(-dy, -dx);
            let dh = away - sp.heading;
            dh -= Math.round(dh / TAU) * TAU;
            sp.heading += dh * dt * 2;
          }
        }
        const v = sp.speed * (0.8 + 0.3 * Math.sin(this.time * 2 + sp.id));
        P[0] = wrap(P[0] + Math.cos(sp.heading) * v * dt);
        P[1] = wrap(P[1] + Math.sin(sp.heading) * v * dt);
        for (let k = 1; k < SERP_N; k++) {
          const dx = wrap(P[k * 2] - P[k * 2 - 2]), dy = wrap(P[k * 2 + 1] - P[k * 2 - 1]);
          const d = Math.hypot(dx, dy);
          if (d > sp.seg) {
            P[k * 2] = wrap(P[k * 2 - 2] + (dx / d) * sp.seg);
            P[k * 2 + 1] = wrap(P[k * 2 - 1] + (dy / d) * sp.seg);
          }
        }
      }
      this.serpents = this.serpents.filter((s) => !(s.dying >= 1));
    }

    _updateOrbs(dt, realDt) {
      const cur = this.cursor, cam = this.cam;
      for (const o of this.orbs) {
        o.hover += ((o.hoverT || 0) - o.hover) * C.damp(8, realDt);
        if (o.dying) o.born -= realDt * 0.7;
        else o.born = Math.min(1, o.born + realDt * 0.5);
        if (!o.grabbed) {
          o.vx += Math.sin(this.time * 0.05 + o.seedF) * 0.02 * dt;
          o.vy += Math.cos(this.time * 0.04 + o.seedF * 2) * 0.02 * dt;
          for (const p of this.orbs) {
            if (p === o) continue;
            const dx = wrap(o.x - p.x), dy = wrap(o.y - p.y), d = Math.hypot(dx, dy) + 1e-3;
            if (d < o.r + p.r + 1.5) { o.vx += (dx / d) * dt * 1.2; o.vy += (dy / d) * dt * 1.2; }
          }
          o.vx *= Math.exp(-dt * 0.6);
          o.vy *= Math.exp(-dt * 0.6);
          o.x = wrap(o.x + o.vx * dt);
          o.y = wrap(o.y + o.vy * dt);
        }
        // every orb hums the chord of the world inside it
        if (this.audio.started && !o.voice && o.born > 0) {
          o.voice = this.audio.sustain('hum');
        }
        if (o.voice) {
          const sp = this._audioSpatial(o.x, o.y);
          let prox = 0;
          if (cur.active) {
            const d = Math.hypot(wrap(cur.x - o.x), wrap(cur.y - o.y));
            prox = Math.exp(-(d * d) / (o.r * o.r * 9));
          }
          const g = (0.012 * sp.att + 0.07 * prox * this.gain + 0.05 * o.hover * this.gain) * Math.max(0, o.born) * (this.music.active ? 0.5 : 1) * (1 - this.intro);
          o.voice.set(o.chord.map((m) => C.midiToFreq(m)), g, sp.pan, 0, 500 + 1500 * prox);
        }
      }
      const gone = this.orbs.filter((o) => o.born <= 0 && o.dying);
      for (const o of gone) if (o.voice) o.voice.stop(0.3);
      if (gone.length) this.orbs = this.orbs.filter((o) => !gone.includes(o));
    }

    // ------------------------------------------------------------------ packing for the GPU
    pack(frame, settings) {
      const cam = this.cam, sim = this.sim, music = this.music, mActive = music.active;
      const hw = (cam.viewH * cam.aspect) / 2 + 2, hh = cam.viewH / 2 + 2;
      const inView = (x, y, m) => Math.abs(wrap(x - cam.x)) < hw + (m || 0) && Math.abs(wrap(y - cam.y)) < hh + (m || 0);

      // particle law & forces
      const L = this.law;
      sim.law[0] = L.curl; sim.law[1] = L.central; sim.law[2] = L.cym; sim.law[3] = L.sign * (this.flipT > 0 ? -1 : 1);
      sim.law2[0] = L.drag; sim.law2[1] = L.k; sim.law2[2] = L.flow; sim.law2[3] = 0;
      sim.flowT = this.flowT;
      let nw = 0;
      const addWell = (x, y, str, swirl, soft, jet, axis, core) => {
        if (nw >= 16) return;
        sim.wells.set([x, y, str, swirl], nw * 4);
        sim.wellsB.set([soft, jet, axis, core], nw * 4);
        nw++;
      };
      if (this.charge) {
        const k = Math.min(1, this.charge.t / 2.6);
        addWell(this.charge.x, this.charge.y, 0.5 + 7 * Math.pow(k, 1.3), 0.9, 0.35, 0, 0, 0);
      }
      for (const st of this.stars) addWell(st.x, st.y, 1.6 * st.mass * st.born, 0.7, 0.4, 7 + st.mass * 2, st.axis, 0.16);
      for (const o of this.orbs) addWell(o.x, o.y, 0.6 * o.r * Math.max(0, o.born), 1.2, o.r * 0.9, 0, 0, 0);
      if (this.G && this.G.wells) this.G.wells(addWell);
      if (this.V && this.V.wells) this.V.wells(addWell);
      sim.nWells = nw;
      let ns = 0;
      for (const s of this.shocks) {
        if (ns >= 24) break;
        sim.shocks.set([s.x, s.y, s.r, s.amp], ns * 4);
        sim.shocksB.set([s.w, s.heat, s.z, 0], ns * 4);
        ns++;
      }
      sim.nShocks = ns;
      let nst = 0;
      for (const s of this.stirs) {
        sim.stirs.set([s.x, s.y, s.vx, s.vy], nst * 4);
        nst++;
      }
      sim.nStirs = nst;
      sim.stirR = C.clamp(cam.viewH * 0.06, 0.4, 2.0);
      sim.cursor.set([this.cursor.x, this.cursor.y, this.cursor.active ? 0.9 : 0, C.clamp(cam.viewH * 0.06, 0.4, 1.6)]);
      const b = music.bands;
      sim.audio.set(mActive ? [b.bass * 0.9, b.mid, b.high, music.level] : [0, 0, 0, 0]);
      sim.intro.set([this.intro, this.bangFrame ? 1 : 0, this.introCenter[0], this.introCenter[1]]);
      this.bangFrame = false;
      sim.mode = this.G ? this.G.simMode : 0;
      if (this.G && this.G.modes) this.G.modes(sim.modes);
      else if (this.V && this.V.modes) {
        // visiting bowls make every medium a little bit of a Chladni plate
        this.V.modes(sim.modes);
        if (sim.mode === 0 || sim.mode === 2 || sim.mode === 3) sim.law[2] = Math.max(L.cym, 0.7);
      } else {
        const loud = Math.min(1.6, this.audio.level * 0.9 + (mActive ? music.level * 1.3 : 0));
        const amp = Math.sqrt(0.12 + loud), mx = C.smooth(0, 1, this.chl.mix);
        sim.modes.fill(0);
        sim.modes.set([this.chl.a[0], this.chl.a[1], amp * (1 - mx), 0, this.chl.b[0], this.chl.b[1], amp * mx, 0]);
      }
      sim.cymSense = sim.mode === 1 && this.V && this.V.modes ? 2.5 : 0;
      if (this.G && this.G.simParams) this.G.simParams(sim);
      sim.respawn = this.intro > 0.2 || this.G ? 0 : 0.004;

      // singers
      let n = 0;
      const SB = this.singerBuf;
      for (const s of this.singers) {
        if (!inView(s.x, s.y, s.size * 3)) continue;
        const a = s.born * (s.dying ? Math.max(0, 1 - s.dying) : 1);
        const v = Math.hypot(s.vx, s.vy);
        const o = n * 16;
        SB[o] = s.x; SB[o + 1] = s.y; SB[o + 2] = s.size * (1 + 0.5 * (s.dying || 0)); SB[o + 3] = s.heading;
        SB[o + 4] = s.col[0]; SB[o + 5] = s.col[1]; SB[o + 6] = s.col[2]; SB[o + 7] = a;
        SB[o + 8] = s.g.lobes; SB[o + 9] = s.pulse; SB[o + 10] = s.g.spike; SB[o + 11] = (s.id % 100) / 10;
        SB[o + 12] = s.glow; SB[o + 13] = s.hover; SB[o + 14] = s.g.degrees.length; SB[o + 15] = Math.min(0.35, v * 0.04);
        n++;
      }
      frame.singers = SB;
      frame.singerCount = n;

      // ribbons: singer tails + serpents + the stroke you're drawing
      const RB = this.ribbonBuf;
      let rv = 0;
      const push = (x, y, z, side, c, a) => {
        if (rv >= MAX_RIBBON_VERTS) return;
        const o = rv * 8;
        RB[o] = x; RB[o + 1] = y; RB[o + 2] = z; RB[o + 3] = side;
        RB[o + 4] = c[0]; RB[o + 5] = c[1]; RB[o + 6] = c[2]; RB[o + 7] = a;
        rv++;
      };
      const strip = (pts, count, widthFn, colFn, alphaFn) => {
        // pts: camera-relative continuous coordinates
        for (let i = 0; i < count - 1; i++) {
          const x0 = pts[i * 2], y0 = pts[i * 2 + 1], x1 = pts[i * 2 + 2], y1 = pts[i * 2 + 3];
          let dx = x1 - x0, dy = y1 - y0;
          const d = Math.hypot(dx, dy) || 1e-4;
          const nx = -dy / d, ny = dx / d;
          const w0 = widthFn(i), w1 = widthFn(i + 1);
          const c0 = colFn(i), c1 = colFn(i + 1), a0 = alphaFn(i), a1 = alphaFn(i + 1);
          push(x0 + nx * w0, y0 + ny * w0, 0, 1, c0, a0);
          push(x0 - nx * w0, y0 - ny * w0, 0, -1, c0, a0);
          push(x1 + nx * w1, y1 + ny * w1, 0, 1, c1, a1);
          push(x0 - nx * w0, y0 - ny * w0, 0, -1, c0, a0);
          push(x1 - nx * w1, y1 - ny * w1, 0, -1, c1, a1);
          push(x1 + nx * w1, y1 + ny * w1, 0, 1, c1, a1);
        }
      };
      const tmp = new Float32Array(Math.max(TR, SERP_N, 2) * 2);
      const toRel = (src, count, stride) => {
        let px = wrap(src[0] - cam.x), py = wrap(src[1] - cam.y);
        tmp[0] = px; tmp[1] = py;
        for (let i = 1; i < count; i++) {
          px += wrap(src[i * stride] - src[(i - 1) * stride]);
          py += wrap(src[i * stride + 1] - src[(i - 1) * stride + 1]);
          tmp[i * 2] = px; tmp[i * 2 + 1] = py;
        }
        return tmp;
      };
      for (const s of this.singers) {
        if (!inView(s.x, s.y, 3)) continue;
        const a = s.born * (s.dying ? Math.max(0, 1 - s.dying) : 1);
        // head of the tail sits under the bell
        const src = s.trail;
        src[0] = s.x; src[1] = s.y;
        const rel = toRel(src, TR, 2);
        const glow = 0.5 + s.glow * 0.6 + s.pulse * 0.6;
        strip(rel, TR, (i) => s.size * 0.32 * (1 - i / TR), () => s.col, (i) => a * glow * 0.55 * Math.pow(1 - i / TR, 1.6));
      }
      for (const sp of this.serpents) {
        const a = Math.min(1, sp.born) * (sp.dying ? Math.max(0, 1 - sp.dying) : 1);
        const rel = toRel(sp.pts, SERP_N, 2);
        const cols = sp.melody.map((d) => C.hsl(C.pcHue(this.pcOf(d)), 0.85, 0.6));
        strip(rel, SERP_N,
          (i) => 0.11 * sp.thick * (0.35 + 0.65 * Math.sin(Math.PI * Math.min(1, (i + 2) / SERP_N))) * (1 + sp.glow[i] * 0.8),
          (i) => cols[Math.min(7, Math.floor((i / SERP_N) * 8))],
          (i) => a * (0.55 + sp.glow[i] * 1.6));
      }
      if (this.stroke && this.stroke.pts.length >= 4) {
        const st = this.stroke, cnt = Math.min(st.pts.length / 2, 400);
        const start = st.pts.length / 2 - cnt;
        const arr = new Float32Array(cnt * 2);
        // camera-relative: offset the unwrapped stroke by the wrapped position of its first point
        const ox = wrap(st.pts[start * 2] - cam.x) - st.pts[start * 2];
        const oy = wrap(st.pts[start * 2 + 1] - cam.y) - st.pts[start * 2 + 1];
        for (let i = 0; i < cnt; i++) {
          arr[i * 2] = st.pts[(start + i) * 2] + ox;
          arr[i * 2 + 1] = st.pts[(start + i) * 2 + 1] + oy;
        }
        const col = C.hsl(C.pcHue(this.pcOf(st.curDeg || 0)), 0.8, 0.65);
        strip(arr, cnt, () => 0.06, () => col, (i) => 0.4 + 0.6 * (i / cnt));
      }
      if (this.G && this.G.ribbons) this.G.ribbons(strip, toRel, cam);
      if (this.V && this.V.ribbons) this.V.ribbons(strip, toRel, cam);
      for (const m of this.meteors) {
        if (m.age < 0) continue;
        const hx = wrap(m.x - cam.x), hy = wrap(m.y - cam.y), k = 1 - m.age / m.life;
        strip(new Float32Array([hx, hy, hx - m.vx * 0.12, hy - m.vy * 0.12]), 2, (i) => (i ? 0.01 : 0.06), () => this.palette.accent, (i) => (i ? 0 : 1.2 * k));
      }
      frame.ribbons = RB;
      frame.ribbonCount = rv;

      // sprites
      const SP = this.spriteBuf;
      let k = 0;
      const spr = (x, y, z, r, c, a, type, p1, p2, p3) => {
        if (k >= MAX_SPRITES) return;
        const o = k * 12;
        SP[o] = x; SP[o + 1] = y; SP[o + 2] = z; SP[o + 3] = r;
        SP[o + 4] = c[0]; SP[o + 5] = c[1]; SP[o + 6] = c[2]; SP[o + 7] = a;
        SP[o + 8] = type; SP[o + 9] = p1; SP[o + 10] = p2 || 0; SP[o + 11] = p3 || 0;
        k++;
      };
      for (const r of this.rings) {
        if (!inView(r.x, r.y, r.r1)) continue;
        const t = r.t / r.dur;
        const e = 1 - Math.pow(1 - t, 2.2);
        const rad = C.lerp(r.r0, r.r1, e);
        spr(r.x, r.y, 0, rad / 0.8, r.col, r.alpha * Math.pow(1 - t, 1.5) * 1.4, 0, r.thick / Math.max(0.3, rad) * 0.8);
      }
      for (const st of this.stars) {
        if (!inView(st.x, st.y, 3)) continue;
        const sz = 0.5 + st.mass * 0.35;
        spr(st.x, st.y, 0, sz * 2.2, st.col, 0.1 * st.born * (1 + st.flare), 1, 5);
        spr(st.x, st.y, 0, sz * (1 + st.flare * 0.15), st.col, st.born * (1.4 + st.flare * 1.4), 2, st.mass, st.spin, 0);
      }
      if (this.charge) {
        const c = this.charge, kk = Math.min(1, c.t / 2.6);
        const pal = this.palette;
        spr(c.x, c.y, 0, 0.6 + kk * 1.6, pal.hot, 0.25 + kk * 0.5, 1, 4);
        spr(c.x, c.y, 0, 0.3 + kk * 0.9, c.ignited ? pal.hot : pal.accent, 0.6 + kk * 1.2, 2, kk * 1.5, this.time * 2, 0);
        const rr = (0.8 + 2.5 * (1 - ((c.t * 1.6) % 1)));
        spr(c.x, c.y, 0, rr / 0.8, pal.accent, 0.35 * ((c.t * 1.6) % 1), 0, 0.05);
      }
      for (const o of this.orbs) {
        if (o.hover > 0.02 && inView(o.x, o.y, 2)) spr(o.x, o.y, 0, (o.r * 1.25) / 0.8, o.c2, o.hover * 0.6, 0, 0.012);
        if (o.rift > 0.02 && inView(o.x, o.y, 4)) spr(o.x, o.y, 0, (o.r * 3.2) / 0.8, o.c3, o.rift * (0.35 + 0.15 * Math.sin(this.time * 5)), 0, 0.012);
      }
      if (this.cursor.active && settings.wisp) {
        spr(this.cursor.x, this.cursor.y, 0.05, C.clamp(cam.viewH * 0.035, 0.25, 0.8), this.palette.accent, 0.55, 3, 0);
      }
      if (this.G && this.G.sprites) this.G.sprites(spr, inView);
      if (this.V && this.V.sprites) this.V.sprites(spr, inView);
      for (const m of this.meteors) if (m.age >= 0) spr(wrap(m.x), wrap(m.y), 0.05, 0.25, [1, 1, 1], 1.4 * (1 - m.age / m.life), 1, 14);
      frame.sprites = SP;
      frame.spriteCount = k;

      // orbs
      frame.orbs = this.orbs.filter((o) => inView(o.x, o.y, o.r * 2)).map((o) => ({
        x: o.x, y: o.y, r: o.r * (1 + 0.4 * (o.rift || 0)), c1: o.c1, c2: o.c2, c3: o.c3, seedF: o.seedF, hover: Math.max(o.hover, o.rift || 0), born: Math.max(0, Math.min(1, o.born)), genus: o.pv.genus,
      }));
      frame.palette = this.palette;
      frame.sim = sim;
      frame.field = this.G && this.G.field ? this.G.field() : null;
      frame.dustLayer = this.G ? this.G.dustLayer : 1;
      frame.trailMul = this.G && this.G.trailMul ? this.G.trailMul : 1;
    }

    // world census for the HUD: how many creatures sing each pitch class
    census() {
      const c = new Array(12).fill(0);
      for (const s of this.singers) if (!s.dying) for (const pc of s.pcs) c[pc]++;
      return c;
    }
  }

  C.Universe = Universe;
  C.SERP_N = SERP_N;
})();
