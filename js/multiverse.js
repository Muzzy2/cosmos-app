'use strict';
// COSMOS 4 memory: every world you have been to is remembered on this device, and keeps living (in a
// cheaper, abstract form) while you are elsewhere.
//
//   index    localStorage (small, synchronous): which worlds exist and what kind each one is, so a world
//            comes back the same kind of world after a reload; plus a one-line summary of who lives there.
//   records  IndexedDB 'worlds' (larger, async): the population (every genome), the light field, pulsars,
//            the doors you drew, its species and its history, and creatures waiting to arrive.
//   catch-up When you come back, the time you were away is replayed by C.Eco: the same trait economics as
//            the live world (genome.js), in 30-second slices, bounded (at most 80 slices, ~40 simulated
//            minutes however long you were gone) and seeded from the world and the visit, so a given saved
//            state plus a given absence always produces the same result.
//   migrants Creatures that slip into an orb are delivered live if that world is awake, otherwise written
//            into its record and they arrive on your next visit.
// Records carry a version (v) and are validated on load; a damaged record is dropped, never fatal.
(function () {
  const C = window.COSMOS;
  const V = 1, KEY = 'mv';
  const MAX_SINGERS = 140; // the breeding limit (catch-up births)
  const SAVE_MAX = 220; // everything the live engine can hold is saved (immigration and rifts can pass 140)
  const MAX_SUMMARIES = 400, MAX_LINEAGES = 300;
  let index = C.storage.get(KEY, null);
  if (!index || index.v !== V || typeof index.worlds !== 'object') index = { v: V, worlds: {}, created: Date.now() };
  let frozen = false; // set while forgetting: nothing still alive in memory may write itself back
  // The index is small by construction (bounded below); if the browser still refuses it, shrink and retry.
  function saveIndex() {
    if (frozen) return;
    for (let k = 0; k < 3; k++) {
      try { localStorage.setItem('cosmos.' + KEY, JSON.stringify(index)); return; } catch (e) { boundIndex(Math.floor(MAX_SUMMARIES / (2 << k))); }
    }
  }
  // keep every world that has a full record (and the origin), then the most recently seen summaries
  function boundIndex(maxSummaries) {
    const ws = Object.entries(index.worlds);
    if (ws.length > maxSummaries) {
      const keep = new Set(ws.filter(([s, w]) => w.rec || w.waiting || +s === 1).map(([s]) => s));
      const rest = ws.filter(([s]) => !keep.has(s)).sort((a, b) => (b[1].last || 0) - (a[1].last || 0));
      for (const [s] of rest.slice(Math.max(0, maxSummaries - keep.size))) delete index.worlds[s];
    }
    const ls = Object.entries(index.lineages || {});
    if (ls.length > MAX_LINEAGES) for (const [k] of ls.slice(0, ls.length - MAX_LINEAGES)) delete index.lineages[k];
  }

  // Every read-modify-write of a world record goes through one queue, so two writers (a save and an
  // arriving migrant, or a wake and a save) can never interleave and lose each other's changes.
  let queue = Promise.resolve();
  const serial = (fn) => { const p = queue.then(() => (frozen ? null : fn())); queue = p.catch(() => {}); return p; };

  C.now = () => Date.now();
  // world.js asks this before inventing a world: a remembered world keeps its kind, look and visitor
  C.mvDef = (seed) => { const w = index.worlds[seed]; return w && w.def ? w.def : null; };

  function remember(world, extra) {
    if (frozen) return null;
    const e = index.worlds[world.seed] || (index.worlds[world.seed] = { visits: 0 });
    e.def = { genus: world.genus, style: world.style, visitor: world.visitor };
    e.name = world.name;
    Object.assign(e, extra || {});
    if (Object.keys(index.worlds).length > MAX_SUMMARIES) boundIndex(MAX_SUMMARIES);
    saveIndex();
    return e;
  }

  // ------------------------------------------------------------------ saving
  function compactSinger(s) {
    return { x: +s.x.toFixed(2), y: +s.y.toFixed(2), g: s.g, energy: +s.energy.toFixed(3), age: +s.age.toFixed(1), life: +s.life.toFixed(1), sp: s.sp || 0, gen: s.gen || 0, home: s.home, lin: s.lin, foreign: s.foreign || null, fcol: s.fcol || null, hyb: !!s.hyb };
  }
  function recordOf(u) {
    const singers = u.singers.filter((s) => !s.dying && !s.leviathan).slice(0, SAVE_MAX).map(compactSinger);
    return {
      id: u.world.seed, v: V, savedAt: C.now(), simTime: u.time, root: u.root, scaleName: u.scaleName, scale: u.scale.slice(),
      nut: u.nut.slice(), singers,
      stars: u.stars.map((st) => ({ x: st.x, y: st.y, mass: st.mass, age: st.age, life: st.life, degree: st.degree, beat: st.beat, offset: st.offset })),
      userOrbs: u.orbs.filter((o) => o.user && !o.dying).map((o) => ({ x: o.x, y: o.y, seed: o.seed, r: o.r })),
      // working fields (prefixed _) stay in memory
      species: u.species ? u.species.map((sp) => Object.assign(Object.fromEntries(Object.entries(sp).filter(([k]) => k[0] !== '_')), { centroid: sp.centroid.slice(), origin: sp.origin ? sp.origin.slice() : sp.centroid.slice() })) : [],
      log: u.log.slice(-80), arrivals: [], stats: Object.assign({}, u.stats), visits: (index.worlds[u.world.seed] || {}).visits || 0,
    };
  }
  // write a world's whole state; `keepArrivals` keeps migrants that arrived in the stored record meanwhile
  async function write(u, keepArrivals) {
    const rec = recordOf(u);
    if (keepArrivals) {
      const old = await C.db.get('worlds', rec.id).catch(() => null);
      if (old && old.arrivals && old.arrivals.length) rec.arrivals = old.arrivals;
    }
    if (frozen) return false;
    await C.db.put('worlds', rec);
    remember(u.world, { last: rec.savedAt, pop: rec.singers.length, top: topSpecies(u), lins: lineageCounts(u), rec: true, waiting: rec.arrivals.length || 0 });
    if (++saves % 25 === 0) prune();
    return true;
  }
  function save(u) {
    if (!u || !u.world || u.restoring || frozen) return Promise.resolve(false);
    return serial(() => write(u, true)).catch(() => false);
  }
  // At most MAX_RECORDS full memories (~30-60 KB each); the least recently visited are slimmed to their
  // one-line summary and their kind (they come back as the same world, freshly populated).
  const MAX_RECORDS = 150;
  let saves = 0;
  function prune() {
    const full = Object.entries(index.worlds).filter(([, w]) => w.rec).sort((a, b) => (a[1].last || 0) - (b[1].last || 0));
    for (const [seed, w] of full.slice(0, Math.max(0, full.length - MAX_RECORDS))) {
      if (+seed === 1) continue; // the origin is always remembered
      w.rec = false;
      w.waiting = 0;
      C.db.del('worlds', +seed).catch(() => {});
    }
    saveIndex();
  }
  // which families live here, and how many of each (for following lineages across worlds)
  function lineageCounts(u) {
    const m = {};
    for (const s of u.singers) if (!s.dying && s.lin) m[s.lin] = (m[s.lin] || 0) + 1;
    return Object.fromEntries(Object.entries(m).sort((a, b) => b[1] - a[1]).slice(0, 8));
  }
  // the lineage register: a family's name (its founding species) and its home world
  function nameLineage(lin, name, home, homeName) {
    index.lineages = index.lineages || {};
    if (index.lineages[lin]) return;
    index.lineages[lin] = { name, home, homeName };
    boundIndex(MAX_SUMMARIES);
    saveIndex();
  }
  // every world a lineage lives in (at least 5 members), from the summaries of every remembered world
  function spread(lin) {
    const out = [];
    for (const k in index.worlds) { const w = index.worlds[k]; if (w.lins && w.lins[lin] >= 5) out.push({ seed: +k, name: w.name, n: w.lins[lin] }); }
    return out;
  }
  function topSpecies(u) {
    if (!u.species) return [];
    return u.species.filter((s) => !s.extinct && s.count > 0).sort((a, b) => b.count - a.count).slice(0, 3).map((s) => ({ id: s.id, name: s.name, n: s.count }));
  }

  // ------------------------------------------------------------------ restoring
  // A record is checked all the way down before anything in the world is touched; bad entries are dropped.
  const fin = (x) => typeof x === 'number' && isFinite(x);
  // musical genes (cult, tone) that are missing or damaged are dropped and refilled from the world's culture
  const goodArr = (a, n) => Array.isArray(a) && a.length === n && a.every((x) => fin(x) && x >= 0 && x <= 1);
  function goodGenome(g) {
    const ok = g && typeof g === 'object' && Array.isArray(g.degrees) && g.degrees.length >= 1 && g.degrees.length <= 3 && g.degrees.every(fin) &&
      ['timbre', 'lobes', 'rhythm', 'speed', 'social', 'spike'].every((k) => fin(g[k])) && (g.motif == null || (Array.isArray(g.motif) && g.motif.length === 4 && g.motif.every(fin)));
    if (ok && g.cult != null && !goodArr(g.cult, C.CULTURE_KEYS ? C.CULTURE_KEYS.length : 8)) delete g.cult;
    if (ok && g.tone != null && !goodArr(g.tone, C.TONE_KEYS ? C.TONE_KEYS.length : 4)) delete g.tone;
    return ok;
  }
  const goodSinger = (m) => m && fin(m.x) && fin(m.y) && fin(m.energy) && goodGenome(m.g);
  const goodSpecies = (sp) => sp && typeof sp.id === 'string' && Array.isArray(sp.centroid) && sp.centroid.length === 13 && sp.centroid.every(fin);
  function valid(rec) {
    return !!(rec && rec.v === V && Array.isArray(rec.singers) && rec.nut && rec.nut.length === 4096);
  }
  // exact: put the world back as it was at that moment (relive), not merely restock it
  function restore(u, rec, exact) {
    const singers = rec.singers.filter(goodSinger), species = (rec.species || []).filter(goodSpecies);
    const nut = Float32Array.from(rec.nut, (x) => (fin(x) ? x : 0));
    u.singers = [];
    if (rec.scale && rec.scale.length && rec.scale.every(fin)) { u.scale = rec.scale.slice(); u.root = rec.root; u.scaleName = rec.scaleName; }
    u.nut.set(nut);
    for (const m of singers) {
      const s = u.spawnSinger(m.x, m.y, m.g, { energy: m.energy, sp: m.sp, gen: m.gen, home: m.home, lin: m.lin });
      if (!s) break;
      s.age = fin(m.age) ? m.age : 0; s.life = fin(m.life) ? m.life : 200; s.born = 1; s.hyb = !!m.hyb;
      if (m.foreign) { s.foreign = m.foreign; s.fcol = m.fcol; u._look(s); }
    }
    u.stars = [];
    for (const st of rec.stars || []) {
      if (!st || !fin(st.x) || !fin(st.y) || !fin(st.mass)) continue;
      const x = u.makeStar(st.x, st.y, st.mass);
      Object.assign(x, { age: st.age, life: st.life, degree: st.degree, beat: st.beat, offset: st.offset, born: 1 });
    }
    const userOrbs = (rec.userOrbs || []).filter((o) => o && fin(o.x) && fin(o.y) && fin(o.r));
    if (exact) u.orbs = u.orbs.filter((o) => !o.user || userOrbs.some((x) => x.seed === o.seed));
    for (const o of userOrbs) if (!u.orbs.some((x) => x.seed === o.seed)) u.orbs.push(u._makeOrb(o.x, o.y, o.seed, o.r, { born: 1, user: true }));
    u.species = species.map((sp) => Object.assign({}, sp, { centroid: sp.centroid.slice(), origin: (sp.origin && sp.origin.length === 13 ? sp.origin : sp.centroid).slice() }));
    u.log = Array.isArray(rec.log) ? rec.log.slice() : [];
    if (rec.stats) Object.assign(u.stats, rec.stats);
    if (exact) {
      u.time = fin(rec.simTime) ? rec.simTime : u.time;
      u.spawnQueue = []; u.pending = []; u.emigrants = []; u.serpents = []; u.rift = null;
      u._obsT = -1e9; u.obs = null;
    } else u.time = Math.max(u.time, fin(rec.simTime) ? rec.simTime : 0);
  }

  // Bring a world back: its saved state, then the time you were away, then anyone who arrived meanwhile,
  // and save the result at once (so the newcomers and the catch-up are never lost to an early close).
  function wakeWorld(u) {
    return serial(async () => {
      const seed = u.world.seed;
      let rec = null;
      try { rec = await C.db.get('worlds', seed); } catch (e) {}
      const e = index.worlds[seed];
      if (e) { e.visits = (e.visits || 0) + 1; saveIndex(); }
      if (!rec) return null;
      const report = { away: 0, arrived: 0 };
      if (valid(rec)) {
        restore(u, rec);
        const away = C.now() - rec.savedAt;
        report.away = away;
        if (away > 20000 && u.singers.length) {
          report.eco = C.Eco.advance(u, away, rec.savedAt, C.hash(seed, (e && e.visits) || 0));
          if (C.Observatory) C.Observatory.rebase(u);
        }
      }
      const arr = (rec.arrivals || []).filter((m) => m && goodGenome(m.g));
      if (arr.length) { report.arrived = u.immigrate(arr, 0, 0); report.from = arr[0].from; }
      u.lastWall = C.now();
      if (valid(rec) || arr.length) await write(u, false); // arrivals consumed in the same write that keeps them
      return report;
    });
  }

  // A migrant for a world that isn't awake: it waits in that world's record.
  function addArrival(seed, m, world) {
    return serial(async () => {
      const rec = (await C.db.get('worlds', seed)) || { id: seed, v: V, arrivals: [] };
      rec.arrivals = (rec.arrivals || []).concat([m]).slice(-40);
      if (frozen) return;
      await C.db.put('worlds', rec);
      if (world) remember(world, { waiting: rec.arrivals.length });
    }).catch(() => {});
  }

  // Forget everything: stop every writer, let anything already in flight finish (it now writes nothing),
  // then clear. The caller reloads the app.
  async function forgetAll() {
    const drain = queue;
    frozen = true;
    try { await drain; } catch (e) {}
    try { localStorage.setItem('cosmos.' + KEY, JSON.stringify({ v: V, worlds: {}, created: Date.now() })); } catch (e) {}
    index = { v: V, worlds: {}, created: Date.now() };
    try { await C.db.clear('worlds'); await C.db.clear('journal'); } catch (e) {}
  }

  C.multiverse = {
    get index() { return index; }, has: (seed) => !!(index.worlds[seed] && index.worlds[seed].rec) || !!(index.worlds[seed] && index.worlds[seed].waiting),
    remember, save, wakeWorld, addArrival, forgetAll, recordOf, restore, valid, nameLineage, spread, lineageCounts, saveIndex,
    get lineages() { return index.lineages || {}; }, get frozen() { return frozen; },
  };

  // ==================================================================== the abstract ecology (catch-up)
  // Space is averaged away; everything else follows the live rules: the same costs per trait, the same
  // mate choice (consonance, matching song, same way of life), the same mutation.
  const SLICE = 30;
  C.Eco = {
    simSecondsFor(awayMs) {
      const s = awayMs / 1000;
      return Math.min(2400, s < 600 ? s : 600 + 400 * Math.log(1 + (s - 600) / 600));
    },
    advance(u, awayMs, fromWall, seed) {
      const realRandom = Math.random;
      const R = C.rng(seed >>> 0);
      Math.random = R; // deterministic: the same saved state and absence always give the same result
      const out = { slices: 0, born: 0, died: 0, eaten: 0, simSeconds: 0 };
      try {
        const sim = this.simSecondsFor(awayMs), n = Math.min(80, Math.floor(sim / SLICE));
        out.simSeconds = n * SLICE;
        const before = traitMeans(u);
        for (let k = 0; k < n; k++) {
          const env = C.envOf(u.world, fromWall + ((k + 0.5) / n) * awayMs);
          slice(u, env, out);
          out.slices++;
          if (!u.singers.length) break;
        }
        out.before = before;
        out.after = traitMeans(u);
        u.time += out.simSeconds;
      } finally {
        Math.random = realRandom;
      }
      return out;
    },
  };
  function traitMeans(u) {
    const L = u.singers.filter((s) => !s.dying);
    const m = (k) => (L.length ? L.reduce((a, s) => a + s.g[k], 0) / L.length : 0);
    return { n: L.length, climate: +m('climate').toFixed(3), diet: +m('diet').toFixed(3), hunters: L.filter((s) => C.isHunter(s.g)).length };
  }
  function slice(u, env, out) {
    const S = u.singers.filter((s) => !s.dying);
    // the light this world grows per second, and how well a crowd can find it (calibrated against the
    // live world in tests/evo/catchup.js)
    let base = 0;
    for (let i = 0; i < u.nutBase.length; i++) base += u.nutBase[i];
    const supply = u.regen * base * 1.6 * 1.0;
    const prey = S.filter((s) => !C.isHunter(s.g)), hunters = S.filter((s) => C.isHunter(s.g));
    let wsum = 0;
    for (const s of prey) wsum += s.size * C.grazeEff(s.g);
    for (const s of hunters) wsum += s.size * C.grazeEff(s.g);
    const beat = 60 / (u.world.bpm || 82);
    for (const s of S) {
      const share = wsum > 0 ? (supply * s.size * C.grazeEff(s.g)) / wsum : 0;
      const pulses = 1 / (s.g.rhythm * beat);
      let net = share - (0.026 + 0.04 * s.size) - pulses * C.pulseCost(s.g) + C.climateCost(s.g, env.warmth, u.ctl.climate);
      s.energy += net * SLICE;
      s.age += SLICE;
    }
    // hunting: each hunter tries a few strikes on smaller prey with a different song
    for (const h of hunters) {
      for (let t = 0; t < 3; t++) {
        const p = prey[Math.floor(Math.random() * prey.length)];
        if (!p || p.dead || p.size > h.size * 1.5 || C.motifSim(h.g.motif, p.g.motif) >= 0.8) continue;
        if (Math.random() < C.strikeOdds(h.g, p.g) * 0.5) { h.energy += Math.min(1.6, Math.max(0, p.energy) * 0.7 + 0.4 * p.size); p.dead = true; out.eaten++; }
      }
    }
    for (const s of S) if (!s.dead && (s.energy <= 0 || s.age > s.life)) s.dead = true;
    const alive = S.filter((s) => !s.dead);
    out.died += S.length - alive.length;
    // births: compatible pairs with energy to spare, as in the live world
    const kids = [];
    const room = () => alive.length + kids.length < MAX_SINGERS;
    for (const a of alive) {
      if (!room()) break;
      if (a.energy > 1.55 && a.age > 12) {
        let mate = null;
        for (let t = 0; t < 6 && !mate; t++) {
          const b = alive[Math.floor(Math.random() * alive.length)];
          if (b === a || b.energy <= 1.55) continue;
          const cons = C.CONSONANCE[(((b.pcs[0] - a.pcs[0]) % 12) + 12) % 12];
          if (cons > 0.45 && C.isHunter(a.g) === C.isHunter(b.g) && (!u.ctl.mate || C.motifSim(a.g.motif, b.g.motif) > 0.62)) mate = b;
        }
        if (mate) {
          let g = { degrees: (Math.random() < 0.5 ? a : mate).g.degrees.slice() };
          for (const k of C.GENE_KEYS) g[k] = (Math.random() < 0.5 ? a : mate).g[k];
          g.motif = (Math.random() < 0.5 ? a : mate).g.motif.slice();
          if (C.recombine) { g.cult = C.recombine(a.g.cult, mate.g.cult, Math.random); g.tone = C.recombine(a.g.tone, mate.g.tone, Math.random); }
          kids.push({ g: u._mutate(g, null, 1), a, b: mate });
          a.energy -= 0.55; mate.energy -= 0.55;
        } else if (a.energy > 2.7) {
          kids.push({ g: u._mutate(a.g, null, 1), a, b: null });
          a.energy *= 0.5;
        }
      }
    }
    u.singers = u.singers.filter((s) => !s.dead && !s.dying);
    for (const k of kids) {
      const c = u.spawnSinger(k.a.x + C.gauss(Math.random) * 0.8, k.a.y + C.gauss(Math.random) * 0.8, k.g, { energy: 1.0, sp: k.a.sp, gen: Math.max(k.a.gen, k.b ? k.b.gen : 0) + 1, home: k.a.home, lin: k.a.lin });
      if (c) {
        c.born = 1; c.age = Math.random() * SLICE;
        if (k.a.fcol && (!k.b || k.b.fcol)) { c.fcol = k.a.fcol; c.foreign = k.a.foreign; u._look(c); }
        // the same ancestry rules as the live world: newcomer × native (or a hybrid's child) is a hybrid
        if (k.b ? (!!k.a.foreign !== !!k.b.foreign || k.a.hyb || k.b.hyb) : k.a.hyb) c.hyb = true;
        out.born++;
      }
    }
  }
})();
