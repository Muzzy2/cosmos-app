'use strict';
// The score: an endless composer under the living world. It writes in sections that arrive, float,
// build, peak, break down and return; it moves through real chord progressions with smooth voice
// leading; it states a motif, rests while the creatures answer, then develops it. Every world has its
// own themes (seeded by the world), its own band (C.FAMILIES) and its own groove, and the ecosystem and
// your hands push its energy up and down, so it never plays the same thing twice.
(function () {
  const C = window.COSMOS;

  // chord-to-chord tendencies for seven-note scales (scale degrees 0-6)
  const NEXT7 = {
    0: { 3: 3, 4: 2, 5: 3, 1: 1.2, 2: 0.8 },
    1: { 4: 4, 3: 1, 6: 0.6, 5: 0.6 },
    2: { 5: 3, 3: 2, 1: 1 },
    3: { 4: 3, 0: 2.5, 1: 2, 5: 1 },
    4: { 0: 4, 5: 2.2, 3: 1 },
    5: { 3: 3, 1: 2.5, 4: 1.5, 2: 0.6 },
    6: { 0: 3, 2: 1, 5: 1 },
  };
  function weighted(r, table) {
    let tot = 0;
    for (const k in table) tot += table[k];
    let x = r() * tot;
    for (const k in table) { x -= table[k]; if (x <= 0) return +k; }
    return +Object.keys(table)[0];
  }
  function nextDeg(r, from, len) {
    if (len === 7) return weighted(r, NEXT7[from]);
    const t = {};
    for (let d = 0; d < len; d++) if (d !== from) t[d] = d === 0 ? 2.2 : 1;
    return weighted(r, t);
  }
  // a progression that doesn't see-saw between two chords
  function progression(r, len, start, n) {
    const p = [start];
    while (p.length < n) {
      let d = nextDeg(r, p[p.length - 1], len);
      if (p.length >= 2 && d === p[p.length - 2]) d = nextDeg(r, p[p.length - 1], len);
      p.push(d);
    }
    return p;
  }

  // sections: bars, energy from -> to, which theme, chord length in bars, where it can go next
  const SECTIONS = {
    arrive:    { bars: 8,  e: [0.18, 0.4],  theme: 'A', hr: 2, next: { float: 0.4, build: 0.6 } },
    float:     { bars: 8,  e: [0.26, 0.32], theme: 'B', hr: 2, next: { build: 0.7, groove: 0.3 } },
    build:     { bars: 8,  e: [0.42, 0.72], theme: 'B', hr: 1, next: { peak: 1 } },
    peak:      { bars: 16, e: [0.82, 0.88], theme: 'A', hr: 1, next: { breakdown: 0.5, groove: 0.5 } },
    groove:    { bars: 16, e: [0.56, 0.62], theme: 'A', hr: 1, next: { build: 0.4, breakdown: 0.3, peak: 0.3 } },
    breakdown: { bars: 8,  e: [0.22, 0.14], theme: 'B', hr: 2, next: { return: 0.6, build: 0.4 } },
    return:    { bars: 16, e: [0.6, 0.5],   theme: 'A', hr: 1, next: { float: 0.4, groove: 0.3, build: 0.3 } },
  };

  // grooves: 16-step patterns per instrument, a light and a full version
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
  const DRUM_VEL = { thunder: 0.32, kick: 0.2, shaker: 0.2, rim: 0.14, hat: 0.22, clap: 0.16, boom: 0.18, tom: 0.2, chip: 0.07, drip: 0.1 };
  const SWUNG = { soft: 1, wood: 1, heart: 1, drip: 1, tide: 1 };

  // the same pitch class, placed in the octave above `floor`
  const intoOctave = (m, floor) => { while (m < floor) m += 12; while (m >= floor + 12) m -= 12; return m; };
  // a Euclidean rhythm: k hits spread as evenly as possible over n steps
  const euclid = (k, n, rot) => Array.from({ length: n }, (_, i) => ((i + (rot || 0)) * k) % n < k);

  class Composer {
    constructor(audio) {
      this.a = audio;
      this.uni = null;
      this.seed = 0;
      this.chordPcs = null;
      this.chord = null;
      this.voicing = null;
      this.sectionName = 'arrive';
      this.sec = SECTIONS.arrive;
      this.barInSec = 0;
      this.secCount = 0;
      this.energy = 0;
      this.log = []; // recent events, for tests: {t, layer, midi}
      this.keepLog = false;
      this.gainNow = -1;
      this.lite = !!C.MOBILE; // phones: no sixteenth-note arpeggios, lighter percussion
    }

    // Follow the world you are in. A new world gets its own themes, band and groove.
    setWorld(uni) {
      if (uni === this.uni) return;
      this.uni = uni;
      const w = uni.world || {};
      this.fam = C.familyOf(uni.genus);
      this.grooveName = this.fam.groove;
      this.r = C.rng(((w.seed || 1) ^ 0x5c0e) >>> 0);
      this._themes();
      // arrive at the energy you came in with, so a glide never falls into a hole
      const prev = this.energy;
      this._enter(prev > 0.55 ? 'groove' : prev > 0.38 ? 'float' : 'arrive');
      this.pendingChord = !!this.chord;
      this.a.defaultFam = uni.genus;
    }

    _themes() {
      const r = this.r, len = this.uni.scale.length;
      this.A = progression(r, len, 0, 4);
      this.B = progression(r, len, len === 7 ? weighted(r, { 3: 2, 5: 2, 1: 1 }) : 1 + Math.floor(r() * (len - 1)), 4);
      this.motif = this._makeMotif();
      this.arpMode = ['up', 'updown', 'walk', 'pendulum'][Math.floor(r() * 4)];
      this.arpEuclid = [[5, 16], [7, 16], [9, 16], [11, 16], [6, 16]][Math.floor(r() * 5)];
      this.sevenths = r() < 0.5;
    }
    // a short idea: 4-6 notes over two bars, a contour in scale steps that ends near home
    _makeMotif() {
      const r = this.r, n = 4 + Math.floor(r() * 3), notes = [];
      let step = r() < 0.5 ? 0 : 2, deg = 0;
      for (let i = 0; i < n && step < 30; i++) {
        const len = [2, 2, 4, 4, 6, 8][Math.floor(r() * 6)];
        notes.push({ step, deg, len });
        step += len;
        deg += [-2, -1, -1, 1, 1, 2, 3][Math.floor(r() * 7)];
        deg = C.clamp(deg, -3, 6);
      }
      notes[notes.length - 1].deg = [0, 2, 4][Math.floor(r() * 3)];
      return notes;
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

    _enter(name) {
      this.sectionName = name;
      this.sec = SECTIONS[name];
      this.barInSec = 0;
      this.secCount++;
      // themes evolve: every few sections one chord of each theme changes; now and then a new motif
      const len = this.uni.scale.length;
      if (this.secCount % 5 === 0) this.A[1 + Math.floor(Math.random() * 3)] = nextDeg(Math.random, this.A[0], len);
      if (this.secCount % 4 === 0) this.B = progression(Math.random, len, this.B[0], 4);
      if (this.secCount % 7 === 0) { this.motif = this._makeMotif(); this.arpMode = ['up', 'updown', 'walk', 'pendulum'][Math.floor(Math.random() * 4)]; }
      this.phraseMotif = this._develop();
    }

    // Called with the 16th-note ticks the engine is about to play.
    onTicks(ticks, uni) {
      if (!this.a.ctx) return;
      if (uni && uni !== this.uni) this.setWorld(uni);
      if (!this.uni) return;
      for (const tk of ticks) {
        const s = ((tk.tick % 16) + 16) % 16;
        // a new world sounds its first chord straight away, not up to a bar later
        if (this.pendingChord && s !== 0) {
          const td = this.a.tickDur();
          this._chord((this.sec.theme === 'A' ? this.A : this.B)[0], tk.time, (16 - s) * td + 16 * td);
        }
        this.pendingChord = false;
        if (s === 0) this._bar(tk);
        this._step(tk, s);
      }
    }

    _bar(tk) {
      const a = this.a, sec = this.sec;
      if (this.barInSec >= sec.bars) this._enter(weightedName(sec.next));
      const s2 = this.sec, prog = s2.theme === 'A' ? this.A : this.B;
      const p = this.barInSec / s2.bars;
      // energy: the section's arc, lifted by a busy ecosystem and by you
      const u = this.uni;
      const life = C.clamp(((u.singers && u.singers.length) || 0) / 120, 0, 1) * 0.08;
      const you = C.clamp(a.level / 1.5, 0, 1) * 0.1;
      // each world has a floor and a ceiling: a tunnel never idles, a tide never pounds
      this.energy = C.clamp(C.lerp(s2.e[0], s2.e[1], p) + life + you, this.fam.minE || 0, this.fam.maxE || 1);
      // the score steps aside entirely for your song, and follows the comfort settings
      const want = a.synthOn && a.duck >= 1 ? a.scoreVolume * (this.fam.trim || 1) : 0;
      if (Math.abs(want - this.gainNow) > 0.001 && a.scoreBus) {
        a.scoreBus.gain.setTargetAtTime(want, tk.time, 1.5);
        this.gainNow = want;
      }
      this.barT = tk.time;
      this.barDur = a.tickDur() * 16;
      // breath: the second-to-last bar of a breakdown is held silence, on purpose
      this.breath = this.sectionName === 'breakdown' && this.barInSec === s2.bars - 2;
      // harmonic rhythm breathes: chords last one to four bars, never on a fixed grid
      if (this.barInSec === 0) { this.chordLeft = 0; this.chordIdx = -1; }
      if (this.chordLeft <= 0) {
        this.chordIdx++;
        // calm worlds hold their chords longer: never less than two bars
        const calm = (this.fam.maxE || 1) <= 0.6;
        const lens = calm ? [2, 2, 3, 4] : s2.hr === 2 ? [1, 2, 2, 3, 4] : [1, 1, 1, 2, 2];
        this.chordLen = Math.min(lens[Math.floor(Math.random() * lens.length)], s2.bars - this.barInSec);
        this.chordLeft = this.chordLen;
        this._chord(prog[this.chordIdx % prog.length], tk.time, this.chordLen * this.barDur);
      }
      this.chordLeft--;
      // a rising swell into a peak; a low impact when it lands
      if (this.sectionName === 'build' && this.barInSec === s2.bars - 1 && (this.fam.maxE || 1) >= 0.8) this._play('riser', 60, tk.time, 0.05 + 0.04 * this.energy, this.barDur, 0, 'fx');
      if (this.sectionName === 'peak' && this.barInSec === 0) this._play('boom', u.midiOf(0) - 24, tk.time, 0.22, 2, 0, 'fx');
      this.barInSec++;
    }

    _chord(deg, t, dur) {
      const u = this.uni, len = u.scale.length;
      const degs = [deg, deg + 2, deg + 4];
      if (this.fam.ext === 'add9') degs.push(deg + len + 1);
      else if (this.fam.ext === 'seventh' || (this.sevenths && len === 7 && this.energy > 0.45)) degs.push(deg + 6);
      const midis = degs.map((d) => u.midiOf(d));
      this.chordDeg = deg;
      this.chord = midis;
      this.chordPcs = new Set(midis.map((m) => ((m % 12) + 12) % 12));
      if (this.breath || this.energy < 0.1 || !this.fam.pad) return;
      // voice leading: of every inversion that sits around middle C, take the one that moves least
      const cands = [];
      for (let inv = 0; inv < midis.length; inv++) {
        const rot = midis.slice(inv).concat(midis.slice(0, inv));
        let prev = rot[0];
        while (prev < 52) prev += 12;
        while (prev >= 64) prev -= 12;
        const v = [prev];
        for (let i = 1; i < rot.length; i++) {
          let x = rot[i];
          while (x <= prev + 2) x += 12;
          while (x - 12 > prev + 2) x -= 12;
          v.push(x);
          prev = x;
        }
        cands.push(v);
      }
      let best = cands[0], bestCost = Infinity;
      for (const v of cands) {
        const top = v[v.length - 1];
        let cost = top > 79 ? 20 : 0;
        if (this.voicing) for (let i = 0; i < v.length; i++) cost += Math.abs(v[i] - (this.voicing[i] || this.voicing[this.voicing.length - 1]));
        if (cost < bestCost) { bestCost = cost; best = v; }
      }
      this.voicing = best;
      const vel = 0.04 + 0.035 * this.energy;
      const up = this.fam.pad === 'glassharp' ? 12 : 0;
      best.forEach((m, i) => this._play(this.fam.pad, m + up, t + i * 0.012, vel, dur * 1.02, (i / (best.length - 1) - 0.5) * 0.7, 'pad'));
    }

    _step(tk, s) {
      const e = this.energy, t = tk.time, u = this.uni, f = this.fam;
      if (this.breath || !this.chord) return;
      const bar = this.barInSec - 1, sec = this.sec, td = this.a.tickDur();
      const lastStepOfChord = this.chordLeft === 0 && s === 14;
      // bass
      if (f.bass && e > 0.3) {
        let root = this.chord[0];
        while (root > 47) root -= 12;
        while (root < 36) root += 12;
        let hits;
        if (e < 0.5) hits = [0];
        else if (e < 0.75) hits = this.grooveName === 'drive' ? [0, 8] : [0, 10];
        else hits = this.grooveName === 'drive' ? [0, 3, 8, 11, 14] : [0, 6, 8, 14];
        if (hits.includes(s)) {
          let m = root;
          if (s === 14 && lastStepOfChord) m = Math.random() < 0.5 ? root + 12 : intoOctave(this.chord[2], root);
          else if (s !== 0 && Math.random() < 0.3) m = root + 12;
          const dur = s === 0 && e < 0.5 ? this.barDur * (this.chordLeft + 1) * 0.95 : td * (s === 0 ? 5 : 2.5);
          this._play(f.bass, m, t, (0.035 + 0.015 * e) * (f.bassGain || 1), dur, 0, 'bass');
        }
      }
      // arpeggio
      if (f.arp && e > 0.42 && this.sectionName !== 'breakdown') {
        const sixteenths = e > 0.62 && !this.lite;
        const [k, n] = this.arpEuclid;
        const on = sixteenths ? euclid(k, n, bar)[s] : s % 2 === 0 && euclid(Math.ceil(k / 2), 8, bar)[s / 2];
        // every fourth bar the arpeggio breathes for half a bar; otherwise some notes simply rest
        const rest = (bar % 4 === 3 && s >= 8) || Math.random() < 0.18;
        if (on && !rest) {
          const pool = [];
          for (const m of this.chord) for (const o of [12, 24]) { const x = m + o; if (x >= 62 && x <= 90) pool.push(x); }
          // a chord voiced unusually high or low still arpeggiates: fold its notes into the register
          if (!pool.length) for (const m of this.chord) { let x = m; while (x < 62) x += 12; while (x > 90) x -= 12; pool.push(x); }
          pool.sort((x, y) => x - y);
          const i = this._arpIndex(pool.length, tk.tick);
          const accent = s % 4 === 0 ? 1.25 : 1;
          const human = 0.75 + Math.random() * 0.5;
          this._play(f.arp, pool[i], t + Math.random() * ((f.maxE || 1) <= 0.6 ? 0.03 : 0.018), (0.065 + 0.04 * e) * accent * human, 0.7 + Math.random() * 0.6, s % 4 < 2 ? -0.35 : 0.35, 'arp');
        }
      }
      // the motif: two bars of call, two bars left open for the creatures to answer
      if (f.lead && e > 0.35 && /build|peak|return|groove/.test(this.sectionName) && bar % 4 < 2) {
        const step = (bar % 4) * 16 + s;
        for (const n of this.phraseMotif) {
          if (n.step !== step) continue;
          const len = u.scale.length;
          // brass and choir sing an octave lower, under the bells instead of on top of them
          const m = u.midiOf(len + this.chordDeg + n.deg) - (f.lead === 'brass' || f.lead === 'choir' ? 12 : 0);
          this._play(f.lead, m, t + Math.random() * 0.012, (0.065 + 0.03 * e) * (0.85 + Math.random() * 0.3), Math.max(0.25, n.len * td * 1.1), 0.12, 'lead');
        }
        if (bar % 4 === 1 && s === 15) this.phraseMotif = this._develop();
      }
      // groove
      const G = this.grooveName && GROOVES[this.grooveName];
      if (G && e > 0.48 && this.sectionName !== 'float') {
        const pat = G[e > 0.7 ? 1 : 0];
        const swing = SWUNG[this.grooveName] && s % 2 === 1 ? td * 0.14 : 0;
        for (const inst in pat) {
          if (pat[inst][s] !== 'x') continue;
          if (inst === 'boom' && bar % 2) continue;
          if (inst === 'thunder' && (bar % 2 || Math.random() < 0.4)) continue; // thunder comes when it likes
          if (this.lite && (inst === 'shaker' || inst === 'hat') && s % 2) continue;
          let vel = DRUM_VEL[inst] * (f.drumGain || 1) * (0.85 + Math.random() * 0.3) * (s % 4 === 0 ? 1.1 : 0.9);
          let name = inst, m = 48;
          if (inst === 'chip') m = this.chord[0] + 24;
          if (inst === 'drip') { name = 'drop'; m = this.chord[Math.floor(Math.random() * this.chord.length)] + 24; }
          if (inst === 'tom') m = this.chord[0] - 12 + (s > 8 ? -5 : 0);
          if (inst === 'boom') m = this.chord[0] - 24;
          this._play(name, m, t + swing + Math.random() * 0.004, vel, inst === 'hat' && s % 4 === 2 && e > 0.8 ? 0.3 : 0.1, inst === 'hat' || inst === 'shaker' ? 0.25 : 0, 'drums');
        }
      }
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

    _play(inst, midi, t, vel, dur, pan, layer) {
      if (!isFinite(midi)) return;
      // muted (your song is playing, or creature sounds are off): keep composing, but make no voices
      if (this.a.scoreMuted && this.a.scoreMuted()) return;
      this.a.playInst(inst, midi, t, vel, dur, pan);
      if (this.keepLog) this.log.push({ t, layer, inst, midi, sec: this.sectionName });
    }
  }
  function weightedName(table) {
    let tot = 0;
    for (const k in table) tot += table[k];
    let x = Math.random() * tot;
    for (const k in table) { x -= table[k]; if (x <= 0) return k; }
    return Object.keys(table)[0];
  }

  C.Composer = Composer;
  C.SCORE_SECTIONS = SECTIONS;
})();
