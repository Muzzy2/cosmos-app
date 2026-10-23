'use strict';
// The score: an endless composer under the living world. Each world composes by its own grammar, read
// from its musical culture (style.js): the meter it counts in and whether its layers cycle against each
// other, how strict its pulse is, which chords it builds and how it moves between them, the shape of its
// form (sections that build and break down, a refrain and its episodes, long swells, patterns that grow
// and phase, music that barely moves, a line and its answers), and which textures it uses: a second line
// in counterpoint, a canon, a drone, a cloud of grains, interlocking hockets, suspensions that resolve.
// The culture is carried by the creatures, so as they evolve, migrate and mix, the grammar changes.
// What stays from COSMOS 3 and 4: real progressions with smooth voice leading, motifs stated and
// developed (most of them the song the biggest species actually sings), chords leaning toward the pitches
// the population sings, Euclidean rhythms, each world's band and energy range, breaths of silence.
(function () {
  const C = window.COSMOS;

  // ------------------------------------------------------------------ harmony
  // chord-to-chord tendencies for seven-note scales (scale degrees 0-6): one of several grammars
  const NEXT7 = {
    0: { 3: 3, 4: 2, 5: 3, 1: 1.2, 2: 0.8 },
    1: { 4: 4, 3: 1, 6: 0.6, 5: 0.6 },
    2: { 5: 3, 3: 2, 1: 1 },
    3: { 4: 3, 0: 2.5, 1: 2, 5: 1 },
    4: { 0: 4, 5: 2.2, 3: 1 },
    5: { 3: 3, 1: 2.5, 4: 1.5, 2: 0.6 },
    6: { 0: 3, 2: 1, 5: 1 },
  };
  const md = (x, n) => ((x % n) + n) % n;
  // grammars of movement: functional, falling fifths (chains of ii-V-I), planing by step, a pendulum
  // around home, chains of thirds, and modal stasis that hovers and leans
  const GRAMMARS = {
    functional: (f, n) => { if (n === 7) return NEXT7[f]; const t = {}; for (let d = 0; d < n; d++) if (d !== f) t[d] = d === 0 ? 2.2 : 1; return t; },
    fifths: (f, n) => ({ [md(f + (n === 7 ? 3 : 2), n)]: 5, [md(f + (n === 7 ? 4 : 3), n)]: 1, 0: f === 0 ? 0 : 0.5 }),
    steps: (f, n) => ({ [md(f + 1, n)]: 2.5, [md(f - 1, n)]: 2.5, 0: f === 0 ? 0 : 0.6 }),
    pendulum: (f, n) => { if (f !== 0) return { 0: 5 }; const t = {}; for (let d = 1; d < n; d++) t[d] = 1; return t; },
    thirds: (f, n) => ({ [md(f + 2, n)]: 2.5, [md(f - 2, n)]: 2.5, 0: f === 0 ? 0 : 0.8 }),
    stasis: (f, n) => ({ [f]: 4, [md(f + 1, n)]: 0.6, [md(f - 1, n)]: 0.6, 0: f === 0 ? 4 : 1 }),
  };
  function weighted(r, table) {
    let tot = 0;
    for (const k in table) tot += table[k];
    let x = r() * tot;
    for (const k in table) { x -= table[k]; if (x <= 0) return isNaN(+k) ? k : +k; }
    const k0 = Object.keys(table)[0];
    return isNaN(+k0) ? k0 : +k0;
  }
  // COSMOS 4: while themes evolve, chords lean toward the notes the living creatures actually sing
  let popBias = null;
  function nextDeg(r, from, len, mix) {
    const t = {};
    for (const g in mix) {
      const tab = GRAMMARS[g](from, len);
      let tot = 0;
      for (const k in tab) tot += tab[k];
      if (tot) for (const k in tab) t[k] = (t[k] || 0) + (mix[g] * tab[k]) / tot;
    }
    if (mix.stasis == null) delete t[from];
    if (popBias) for (const k in t) t[k] *= popBias(+k);
    return Object.keys(t).length ? weighted(r, t) : 0;
  }
  // a progression that doesn't see-saw between two chords (unless the grammar is a pendulum)
  function progression(r, len, start, n, mix) {
    const p = [start];
    while (p.length < n) {
      let d = nextDeg(r, p[p.length - 1], len, mix);
      if (p.length >= 2 && d === p[p.length - 2] && !mix.pendulum) d = nextDeg(r, p[p.length - 1], len, mix);
      p.push(d);
    }
    return p;
  }

  // ------------------------------------------------------------------ forms
  // sections: bars, energy from -> to, theme, harmonic rhythm (2 = slower), where it can go next, and a
  // mask of which layers may play (missing = allowed). 'arc' is the COSMOS 3 form, unchanged.
  const FORMS = {
    arc: {
      arrive:    { bars: 8,  e: [0.18, 0.4],  theme: 'A', hr: 2, next: { float: 0.4, build: 0.6 }, mask: { lead: 0 } },
      float:     { bars: 8,  e: [0.26, 0.32], theme: 'B', hr: 2, next: { build: 0.7, groove: 0.3 }, mask: { lead: 0, drums: 0 } },
      build:     { bars: 8,  e: [0.42, 0.72], theme: 'B', hr: 1, next: { peak: 1 }, rise: 1 },
      peak:      { bars: 16, e: [0.82, 0.88], theme: 'A', hr: 1, next: { breakdown: 0.5, groove: 0.5 }, land: 1 },
      groove:    { bars: 16, e: [0.56, 0.62], theme: 'A', hr: 1, next: { build: 0.4, breakdown: 0.3, peak: 0.3 } },
      breakdown: { bars: 8,  e: [0.22, 0.14], theme: 'B', hr: 2, next: { return: 0.6, build: 0.4 }, mask: { lead: 0, arp: 0 }, breath: 1 },
      return:    { bars: 16, e: [0.6, 0.5],   theme: 'A', hr: 1, next: { float: 0.4, groove: 0.3, build: 0.3 } },
    },
    rondo: {
      refrain:   { bars: 8,  e: [0.5, 0.56],  theme: 'A', hr: 1, next: { episode: 0.5, interlude: 0.5 } },
      episode:   { bars: 8,  e: [0.36, 0.46], theme: 'B', hr: 1, next: { refrain: 1 }, mask: { drums: 0, arp: 0.5 }, counter: 1 },
      interlude: { bars: 8,  e: [0.2, 0.3],   theme: 'C', hr: 2, next: { refrain: 0.8, hush: 0.2 }, mask: { drums: 0, arp: 0 }, counter: 1 },
      hush:      { bars: 4,  e: [0.12, 0.1],  theme: 'C', hr: 2, next: { refrain: 1 }, mask: { drums: 0, arp: 0, lead: 0 }, breath: 1 },
    },
    waves: {
      rise:  { bars: 16, e: [0.15, 0.68], theme: 'A', hr: 2, next: { crest: 1 }, rise: 1, mask: { drums: 0.25, arp: 0.6 } },
      crest: { bars: 8,  e: [0.72, 0.78], theme: 'A', hr: 1, next: { ebb: 1 }, land: 1 },
      ebb:   { bars: 16, e: [0.62, 0.16], theme: 'B', hr: 2, next: { still: 0.6, rise: 0.4 }, breath: 1, mask: { drums: 0 } },
      still: { bars: 8,  e: [0.08, 0.12], theme: 'B', hr: 2, next: { rise: 1 }, mask: { drums: 0, arp: 0, lead: 0 }, texture: 1 },
    },
    process: {
      seed:  { bars: 8,  e: [0.32, 0.4],  theme: 'A', hr: 2, next: { grow: 1 }, mask: { lead: 0, drums: 0 }, grow: 1 },
      grow:  { bars: 16, e: [0.42, 0.62], theme: 'A', hr: 2, next: { phase: 1 }, grow: 1, mask: { drums: 0.3 } },
      phase: { bars: 24, e: [0.6, 0.66],  theme: 'A', hr: 2, next: { thin: 1 }, phase: 1 },
      thin:  { bars: 16, e: [0.58, 0.3],  theme: 'B', hr: 2, next: { seed: 0.5, grow: 0.5 }, thin: 1, mask: { drums: 0 } },
    },
    drift: {
      glow:  { bars: 24, e: [0.22, 0.3],  theme: 'A', hr: 2, next: { glow2: 0.6, hush: 0.4 }, mask: { drums: 0 }, texture: 1 },
      glow2: { bars: 24, e: [0.28, 0.36], theme: 'B', hr: 2, next: { glow: 0.6, hush: 0.4 }, mask: { drums: 0 }, texture: 1 },
      hush:  { bars: 12, e: [0.1, 0.08],  theme: 'B', hr: 2, next: { glow: 1 }, mask: { drums: 0, arp: 0, lead: 0 }, texture: 1, breath: 1 },
    },
    call: {
      call:   { bars: 8,  e: [0.36, 0.46], theme: 'A', hr: 1, next: { answer: 1 }, mask: { drums: 0, arp: 0.5 } },
      answer: { bars: 8,  e: [0.36, 0.46], theme: 'B', hr: 1, next: { call: 0.4, tutti: 0.6 }, mask: { drums: 0, arp: 0.5 }, counter: 1, answer: 1 },
      tutti:  { bars: 16, e: [0.55, 0.7],  theme: 'A', hr: 1, next: { call: 0.6, hush: 0.4 }, counter: 1, land: 1, mask: { drums: 0.6 } },
      hush:   { bars: 8,  e: [0.16, 0.1],  theme: 'B', hr: 2, next: { call: 1 }, mask: { drums: 0, arp: 0, lead: 0 }, breath: 1 },
    },
  };
  // arriving quietly in any world: a few bars of its ground (pads, drone, grains, a few glints) before
  // its form begins (the audit: the old composer's breathing openings were part of why calm worlds worked)
  const INTRO = { bars: 4, e: [0.16, 0.3], theme: 'A', hr: 2, mask: { drums: 0, arp: 0.4, lead: 0 }, texture: 1 };
  const FIRST = { arc: ['arrive', 'float', 'groove'], rondo: ['refrain', 'refrain', 'refrain'], waves: ['rise', 'rise', 'crest'], process: ['seed', 'grow', 'phase'], drift: ['glow', 'glow', 'glow2'], call: ['call', 'call', 'tutti'] };

  // ------------------------------------------------------------------ rhythm
  // COSMOS 3's grooves (4/4 only): kept for the worlds whose culture still counts in four
  const GROOVES = {
    tide:  [{ shaker: '......x.......x.' }, { shaker: '..x...x...x...x.', drip: '.......x........' }],
    soft:  [{ kick: 'x...............', shaker: '..x...x...x...x.' }, { kick: 'x.....x...x.....', shaker: 'x.xxx.xxx.xxx.xx', rim: '....x.......x...' }],
    wood:  [{ rim: 'x..x..x...x..x..' }, { kick: 'x.......x.......', rim: 'x..x..x...x..x..', shaker: '..x...x...x...x.' }],
    clock: [{ rim: 'x...x...x...x...' }, { rim: 'x...x...x...x...', hat: '..x...x...x...x.', kick: 'x.......x.......' }],
    heart: [{ kick: 'x..x............' }, { kick: 'x..x....x..x....', shaker: '....x.......x...' }],
    drip:  [{ drip: '..x.....x..x....' }, { drip: '..x..x..x..x.x..', rim: 'x.......x.......' }],
    deep:  [{ boom: 'x...............' }, { boom: 'x...............', kick: '........x.......', hat: '..x...x...x...x.' }],
    drive: [{ kick: 'x...x...x...x...', hat: '..x...x...x...x.' }, { kick: 'x...x...x...x...', hat: '..x...x...x...x.', clap: '....x.......x...', shaker: 'xxxxxxxxxxxxxxxx' }],
    chip:  [{ chip: 'x...x...x..x.x..' }, { chip: 'x...x...x..x.x..', kick: 'x...x...x...x...', hat: '..x...x...x...x.' }],
    toms:  [{ tom: 'x.......x.....x.', thunder: '.....x..........' }, { tom: 'x..x..x...x.x.x.', kick: 'x.......x.......', hat: '....x.......x...', thunder: '..x.............' }],
  };
  // each groove's kit, for patterns generated in any meter: a low, a middle and a high voice
  const KITS = {
    tide: ['drip', 'drip', 'shaker'], soft: ['kick', 'rim', 'shaker'], wood: ['kick', 'rim', 'shaker'], clock: ['kick', 'rim', 'hat'],
    heart: ['kick', 'kick', 'shaker'], drip: ['rim', 'drip', 'drip'], deep: ['boom', 'kick', 'hat'], drive: ['kick', 'clap', 'hat'],
    chip: ['kick', 'chip', 'hat'], toms: ['tom', 'thunder', 'hat'],
  };
  const DRUM_VEL = { thunder: 0.32, kick: 0.2, shaker: 0.2, rim: 0.14, hat: 0.22, clap: 0.16, boom: 0.18, tom: 0.2, chip: 0.07, drip: 0.1 };
  const SWUNG = { soft: 1, wood: 1, heart: 1, drip: 1, tide: 1 };
  const NOT_PITCHED = ['kick', 'hat', 'shaker', 'rim', 'clap', 'riser', 'boom', 'thunder'];

  const intoOctave = (m, floor) => { while (m < floor) m += 12; while (m >= floor + 12) m -= 12; return m; };
  // a Euclidean rhythm (Toussaint): k hits spread as evenly as possible over n steps
  const euclid = (k, n, rot) => Array.from({ length: n }, (_, i) => ((i + (rot || 0)) * k) % n < k);
  const pat = (hits, n) => { const p = new Array(n).fill(false); for (const h of hits) if (h >= 0 && h < n) p[h] = true; return p; };

  class Composer {
    constructor(audio) {
      this.a = audio;
      this.uni = null;
      this.seed = 0;
      this.chordPcs = null;
      this.chord = null;
      this.voicing = null;
      this.sectionName = 'arrive';
      this.sec = FORMS.arc.arrive;
      this.barInSec = 0;
      this.secCount = 0;
      this.energy = 0;
      this.log = []; // recent events, for tests: {t, layer, inst, midi, sec}
      this.keepLog = false;
      this.gainNow = -1;
      this.lite = !!C.MOBILE; // phones: no sixteenth-note arpeggios, lighter percussion, fewer layers
      this.echo = [];
      this.onShift = null; // set by main: the world's music changed character (a discovery)
    }

    // Follow the world you are in. A new world gets its own grammar, themes, band and groove.
    setWorld(uni) {
      if (uni === this.uni) return;
      this.uni = uni;
      const w = uni.world || {};
      this.fam = C.familyOf(uni.genus);
      this.r = C.rng(((w.seed || 1) ^ 0x5c0e) >>> 0);
      this.st = C.musicStyle(uni);
      this._plan(true);
      this._themes();
      this.echo = [];
      this.voicing = null;
      this.center = 0;
      // arrive at the energy you came in with, so a glide never falls into a hole
      const prev = this.energy, first = FIRST[this.form];
      const quiet = (this.fam.maxE || 1) <= 0.75 && (this.fam.minE || 0) < 0.3;
      this._enter(prev > 0.55 ? first[2] : prev > 0.38 ? first[1] : quiet ? 'intro' : first[0]);
      this.stepInBar = this.meter.n; // the first bar starts on the next sixteenth
      this.stepAbs = 0;
      this.a.defaultFam = uni.genus;
      this._setSpace();
    }

    // ------------------------------------------------------------------ the grammar, from the culture
    _plan(fresh) {
      const st = this.st, f = this.fam, r = this.r;
      const prevMeter = this.meter && this.meter.name, prevSecond = this.second ? this.second.name : '';
      this.free = st.pulse < 0.22;
      this.meter = st.meterObj;
      this.second = st.second;
      if (fresh || !this.form) this.form = weighted(r, st.formW);
      const n = this.meter.n;
      this.accents = new Set();
      let a = 0;
      for (const g of this.meter.g) { this.accents.add(a); a += g; }
      this.swing = (SWUNG[f.groove] ? 0.1 : 0) + st.swing * 0.14;
      // harmony: how chords are stacked
      const ext = f.ext;
      this.tertian = false;
      if (st.quartal > 0.7) { this.stack = [0, 3, 6]; this.harmonyName = 'chords in fourths'; }
      else if (st.tension > 0.86 && st.density < 0.4) { this.stack = [0, 1, 4]; this.harmonyName = 'clusters'; }
      else if (st.color > 0.72) { this.stack = st.color > 0.86 ? [0, 2, 4, 6, 8, 10] : [0, 2, 4, 6, 8]; this.harmonyName = 'jazz-like extended chords'; }
      else if (st.color > 0.55 || ext === 'seventh') { this.stack = [0, 2, 4, 6]; this.harmonyName = 'seventh chords'; }
      else if (st.color < 0.18) { this.stack = [0, 4, 7]; this.harmonyName = 'open fifths'; }
      else { this.stack = ext === 'add9' ? [0, 2, 4, 8] : [0, 2, 4]; this.harmonyName = ext === 'add9' ? 'added ninths' : 'triads'; }
      if (this.stack[1] === 2 && this.stack[2] === 4) this.tertian = true;
      // scales of five or six notes: the same shapes, scaled to their steps
      const len = this.uni.scale.length;
      if (len !== 7) this.stack = [...new Set(this.stack.map((o) => Math.round((o * len) / 7)))];
      // how chords move: a blend of grammars
      const mix = { functional: 1.2 - st.quartal * 0.6 };
      mix.fifths = st.color * 1.4 * (st.color > 0.6 ? 1.5 : 0.4);
      mix.steps = st.quartal * 1.5;
      mix.thirds = st.tension * 0.8;
      mix.pendulum = this.form === 'process' || this.form === 'drift' ? 0.9 : 0.2;
      mix.stasis = st.drone > 0.6 || this.form === 'drift' ? 1.2 : 0.1;
      this.mix = mix;
      // rhythm cells: the arpeggio or ostinato may cycle in its own length against the bar (polymeter)
      const polyLens = [3, 5, 6, 7, 9, 10, 11, 12, 13].filter((L) => L !== n && L !== n / 2);
      this.arpLen = st.poly > 0.55 ? polyLens[Math.floor(r() * polyLens.length)] : n;
      // calm worlds leave more room between notes (the audit: busy bells everywhere is not a culture)
      this.calm = (f.maxE || 1) <= 0.75;
      const k = Math.max(2, Math.round(this.arpLen * (0.2 + 0.3 * st.density) * (this.calm ? 0.8 : 1)));
      this.arpCell = euclid(k, this.arpLen, Math.floor(r() * this.arpLen));
      // a second culture's meter becomes an ostinato in its own cycle
      this.secondCell = this.second && this.second.n !== n ? euclid(Math.max(2, Math.round(this.second.n * 0.3)), this.second.n, 0) : null;
      this.arpMode = ['up', 'updown', 'walk', 'pendulum'][Math.floor(r() * 4)];
      this.sevenths = r() < 0.5;
      // the bass: the bar's main beats, then syncopations as the culture grows denser
      const groups = this.meter.g, starts = [...this.accents];
      this.bassCells = [pat([0], n), pat([0, starts[Math.floor(starts.length / 2)] + (st.density > 0.6 ? 2 : 0)], n), pat(starts.map((s, i) => s + (i % 2 && st.density > 0.5 ? 2 : 0)).concat([n - 2]), n)];
      // drums: COSMOS 3's groove where the world still counts in four, else a kit pattern for its meter
      this.kit = f.groove ? KITS[f.groove] : null;
      this.useGroove = !!(f.groove && n === 16 && !this.free && r() < 0.75);
      if (this.kit) {
        const mid = starts[Math.floor(starts.length / 2)];
        const hiK = Math.max(2, Math.round(n * (0.12 + 0.28 * st.density)));
        this.kitCells = [
          { low: pat([0], n), mid: pat([mid], n), high: euclid(Math.ceil(hiK / 2), n, 1) },
          { low: pat([0, ...starts.filter((s, i) => i && i % 2 === 0)].concat(st.density > 0.55 ? [n - 4 + 2 * (n % 4 ? 1 : 0)] : []), n), mid: pat(starts.filter((s, i) => i % 2 === 1).concat(groups.length > 3 ? [] : [mid]), n), high: euclid(hiK, n, 0) },
        ];
      }
      // textures this culture uses
      const tex = [];
      this.counterOn = st.counter > 0.55 && !this.lite || this.form === 'call';
      this.canon = st.canon > 0.62 ? { lag: st.canon > 0.8 ? Math.round(n / 2) : n, by: r() < 0.5 ? -7 : 4 } : null;
      this.droneOn = st.drone > 0.58;
      this.grainOn = st.grain > 0.62 || this.form === 'drift' || this.form === 'waves';
      this.hocket = st.hocket > 0.62;
      this.suspend = st.tension > 0.45;
      if (this.counterOn) tex.push('counterpoint');
      if (this.canon) tex.push('canon');
      if (this.droneOn) tex.push('drone');
      if (this.hocket) tex.push('hocket');
      if (this.grainOn) tex.push('grain clouds');
      if (this.arpLen !== n) tex.push(this.arpLen + ' against ' + n);
      if (this.suspend) tex.push('suspensions');
      this.texture = tex;
      // voices: the world's band, and procedural instruments made from its founding tone
      const tone = st.tone || [0.5, 0.5, 0.5, 0.5];
      const V = C.Voices;
      this.v = { pad: f.pad, bass: f.bass, arp: f.arp, lead: f.lead, counter: f.notes[1], canon: f.notes[0], drone: f.pad, arp2: f.notes[2] };
      if (V) {
        this.v.grain = V.instrument('modal', [0.7 + 0.3 * tone[0], tone[1], 0.8, 0.2], 'glass');
        if (st.synth > 0.62) this.v.counter = V.instrument(tone[2] > 0.5 ? 'modal' : 'voice', [0.3 + 0.4 * tone[0], 0.3 * tone[1], tone[2], 0.4 + 0.4 * tone[3]], f.notes[1]);
        if (st.synth > 0.55) this.v.canon = V.instrument(V.modelOfTone(tone), tone, f.notes[0]);
        if (st.synth > 0.5) this.v.drone = V.instrument('pad', [0.15 + 0.25 * tone[0], 0.4 * tone[1], 0.1, 0.3 * tone[3]], f.pad);
        if (st.synth > 0.78 && f.arp) this.v.arp = V.instrument(tone[1] > 0.5 ? 'modal' : 'string', [0.4 + 0.5 * tone[0], tone[1], 0.75, 0.3], f.arp);
        if (st.synth > 0.86 && f.lead) this.v.lead = V.instrument(tone[2] > 0.5 ? 'fm' : 'voice', tone, f.lead);
        this.v.arp2 = this.hocket ? V.instrument('modal', [0.5 * tone[0] + 0.2, 0.3, 0.6, 0.55], f.notes[2]) : f.notes[2];
        // render what this grammar will actually play, in the registers it plays them, a little at a time
        // before it's needed (a new world first forgets what the last one asked for)
        if (this.a.ctx) {
          if (fresh) V.forget(this.a.ctx);
          const want = { arp: [67, 79, 91], lead: [67, 79], drone: this.droneOn && [43, 50], grain: this.grainOn && [79, 91], counter: this.counterOn && [55, 67, 79], canon: this.canon && !this.lite && [55, 67, 79], arp2: this.hocket && [67, 79] };
          for (const role in want) if (want[role]) V.prepare(this.a.ctx, this.v[role], want[role]);
        }
      }
      this.sig = this._sig(st);
      this.plan = { form: this.form, meter: this.free ? 'free' : this.meter.name, harmonyName: this.harmonyName, texture: tex };
      this.words = C.styleWords(st, this.plan);
      // the music changed character because of who lives here now: tell the observatory (at most every 5 minutes)
      const second = this.second ? this.second.name : '', u = this.uni, now = performance.now();
      if (!fresh && this.onShift && ((prevMeter && prevMeter !== this.meter.name) || (second && second !== prevSecond && second !== this.meter.name)) && now - (u._musicShiftT || -1e9) > 300000) {
        u._musicShiftT = now;
        this.onShift(u, prevMeter, this.meter.name, this.st);
      }
    }
    // the decisions a culture's genes make; when these change, the grammar is re-made
    _sig(st) {
      const b = (x, t) => (x > t ? 1 : 0);
      return [st.meterObj.name, st.second ? st.second.name : '', b(0.22, st.pulse), b(st.quartal, 0.7), Math.floor(st.color * 5), b(st.poly, 0.55), b(st.counter, 0.55), b(st.canon, 0.62), b(st.drone, 0.58), b(st.hocket, 0.62), b(st.grain, 0.62)].join('|');
    }
    // each world's acoustic: how much hall and echo its culture likes
    _setSpace() {
      const a = this.a, sp = this.st.space;
      if (!a.ctx || !a.scoreRev) return;
      const t = a.ctx.currentTime;
      a.scoreRev.gain.setTargetAtTime(0.22 + 0.4 * sp, t, 1.5);
      a.scoreDly.gain.setTargetAtTime(0.04 + 0.14 * sp * (this.free ? 1.3 : 1), t, 1.5);
    }

    _themes() {
      const r = this.r, len = this.uni.scale.length, mix = this.mix;
      this.A = progression(r, len, 0, 4, mix);
      this.B = progression(r, len, len === 7 ? weighted(r, { 3: 2, 5: 2, 1: 1 }) : 1 + Math.floor(r() * (len - 1)), 4, mix);
      this.Cth = progression(r, len, len === 7 ? weighted(r, { 5: 2, 2: 1, 6: 1 }) : Math.floor(len / 2), 4, mix);
      this.motif = this._makeMotif();
    }
    // a short idea: 4-6 notes over two bars, a contour in scale steps that ends near home. COSMOS 4: most
    // of the time the score borrows the song the biggest living species actually sings (observatory.js).
    // Positions are written in sixteenths of two 4/4 bars and placed into the world's own meter.
    _makeMotif() {
      const pop = this.uni && this.uni.songMotif;
      if (pop && (this.r || Math.random)() < 0.75) return this._popMotif(pop, this.uni.songRhythm || 4);
      const r = this.r, n = 4 + Math.floor(r() * 3), notes = [], leap = this.st ? this.st.leap : 0.5;
      const moves = leap > 0.6 ? [-4, -2, -1, 1, 2, 3, 4, 5] : leap < 0.35 ? [-1, -1, -1, 1, 1, 1, 2, -2] : [-2, -1, -1, 1, 1, 2, 3];
      let step = r() < 0.5 ? 0 : 2, deg = 0;
      for (let i = 0; i < n && step < 30; i++) {
        const len = [2, 2, 4, 4, 6, 8][Math.floor(r() * 6)];
        notes.push({ step, deg, len });
        step += len;
        deg += moves[Math.floor(r() * moves.length)];
        deg = C.clamp(deg, -3, 7);
      }
      notes[notes.length - 1].deg = [0, 2, 4][Math.floor(r() * 3)];
      return notes;
    }
    _popMotif(m, rhythm) {
      const len = C.clamp(rhythm, 2, 8), notes = [];
      let deg = 0, step = 0;
      for (let i = 0; i < 4; i++) { notes.push({ step, deg: C.clamp(deg, -3, 7), len }); step += len; deg += m[i]; }
      if (step < 30) notes.push({ step, deg: 0, len: Math.min(8, 32 - step) }); // and home again
      this.popSong = m.join(',');
      return notes;
    }
    // the creatures' song changed (a dialect, or newcomers took hold): the score takes it up at once
    adoptSong(u) {
      if (u !== this.uni || !u.songMotif || u.songMotif.join(',') === this.popSong) return;
      this.motif = this._popMotif(u.songMotif, u.songRhythm || 4);
      this.phrase = this._place(this._develop());
    }
    // develop the motif: the same, inverted, backwards, stretched, or just its opening
    _develop() {
      const m = this.motif, kind = Math.floor(Math.random() * 6);
      if (kind === 1) return m.map((n) => ({ ...n, deg: -n.deg }));
      if (kind === 2) { const last = m[m.length - 1].step; return m.map((n) => ({ ...n, step: last - n.step })).reverse(); }
      if (kind === 3) return m.filter((n) => n.step < 16).map((n) => ({ ...n, step: n.step * 2, len: n.len * 2 }));
      if (kind === 4) { const h = m.filter((n) => n.step < 12); return h.concat(h.map((n) => ({ ...n, step: n.step + 16, deg: n.deg + 1 }))); }
      return m;
    }
    // into this meter: position p of a two-bar 4/4 phrase -> the same place in two bars of n sixteenths
    // (free time stretches the phrase over four bars)
    _place(m) {
      const n = this.meter.n, k = this.free ? 2 : 1;
      return m.map((x) => ({ at: k * (Math.floor(x.step / 16) * n + Math.round(((x.step % 16) * n) / 16)), deg: x.deg, len: x.len * (n / 16) * k }));
    }

    _popBias() {
      const u = this.uni;
      if (!u || !u.census || !u.singers || u.singers.length < 10) return null;
      const c = u.census();
      let tot = 0;
      for (const x of c) tot += x;
      if (!tot) return null;
      return (d) => { const s = (c[u.pcOf(d)] + c[u.pcOf(d + 2)] + c[u.pcOf(d + 4)]) / tot; return 0.6 + 2.4 * s; };
    }
    _enter(name) {
      const sections = FORMS[this.form];
      if (name !== 'intro' && !sections[name]) name = FIRST[this.form][0];
      this.sectionName = name;
      this.sec = name === 'intro' ? Object.assign({ next: { [FIRST[this.form][0]]: 1 } }, INTRO) : sections[name];
      this.barInSec = 0;
      this.secCount++;
      // the culture is re-read at every section: evolution, migration and mixing change the grammar (its
      // decisions are re-made when they change, and every eight sections for variety)
      if (this.secCount > 1 && this.uni) {
        this.st = C.musicStyle(this.uni);
        if (this._sig(this.st) !== this.sig || this.secCount % 8 === 0) this._plan(false);
        this._setSpace();
      }
      // themes evolve: every few sections one chord of each theme changes; now and then a new motif
      const len = this.uni.scale.length;
      popBias = this._popBias();
      if (this.secCount % 5 === 0) this.A[1 + Math.floor(Math.random() * 3)] = nextDeg(Math.random, this.A[0], len, this.mix);
      if (this.secCount % 4 === 0) this.B = progression(Math.random, len, this.B[0], 4, this.mix);
      if (this.secCount % 6 === 0) this.Cth = progression(Math.random, len, this.Cth[0], 4, this.mix);
      popBias = null;
      if (this.secCount % 7 === 0) { this.motif = this._makeMotif(); this.arpMode = ['up', 'updown', 'walk', 'pendulum'][Math.floor(Math.random() * 4)]; }
      // a modal shift: for a while the music centres on another degree of the same scale, then comes home
      if (this.st.modal > 0.6 && len === 7 && this.secCount % 9 === 0) this.center = this.center ? 0 : [5, 3, 1][Math.floor(Math.random() * 3)];
      this.phrase = this._place(this._develop());
      // process music grows from one note and thins away again
      this.growN = this.sec.grow ? 1 : 99;
    }

    // Called with the 16th-note ticks the engine is about to play.
    onTicks(ticks, uni) {
      if (!this.a.ctx) return;
      if (uni && uni !== this.uni) this.setWorld(uni);
      if (!this.uni) return;
      if (C.Voices && !this.a.offline && ticks.length) C.Voices.pump(this.a.ctx, this.lite ? 2 : 4);
      for (const tk of ticks) {
        if (this.stepInBar >= this.meter.n) { this.stepInBar = 0; this._bar(tk); }
        this._step(tk, this.stepInBar);
        this.stepInBar++;
        this.stepAbs++;
      }
    }

    _bar(tk) {
      const a = this.a;
      if (this.barInSec >= this.sec.bars) this._enter(weighted(Math.random, this.sec.next));
      const s2 = this.sec, prog = s2.theme === 'A' ? this.A : s2.theme === 'B' ? this.B : this.Cth;
      const p = this.barInSec / s2.bars;
      // energy: the section's arc, lifted by a busy ecosystem and by you
      const u = this.uni;
      const life = C.clamp(((u.singers && u.singers.length) || 0) / 120, 0, 1) * 0.08;
      const you = C.clamp(a.level / 1.5, 0, 1) * 0.1;
      // each world has a floor and a ceiling: a tunnel never idles, a tide never pounds
      this.energy = C.clamp(C.lerp(s2.e[0], s2.e[1], p) + life + you, this.fam.minE || 0, this.fam.maxE || 1);
      // the score steps aside entirely for your song, and follows the comfort settings
      const want = a.synthOn && a.duck >= 1 ? a.scoreVolume * (this.fam.trim || 1) * (this.levelTrim || 1) : 0;
      if (Math.abs(want - this.gainNow) > 0.001 && a.scoreBus) {
        a.scoreBus.gain.setTargetAtTime(want, tk.time, 1.5);
        this.gainNow = want;
      }
      this.barT = tk.time;
      this.barDur = a.tickDur() * this.meter.n;
      this.bar = (this.bar || 0) + 1;
      // breath: a held silence near the end of a falling section, more often in cultures that like space
      this.breath = !!s2.breath && this.barInSec === s2.bars - 2 && (this.sectionName === 'breakdown' || Math.random() < 0.4 + 0.6 * this.st.silence);
      // process music adds a note to its cell every bar, or thins it
      if (s2.grow) this.growN = Math.min(99, (this.growN || 1) + 1);
      if (s2.thin) this.growN = Math.max(1, Math.round(this.arpCell.filter(Boolean).length * (1 - p)));
      // harmonic rhythm breathes: chords last one to four bars, never on a fixed grid
      if (this.barInSec === 0) { this.chordLeft = 0; this.chordIdx = -1; }
      if (this.chordLeft <= 0) {
        this.chordIdx++;
        const calm = (this.fam.maxE || 1) <= 0.6, slow = this.st.hr > 0.7 || this.free;
        const lens = slow ? [2, 3, 4, 4] : calm ? [2, 2, 3, 4] : s2.hr === 2 ? [1, 2, 2, 3, 4] : this.st.hr < 0.3 ? [1, 1, 1, 2] : [1, 1, 1, 2, 2];
        // never shorter than ~2.4 s: in short odd-meter bars a pad would release before its next chord (heard as gaps)
        const minLen = Math.ceil(2.4 / this.barDur);
        this.chordLen = Math.min(Math.max(minLen, lens[Math.floor(Math.random() * lens.length)]), Math.max(1, s2.bars - this.barInSec));
        this.chordLeft = this.chordLen;
        this._chord(prog[this.chordIdx % prog.length] + this.center, tk.time, this.chordLen * this.barDur);
      }
      this.chordLeft--;
      // a rising swell into a peak; a low impact when it lands
      if (s2.rise && this.barInSec === s2.bars - 1 && (this.fam.maxE || 1) >= 0.8) this._play('riser', 60, tk.time, 0.05 + 0.04 * this.energy, this.barDur, 0, 'fx');
      if (s2.land && this.barInSec === 0 && (this.fam.maxE || 1) >= 0.7) this._play('boom', u.midiOf(0) - 24, tk.time, 0.22, 2, 0, 'fx');
      // the drone: the world's ground, re-struck as the chords change or every few bars
      if (this.droneOn && !this.breath && this.barInSec % 4 === 0) {
        const root = intoOctave(u.midiOf(this.center), 43), dur = this.barDur * 4.2;
        this._play(this.v.drone, root, tk.time, 0.026 + 0.016 * this.energy, dur, -0.3, 'drone');
        if (this.stack[1] !== 1) this._play(this.v.drone, intoOctave(u.midiOf(this.center + (u.scale.length === 7 ? 4 : 3)), 50), tk.time + 0.05, 0.02, dur, 0.3, 'drone');
      }
      // how busy the melodic layers were in the bar just gone, against what this culture and energy want
      this.actPrev = this.actNow || 0;
      this.actNow = 0;
      this.actWant = (1.5 + 7 * this.st.density) * (0.35 + this.energy) * (this.meter.n / 16);
      this.barInSec++;
    }

    _chord(deg, t, dur) {
      const u = this.uni, len = u.scale.length;
      const degs = this.stack.map((o) => deg + o);
      if (this.stack.length === 3 && this.tertian && this.sevenths && len === 7 && this.energy > 0.45) degs.push(deg + 6);
      const midis = degs.map((d) => u.midiOf(d));
      this.chordDeg = deg;
      this.chord = midis;
      this.chordPcs = new Set(midis.map((m) => ((m % 12) + 12) % 12));
      if (this.energy < 0.08 || !this.fam.pad) return;
      // a pad plays at most four voices; with big chords, the root is the bass's
      const pm = midis.length > 4 ? midis.slice(1, 5) : midis;
      // voice leading: of every inversion that sits around middle C, take the one that moves least
      // (stacks of fourths and clusters keep their shape: inverting them makes different chords)
      const keep = !this.tertian;
      const cands = [];
      for (let inv = 0; inv < (keep ? 1 : pm.length); inv++) {
        const rot = pm.slice(inv).concat(pm.slice(0, inv));
        let prev = rot[0];
        while (prev < 52) prev += 12;
        while (prev >= 64) prev -= 12;
        const v = [prev];
        for (let i = 1; i < rot.length; i++) {
          let x = rot[i];
          while (x <= prev + (keep ? 0 : 2)) x += 12;
          while (x - 12 > prev + (keep ? 0 : 2)) x -= 12;
          v.push(x);
          prev = x;
        }
        cands.push(v);
      }
      let best = cands[0], bestCost = Infinity;
      // bright pads (organ, glass harmonica, choir) glare up high (the audit: 2-4 kHz fatigue): keep them lower
      const topMax = /organ|glassharp|choir/.test(this.fam.pad) ? 74 : 79;
      for (const v of cands) {
        const top = v[v.length - 1];
        let cost = top > topMax ? 20 + (top - topMax) * 2 : 0;
        if (this.voicing) for (let i = 0; i < v.length; i++) cost += Math.abs(v[i] - (this.voicing[i] || this.voicing[this.voicing.length - 1]));
        if (cost < bestCost) { bestCost = cost; best = v; }
      }
      const prevTop = this.voicing ? this.voicing[this.voicing.length - 1] : null;
      this.voicing = best;
      const vel = (0.04 + 0.035 * this.energy) * (best.length > 3 ? 0.85 : 1);
      const up = this.fam.pad === 'glassharp' ? 12 : 0;
      // a suspension: the top voice holds the old chord's note a step above, then resolves down into the new
      const top = best[best.length - 1];
      const sus = this.suspend && prevTop != null && prevTop - top > 0 && prevTop - top <= 2 && Math.random() < 0.3 + 0.5 * this.st.tension && dur > this.barDur * 0.9;
      best.forEach((m, i) => {
        const pan = (i / (best.length - 1) - 0.5) * 0.7;
        if (sus && i === best.length - 1) {
          const hold = Math.min(this.barDur * 0.5, dur * 0.4);
          this._play(this.fam.pad, prevTop + up, t + i * 0.012, vel, hold, pan, 'pad');
          this._play(this.fam.pad, m + up, t + hold, vel, dur * 1.02 - hold, pan, 'pad');
        } else this._play(this.fam.pad, m + up, t + i * 0.012, vel, dur * 1.02, pan, 'pad');
      });
    }

    // a layer the section allows (a fraction: it enters that far from the end, so sections build), when
    // the energy is there for it
    _layerOn(name, threshold) {
      let m = this.sec.mask && this.sec.mask[name];
      // a driving world (a tunnel, Life) never waits for its drums, except in its quiet sections (the audit:
      // 24 seconds without a beat is not a tunnel)
      if (name === 'drums' && (this.fam.minE || 0) >= 0.5 && !this.sec.breath && !/still|hush|interlude/.test(this.sectionName)) m = null;
      if (m === 0) return false;
      if (m != null && m < 1 && (this.barInSec - 1) / this.sec.bars < 1 - m) return false;
      return this.energy > threshold;
    }

    _step(tk, s) {
      const e = this.energy, t = tk.time, u = this.uni, f = this.fam, st = this.st, n = this.meter.n;
      // echoes waiting to sound (the canon's second voice)
      if (this.echo.length) {
        const keep = [];
        for (const x of this.echo) { if (x.at <= this.stepAbs) this._play(x.inst, x.midi, t + (x.dt || 0), x.vel, x.dur, x.pan, 'canon'); else keep.push(x); }
        this.echo = keep;
      }
      if (this.breath || !this.chord) return;
      const bar = this.barInSec - 1, td = this.a.tickDur();
      const lastStepOfChord = this.chordLeft === 0 && s === n - 2;
      const accent = this.accents.has(s);
      const human = this.free ? 0.04 : (f.maxE || 1) <= 0.6 ? 0.03 : 0.018;
      // bass
      if (f.bass && e > 0.3 && this._layerOn('bass', 0.3)) {
        let root = this.chord[0];
        if (this.stack.length > 4) root = this.chord[0];
        while (root > 47) root -= 12;
        while (root < 36) root += 12;
        let on;
        if (this.free) on = s === 0 && this.chordLeft === this.chordLen - 1;
        else if (this.useGroove) {
          const hits = e < 0.5 ? [0] : e < 0.75 ? (f.groove === 'drive' ? [0, 8] : [0, 10]) : f.groove === 'drive' ? [0, 3, 8, 11, 14] : [0, 6, 8, 14];
          on = hits.includes(s);
        } else on = this.bassCells[e < 0.5 ? 0 : e < 0.75 ? 1 : 2][s];
        if (on) {
          let m = root;
          if (s === n - 2 && lastStepOfChord) m = Math.random() < 0.5 ? root + 12 : intoOctave(this.chord[2 % this.chord.length], root);
          else if (s !== 0 && Math.random() < 0.3) m = root + 12;
          const dur = s === 0 && (e < 0.5 || this.free) ? this.barDur * (this.chordLeft + 1) * 0.95 : td * (s === 0 ? 5 : 2.5);
          this._play(this.v.bass, m, t, (0.035 + 0.015 * e) * (f.bassGain || 1), dur, 0, 'bass');
        }
      }
      // arpeggio or ostinato (it may cycle in its own length against the bar)
      // music that barely moves still glints: a few scattered notes instead of a pattern
      const scatter = this.free || this.form === 'drift';
      const arpTh = scatter ? 0.15 : 0.42 + Math.max(0, 0.5 - st.density) * 0.2 - (this.sec.grow || this.sec.phase ? 0.12 : 0);
      if (f.arp && this._layerOn('arp', arpTh)) {
        const pos = this.stepAbs % this.arpLen;
        let on;
        if (scatter) on = Math.random() < (this.free ? 0.05 + 0.12 * st.density : 0.025 + 0.05 * st.density) * (0.5 + e);
        else {
          const sixteenths = e > (this.calm ? 0.72 : 0.64) && !this.lite;
          on = sixteenths || this.arpLen !== n ? this.arpCell[pos] : s % 2 === 0 && euclid(Math.ceil(this.arpCell.filter(Boolean).length / 2), Math.ceil(n / 2), bar)[s / 2];
          // process music: only the first growN hits of the cell sound
          if (on && this.growN < 99) { let c = 0; for (let i = 0; i <= pos; i++) if (this.arpCell[i]) c++; on = c <= this.growN; }
        }
        // every fourth bar the arpeggio breathes for half a bar; otherwise some notes simply rest
        const rest = (bar % 4 === 3 && s >= n / 2 && !this.sec.phase) || Math.random() < 0.12 + 0.12 * st.silence + (this.calm ? 0.1 : 0);
        // the governor: when the lead, counter and canon are all speaking, the arpeggio steps back
        if (on && this.actPrev > this.actWant * 1.6 && Math.random() < 0.5) on = false;
        if (on && !rest) {
          const i = this._arpNote(tk.tick);
          const acc = accent ? 1.25 : 1;
          const comp = Math.sqrt(6 / Math.max(3, this.arpCell.filter(Boolean).length * (16 / this.arpLen)));
          const hocketB = this.hocket && pos % 2 === 1;
          this._play(hocketB ? this.v.arp2 : this.v.arp, i, t + Math.random() * human, (0.065 + 0.04 * e) * acc * (0.75 + Math.random() * 0.5) * comp, 0.7 + Math.random() * 0.6, hocketB ? 0.45 : s % 4 < 2 ? -0.35 : 0.35, 'arp');
          // phasing: the same cell again, one step slower each cycle, on the other side
          if (this.sec.phase && !this.lite) {
            const pos2 = this.stepAbs % (this.arpLen + 1);
            if (pos2 < this.arpLen && this.arpCell[pos2]) this._play(this.v.arp2 || this.v.arp, this._arpNote(tk.tick + 1) + 12, t + 0.004, (0.045 + 0.03 * e) * comp, 0.6, 0.55, 'arp');
          }
        }
      }
      // ... and when everything has fallen quiet for a bar, a few soft glints keep the world alive
      else if (!this.breath && e > 0.12 && this.actPrev < this.actWant * 0.45 && (f.arp || f.notes[0]) && Math.random() < Math.min(0.15, (this.actWant * 0.5 - this.actPrev) / n)) {
        this._play(f.arp || f.notes[0], this._arpNote(tk.tick), t + Math.random() * human, 0.04 + 0.03 * e, 0.8 + Math.random() * 0.8, (Math.random() - 0.5) * 0.9, 'arp');
      }
      // a second culture's meter: its own ostinato cycling against ours
      if (this.secondCell && !this.free && e > 0.3 && this._layerOn('arp', 0.3)) {
        const pos = this.stepAbs % this.second.n;
        if (this.secondCell[pos]) this._play(f.notes[2], intoOctave(this.chord[pos % this.chord.length], 60), t + Math.random() * human, 0.05 + 0.02 * e, 0.4, -0.55, 'arp');
      }
      // the motif: two bars of call, two bars left open for the creatures (or the counter-voice) to answer;
      // in an answer section the two trade places, so the dialogue never leaves a bar empty
      const leadSecs = this.sec.mask && this.sec.mask.lead === 0 ? false : true;
      const span = this.free ? 4 : 2, swap = !!this.sec.answer;
      const leadBar = swap ? bar % (span * 2) >= span : bar % (span * 2) < span;
      if (f.lead && e > (scatter ? 0.18 : 0.35) && leadSecs && leadBar) {
        const at = (bar % span) * n + s;
        for (const x of this.phrase) {
          if (x.at !== at) continue;
          const len = u.scale.length;
          const deg = len + this.chordDeg + x.deg;
          // brass and choir sing an octave lower, under the bells instead of on top of them
          const m = u.midiOf(deg) - (f.lead === 'brass' || f.lead === 'choir' ? 12 : 0);
          // a pure-toned lead (glass, sine) sits back and doesn't hold: held sines read as a test tone (the audit)
          const pure = /^(glass|sine|glassharp)$/.test(f.lead) && this.v.lead === f.lead;
          const vel = (0.065 + 0.03 * e) * (0.85 + Math.random() * 0.3) * (swap ? 0.8 : 1) * (pure ? 0.7 : 1), dur = Math.min(pure ? 1.4 : 99, Math.max(0.25, x.len * td * 1.1));
          // an ornament: a quick neighbour note just before
          if (st.ornament > 0.6 && Math.random() < st.ornament * 0.4 && x.len >= 2) this._play(this.v.lead, u.midiOf(deg + 1) + (m - u.midiOf(deg)), t - td * 0.5, vel * 0.55, td * 0.6, 0.12, 'lead');
          this._play(this.v.lead, m, t + Math.random() * 0.012, vel, dur, 0.12, 'lead');
          if (this.counterOn && this._layerOn('counter', 0.3)) this._counterNote(m, deg, t, dur, vel);
          if (this.canon && !this.lite) this.echo.push({ at: this.stepAbs + this.canon.lag, inst: this.v.canon, midi: u.midiOf(deg + this.canon.by) + (m - u.midiOf(deg)), vel: vel * 0.55, dur, pan: -0.4 });
        }
        if (bar % span === span - 1 && s === n - 1) this.phrase = this._place(this._develop());
      } else if (this.counterOn && (this.sec.answer || this.sec.counter) && e > 0.3 && this._layerOn('counter', 0.3)) {
        // the answer: the motif turned upside down, lower, in the counter-voice
        const at = (bar % span) * n + s;
        for (const x of this.phrase) {
          if (x.at !== at) continue;
          const deg = this.chordDeg + C.clamp(-x.deg, -4, 6);
          this._play(this.v.counter, u.midiOf(deg), t + Math.random() * human, 0.06 + 0.025 * e, Math.max(0.3, x.len * td * 1.2), -0.25, 'counter');
        }
      }
      // grains: a fine, high cloud around the chord, in the textures that like it
      if (this.grainOn && (this.sec.texture || this.form === 'drift' || this.form === 'waves') && C.Voices) {
        const pg = (0.06 + 0.25 * st.grain) * (this.lite ? 0.4 : 1) * (0.4 + e);
        if (Math.random() < pg) {
          const m = intoOctave(this.chord[Math.floor(Math.random() * this.chord.length)], 72 + Math.floor(Math.random() * 2) * 12);
          this._play(this.v.grain, m, t + Math.random() * td, 0.03 + 0.03 * Math.random(), 0.06 + 0.25 * Math.random(), (Math.random() - 0.5) * 1.4, 'texture', true);
        }
      }
      // drums
      // drums: a calm world keeps them for the top of its range (the audit: a constant tick reads as a click track)
      // (a clockwork world's ticks are its pulse, not decoration: they keep the usual threshold)
      if (this.kit && !this.free && this._layerOn('drums', this.calm && f.groove !== 'clock' ? Math.max(0.48, (f.maxE || 1) - 0.14) : 0.48)) {
        const swing = s % 2 === 1 ? td * this.swing : 0;
        const full = e > 0.7;
        const hits = [];
        if (this.useGroove) {
          const G = GROOVES[f.groove][full ? 1 : 0];
          for (const inst in G) if (G[inst][s] === 'x') hits.push(inst);
        } else {
          const cell = this.kitCells[full ? 1 : 0];
          if (cell.low[s]) hits.push(this.kit[0]);
          if (cell.mid[s]) hits.push(this.kit[1]);
          if (cell.high[s]) hits.push(this.kit[2]);
        }
        for (const inst of hits) {
          if (inst === 'boom' && bar % 2) continue;
          if (inst === 'thunder' && (bar % 2 || Math.random() < 0.4)) continue; // thunder comes when it likes
          if (this.lite && (inst === 'shaker' || inst === 'hat') && s % 2) continue;
          let vel = DRUM_VEL[inst] * (f.drumGain || 1) * (0.85 + Math.random() * 0.3) * (accent ? 1.1 : 0.9);
          let name = inst, m = 48;
          if (inst === 'chip') m = this.chord[0] + 24;
          if (inst === 'drip') { name = 'drop'; m = this.chord[Math.floor(Math.random() * this.chord.length)] + 24; vel *= 0.9; }
          if (inst === 'tom') m = this.chord[0] - 12 + (s > n / 2 ? -5 : 0);
          if (inst === 'boom') m = this.chord[0] - 24;
          // played by hands, not a grid: looser in looser cultures, and the off-beat ticks softer and uneven
          if (!accent && (inst === 'hat' || inst === 'shaker' || inst === 'rim')) vel *= 0.55 + 0.35 * Math.random();
          const loose = 0.004 + 0.012 * (1 - st.pulse);
          this._play(name, m, t + swing + Math.random() * loose, vel, inst === 'hat' && s % 4 === 2 && e > 0.8 ? 0.3 : 0.1, inst === 'hat' || inst === 'shaker' ? 0.25 : 0, 'drums');
        }
      }
    }

    // counterpoint, note against note: below the lead, consonant with it (thirds, sixths, fifths, octaves),
    // moving against it, by step where it can, never in parallel fifths or octaves (after Fux)
    _counterNote(leadMidi, leadDeg, t, dur, vel) {
      const u = this.uni, len = u.scale.length;
      const prev = this.cp;
      let best = null, bestCost = Infinity;
      for (let d = leadDeg - len * 2; d < leadDeg - 1; d++) {
        const m = u.midiOf(d), iv = leadMidi - m;
        if (iv < 3 || iv > 19 || m < 55) continue;
        const ic = iv % 12;
        if (![3, 4, 7, 8, 9, 0].includes(ic)) continue;
        let cost = 0;
        if (prev) {
          const leadMove = leadMidi - prev.lead, move = m - prev.m;
          if ((ic === 7 || ic === 0) && prev.ic === ic && move !== 0) cost += 50; // parallel perfect intervals
          if (leadMove && move && Math.sign(leadMove) === Math.sign(move)) cost += 3; // similar motion
          cost += Math.abs(move) * 0.6; // stepwise
        }
        if (ic === 0 || ic === 7) cost += 1.5; // imperfect consonances are sweeter in the middle of a line
        if (!this.chordPcs.has(((m % 12) + 12) % 12)) cost += 2;
        cost += Math.abs(iv - 9) * 0.15;
        if (cost < bestCost) { bestCost = cost; best = { m, ic }; }
      }
      if (!best) return;
      this.cp = { m: best.m, ic: best.ic, lead: leadMidi };
      this._play(this.v.counter, best.m, t + 0.01 + Math.random() * 0.01, vel * 0.62, dur * (this.st.counter > 0.8 ? 1.4 : 1), -0.2, 'counter');
    }

    _arpNote(tick) {
      const pool = [];
      for (const m of this.chord) for (const o of [12, 24]) { const x = m + o; if (x >= 62 && x <= 90) pool.push(x); }
      // a chord voiced unusually high or low still arpeggiates: fold its notes into the register
      if (!pool.length) for (const m of this.chord) { let x = m; while (x < 62) x += 12; while (x > 90) x -= 12; pool.push(x); }
      pool.sort((x, y) => x - y);
      return pool[this._arpIndex(pool.length, tick)];
    }
    _arpIndex(n, tick) {
      if (n <= 1) return 0;
      const k = Math.floor(tick / 2);
      if (this.arpMode === 'up') return k % n;
      if (this.arpMode === 'updown') { const p = 2 * n - 2, x = k % p; return x < n ? x : p - x; }
      if (this.arpMode === 'pendulum') return k % 2 ? n - 1 - (Math.floor(k / 2) % n) : Math.floor(k / 2) % n;
      this.walk = C.clamp((this.walk || 0) + (Math.random() < 0.5 ? -1 : 1), 0, n - 1);
      return this.walk;
    }

    _play(inst, midi, t, vel, dur, pan, layer, grain) {
      if (!isFinite(midi) || !inst) return;
      // muted (your song is playing, or creature sounds are off): keep composing, but make no voices
      if (this.a.scoreMuted && this.a.scoreMuted()) return;
      if (grain && C.Voices) this.a.playGrain(inst, midi, t, vel, dur, pan);
      else this.a.playInst(inst, midi, t, vel, dur, pan);
      if (C.Capture && !this.a.offline) C.Capture.note(this.a, layer, inst, midi, t, vel, dur, this.uni && this.uni.world && this.uni.world.seed);
      if (layer === 'lead' || layer === 'arp' || layer === 'counter' || layer === 'canon') this.actNow = (this.actNow || 0) + 1;
      if (this.keepLog) this.log.push({ t, layer, inst, midi, sec: this.sectionName });
    }
  }

  C.Composer = Composer;
  C.SCORE_FORMS = FORMS;
  C.SCORE_SECTIONS = FORMS.arc;
  C.SCORE_UNPITCHED = NOT_PITCHED;
})();
