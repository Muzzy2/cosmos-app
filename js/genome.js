'use strict';
// COSMOS 4 genomes: what a singer inherits, how it mutates, and what each trait costs or earns. The live
// ecosystem (life.js) and the off-screen catch-up (multiverse.js) both use these same rules, so a world
// you return to has evolved by the laws you watched it live by.
//
// Traits that matter (each one trades something off; none is free):
//   degrees  pitch, and so body size (low notes are big: they eat more and burn more)
//   speed    thrust per pulse, paid for on every pulse (cost grows with speed squared)
//   rhythm   pulse period in beats: frequent pulses swim more but cost more
//   social   flocking toward neighbours whose notes are consonant with yours
//   spike    armour and weapon: hunters with more spike win more fights; prey with more spike survive them
//   diet     0 grazes light .. 1 hunts other singers (grazing efficiency falls as diet rises)
//   climate  the warmth it thrives in; living away from it costs energy ...
//   hardy    ... unless it is hardy, which widens its comfort range but costs a little all the time
//   wander   how readily it slips into an orb and migrates to the world inside
//   motif    a four-step song (scale steps). It sings it, and it only mates with singers whose song is
//            close to its own: songs drift, diverge, and become barriers between species.
// Cosmetic, selection-neutral markers (used by the drift control): timbre, lobes.
(function () {
  const C = window.COSMOS;
  C.GENE_KEYS = ['timbre', 'lobes', 'rhythm', 'speed', 'social', 'spike', 'diet', 'climate', 'hardy', 'wander'];
  const MOTIF_STEPS = [-2, -1, -1, 0, 1, 1, 2, 3];

  // Older snapshots and hand-made genomes get the new genes with neutral values.
  C.fillGenome = function (g, warmth) {
    if (g.diet == null) g.diet = Math.random() * 0.2;
    if (g.climate == null) g.climate = C.clamp((warmth == null ? 0.5 : warmth) + (Math.random() - 0.5) * 0.2, 0, 1);
    if (g.hardy == null) g.hardy = 0.3;
    if (g.wander == null) g.wander = 0.15;
    if (!g.motif || g.motif.length !== 4) g.motif = [0, 1, 2, 3].map(() => MOTIF_STEPS[Math.floor(Math.random() * MOTIF_STEPS.length)]);
    return g;
  };

  C.mutateTraits = function (n, r, rate) {
    const jig = (x, amt, lo, hi) => C.clamp(x + (r() + r() - 1) * amt * rate, lo, hi);
    n.diet = jig(n.diet, 0.07, 0, 1);
    n.climate = jig(n.climate, 0.07, 0, 1);
    n.hardy = jig(n.hardy, 0.05, 0, 1);
    n.wander = jig(n.wander, 0.05, 0, 1);
    n.motif = n.motif.slice();
    if (r() < 0.22 * rate) { const i = Math.floor(r() * 4); n.motif[i] = C.clamp(n.motif[i] + (r() < 0.5 ? -1 : 1), -3, 4); }
    if (r() < 0.03 * rate) n.motif.push(n.motif.shift()); // now and then the song is sung from another bar
  };

  // Grazing on a living medium: a 16x16 tally of how much was eaten where; the busiest spots become
  // erasing brushes in the medium's next step (at most `room` of them).
  C.GrazeMap = class {
    constructor() { this.a = new Float32Array(256); }
    add(x, y, amt) {
      const ix = (((Math.floor((x / C.W + 0.5) * 16)) % 16) + 16) % 16, iy = (((Math.floor((y / C.W + 0.5) * 16)) % 16) + 16) % 16;
      this.a[iy * 16 + ix] += amt;
    }
    brushes(room, scale) {
      const out = [];
      if (room <= 0) { this.a.fill(0); return out; }
      const idx = [];
      for (let i = 0; i < 256; i++) if (this.a[i] > 0.0004) idx.push(i);
      idx.sort((p, q) => this.a[q] - this.a[p]);
      for (const i of idx.slice(0, room)) out.push([((i % 16) + 0.5) / 16 * C.W - C.W / 2, (Math.floor(i / 16) + 0.5) / 16 * C.W - C.W / 2, 0.8, -Math.min(0.6, this.a[i] * scale)]);
      for (let i = 0; i < 256; i++) this.a[i] *= 0.5;
      return out;
    }
  };
  C.fieldAt = (buf, x, y, c) => {
    if (!buf) return 0;
    const ix = (((Math.floor((x / C.W + 0.5) * 64)) % 64) + 64) % 64, iy = (((Math.floor((y / C.W + 0.5) * 64)) % 64) + 64) % 64;
    return buf[(iy * 64 + ix) * 4 + c];
  };

  // A lineage is an inherited surname: the world a family began in and which of its founding kinds it
  // came from. It never mutates, so it can be followed across migrations and worlds.
  C.lineageOf = (worldSeed, k) => 'L' + C.hash(worldSeed, 'lin', k).toString(36);

  // 1 = the same song, 0 = as different as two songs can be
  C.motifSim = (a, b) => {
    let d = 0;
    for (let i = 0; i < 4; i++) d += Math.abs(a[i] - b[i]);
    return 1 - d / 20;
  };

  // Energy per second from living in this climate (always <= 0). `on` lets experiments switch it off.
  // The cost keeps rising with distance (no plateau), so even a badly misplaced population feels every
  // small step toward its new climate: that gradient is what selection climbs.
  C.climateCost = function (g, warmth, on) {
    if (on === false) return -0.03 * g.hardy;
    const width = 0.08 + 0.3 * g.hardy, d = Math.abs(g.climate - warmth) / width;
    return -0.022 * Math.min(4.5, d * d / (1 + d)) - 0.03 * g.hardy;
  };
  C.grazeEff = (g) => 1 - 0.8 * g.diet;
  C.pulseCost = (g) => 0.012 + 0.004 * g.speed * g.speed;
  C.isHunter = (g) => g.diet > 0.5;
  // chance a hunter's strike lands
  C.strikeOdds = (h, p) => C.clamp(0.18 + 0.5 * (h.diet - 0.5) + 0.45 * (h.spike - p.spike), 0.03, 0.85);

  // The note a singer sings on its n-th pulse: its base degree plus its song's step.
  C.motifDegree = (g, step) => {
    const m = g.motif;
    let d = 0;
    for (let i = 0; i < (step % 4); i++) d += m[i];
    return d;
  };

  // A compact description of a body plan and way of life, for telling species apart and spotting novelty.
  // Every axis is roughly 0..1, so distances mean the same thing across traits.
  C.descriptor = function (g, scaleLen) {
    const m = g.motif;
    return [
      C.clamp((g.degrees[0] + scaleLen) / (scaleLen * 4), 0, 1), g.diet, C.clamp((g.speed - 0.4) / 1.6, 0, 1), g.climate, g.hardy,
      (g.rhythm - 2) / 6, g.social, g.spike, g.wander * 0.5, (m[0] + 3) / 7 * 0.6, (m[1] + 3) / 7 * 0.6, (m[2] + 3) / 7 * 0.6, (m[3] + 3) / 7 * 0.6,
    ];
  };
  C.descDist = (a, b) => {
    let s = 0;
    for (let i = 0; i < a.length; i++) s += (a[i] - b[i]) * (a[i] - b[i]);
    return Math.sqrt(s);
  };
})();
