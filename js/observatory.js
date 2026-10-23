'use strict';
// COSMOS 4 observatory: it watches every living world, recognises species as they form, split, drift
// and die out, and notices things nobody scripted: hunters evolving, boom-and-bust cycles, a population
// falling into one rhythm, a song becoming a dialect, newcomers taking over, a hybrid species, a body
// plan never seen in any world before. Each discovery is kept in a journal on this device, with a
// snapshot of the world at that moment, so it can be revisited and replayed.
//
// Guarding against "novelty" that is only noise: a species must hold at least 6 members for 40 simulated
// seconds before it counts; detectors need their condition to persist across scans; novelty is measured
// against an archive of every established form seen so far (mean distance to the 3 nearest), and no
// novelty is claimed until the archive has 6 entries. tests/evo/emergence.js measures how often each
// detector fires in neutral control worlds (its false-alarm rate).
(function () {
  const C = window.COSMOS;
  const T_ASSIGN = 0.36, T_CLUSTER = 0.24, MIN_MEMBERS = 6, NEW_MEMBERS = 8, ESTABLISH_S = 60, EXTINCT_S = 30, NOVELTY = 0.4, ARCHIVE_MIN = 10, MATURE_S = 120, SCAN_S = 5;

  const ADJ = {
    hunter: ['Spined', 'Hungry', 'Thorned', 'Stalking', 'Hooked'], cold: ['Frost', 'Pale', 'Glacial', 'Winter'],
    hot: ['Ember', 'Sun', 'Scorched', 'Kiln'], fast: ['Swift', 'Darting', 'Quick'], big: ['Great', 'Slow', 'Deep'],
    plain: ['Glass', 'Velvet', 'Lantern', 'Drifting', 'Hollow', 'Singing', 'Amber', 'Moth', 'Tidal'],
  };
  const NOUN = ['bellwing', 'drifter', 'lantern', 'mote', 'veil', 'choirling', 'glimmer', 'reed', 'comet', 'wisp', 'chime', 'shoal', 'harp', 'spore'];
  function nameFor(id, d) {
    const r = C.rng(C.hash(id, 'name'));
    const pick = (a) => a[Math.floor(r() * a.length)];
    const kind = d[1] > 0.5 ? 'hunter' : d[3] < 0.3 ? 'cold' : d[3] > 0.7 ? 'hot' : d[2] > 0.6 ? 'fast' : d[0] < 0.3 ? 'big' : 'plain';
    return pick(ADJ[kind]) + ' ' + pick(NOUN);
  }

  // ------------------------------------------------------------------ the journal (device only)
  const journal = {
    list: [], archive: [], loaded: false, listeners: [],
    async load() {
      try {
        const rows = await C.db.all('journal');
        const all = rows.filter((r) => r.kind).sort((a, b) => b.at - a.at);
        this.list = all.slice(0, 200);
        for (const r of all.slice(200)) C.db.del('journal', r.id).catch(() => {});
        const ar = rows.find((r) => r.id === 'archive');
        this.archive = ar ? ar.items.slice(-500) : [];
      } catch (e) {}
      this.loaded = true;
      this.listeners.forEach((f) => f());
    },
    add(rec) {
      if (C.multiverse && C.multiverse.frozen) return;
      this.list.unshift(rec);
      for (const x of this.list.splice(200)) C.db.del('journal', x.id).catch(() => {});
      // only the newest 40 keep their full snapshot (they are the size of a saved world)
      this.list.forEach((x, i) => { if (i >= 40 && x.snapshot) { x.snapshot = null; C.db.put('journal', x).catch(() => {}); } });
      C.db.put('journal', rec).catch(() => {});
      this.listeners.forEach((f) => f(rec));
    },
    saveArchive() {
      if (this.archive.length > 500) this.archive.splice(0, this.archive.length - 500);
      C.db.put('journal', { id: 'archive', items: this.archive }).catch(() => {});
    },
    clear() { this.list = []; this.archive = []; },
  };
  C.journal = journal;

  // ------------------------------------------------------------------ watching one world
  function scan(u, hooks) {
    const len = u.scale.length, now = u.time;
    const L = u.singers.filter((s) => !s.dying && !s.leviathan);
    const obs = u.obs || (u.obs = { hist: [], seen: {}, fired: {}, chorusT: 0 });
    if (!u.species) u.species = [];
    const live = u.species.filter((sp) => !sp.extinct);
    for (const sp of live) { sp._n = 0; sp._sum = null; sp._foreign = 0; sp._hyb = 0; sp._motifs = new Map(); sp._ids = new Set(); }
    const loose = [];
    for (const s of L) {
      const d = C.descriptor(s.g, len);
      let best = null, bd = T_ASSIGN;
      for (const sp of live) { const dd = C.descDist(d, sp.centroid); if (dd < bd) { bd = dd; best = sp; } }
      if (best) add(best, s, d);
      else loose.push([s, d]);
    }
    // creatures that fit no known species: do enough of them resemble each other to be a new one?
    while (loose.length >= MIN_MEMBERS) {
      const [s0, d0] = loose[0];
      const grp = loose.filter(([, d]) => C.descDist(d, d0) < T_CLUSTER);
      if (grp.length < MIN_MEMBERS) { loose.shift(); continue; }
      const counts = new Map();
      for (const [s] of grp) counts.set(s.sp, (counts.get(s.sp) || 0) + 1);
      let parent = 0, pc = 0;
      for (const [k, v] of counts) if (k && v > pc) { pc = v; parent = k; }
      const centroid = d0.map((_, i) => grp.reduce((a, [, d]) => a + d[i], 0) / grp.length);
      const id = 'sp' + C.hash(u.world.seed, now.toFixed(1), u.species.length).toString(36);
      // the kinds a world was founded with (or arrived knowing nothing) are its natives, not discoveries
      const founder = !parent && (u.time < 60 || !obs.scans);
      const sp = { id, name: nameFor(id, centroid), centroid, origin: centroid.slice(), parent, home: u.world.seed, born: now, firstWall: C.now(), status: founder ? 'established' : 'emerging', founder, count: 0, peak: 0, zeroT: 0, extinct: false };
      if (founder) {
        journal.archive.push(centroid.map((x) => +x.toFixed(3)));
        journal.saveArchive();
        // a founding kind names its family (lineage), wherever its descendants later go
        const lins = new Map();
        for (const [s] of grp) lins.set(s.lin, (lins.get(s.lin) || 0) + 1);
        let top = null, tn = 0;
        for (const [k, v] of lins) if (k && v > tn) { tn = v; top = k; }
        if (top && C.multiverse) C.multiverse.nameLineage(top, sp.name, u.world.seed, u.world.name);
      }
      u.species.push(sp);
      live.push(sp);
      sp._n = 0; sp._sum = null; sp._foreign = 0; sp._hyb = 0; sp._motifs = new Map(); sp._ids = new Set();
      for (const [s, d] of grp) add(sp, s, d);
      for (const g of grp) loose.splice(loose.indexOf(g), 1);
      void s0;
    }
    function add(sp, s, d) {
      s.sp = sp.id;
      sp._n++;
      sp._ids.add(s.id);
      if (!sp._sum) sp._sum = d.slice(); else for (let i = 0; i < d.length; i++) sp._sum[i] += d[i];
      if (s.foreign) sp._foreign++;
      if (s.hyb) sp._hyb++;
      const key = s.g.motif.join(',');
      sp._motifs.set(key, (sp._motifs.get(key) || 0) + 1);
    }

    obs.scans = (obs.scans || 0) + 1;
    // keep the record of the dead short: the 40 most recent extinct species are enough for history
    if (u.species.length > 60) {
      const dead = u.species.filter((x) => x.extinct);
      const drop = new Set(dead.slice(0, Math.max(0, dead.length - 40)));
      u.species = u.species.filter((x) => !drop.has(x));
    }
    // species bookkeeping and their stories
    const events = [];
    for (const sp of live) {
      sp.count = sp._n;
      sp.peak = Math.max(sp.peak, sp.count);
      // membership stability: a species is the same creatures (and their young) scan after scan; a cluster
      // whose members churn completely is a statistical lump, not a lineage (the no-heredity null showed it)
      if (sp._prev && sp._prev.size) {
        let kept = 0;
        for (const id of sp._prev) if (sp._ids.has(id)) kept++;
        sp.stable = (sp.stable == null ? 0.5 : sp.stable) * 0.6 + (kept / sp._prev.size) * 0.4;
      }
      sp._prev = sp._ids;
      if (sp._n) {
        const m = sp._sum.map((x) => x / sp._n);
        for (let i = 0; i < m.length; i++) sp.centroid[i] += (m[i] - sp.centroid[i]) * 0.25; // species drift with their members
        sp.zeroT = 0;
        let mk = null, mv = 0;
        for (const [k, v] of sp._motifs) if (v > mv) { mv = v; mk = k; }
        sp.motif = mk ? mk.split(',').map(Number) : sp.motif;
        if (!sp.motif0 && sp.motif) sp.motif0 = sp.motif.slice(); // the song it started with
        sp.motifShare = sp._n ? mv / sp._n : 0;
        sp.foreignShare = sp._foreign / sp._n;
        sp.hybShare = sp._hyb / sp._n;
      } else sp.zeroT += SCAN_S;
      if (sp.status === 'emerging') {
        if (sp.count >= NEW_MEMBERS && now - sp.born >= ESTABLISH_S && (sp.stable || 0) >= 0.6) {
          sp.status = 'established';
          const par = u.species.find((x) => x.id === sp.parent);
          const nov = novelty(sp.centroid);
          journal.archive.push(sp.centroid.map((x) => +x.toFixed(3)));
          journal.saveArchive();
          if (nov != null && nov > NOVELTY) events.push({ kind: 'novel', sp, score: nov, text: 'a form of life never seen in any world: the ' + sp.name });
          else if (sp.hybShare >= 0.5) events.push({ kind: 'hybrid', sp, text: 'a hybrid species: the ' + sp.name + ', born of newcomers and natives' });
          // a split needs a parent lineage here: a cluster with no ancestry is either newcomers (the invasion
          // detector's business) or a statistical lump, and the null test showed those are not discoveries
          else if (par && !par.extinct) events.push({ kind: 'speciation', sp, text: 'the ' + par.name + ' have split: a new species, the ' + sp.name });
        } else if (sp.count === 0 && sp.zeroT > EXTINCT_S) sp.extinct = true; // never got going
      } else {
        if (sp.zeroT >= EXTINCT_S) {
          sp.extinct = true;
          sp.extinctWall = C.now();
          sp.extinctT = now;
          // only a species that had a real life counts (founders dying in a hostile climate do not)
          if (sp.peak >= 10 && now - sp.born >= MATURE_S) events.push({ kind: 'extinction', sp, text: 'the last of the ' + sp.name + ' are gone' });
        }
        // anagenesis: a species that has drifted far from what it was is now something else
        const mature = now - sp.born >= MATURE_S;
        if (!sp.extinct && mature && C.descDist(sp.centroid, sp.origin) > 0.5 && !sp.transformed) {
          sp.transformed = true;
          events.push({ kind: 'transformed', sp, text: 'the ' + sp.name + ' have changed beyond recognition since they first appeared' });
        }
        // climate adaptation
        if (!sp.extinct && mature && !sp.adapted && Math.abs(sp.centroid[3] - sp.origin[3]) > 0.15) {
          sp.adapted = true;
          events.push({ kind: 'adaptation', sp, text: 'the ' + sp.name + ' have adapted to the ' + (sp.centroid[3] > sp.origin[3] ? 'warmth' : 'cold') + ' here' });
        }
        // a dialect: most of a species sings exactly the same song
        if (!sp.extinct && mature && !sp.dialect && sp.count >= 8 && sp.motifShare >= 0.7 && sp.motif0 && sp.motif.join(',') !== sp.motif0.join(',')) {
          sp.dialect = true;
          events.push({ kind: 'dialect', sp, text: 'the ' + sp.name + ' have a new song, and nearly all of them sing it — a dialect of their own' });
        }
        // newcomers taking hold
        if (!sp.extinct && !sp.invader && (sp.stable || 0) >= 0.6 && sp.foreignShare >= 0.6 && sp.count >= Math.max(8, L.length * 0.25)) {
          sp.invader = true;
          events.push({ kind: 'invasion', sp, text: 'newcomers from another world have taken hold: the ' + sp.name });
        }
      }
    }

    // whole-world phenomena
    const hunters = L.filter((s) => C.isHunter(s.g)).length, prey = L.length - hunters;
    obs.hist.push({ t: now, n: L.length, h: hunters, p: prey });
    if (obs.hist.length > 80) obs.hist.shift();
    const fire = (kind, text, minGap) => {
      const last = obs.fired[kind];
      if (last != null && now - last < (minGap || 600)) return;
      obs.fired[kind] = now;
      events.push({ kind, text });
    };
    // hunters evolving where the founders were grazers
    const founderHunters = u.world.species.some((sp) => (sp.diet || 0) > 0.5);
    const hf = L.length ? hunters / L.length : 0;
    // (if the founders already hunted, that is no discovery)
    if (!founderHunters && hunters >= 5 && hf >= 0.15) { obs.huntT = (obs.huntT || 0) + SCAN_S; if (obs.huntT >= 15) fire('hunters', 'hunters have evolved here from creatures that ate only light', 1e9); } else obs.huntT = 0;
    // boom and bust: prey peaks, then hunters peak a little later
    if (obs.hist.length >= 60) {
      const P = obs.hist.map((x) => x.p), Hs = obs.hist.map((x) => x.h);
      const peaks = localPeaks(P, 0.3), hpeaks = localPeaks(Hs, 0.3);
      // correlate changes, not levels: two counts that merely trend together are not a cycle
      const dP = P.slice(1).map((x, i) => x - P[i]), dH = Hs.slice(1).map((x, i) => x - Hs[i]);
      const lag = bestLagCorr(dP, dH, 1, 8);
      if (peaks >= 2 && hpeaks >= 2 && lag.r > 0.62 && Math.min(...Hs.slice(-30)) >= 2 && Math.max(...Hs) >= 6) fire('cycle', 'boom and bust: the hunters rise and fall a beat behind their prey', 900);
    }
    // a chorus: singers of one rhythm whose pulses fall into step (the firefly coupling, emergent)
    const groups = new Map();
    for (const s of L) { const g = groups.get(s.g.rhythm) || []; g.push(s.phase); groups.set(s.g.rhythm, g); }
    let chorus = 0;
    for (const [, ph] of groups) if (ph.length >= 12) {
      let cx = 0, cy = 0;
      for (const p of ph) { cx += Math.cos(p * 2 * Math.PI); cy += Math.sin(p * 2 * Math.PI); }
      chorus = Math.max(chorus, Math.hypot(cx, cy) / ph.length);
    }
    obs.chorus = chorus;
    if (chorus > 0.85) { obs.chorusT += SCAN_S; if (obs.chorusT >= 20) fire('chorus', 'a chorus: dozens of them have fallen into one pulse', 900); } else obs.chorusT = 0;

    // the population's song: the score borrows the most common motif of the biggest species
    const big = live.filter((sp) => !sp.extinct && sp.count > 0).sort((a, b) => b.count - a.count)[0];
    if (big && big.motif) { u.songMotif = big.motif; u.songRhythm = Math.round(big.centroid[5] * 6 + 2); u.songSpecies = big.name; }

    for (const ev of events) record(u, ev, hooks);
    return events;
  }

  function novelty(d) {
    const A = journal.archive;
    if (A.length < ARCHIVE_MIN) return null;
    const ds = A.map((a) => C.descDist(a, d)).sort((x, y) => x - y);
    return (ds[0] + ds[1] + ds[2]) / 3;
  }
  function localPeaks(xs, amp) {
    const mx = Math.max(...xs), mn = Math.min(...xs);
    if (mx - mn < amp * Math.max(1, mx)) return 0;
    let n = 0;
    for (let i = 2; i < xs.length - 2; i++) if (xs[i] >= xs[i - 1] && xs[i] >= xs[i + 1] && xs[i] > xs[i - 2] && xs[i] > xs[i + 2] && xs[i] - mn > (mx - mn) * 0.6) n++;
    return n;
  }
  function bestLagCorr(a, b, lo, hi) {
    let best = { r: -1, lag: 0 };
    for (let lag = lo; lag <= hi; lag++) {
      const x = a.slice(0, a.length - lag), y = b.slice(lag);
      const mx = x.reduce((p, q) => p + q, 0) / x.length, my = y.reduce((p, q) => p + q, 0) / y.length;
      let num = 0, dx = 0, dy = 0;
      for (let i = 0; i < x.length; i++) { num += (x[i] - mx) * (y[i] - my); dx += (x[i] - mx) ** 2; dy += (y[i] - my) ** 2; }
      const r = num / Math.sqrt(dx * dy + 1e-9);
      if (r > best.r) best = { r, lag };
    }
    return best;
  }

  function record(u, ev, hooks) {
    const entry = { t: C.now(), kind: ev.kind, text: ev.text };
    u.log.push(entry);
    if (u.log.length > 120) u.log.shift();
    const rec = {
      id: 'd' + C.hash(u.world.seed, ev.kind, entry.t, ev.text).toString(36), at: entry.t, kind: ev.kind, text: ev.text,
      world: u.world.seed, worldName: u.world.name, genus: u.world.genus, simTime: +u.time.toFixed(1),
      species: ev.sp ? { id: ev.sp.id, name: ev.sp.name, descriptor: ev.sp.centroid.map((x) => +x.toFixed(3)), motif: ev.sp.motif, count: ev.sp.count } : null,
      score: ev.score != null ? +ev.score.toFixed(3) : null,
      snapshot: C.multiverse ? C.multiverse.recordOf(u) : null,
      // a musical discovery keeps the music around it (compact note events, for MIDI)
      meter: ev.meter ? { n: ev.meter.n, g: ev.meter.g.slice(), name: ev.meter.name } : null,
      notes: ev.notes ? ev.notes.slice(-1500).map((e) => ({ beat: +e.beat.toFixed(3), layer: e.layer, inst: e.inst, midi: e.midi, vel: +e.vel.toFixed(3), dur: +e.dur.toFixed(2), bpm: Math.round(e.bpm) })) : null,
    };
    journal.add(rec);
    if (hooks && hooks.discover) hooks.discover(u, rec);
  }

  // After time passed unseen (catch-up), each species follows its own descendants (lineage is inherited),
  // so off-screen evolution shows up as species changing, not as a crowd of strangers.
  function rebase(u) {
    if (!u.species) return;
    const len = u.scale.length;
    for (const sp of u.species) {
      if (sp.extinct) continue;
      const M = u.singers.filter((s) => !s.dying && s.sp === sp.id);
      if (!M.length) continue;
      const m = C.descriptor(M[0].g, len).map(() => 0);
      for (const s of M) { const d = C.descriptor(s.g, len); for (let i = 0; i < m.length; i++) m[i] += d[i] / M.length; }
      sp.centroid = m;
      sp.count = M.length;
    }
  }

  C.Observatory = {
    SCAN_S, rebase, record,
    // call every frame with the worlds that are alive; each is scanned every SCAN_S simulated seconds
    tick(worlds, hooks) {
      for (const u of worlds) {
        if (!u || !u.singers) continue;
        u._obsT = (u._obsT || 0);
        if (u.time - u._obsT < SCAN_S) continue;
        u._obsT = u.time;
        scan(u, hooks);
      }
    },
    scan, novelty, nameFor,
  };
})();
