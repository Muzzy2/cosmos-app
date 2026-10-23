'use strict';
// Musical culture: every world has one, and its creatures carry it.
//
// A world's culture is a set of continuous genes (0..1): how strict its pulse is, which meter it counts
// in, how its layers cycle against each other, how rich its chords are and how they are stacked, how dense
// and swung its rhythm is, how much space it leaves. They are drawn from the world's seed, leaning toward
// its medium (an orrery keeps clockwork polymeters; a resonance plate barely has a pulse), so two worlds of
// one kind are cousins, not twins.
//
// The heritable part (CULTURE_KEYS) lives in every singer as its `cult` gene, and its instrument lives in
// its `tone` gene (TONE_KEYS). Founders are born into their world's culture; children inherit it from
// their parents with small copying errors; migrants carry their home's culture into the worlds they
// reach. So the music a world plays is what its population carries: a wave of newcomers in seven can
// tip a four-four world into seven, and a mixed population plays both meters at once (a polymeter born of
// two cultures living together). The non-heritable part follows the population's other traits: hunters
// bring tension, solitary creatures independent lines (counterpoint), frequent pulses denser rhythm.
(function () {
  const C = window.COSMOS;

  C.CULTURE_KEYS = ['meter', 'pulse', 'poly', 'color', 'quartal', 'density', 'swing', 'space'];
  C.TONE_KEYS = ['bright', 'metal', 'attack', 'body'];

  // meters, from the most familiar to the least; `g` groups the bar's sixteenths into beats of 2 or 3 eighths
  C.METERS = [
    { n: 16, g: [4, 4, 4, 4], name: '4/4' },
    { n: 12, g: [6, 6], name: '6/8' },
    { n: 12, g: [4, 4, 4], name: '3/4' },
    { n: 20, g: [4, 4, 4, 4, 4], name: '5/4' },
    { n: 14, g: [4, 4, 6], name: '7/8' },
    { n: 24, g: [6, 6, 6, 6], name: '12/8' },
    { n: 18, g: [4, 4, 4, 6], name: '9/8' },
    { n: 10, g: [6, 4], name: '5/8' },
    { n: 22, g: [4, 4, 4, 4, 6], name: '11/8' },
  ];
  // the familiar meters take most of the gene's range, the rarer ones less
  const METER_AT = [0.36, 0.47, 0.55, 0.63, 0.71, 0.79, 0.86, 0.93, 1.01];
  C.meterOf = (gene) => C.METERS[Math.max(0, METER_AT.findIndex((x) => gene < x))];
  C.meterGene = (name) => { const i = C.METERS.findIndex((m) => m.name === name); return i < 0 ? 0.2 : i === 0 ? 0.2 : (METER_AT[i - 1] + METER_AT[i]) / 2; };

  // Each medium's tendencies (gene means). Anything not named sits at 0.5. `spread` is how far worlds of
  // this kind wander from it. form weights: arc (sections that build and break down), rondo (a refrain
  // between contrasting episodes), waves (long swells and ebbs), process (patterns that grow, phase and
  // thin out), drift (barely changing, long held colour), call (a line and its answers).
  const PRIOR = {
    tide:      { pulse: 0.5, meter: 0.2, density: 0.35, color: 0.5, space: 0.8, silence: 0.45, drone: 0.4, form: { waves: 2, drift: 1, arc: 1 } },
    mycelium:  { pulse: 0.8, meter: 0.6, poly: 0.65, density: 0.55, counter: 0.5, hocket: 0.6, form: { process: 2, rondo: 1, arc: 1 } },
    orrery:    { pulse: 0.95, meter: 0.6, poly: 0.6, canon: 0.6, density: 0.45, silence: 0.35, form: { arc: 2, process: 1 } },
    skin:      { pulse: 0.55, meter: 0.45, swing: 0.5, color: 0.68, counter: 0.45, tension: 0.5, density: 0.38, form: { arc: 2, call: 1, rondo: 1 } },
    resonance: { pulse: 0.12, quartal: 0.6, drone: 0.9, density: 0.2, silence: 0.6, space: 0.85, form: { drift: 2, waves: 1 } },
    attractor: { pulse: 0.7, meter: 0.62, poly: 0.55, color: 0.6, form: { waves: 2, process: 1, arc: 1 } },
    flame:     { pulse: 0.62, density: 0.5, tension: 0.55, form: { arc: 2, waves: 1 } },
    plife:     { pulse: 0.82, meter: 0.68, poly: 0.55, hocket: 0.7, density: 0.6, form: { process: 2, rondo: 1 } },
    murmur:    { pulse: 0.3, counter: 0.8, canon: 0.5, density: 0.4, space: 0.7, form: { waves: 2, call: 1 } },
    fluid:     { pulse: 0.5, swing: 0.45, color: 0.7, form: { drift: 1, waves: 1, rondo: 1 } },
    ripple:    { pulse: 0.6, meter: 0.72, poly: 0.75, canon: 0.55, density: 0.4, form: { process: 2, waves: 1 } },
    scope:     { pulse: 0.2, drone: 0.85, quartal: 0.55, density: 0.15, silence: 0.55, form: { drift: 2 } },
    blackhole: { pulse: 0.4, tension: 0.75, color: 0.6, drone: 0.7, space: 0.9, form: { waves: 2, arc: 1 } },
    julia:     { pulse: 0.45, meter: 0.85, quartal: 0.7, canon: 0.75, color: 0.5, form: { drift: 1, process: 1, call: 1 } },
    tunnel:    { pulse: 1, meter: 0.1, density: 0.9, swing: 0.2, form: { arc: 4, process: 1 } },
    cathedral: { pulse: 0.35, counter: 0.9, canon: 0.65, drone: 0.6, hr: 0.8, space: 0.95, color: 0.45, density: 0.3, hocket: 0.3, form: { waves: 2, arc: 1, call: 1 } },
    life:      { pulse: 1, meter: 0.3, density: 0.7, hocket: 0.6, form: { process: 2, arc: 1 } },
    lenia:     { pulse: 0.5, density: 0.4, color: 0.6, form: { waves: 2, drift: 1 } },
    storm:     { pulse: 0.78, meter: 0.7, tension: 0.8, density: 0.7, poly: 0.4, color: 0.3, quartal: 0.6, drone: 0.6, form: { arc: 2, waves: 1 } },
  };
  // where a gene sits when a medium has no tendency (rarer colours start lower)
  const DEFAULT = { meter: 0.32, quartal: 0.38, tension: 0.42 };
  const WORLD_KEYS = ['counter', 'canon', 'drone', 'hocket', 'tension', 'silence', 'hr', 'leap', 'ornament', 'register', 'synth', 'modal', 'grain'];

  // The culture a world was founded with (deterministic from its seed; never changes).
  const baseCache = new Map();
  // The First Tide is where everyone begins: its culture is chosen, not drawn (as its world is, in world.js):
  // COSMOS 4's sound, warmer chords, long swells, a little canon and suspension. Everything else is found.
  const ORIGIN = { meter: 0.2, pulse: 0.55, poly: 0.3, color: 0.62, quartal: 0.15, density: 0.36, swing: 0.3, space: 0.85,
    counter: 0.45, canon: 0.5, drone: 0.45, hocket: 0.4, tension: 0.5, silence: 0.4, hr: 0.5, leap: 0.5, ornament: 0.5, register: 0.5, synth: 0.6, modal: 0.5, grain: 0.55,
    formW: { waves: 2, arc: 1 }, tone: [0.55, 0.4, 0.6, 0.45], origin: true };
  C.cultureBase = function (seed, genus) {
    const key = seed + '|' + genus;
    if (baseCache.has(key)) return baseCache.get(key);
    if (seed === 1 && genus === 'tide') { baseCache.set(key, ORIGIN); return ORIGIN; }
    const P = PRIOR[genus] || PRIOR.tide, r = C.rng(C.hash(seed, 'culture', genus));
    const spread = 0.28, b = {};
    const draw = (k) => C.clamp((P[k] == null ? (DEFAULT[k] == null ? 0.5 : DEFAULT[k]) : P[k]) + C.gauss(r) * spread * 0.6, 0, 1);
    for (const k of C.CULTURE_KEYS) b[k] = draw(k);
    for (const k of WORLD_KEYS) b[k] = draw(k);
    // meters: most worlds of a medium share its usual meter, a third wander far from it
    if (r() < 0.33) b.meter = r();
    // a strict pulse keeps its grooves; a loose one barely has any
    const fw = Object.assign({}, P.form || { arc: 1 });
    for (const f in fw) fw[f] *= 0.6 + r() * 0.8;
    b.formW = fw;
    b.tone = C.TONE_KEYS.map(() => r());
    baseCache.set(key, b);
    return b;
  };

  // A founder's cultural genes: its world's, with the small differences any population has.
  C.cultForFounder = function (base, r) {
    r = r || Math.random;
    const c = C.CULTURE_KEYS.map((k) => C.clamp(base[k] + (r() - 0.5) * 0.08, 0, 1));
    c[0] = C.meterGene(C.meterOf(base.meter).name);
    return c;
  };
  // A founding species' culture: its world's, with its own accent; now and then a species counts in a
  // meter of its own, so two founding peoples can already be heard against each other (deterministic).
  C.cultForSpecies = function (seed, genus, sp) {
    const base = C.cultureBase(seed, genus), r = C.rng(C.hash(seed, 'cult', sp.degree, sp.timbre, sp.lobes));
    const c = C.CULTURE_KEYS.map((k) => C.clamp(base[k] + C.gauss(r) * 0.07, 0, 1));
    c[0] = C.meterGene(C.meterOf(r() < 0.22 && !base.origin ? r() : base.meter).name);
    return c;
  };
  // A species' instrument: the world's founding tone with this species' own twist (deterministic).
  C.toneForSpecies = function (seed, genus, sp) {
    const base = C.cultureBase(seed, genus).tone;
    const r = C.rng(C.hash(seed, 'tone', sp.degree, sp.timbre, sp.lobes));
    return C.TONE_KEYS.map((k, i) => C.clamp(base[i] + (r() - 0.5) * 0.5, 0, 1));
  };
  // Copying errors: the continuous genes drift a little; the meter is learned faithfully (it is a category,
  // not a quantity), except for a rare innovation that counts in another meter altogether.
  C.mutateCulture = function (n, r, rate) {
    if (n.cult) n.cult = n.cult.map((x, i) => (i === 0 ? (r() < 0.002 * rate ? C.meterGene(C.METERS[Math.floor(r() * C.METERS.length)].name) : x) : r() < 0.3 * rate ? C.clamp(x + (r() + r() - 1) * 0.06 * rate, 0, 1) : x));
    if (n.tone) n.tone = n.tone.map((x) => (r() < 0.3 * rate ? C.clamp(x + (r() + r() - 1) * 0.07 * rate, 0, 1) : x));
  };
  // Does a creature sing with its own instrument? Natives sing with their world's tuned band (its timbre gene
  // picks soft, middle or edgy). A lineage whose instrument genes have evolved far from its world's founding
  // tone, or a newcomer from elsewhere, sings with the instrument its genes describe; so does everyone in a
  // culture that makes its own instruments (synth gene). New instruments are heard as evolution and migration.
  C.ownVoice = function (tone, base) {
    if (!tone || !base || !base.tone) return false;
    if (base.synth > 0.72) return true;
    let d = 0;
    for (let i = 0; i < tone.length; i++) d += (tone[i] - base.tone[i]) * (tone[i] - base.tone[i]);
    return Math.sqrt(d) > 0.42;
  };
  // a child takes each cultural gene from one parent or the other: hybrids recombine two cultures
  C.recombine = (a, b, r) => (a && b && a.length === b.length ? a.map((x, i) => (r() < 0.5 ? x : b[i])) : (a || b || null) && (a || b).slice());

  // ------------------------------------------------------------------ what the population carries
  // Means of the heritable genes, the meters people actually count in (a population may hold two), and
  // the traits that colour the music without being musical genes themselves.
  function summary(u) {
    const S = (u.singers || []).filter((s) => s && s.g && !s.dying && s.g.cult && s.g.cult.length === C.CULTURE_KEYS.length);
    const n = S.length;
    if (n < 6) return null;
    const mean = C.CULTURE_KEYS.map(() => 0), tone = C.TONE_KEYS.map(() => 0);
    const meters = new Map();
    let rhythm = 0, social = 0, hunters = 0, climate = 0, spike = 0, foreign = 0, hyb = 0;
    for (const s of S) {
      s.g.cult.forEach((x, i) => (mean[i] += x / n));
      if (s.g.tone) s.g.tone.forEach((x, i) => (tone[i] += x / n));
      const m = C.meterOf(s.g.cult[0]).name;
      meters.set(m, (meters.get(m) || 0) + 1);
      rhythm += s.g.rhythm / n; social += s.g.social / n; climate += s.g.climate / n; spike += s.g.spike / n;
      if (C.isHunter(s.g)) hunters++;
      if (s.foreign) foreign++;
      if (s.hyb) hyb++;
    }
    const ranked = [...meters.entries()].sort((a, b) => b[1] - a[1]);
    const species = (u.species || []).filter((sp) => !sp.extinct).length;
    return { n, mean, tone, meters: ranked.map(([name, c]) => ({ name, share: c / n })), rhythm, social, hunterShare: hunters / n, climate, spike, foreignShare: foreign / n, hybShare: hyb / n, species };
  }
  C.cultureSummary = summary;

  // ------------------------------------------------------------------ the style the composer plays
  // base culture, pulled toward what the living population carries (the more of them, the stronger)
  C.musicStyle = function (u) {
    const genus = u.genus || 'tide', seed = (u.world && u.world.seed) || 1;
    const b = C.cultureBase(seed, genus), st = Object.assign({}, b);
    st.genus = genus;
    const pop = summary(u);
    st.pop = pop;
    if (pop) {
      const w = C.clamp(pop.n / 24, 0, 1);
      C.CULTURE_KEYS.forEach((k, i) => (st[k] = C.lerp(b[k], pop.mean[i], w)));
      // the meter people count in is the one most of them carry, not an average of meters
      if (w > 0.5) st.meter = C.meterGene(pop.meters[0].name);
      // a second culture big enough to be heard plays in its own meter against the first
      // (it appears at 22% and fades below 15%, so a culture on the edge doesn't flicker in and out)
      const second = pop.meters[1], need = second && u._musicSecond === second.name ? 0.15 : 0.22;
      st.second = second && second.share >= need && w > 0.5 ? C.METERS.find((m) => m.name === second.name) : null;
      u._musicSecond = st.second ? st.second.name : null;
      // traits that aren't musical genes still colour the music
      st.density = C.clamp(C.lerp(st.density, 1 - (pop.rhythm - 2) / 6, 0.35 * w), 0, 1);
      st.counter = C.clamp(C.lerp(st.counter, 1 - pop.social, 0.4 * w), 0, 1);
      st.tension = C.clamp(st.tension + pop.hunterShare * 0.5 * w, 0, 1);
      st.bright = C.clamp(0.35 + 0.5 * pop.tone[0] * w + 0.3 * (pop.climate - 0.5), 0, 1);
      st.attack = C.lerp(0.5, pop.tone[2], w);
      st.voices = C.clamp(pop.species, 1, 6);
      st.blend = pop.hybShare + pop.foreignShare;
    } else {
      st.second = null;
      st.bright = 0.35 + 0.4 * b.tone[0];
      st.attack = b.tone[2];
      st.voices = 2;
      st.blend = 0;
    }
    st.meterObj = C.meterOf(st.meter);
    return st;
  };

  // ------------------------------------------------------------------ the music, in a few words
  const FORM_WORDS = { arc: 'rises and falls', rondo: 'returns to its refrain', waves: 'swells like a tide', process: 'grows by process', drift: 'barely moves', call: 'calls and answers' };
  C.styleWords = function (st, plan) {
    const w = [];
    if (st.pulse < 0.22) w.push('free time');
    else w.push(st.meterObj.name + (st.second ? ' against ' + st.second.name : ''));
    if (plan) {
      w.push(plan.harmonyName);
      if (plan.texture.length) w.push(plan.texture.slice(0, 2).join(', '));
    }
    return w.join(' · ');
  };
  C.FORM_WORDS = FORM_WORDS;
})();
