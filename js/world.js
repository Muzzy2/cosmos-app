'use strict';
// World genesis: every world is a seed -> name, palette, scale, tempo, physical law, founding species.
(function () {
  const C = window.COSMOS;

  C.SCALES = {
    'major pentatonic': [0, 2, 4, 7, 9],
    'minor pentatonic': [0, 3, 5, 7, 10],
    dorian: [0, 2, 3, 5, 7, 9, 10],
    lydian: [0, 2, 4, 6, 7, 9, 11],
    aeolian: [0, 2, 3, 5, 7, 8, 10],
    ionian: [0, 2, 4, 5, 7, 9, 11],
    mixolydian: [0, 2, 4, 5, 7, 9, 10],
    hirajoshi: [0, 2, 3, 7, 8],
    'in-sen': [0, 1, 5, 7, 10],
    yo: [0, 2, 5, 7, 9],
    'whole-tone': [0, 2, 4, 6, 8, 10],
  };
  C.isMinorScale = (s) => s.includes(3) && !s.includes(4);

  // Physical laws. curl = tide strength, central = galactic swirl, cym = Chladni (sound shapes dust),
  // sign = +1 wells attract / -1 repel, drag = how syrupy space is, k = flow feature scale.
  C.LAWS = {
    tide: { curl: 1.0, central: 0.25, cym: 0.0, sign: 1, drag: 1.3, k: 2, flow: 1.0 },
    galaxy: { curl: 0.35, central: 1.4, cym: 0.0, sign: 1, drag: 1.1, k: 3, flow: 0.8 },
    cymatic: { curl: 0.3, central: 0.0, cym: 1.0, sign: 1, drag: 2.2, k: 2, flow: 0.6 },
    storm: { curl: 2.1, central: 0.0, cym: 0.0, sign: 1, drag: 0.9, k: 3, flow: 1.6 },
    inverse: { curl: 0.8, central: 0.2, cym: 0.0, sign: -1, drag: 1.4, k: 2, flow: 0.9 },
    silk: { curl: 0.55, central: 0.1, cym: 0.15, sign: 1, drag: 3.0, k: 1, flow: 0.5 },
  };
  C.LAW_WORDS = {
    tide: 'law of tides',
    galaxy: 'law of the spiral',
    cymatic: 'law of resonance',
    storm: 'law of storms',
    inverse: 'law of repulsion',
    silk: 'law of silk',
  };

  const ADJ = ['Velvet', 'Hollow', 'Singing', 'Drowned', 'Amber', 'Glass', 'Silent', 'Burning', 'Tender', 'Electric',
    'Lunar', 'Feral', 'Opaline', 'Sunken', 'Gilded', 'Whispering', 'Ultraviolet', 'Saffron', 'Ninefold', 'Dreaming',
    'Molten', 'Cobalt', 'Quiet', 'Inverted', 'Weeping', 'Radiant', 'Folded', 'Eleventh'];
  const NOUN = ['Tide', 'Orchard', 'Choir', 'Abyss', 'Garden', 'Lattice', 'Bloom', 'Reef', 'Cathedral', 'Hive',
    'Meridian', 'Nursery', 'Archipelago', 'Spiral', 'Cradle', 'Engine', 'Delta', 'Veil', 'Expanse', 'Hymn',
    'Furnace', 'Lagoon', 'Aviary', 'Monastery', 'Mirror', 'Swarm'];

  const SCHEMES = {
    analog: [0, 0.08, -0.07, 0.15],
    comp: [0, 0.5, 0.06, 0.55],
    triad: [0, 0.333, 0.666, 0.1],
    split: [0, 0.42, 0.58, 0.05],
  };

  function makePalette(r, h0, scheme) {
    const o = SCHEMES[scheme];
    return {
      mid: C.hsl(h0 + o[0], 0.75 + r() * 0.2, 0.42 + r() * 0.1),
      hot: C.hsl(h0 + o[1], 0.9, 0.66 + r() * 0.08),
      accent: C.hsl(h0 + o[2], 0.95, 0.58),
      deep: C.hsl(h0 + o[3], 0.6, 0.035 + r() * 0.02),
    };
  }

  function makeSpecies(r, scaleLen, n) {
    const out = [];
    for (let i = 0; i < n; i++) {
      out.push({
        degree: Math.floor(r() * scaleLen * 2.4) - 1,
        timbre: r(),
        lobes: 3 + Math.floor(r() * 8),
        rhythm: [2, 3, 4, 4, 6, 8][Math.floor(r() * 6)],
        speed: 0.7 + r() * 0.7,
        social: 0.3 + r() * 0.7,
        spike: r(),
        count: 6 + Math.floor(r() * 10),
      });
    }
    return out;
  }

  // Genera: fundamentally different kinds of universe. Each has its own physics, life, sound and verbs.
  // Media: the physics a world is made of. Visitors: an unrelated life form living in it. Styles: how it looks.
  C.GENERA = ['tide', 'mycelium', 'orrery', 'skin', 'resonance', 'attractor', 'flame', 'plife', 'murmur', 'fluid', 'ripple', 'scope', 'blackhole', 'julia', 'tunnel', 'cathedral', 'life', 'storm', 'lenia'];
  C.GENUS_WORDS = {
    tide: 'a tide of singers',
    mycelium: 'a thinking mould',
    orrery: 'a clockwork of orbits',
    skin: 'living skin',
    resonance: 'a plate of singing sand',
    attractor: 'a strange attractor',
    flame: 'a fractal flame',
    plife: 'a soup of particle life',
    murmur: 'a murmuration',
    fluid: 'a living fluid',
    ripple: 'a ripple tank',
    scope: 'a world that draws its own sound',
    blackhole: 'a black hole',
    julia: 'a Julia set',
    tunnel: 'a hyperspace tunnel',
    cathedral: 'a cathedral of mirrors',
    life: 'the Game of Life',
    storm: 'a lightning storm',
    lenia: 'continuous life',
  };
  C.GENUS_VERBS = {
    tide: 'hold to gather light · drag to stir · right-drag to draw a living melody',
    mycelium: 'tap to plant a seed · it will reach for the others · hold to shine a light it fears',
    orrery: 'tap to set a planet in orbit · drag to fling one · keys place notes into orbit',
    skin: 'tap or drag to feed it · right-drag to scar · keys write notes under the playhead',
    resonance: 'hold to bow a tone · tap to place a singing bowl · the sand draws what it hears',
    attractor: 'drag to sculpt its shape · tap to pluck it · each key is a different shape · it sings its own orbit',
    flame: 'drag to twist the flame · tap to reseed a branch · keys bend it into a new form',
    plife: 'tap to drop a species · hold to pull them in · keys rewrite how one species feels about the rest',
    murmur: 'you are the hawk — move through them · hold to call them to roost · drag to lead them',
    fluid: 'drag to push the fluid and pour ink · tap to splash · hold to stir a whirlpool',
    ripple: 'tap for a drop · hold to make a source that rings (higher = faster) · drag for a wake',
    scope: 'left ear draws x, right ear draws y · keys change the interval · drag to turn it · hold to tie a knot',
    blackhole: 'tap to drop matter in and hear it fall · hold to feed it · drag to spin the disk',
    julia: 'drag to move c and melt the fractal · hold to trace the Mandelbrot edge · keys jump to famous shapes',
    tunnel: 'hold for hyperdrive · tap to boost · drag to twist · keys rebuild the walls',
    cathedral: 'drag to turn the building · tap to send light through it · hold to fold the mirrors',
    life: 'one generation per sixteenth note · tap or drag to seed life · right-drag to erase · keys change the laws',
    storm: 'tap to call lightning · drag for a plasma globe · hold to charge a strike that makes a new pole',
    lenia: 'tap to drop life · drag to paint it · right-drag to erase · hold for a big seed · keys bend the law of growth',
  };
  C.VISITOR_WORDS = { singers: 'with singing jellies', orrery: 'with a solar system adrift in it', bowls: 'with singing bowls', storm: 'under a lightning storm' };
  const RD_REGIMES = [
    ['coral', 0.0545, 0.062], ['mitosis', 0.0367, 0.0649], ['worms', 0.078, 0.061], ['spots', 0.03, 0.062],
    ['maze', 0.029, 0.057], ['waves', 0.014, 0.045], ['bubbles', 0.098, 0.0555], ['fingerprint', 0.037, 0.06],
  ];
  C.worldDefs = new Map();

  C.makeWorld = function (seed, opts) {
    opts = opts || {};
    if (C.worldDefs.has(seed)) return C.worldDefs.get(seed);
    const w = makeWorld(seed, opts);
    C.worldDefs.set(seed, w);
    return w;
  };

  function makeWorld(seed, opts) {
    const r = C.rng(seed);
    const pick = (arr) => arr[Math.floor(r() * arr.length)];
    const w = { seed };
    if (opts.origin) {
      w.name = 'The First Tide';
      w.lawName = 'tide';
      w.law = Object.assign({}, C.LAWS.tide);
      w.scaleName = 'dorian';
      w.root = 2; // D
      w.bpm = 82;
      w.palette = {
        mid: C.hsl(0.5, 0.85, 0.45), // teal
        hot: C.hsl(0.9, 0.9, 0.7), // magenta-pink
        accent: C.hsl(0.12, 0.95, 0.6), // gold
        deep: C.hsl(0.68, 0.7, 0.045), // indigo
      };
      w.species = [
        { degree: 0, timbre: 0.15, lobes: 5, rhythm: 4, speed: 1.0, social: 0.8, spike: 0.2, count: 14 },
        { degree: 4, timbre: 0.5, lobes: 7, rhythm: 4, speed: 1.1, social: 0.7, spike: 0.5, count: 12 },
        { degree: 7, timbre: 0.3, lobes: 6, rhythm: 2, speed: 1.3, social: 0.6, spike: 0.8, count: 12 },
        { degree: 9, timbre: 0.8, lobes: 9, rhythm: 6, speed: 0.9, social: 0.9, spike: 0.3, count: 10 },
        { degree: -3, timbre: 0.6, lobes: 4, rhythm: 8, speed: 0.7, social: 0.5, spike: 0.1, count: 6 },
      ];
    } else {
      w.name = 'The ' + pick(ADJ) + ' ' + pick(NOUN);
      w.lawName = pick(['tide', 'galaxy', 'storm', 'inverse', 'silk']);
      const base = C.LAWS[w.lawName];
      w.law = {
        curl: base.curl * (0.75 + r() * 0.5),
        central: base.central * (0.6 + r() * 0.8),
        cym: base.cym,
        sign: base.sign,
        drag: base.drag * (0.8 + r() * 0.4),
        k: base.k,
        flow: base.flow * (0.8 + r() * 0.4),
      };
      w.scaleName = pick(Object.keys(C.SCALES));
      w.root = Math.floor(r() * 12);
      w.bpm = Math.round(66 + r() * 44);
      w.palette = makePalette(r, r(), pick(Object.keys(SCHEMES)));
    }
    w.scale = C.SCALES[w.scaleName].slice();
    if (!w.species) w.species = makeSpecies(r, w.scale.length, 3 + Math.floor(r() * 3));
    w.orbSeeds = [];
    const nOrbs = opts.origin ? 3 : 2 + Math.floor(r() * 2);
    for (let i = 0; i < nOrbs; i++) w.orbSeeds.push(C.hash(seed, 'orb', i));
    w.dustHue = r();
    // which kind of universe is this? never the same medium, nor the same look, as where it was reached from
    const avoid = opts.notGenus || [];
    const choices = C.GENERA.filter((g) => !avoid.includes(g));
    w.genus = opts.origin ? 'tide' : opts.genus || choices[Math.floor(r() * choices.length)];
    const avoidStyle = opts.notStyle != null ? [].concat(opts.notStyle) : [];
    if (opts.origin) w.style = 0;
    else if (opts.style != null) w.style = opts.style;
    else if (!avoidStyle.includes(0) && r() < 0.3) w.style = 0;
    else {
      const st = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13].filter((s) => !avoidStyle.includes(s));
      w.style = st[Math.floor(r() * st.length)];
    }
    const visitors = { singers: !['tide'].includes(w.genus), orrery: !['orrery', 'blackhole'].includes(w.genus), bowls: !['resonance'].includes(w.genus), storm: !['storm'].includes(w.genus) };
    const vlist = Object.keys(visitors).filter((v) => visitors[v]);
    w.visitor = opts.origin ? null : opts.visitor !== undefined ? opts.visitor : r() < 0.6 ? vlist[Math.floor(r() * vlist.length)] : null;
    const g = (w.gp = {});
    if (w.genus === 'mycelium') {
      g.sensorAngle = 0.25 + r() * 0.9;
      g.sensorDist = 0.35 + r() * 1.1;
      g.turn = 0.2 + r() * 0.6;
      g.speed = 2 + r() * 3;
      g.decay = 0.9 + r() * 0.07;
      g.deposit = 0.6 + r() * 0.8;
      g.nodes = 4 + Math.floor(r() * 4);
      w.law = { curl: 0, central: 0, cym: 0, sign: 1, drag: 1, k: 2, flow: 0.5 };
    } else if (w.genus === 'orrery') {
      g.exponent = 1.6 + r() * 0.8; // gravity falls off as 1/r^p — every orrery has its own law
      g.suns = r() < 0.55 ? 1 : r() < 0.7 ? 2 : 3;
      g.gates = [3, 4, 5, 6, 8, 12][Math.floor(r() * 6)];
      g.planets = 4 + Math.floor(r() * 5);
      g.G = 10 + r() * 10;
      g.ringSpacing = 0.9 + r() * 1.6;
      g.rings = 1.0 + r() * 1.4;
      w.law = { curl: 0.12, central: 0, cym: 0, sign: 1, drag: 0.9, k: 2, flow: 0.3 };
    } else if (w.genus === 'skin') {
      const a = pick(RD_REGIMES), b = pick(RD_REGIMES);
      g.regimes = [a[0], b[0]];
      g.fk = [a[1], a[2], b[1], b[2]];
      g.iters = 6 + Math.floor(r() * 8);
      g.relief = 0.5 + r() * 1.5;
      g.scanBeats = [4, 8, 8, 16][Math.floor(r() * 4)];
      w.law = { curl: 0.35, central: 0, cym: 0, sign: 1, drag: 1.6, k: 1, flow: 0.4 };
    } else if (w.genus === 'resonance') {
      g.bowls = 2 + Math.floor(r() * 3);
      g.modeScale = 1 + Math.floor(r() * 3);
      g.grain = r();
      w.law = { curl: 0.04, central: 0, cym: 1.5 + r(), sign: 1, drag: 2.6, k: 2, flow: 0.3 };
    } else if (w.genus === 'attractor') {
      const CLIFF = [[-1.4, 1.6, 1.0, 0.7], [1.7, 1.7, 0.6, 1.2], [-1.7, 1.3, -0.1, -1.2], [-1.7, 1.8, -1.9, -0.4], [-1.8, -2.0, -0.5, -0.9], [1.5, -1.8, 1.6, 0.9], [-1.24, -1.25, -1.81, -1.91], [1.6, -0.6, -1.2, 1.6]];
      const base = pick(CLIFF);
      g.base = base.map((v) => v + (r() - 0.5) * 0.15);
      g.drift = 0.04 + r() * 0.1;
      w.law = { curl: 0.12, central: 0, cym: 0, sign: 1, drag: 2.4 + r(), k: 2, flow: 0.4 };
    } else if (w.genus === 'flame') {
      // a fractal flame: a few contractive affine maps, each bent by non-linear "variations"
      const nx = 3 + Math.floor(r() * 2);
      g.xforms = [];
      let wsum = 0;
      for (let i = 0; i < nx; i++) {
        const ang = r() * Math.PI * 2, sc = 0.35 + r() * 0.5, sk = (r() - 0.5) * 0.6;
        const vars = new Array(10).fill(0);
        vars[0] = 0.2 + r() * 0.4;
        const pickV = () => 1 + Math.floor(r() * 9);
        vars[pickV()] += 0.5 + r() * 0.8;
        if (r() < 0.5) vars[pickV()] += 0.3 + r() * 0.5;
        const wgt = 0.3 + r();
        wsum += wgt;
        g.xforms.push({
          a: Math.cos(ang) * sc, b: -Math.sin(ang) * sc + sk, c: Math.sin(ang) * sc, d: Math.cos(ang) * sc - sk * 0.5,
          e: (r() - 0.5) * 1.6, f: (r() - 0.5) * 1.6, w: wgt, col: i / (nx - 1), vars,
        });
      }
      g.xforms.forEach((x) => { x.w /= wsum; });
      g.scale = 4.5 + r() * 2.5;
      g.spin = (r() - 0.5) * 0.06;
      w.law = { curl: 0, central: 0, cym: 0, sign: 1, drag: 1, k: 2, flow: 0.3 };
    } else if (w.genus === 'plife') {
      g.types = 5 + Math.floor(r() * 3);
      g.matrix = [];
      for (let i = 0; i < g.types; i++) {
        g.matrix.push([]);
        for (let j = 0; j < g.types; j++) g.matrix[i].push(r() * 2 - 1);
      }
      g.rMax = 2 + r() * 1.2;
      g.count = 1700 + Math.floor(r() * 500);
      g.force = 8 + r() * 6;
      w.law = { curl: 0.3, central: 0, cym: 0, sign: 1, drag: 1.4, k: 2, flow: 0.4 };
    } else if (w.genus === 'fluid') {
      g.curl = 15 + r() * 30;
      g.dyeDiss = 0.35 + r() * 0.6;
      w.law = { curl: 0.1, central: 0, cym: 0, sign: 1, drag: 3, k: 2, flow: 0.3 };
    } else if (w.genus === 'ripple') {
      g.damp = 0.994 + r() * 0.004;
      w.law = { curl: 0.15, central: 0, cym: 0, sign: 1, drag: 2.5, k: 2, flow: 0.3 };
    } else if (w.genus === 'scope') {
      g.degs = [0, 2 + Math.floor(r() * 5)];
      w.law = { curl: 0.35, central: 0.4, cym: 0, sign: 1, drag: 1.5, k: 2, flow: 0.5 };
    } else if (w.genus === 'blackhole') {
      g.rh = 1.2 + r() * 1.2;
      g.spin = 0.6 + r() * 1.2;
      w.law = { curl: 0.15, central: 1.2, cym: 0, sign: 1, drag: 0.8, k: 2, flow: 0.4 };
    } else if (w.genus === 'julia') {
      g.preset = Math.floor(r() * 12);
      g.scale = 6 + r() * 3;
      w.law = { curl: 0.4, central: 0, cym: 0, sign: 1, drag: 1.5, k: 2, flow: 0.4 };
    } else if (w.genus === 'tunnel') {
      g.speed = 0.6 + r() * 0.8;
      g.sides = 3 + Math.floor(r() * 6);
      g.size = 3 + r() * 3;
      w.law = { curl: 0.2, central: 0.8, cym: 0, sign: 1, drag: 1, k: 2, flow: 0.6 };
    } else if (w.genus === 'cathedral') {
      g.fold = Math.floor(r() * 5);
      w.law = { curl: 0.3, central: 0, cym: 0, sign: 1, drag: 1.5, k: 2, flow: 0.4 };
    } else if (w.genus === 'life') {
      g.rule = r() < 0.4 ? 0 : Math.floor(r() * 7);
      g.every = [1, 2, 2, 4][Math.floor(r() * 4)];
      w.law = { curl: 0.4, central: 0, cym: 0, sign: 1, drag: 1.4, k: 2, flow: 0.4 };
    } else if (w.genus === 'lenia') {
      g.law = Math.floor(r() * 5);
      w.law = { curl: 0.2, central: 0, cym: 0, sign: 1, drag: 1.6, k: 2, flow: 0.3 };
    } else if (w.genus === 'storm') {
      w.law = { curl: 1.2, central: 0, cym: 0, sign: 1, drag: 1.2, k: 3, flow: 1.2 };
    } else if (w.genus === 'murmur') {
      g.count = 2200 + Math.floor(r() * 600);
      g.align = 0.6 + r() * 0.8;
      g.cohere = 0.3 + r() * 0.6;
      g.speed = 4 + r() * 2.5;
      w.law = { curl: 0.5, central: 0, cym: 0, sign: 1, drag: 1.2, k: 2, flow: 0.8 };
    }
    return w;
  }

  // Cheap preview used to paint an orb's interior before you ever enter it.
  C.previewWorld = function (seed, parentGenus, parentStyle) {
    const w = C.makeWorld(seed, { notGenus: parentGenus ? [parentGenus] : [], notStyle: parentStyle });
    return { name: w.name, palette: w.palette, root: w.root, scale: w.scale, lawName: w.lawName, genus: w.genus, style: w.style };
  };
  C.describeWorld = function (w) {
    const parts = [C.GENUS_WORDS[w.genus]];
    if (w.visitor) parts.push(C.VISITOR_WORDS[w.visitor]);
    return parts.join(' ');
  };

  C.degreeToMidi = function (degree, scale, root) {
    const len = scale.length;
    const oct = Math.floor(degree / len);
    const idx = degree - oct * len;
    return 48 + root + scale[idx] + 12 * oct;
  };
  C.degreeToPc = (degree, scale, root) => ((C.degreeToMidi(degree, scale, root) % 12) + 12) % 12;
})();
