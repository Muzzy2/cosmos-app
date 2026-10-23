'use strict';
// App: an endless stack of live worlds you zoom through, input, interface, the frame loop.
//
// Zoom is one continuous parameter. Up to three worlds are alive at once — the one around you (outer),
// the one you're in (cur) and the one inside the thing under your cursor (inner). Each child world is
// tied to its parent by an anchor point and a scale factor S. As you zoom, the inner world opens through
// a membrane around its anchor and takes over halfway through; zooming out does the same in reverse.
(function () {
  const C = window.COSMOS;
  const $ = (id) => document.getElementById(id);
  const wrap = C.wrap;
  const body = document.body;

  // ------------------------------------------------------------------ settings
  const settings = Object.assign({
    volume: 0.6, musicVolume: 0.8, intensity: 0.6, trails: 0.62, quality: 'high',
    strongGuard: true, reduced: false, synth: true, hints: true, wisp: true,
  }, C.storage.get('settings', {}));
  const saveSettings = () => C.storage.set('settings', settings);
  if (window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches && C.storage.get('settings', null) == null) settings.reduced = true;
  const QUALITY = { phone: { side: 256, scale: 1, dpr: 1.25 }, low: { side: 256, scale: 0.8, dpr: 1 }, high: { side: 512, scale: 1, dpr: 1.25 }, ultra: { side: 1024, scale: 1, dpr: 1.5 } };
  // phones and tablets: lighter worlds, touch controls, and the motion sensors
  const TOUCH = matchMedia('(pointer: coarse)').matches || navigator.maxTouchPoints > 1;
  C.MOBILE = TOUCH && Math.min(screen.width, screen.height) < 900;
  if (C.MOBILE && C.storage.get('settings', null) == null) settings.quality = 'phone';
  if (!QUALITY[settings.quality]) settings.quality = 'high';
  if (TOUCH) document.body.classList.add('touch');
  const tilt = new Float32Array(2);
  let shakeT = 0, lastAcc = null;

  // ------------------------------------------------------------------ boot
  const canvas = $('c');
  let renderer;
  try {
    renderer = new C.Renderer(canvas);
  } catch (e) {
    const el = $('err');
    el.style.display = 'flex';
    el.innerHTML = 'COSMOS needs WebGL2 with float render targets.<br>' + String(e.message || e) + '<br><br>Try a current Chrome or Edge with hardware acceleration on.';
    console.error(e);
    return;
  }
  C.noiseData = renderer.noiseData;
  const audio = new C.AudioEngine();
  audio.volume = settings.volume;
  const music = new C.Music(audio);

  // ------------------------------------------------------------------ the stack of worlds
  const IN_HI = 104; // inner world starts to show when its own view is this wide (the whole torus, as a jewel)
  const IN_LO = 19; // ...and covers the screen when it's this wide
  const LOG_SPAN = Math.log(IN_HI / IN_LO);
  const R_IN = 20; // the inner world shows through a circle of this radius (in its own units): one full tile
  const weightOf = (vhInner) => C.smooth(0, 1, Math.log(IN_HI / vhInner) / LOG_SPAN);
  const uniCache = new Map(); // seed -> Universe (worlds keep living memories while you are elsewhere)
  const links = new Map(); // child seed -> { parentSeed, ax, ay, S, cx, cy, depth }
  let musicKey = null;

  function getUniverse(world) {
    let u = uniCache.get(world.seed);
    const fresh = !u;
    if (!u) {
      u = new C.Universe(audio.forWorld({ get genus() { return u.genus; }, get seed() { return u.world && u.world.seed; } }), music);
      u.renderer = renderer;
      u.load(world);
      uniCache.set(world.seed, u);
      // COSMOS 4: a world you have been to before wakes up from its memory (and lives through the time
      // you were away); a new one is remembered from now on
      if (C.multiverse.has(world.seed)) {
        u.restoring = true;
        C.multiverse.wakeWorld(u).then((rep) => { u.restoring = false; u.restored = !!rep; woke(u, rep); }, () => { u.restoring = false; });
      }
      C.multiverse.remember(world);
      if (uniCache.size > 28) {
        for (const [seed, old] of uniCache) {
          if (liveLayers().some((L) => L.uni === old)) continue;
          C.multiverse.save(old);
          old.dispose();
          uniCache.delete(seed);
          break;
        }
      }
    } else {
      uniCache.delete(world.seed), uniCache.set(world.seed, u);
      const away = u.lastWall ? Date.now() - u.lastWall : 0;
      if (away > 20000 && u.singers.length && !u.restoring) { const eco = C.Eco.advance(u, away, u.lastWall, C.hash(world.seed, u.time | 0)); C.Observatory.rebase(u); woke(u, { away, eco }); }
    }
    return { u, fresh };
  }
  // what changed while you were elsewhere, told once when you next arrive there
  function woke(u, rep) {
    u.lastWall = Date.now();
    if (!rep) return;
    const parts = awayParts(rep);
    if (parts.length) u.awayReport = parts;
    // told once you're awake and there (on the sleeping start screen it waits for your first touch)
    if (cur && u === cur.uni && state === 'live') tellAway(u);
  }
  function awayParts(rep) {
    const parts = [];
    const e = rep.eco;
    if (e && e.slices >= 2) {
      const mins = Math.round(e.simSeconds / 60);
      parts.push(e.born + ' born, ' + e.died + ' died in ' + (mins >= 2 ? mins + ' minutes' : 'a minute') + ' of their time');
      if (e.after && e.before && e.after.hunters > e.before.hunters + 2) parts.push('hunters are rising');
      if (e.after && e.before && Math.abs(e.after.climate - e.before.climate) > 0.03) parts.push(e.after.climate > e.before.climate ? 'they are adapting to warmth' : 'they are adapting to cold');
      if (e.after && e.after.n === 0) parts.push('none survived');
    }
    if (rep.arrived) parts.push(rep.arrived + ' newcomer' + (rep.arrived > 1 ? 's' : '') + ' arrived from another world');
    return parts;
  }
  function tellAway(u) {
    if (!u.awayReport) return;
    showToast('while you were away', u.awayReport.join(' · '));
    u.awayReport = null;
  }
  function makeLayer(world, cx, cy, depth) {
    const { u, fresh } = getUniverse(world);
    const gpu = renderer.createLayer(QUALITY[settings.quality].side);
    u.gpu = gpu;
    renderer.use(gpu);
    u.gpuInit(renderer, cx, cy);
    u.intro = 0;
    u.introTarget = 0;
    u.introCenter = [cx, cy];
    u.bangFrame = u.genus === 'tide';
    if (fresh && !u.restoring && (u.genus === 'tide' || world.visitor === 'singers')) u.populate(cx, cy, 8);
    if (fresh && musicKey) u.fitKey(music.chromaLong, musicKey);
    u.setGain(0);
    return { uni: u, gpu, world, depth, prevCam: null, seed: world.seed, cam: { x: cx, y: cy, viewH: 13, roll: 0, h: 1 } };
  }
  function dropLayer(L) {
    if (!L) return;
    C.multiverse.save(L.uni);
    if (L.anchorObj) { L.anchorObj.grabbed = false; L.anchorObj = null; }
    L.uni.setGain(0);
    L.uni.dispose();
    renderer.destroyLayer(L.gpu);
    L.gpu = null;
  }

  // the origin
  const ORIGIN = 1;
  const originWorld = C.makeWorld(ORIGIN, { origin: true });
  let cur = null, inner = null, outer = null, side = null; // side: { L, dx, dy }, the neighbour you are heading for
  const liveLayers = () => [outer, cur, inner, side && side.L].filter(Boolean);
  {
    const { u } = getUniverse(originWorld);
    const gpu = renderer.createLayer(QUALITY[settings.quality].side);
    u.gpu = gpu;
    renderer.use(gpu);
    renderer.seedDust(0, 0, 3.2);
    cur = { uni: u, gpu, world: originWorld, depth: 0, prevCam: null, seed: ORIGIN, cam: null };
    const r = C.rng(5);
    for (let i = 0; i < (u.restoring ? 0 : 7); i++) {
      const sp = u.world.species[i % u.world.species.length];
      const a = r() * Math.PI * 2;
      u.spawnSinger(Math.cos(a) * 2, Math.sin(a) * 2, u._genomeFrom(sp));
    }
  }
  let uni = cur.uni; // the world you are in (input, interface)

  const cam = { x: 0, y: 0, viewH: 7.2, tx: 0, ty: 0, tViewH: 7.2, roll: 0, h: 1, aspect: 1, follow: null };
  let state = 'intro';
  let paused = false;
  let slow = 0, slowHeld = false;
  let idleTime = 0, lastInput = performance.now();
  let drawMode = false;
  let auto = null; // automatic zoom in (double-click) or out (Esc)
  let innerCheckT = 0;
  const did = new Set();
  const overlay = new Float32Array([0, 0, 0, 0]);

  // camera mapping between a parent and a child world
  const toInner = (lk, c) => ({ x: wrap(lk.cx + wrap(c.x - lk.ax) * lk.S), y: wrap(lk.cy + wrap(c.y - lk.ay) * lk.S), viewH: c.viewH * lk.S });
  const toOuter = (lk, c) => ({ x: wrap(lk.ax + wrap(c.x - lk.cx) / lk.S), y: wrap(lk.ay + wrap(c.y - lk.cy) / lk.S), viewH: c.viewH / lk.S });

  // ------------------------------------------------------------------ sizing
  function resize() {
    const q = QUALITY[settings.quality];
    const dpr = Math.min(window.devicePixelRatio || 1, q.dpr) * q.scale;
    const w = Math.max(320, Math.floor(innerWidth * dpr)), h = Math.max(200, Math.floor(innerHeight * dpr));
    renderer.resize(w, h);
  }
  addEventListener('resize', resize);
  resize();

  function toWorld(px, py) {
    const ndcX = (px / innerWidth) * 2 - 1, ndcY = 1 - (py / innerHeight) * 2;
    const rx = ndcX * cam.aspect * cam.viewH * 0.5, ry = ndcY * cam.viewH * 0.5;
    const c = Math.cos(-cam.roll), s = Math.sin(-cam.roll);
    return [wrap(cam.x + c * rx - s * ry), wrap(cam.y + s * rx + c * ry)];
  }

  // ------------------------------------------------------------------ waking up
  let composer = null;
  function wake() {
    if (state !== 'intro') return;
    state = 'live';
    audio.start();
    audio.setSynthOn(settings.synth);
    composer = audio.composer = new C.Composer(audio);
    composer.onShift = musicShift;
    composer.setWorld(uni);
    pack.load().then(packStatus);
    if (TOUCH) enableMotion();
    uni.introTarget = 0;
    uni.bangFrame = true;
    if (!uni.restoring && !uni.restored) uni.populate(0, 0, 6);
    else setTimeout(() => tellAway(uni), 2500);
    cam.tViewH = 13;
    $('intro').classList.add('gone');
    body.classList.remove('asleep');
    const allow = C.flash.request(1);
    uni.addShock(0, 0, 4 * uni.shockMul, 6, 1.2, 2 * allow, 1);
    uni.addRing(0, 0, 0.3, 14, 3.5, uni.palette.hot, 0.04, 0.8 * allow);
    uni.addRing(0, 0, 0.3, 9, 2.6, uni.palette.mid, 0.06, 0.8 * allow);
    const t0 = audio.now() + 0.05;
    audio.burst(0.6, 0, null);
    [0, 2, 4, 7, 9, 11, 14].forEach((d, i) => audio.play({ midi: uni.midiOf(d), timbre: i % 2 ? 0.45 : 0.12, vel: 0.13, pan: (i - 3) * 0.2, dur: 4.5 }, t0 + 0.35 + i * 0.16));
    sessionStart = performance.now();
    lastInput = performance.now();
  }

  // ------------------------------------------------------------------ phone motion: tilt is a wind, a shake is a shockwave
  function enableMotion() {
    const start = () => addEventListener('devicemotion', (e) => {
      const a = e.accelerationIncludingGravity;
      if (!a || a.x == null) return;
      // iOS reports gravity with the opposite sign to Android
      const s = renderer.isIOS ? 1 : -1;
      let gx = a.x * s, gy = a.y * s;
      const ang = ((screen.orientation && screen.orientation.angle) || window.orientation || 0) * Math.PI / 180;
      const c = Math.cos(ang), sn = Math.sin(ang);
      const rx = gx * c + gy * sn, ry = -gx * sn + gy * c;
      tilt[0] += (rx * 0.12 - tilt[0]) * 0.1;
      tilt[1] += (ry * 0.12 - tilt[1]) * 0.1;
      if (lastAcc) {
        const j = Math.hypot(a.x - lastAcc[0], a.y - lastAcc[1], (a.z || 0) - lastAcc[2]);
        const now = performance.now();
        if (j > 22 && now - shakeT > 1200 && state === 'live') {
          shakeT = now;
          const allow = C.flash.request(0.8);
          uni.addShock(cam.x, cam.y, 5 * uni.shockMul, 7, 1, 1.6 * allow, 0.8);
          uni.addRing(cam.x, cam.y, 0.3, cam.viewH * 0.6, 1.4, uni.palette.hot, 0.04, 0.8 * allow);
          audio.burst(0.6, 0, [0, 2, 4].map((d) => uni.midiOf(d)), 0.3);
          uni._found('shake', 'you shook the universe');
          C.haptic('thud');
        }
      }
      lastAcc = [a.x, a.y, a.z || 0];
    });
    try {
      if (typeof DeviceMotionEvent !== 'undefined' && typeof DeviceMotionEvent.requestPermission === 'function') {
        DeviceMotionEvent.requestPermission().then((r) => { if (r === 'granted') start(); }).catch(() => {});
      } else start();
    } catch (e) {}
  }

  // ------------------------------------------------------------------ the zoom engine
  // Is this layer on screen now?
  function shownLayer(L) {
    if (L === inner) return weightOf(cam.viewH * inner.link.S) > 0;
    if (L === outer) return !!cur.link && cam.viewH > IN_LO;
    if (side && L === side.L) return sideShown > 0;
    return L === cur;
  }
  // Before a world is opened as a new layer: two layers must never share one Universe (both would simulate
  // it, and dropping one disposes the other). An unseen layer of that world is let go; a visible one, or the
  // world you are in, means no.
  function freeSeed(seed) {
    if (seed === cur.seed) return false;
    for (const L of [inner, outer, side && side.L]) {
      if (!L || L.seed !== seed) continue;
      if (shownLayer(L)) return false;
      if (side && L === side.L) resetTravel();
      else if (L === inner) { dropLayer(inner); inner = null; }
      else { dropLayer(outer); outer = null; }
    }
    return true;
  }
  // a world you asked for (double-click, journal, Enter) is kept while the glide into it lasts
  const visiting = () => !!(inner && inner.asked && auto && auto.dir < 0);
  let pendingDive = null; // a dive you asked for while a side passage was on screen: opened once it closes
  // Choose (or keep) the world inside whatever is under your cursor; force = a world you asked for. Returns
  // whether that world is (or will be, once a passage closes) the one inside.
  function ensureInner(force) {
    const px = ptr.inside ? ptr.wx : cam.x, py = ptr.inside ? ptr.wy : cam.y;
    const target = force || uni.diveTarget(px, py);
    if (inner && inner.seed === target.seed) { if (force) { inner.asked = true; pendingDive = null; } return true; }
    if (!force && (visiting() || pendingDive)) return false; // gliding into a world you asked for: the cursor doesn't re-aim it
    if (force) pendingDive = null; // a newer request replaces any that was waiting
    if (force && side) {
      if (sideShown > 0 || sideWeight(trav.x * side.dx + trav.y * side.dy) > 0) { pendingDive = target; return true; }
      if (C.MOBILE) resetTravel(); // phones: an unseen neighbour gives way (two living worlds)
    }
    if (!freeSeed(target.seed)) return false;
    if (inner) {
      const wI = weightOf(cam.viewH * inner.link.S);
      const off = Math.hypot(wrap(inner.link.ax - px), wrap(inner.link.ay - py)) / cam.viewH;
      if (wI > 0.001 || (!force && off < 0.4)) return false; // a membrane on screen is never torn down
      dropLayer(inner);
      inner = null;
    }
    // at most three living worlds: an unseen neighbour goes; else the world outside (only prepared while a
    // passage is on screen, since no membrane opens then) makes room
    if (side && outer) { if (sideShown === 0) resetTravel(); else { dropLayer(outer); outer = null; } }
    const world = C.makeWorld(target.seed, { notGenus: [uni.genus], notStyle: [uni.style] });
    const known = links.get(target.seed);
    const S = known ? known.S : C.clamp(R_IN / Math.max(0.3, target.r), 12, 70);
    const L = makeLayer(world, 0, 0, cur.depth + 1);
    L.link = { ax: target.x, ay: target.y, S, cx: 0, cy: 0 };
    links.set(target.seed, { parentSeed: cur.seed, ax: target.x, ay: target.y, S, cx: 0, cy: 0, depth: cur.depth + 1 });
    if (target.grabbed !== undefined) { target.grabbed = true; L.anchorObj = target; }
    L.asked = !!force;
    inner = L;
    return true;
  }
  // Make sure the world around this one exists (inventing one if we started inside it).
  function ensureOuter() {
    if (outer) return;
    let lk = links.get(cur.seed);
    let parentWorld;
    if (lk) parentWorld = C.makeWorld(lk.parentSeed, { notGenus: [uni.genus], notStyle: [uni.style] });
    else {
      const pSeed = C.hash(cur.seed, 'outside');
      parentWorld = C.makeWorld(pSeed, { notGenus: [uni.genus], notStyle: [uni.style] });
      const r = C.rng(pSeed);
      lk = { parentSeed: pSeed, ax: (r() - 0.5) * 8, ay: (r() - 0.5) * 8, S: 26, cx: cam.x, cy: cam.y, depth: cur.depth - 1 };
      links.set(cur.seed, lk);
    }
    // the world around is already alive as another layer (you asked to go there): it waits, nothing is released
    if (parentWorld.seed === cur.seed || liveLayers().some((L) => L.seed === parentWorld.seed)) return;
    const L = makeLayer(parentWorld, lk.ax, lk.ay, cur.depth - 1);
    // the place you came from is marked in the outer world by an orb you can fall back into
    if (!L.uni.orbs.some((o) => o.seed === cur.seed)) {
      const o = L.uni._makeOrb(lk.ax, lk.ay, cur.seed, R_IN / lk.S, { born: 1 });
      L.uni.orbs.push(o);
    }
    const orb = L.uni.orbs.find((o) => o.seed === cur.seed);
    if (orb) { orb.grabbed = true; orb.x = lk.ax; orb.y = lk.ay; }
    cur.link = { ax: lk.ax, ay: lk.ay, S: lk.S, cx: lk.cx, cy: lk.cy };
    outer = L;
  }
  function becomeInner() {
    const lk = inner.link;
    const m = toInner(lk, cam), mt = toInner(lk, { x: cam.tx, y: cam.ty, viewH: cam.tViewH });
    if (outer) dropLayer(outer);
    outer = cur;
    cur = inner;
    inner = null;
    cur.link = lk;
    Object.assign(cam, { x: m.x, y: m.y, viewH: m.viewH, tx: mt.x, ty: mt.y, tViewH: mt.viewH });
    cam.follow = null;
    if (auto && auto.dir < 0) auto.until = 'settle';
    resetTravel();
    arrived();
  }
  function becomeOuter() {
    const lk = cur.link;
    const m = toOuter(lk, cam), mt = toOuter(lk, { x: cam.tx, y: cam.ty, viewH: cam.tViewH });
    if (inner) dropLayer(inner);
    inner = cur;
    inner.link = lk;
    cur = outer;
    outer = null;
    Object.assign(cam, { x: m.x, y: m.y, viewH: m.viewH, tx: mt.x, ty: mt.y, tViewH: mt.viewH });
    cam.follow = null;
    if (auto && auto.dir > 0) auto.until = 'settle';
    resetTravel();
    arrived();
  }

  // ------------------------------------------------------------------ the worlds beside this one
  // Zooming finds a world inside everything and one around everything; travelling finds the worlds
  // beside it. Each world sits in a plane of neighbours, one torus per cell: travel far enough one way
  // and the next world comes up behind a soft front and takes over; come back and the one you left is
  // still there. Neighbours share a parent, where they lie side by side (one of their tori is W/S of it).
  // travel where the next world starts to show and has taken over (a phone screen is ~6 wide), and one cell. STEP = D0 + D1
  // makes the hand-over seamless: from the new world, the old one is exactly as far through its own passage.
  const SIDE_D0 = 6, SIDE_D1 = 22, SIDE_STEP = SIDE_D0 + SIDE_D1;
  const sideWeight = (d) => C.smooth(SIDE_D0, SIDE_D1, d);
  // seed -> { plane, ix, iy }, remembered across visits in localStorage (anything malformed is ignored)
  const CELLS_KEY = 'cosmos.cells', CELLS_MAX = 600;
  const cells = (() => {
    const m = new Map();
    let raw = [];
    try { raw = JSON.parse(localStorage.getItem(CELLS_KEY) || '[]'); } catch (e) {}
    if (!Array.isArray(raw)) return m;
    for (const e of raw.slice(-CELLS_MAX)) {
      if (!Array.isArray(e) || e.length !== 2 || !Number.isFinite(e[0])) continue;
      const c = e[1];
      if (c && Number.isFinite(c.plane) && Number.isInteger(c.ix) && Number.isInteger(c.iy)) m.set(e[0], { plane: c.plane, ix: c.ix, iy: c.iy });
    }
    return m;
  })();
  let cellsSaveT = 0, cellsDirty = false;
  function saveCells() {
    clearTimeout(cellsSaveT);
    if (!cellsDirty) return;
    let list = [...cells];
    // if storage is full, keep the newer half and try once more; still dirty if that fails too
    for (let i = 0; i < 2; i++) {
      try { localStorage.setItem(CELLS_KEY, JSON.stringify(list)); cellsDirty = false; return; } catch (e) { list = list.slice(list.length >> 1); }
    }
  }
  function rememberCell(seed, c) {
    cells.delete(seed);
    cells.set(seed, c);
    while (cells.size > CELLS_MAX) cells.delete(cells.keys().next().value); // the oldest are forgotten first
    cellsDirty = true;
    clearTimeout(cellsSaveT);
    cellsSaveT = setTimeout(saveCells, 1500);
  }
  addEventListener('pagehide', saveCells);
  document.addEventListener('visibilitychange', () => { if (document.hidden) saveCells(); });
  const trav = { x: 0, y: 0 }; // how far you have travelled in this world since arriving (unwrapped)
  const lastCam = { x: 0, y: 0 };
  const glide = { vx: 0, vy: 0, t: 0 }; // a pan keeps drifting after you let go
  let sideShown = 0, drifting = false, stillT = 0, lastVh = 13;
  const travV = { x: 0, y: 0 }; // how the view is moving (smoothed, world units per second)
  // record how fast a pan moves the view (world units per second), for the glide after you let go
  function panVelocity(mx, my) {
    const now = performance.now(), dt = Math.max(0.008, (now - glide.t) / 1000);
    glide.t = now;
    if (dt > 0.2) { glide.vx = glide.vy = 0; return; }
    const k = Math.min(1, dt * 12), cap = cam.viewH * 2.5; // never faster than a slow dissolve can follow
    glide.vx = C.clamp(glide.vx + (mx / dt - glide.vx) * k, -cap, cap);
    glide.vy = C.clamp(glide.vy + (my / dt - glide.vy) * k, -cap, cap);
  }
  const cellOf = (seed) => cells.get(seed) || { plane: seed, ix: 0, iy: 0 };
  function resetTravel() {
    trav.x = trav.y = 0;
    lastCam.x = cam.x; lastCam.y = cam.y;
    if (side) { dropLayer(side.L); side = null; }
    sideShown = 0;
  }
  // the plane's own place in its parent (invented as ensureOuter would, if we have never been outside)
  function planeLink(plane, depth) {
    let lk = links.get(plane);
    if (!lk) {
      const pSeed = C.hash(plane, 'outside'), r = C.rng(pSeed);
      lk = { parentSeed: pSeed, ax: (r() - 0.5) * 8, ay: (r() - 0.5) * 8, S: 26, cx: 0, cy: 0, depth: depth - 1 };
      links.set(plane, lk);
    }
    return lk;
  }
  function ensureSide(dx, dy) {
    if (side && side.dx === dx && side.dy === dy) return;
    if (side) { dropLayer(side.L); side = null; }
    // room for a neighbour: unseen prepared zoom worlds give way (on phones all of them, keeping two living
    // worlds; on desktops one, if both are prepared), then never more than three
    const unseen = (L) => L && !shownLayer(L);
    if (unseen(inner) && (C.MOBILE || outer)) { dropLayer(inner); inner = null; }
    if (unseen(outer) && (C.MOBILE || inner)) { dropLayer(outer); outer = null; }
    if (inner && outer) return;
    const cell = cellOf(cur.seed), ix = cell.ix + dx, iy = cell.iy + dy;
    const seed = ix === 0 && iy === 0 ? cell.plane : C.hash('side', cell.plane, ix, iy);
    rememberCell(cur.seed, cell);
    rememberCell(seed, { plane: cell.plane, ix, iy });
    if (!links.has(seed)) {
      const pl = planeLink(cell.plane, cur.depth);
      links.set(seed, { parentSeed: pl.parentSeed, ax: wrap(pl.ax + (ix * C.W) / pl.S), ay: wrap(pl.ay + (iy * C.W) / pl.S), S: pl.S, cx: 0, cy: 0, depth: cur.depth });
    }
    if (!freeSeed(seed)) return; // alive and on screen as another layer
    const world = C.makeWorld(seed, { notGenus: [uni.genus], notStyle: [uni.style] });
    side = { L: makeLayer(world, cam.x, cam.y, cur.depth), dx, dy };
    sideShown = 0;
    uni._found('beside', 'keep going: every world has neighbours');
  }
  function becomeSide() {
    if (ptr.down && ptr.mode !== 'pan') cancelPointer();
    if (inner) { dropLayer(inner); inner = null; }
    if (outer) { dropLayer(outer); outer = null; }
    const old = cur, s = side;
    cur = s.L;
    cur.link = null; // its parent is found from links when you pull back
    side = { L: old, dx: -s.dx, dy: -s.dy };
    trav.x -= s.dx * SIDE_STEP;
    trav.y -= s.dy * SIDE_STEP;
    sideShown = 1 - sideShown;
    cam.follow = null;
    arrived();
  }
  // Called every frame after the camera moves: track the travel, prepare, reveal and hand over.
  function updateSide(realDt) {
    const mx = wrap(cam.x - lastCam.x), my = wrap(cam.y - lastCam.y);
    lastCam.x = cam.x; lastCam.y = cam.y;
    // while you zoom you are not travelling (a zoom about the cursor moves the view, and a zoom you asked for
    // must not be held up by a passage that keeps reopening)
    const zooming = Math.abs(Math.log(cam.tViewH / cam.viewH)) > 0.05 || !!auto || !!pendingDive;
    const zoomPair = (inner && weightOf(cam.viewH * inner.link.S) > 0) || (outer && cur.link && cam.viewH > IN_LO);
    // (and while a zoom membrane is open the travel is the zoom's, not a journey sideways: no hidden credit)
    if (!zooming && !zoomPair) { trav.x += mx; trav.y += my; }
    const kv = C.damp(4, realDt), idt = 1 / Math.max(realDt, 1e-3);
    travV.x += (mx * idt - travV.x) * kv;
    travV.y += (my * idt - travV.y) * kv;
    const travSpeed = Math.hypot(travV.x, travV.y);
    // still for a while with no passage open: the journey's credit fades, so a neighbour you are not
    // heading for is let go (a third living world costs a phone dearly)
    stillT = travSpeed < 0.25 && !drifting ? stillT + realDt : 0;
    if (stillT > 2 && (!side || sideShown === 0)) { const k = Math.exp(-realDt * 1.2); trav.x *= k; trav.y *= k; }
    const along = Math.max(Math.abs(trav.x), Math.abs(trav.y));
    const dx = Math.abs(trav.x) >= Math.abs(trav.y) ? Math.sign(trav.x) : 0, dy = dx ? 0 : Math.sign(trav.y);
    let w = side ? sideWeight(trav.x * side.dx + trav.y * side.dy) : 0;
    // no neighbour needed (or a different one): let it go, but only once it has faded from view
    if (side && w === 0 && sideShown === 0 && (zooming || along < SIDE_D0 - 5 || ((dx !== side.dx || dy !== side.dy) && along > SIDE_D0 - 2))) { dropLayer(side.L); side = null; }
    if (!side && !zoomPair && !zooming && state === 'live' && along > SIDE_D0 - 2 && (dx || dy)) ensureSide(dx, dy);
    w = side ? sideWeight(trav.x * side.dx + trav.y * side.dy) : 0;
    if (side && w > 0.5) { becomeSide(); w = sideWeight(trav.x * side.dx + trav.y * side.dy); }
    // what you see follows the travel, but never faster than a slow dissolve (no sudden change of light)
    sideShown += C.clamp(w - sideShown, -realDt * 0.9, realDt * 0.9);
    if (side && (w > 0 || sideShown > 0)) {
      // standing still part-way, zooming, or heading across instead: the passage closes again (only the
      // travel relaxes, the view stays where it is), so you are always fully somewhere
      const zoomWish = zooming; // a zoom under way, not a zoom level
      const across = Math.abs(travV.x * side.dx + travV.y * side.dy) < 0.5 * travSpeed;
      if (w > 0 && ((travSpeed < 0.25 && !drifting) || zoomWish || across)) {
        const d = trav.x * side.dx + trav.y * side.dy, nd = Math.max(SIDE_D0 - 1, d - (zoomWish ? 14 : 6) * realDt);
        trav.x -= side.dx * (d - nd);
        trav.y -= side.dy * (d - nd);
      }
      // and no zoom membrane opens while a side passage is on screen: the view waits, your zoom target is kept
      // and resumes when it closes (only a glide of our own is held back). With no world inside prepared, hold
      // above where any new one's membrane could open (S >= 12).
      const lo = inner ? (IN_HI / inner.link.S) * 1.02 : Math.min(lastVh, (IN_HI / 12) * 1.02), hi = IN_LO * 0.97;
      cam.viewH = C.clamp(cam.viewH, lo, hi);
      if (auto) cam.tViewH = C.clamp(cam.tViewH, lo, hi);
    }
    lastVh = cam.viewH;
  }
  const arrivedAt = new Map();
  function arrived() {
    uni = cur.uni;
    did.add('dive');
    if (uni.awayReport) setTimeout(() => { if (cur.uni === uni) tellAway(uni); }, 1800);
    const w = cur.world;
    const last = arrivedAt.get(cur.seed) || -1e9;
    arrivedAt.set(cur.seed, performance.now());
    if (performance.now() - last < 15000) return;
    const kind = C.describeWorld(w);
    const look = C.STYLES[w.style || 0].name;
    // the hands' meaning is explained the first time you meet each kind of world
    // while you keep zooming, the name in the corner is enough; a card appears only for a new kind of world
    if (C.found.has('verbs-' + w.genus)) return;
    C.found.add('verbs-' + w.genus);
    showToast(kind, 'seen in ' + look, C.GENUS_VERBS[w.genus], true);
  }

  // ------------------------------------------------------------------ pointer input
  const ptr = { x: innerWidth / 2, y: innerHeight / 2, wx: 0, wy: 0, inside: false, down: false, mode: 'none', button: 0, downT: 0, dx: 0, dy: 0, vx: 0, vy: 0, speed: 0, target: null, lastT: performance.now(), moved: 0 };
  const touches = new Map();
  let pinch = null;

  function markInput() {
    lastInput = performance.now();
    if (body.classList.contains('idle')) body.classList.remove('idle');
  }

  canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  canvas.addEventListener('pointerdown', (e) => {
    markInput();
    closePanels();
    if (state === 'intro') { wake(); C.haptic('bloom'); return; }
    if (!paused) audio.resume();
    auto = null;
    glide.vx = glide.vy = 0; // a touch catches a glide
    if (e.pointerType === 'touch') {
      touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (touches.size === 2) {
        cancelPointer();
        const [a, b] = [...touches.values()];
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        pinch = { d, cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2, d0: d, t0: performance.now() };
        uni._found('travel', 'drag with two fingers to travel: every world has neighbours');
        return;
      }
      if (touches.size > 2) return;
    }
    try { canvas.setPointerCapture(e.pointerId); } catch (err) {}
    ptr.down = true;
    ptr.button = e.button;
    ptr.downT = performance.now();
    ptr.dx = e.clientX;
    ptr.dy = e.clientY;
    updatePtr(e.clientX, e.clientY);
    const wantsDraw = e.button === 2 || (e.button === 0 && (drawMode || e.shiftKey));
    if (e.button === 1) { ptr.mode = 'pan'; return; }
    if (wantsDraw) {
      const hit = uni.pick(ptr.wx, ptr.wy);
      ptr.mode = 'draw';
      uni.startDraw(ptr.wx, ptr.wy, 1 - e.clientY / innerHeight, hit && hit.type === 'star' ? hit.obj : null);
      did.add('draw');
      return;
    }
    const hit = uni.pick(ptr.wx, ptr.wy);
    if (hit && !hit.obj.grabbed) {
      ptr.mode = 'grab';
      ptr.target = uni.grab(hit);
      body.classList.add('grabbing');
      C.haptic('tick');
      did.add('grab');
      return;
    }
    ptr.mode = 'pending';
  });

  function updatePtr(x, y) {
    const now = performance.now();
    const dt = Math.max(0.001, (now - ptr.lastT) / 1000);
    const [wx, wy] = toWorld(x, y);
    const dwx = wrap(wx - ptr.wx), dwy = wrap(wy - ptr.wy);
    const k = Math.min(1, dt * 25);
    ptr.vx += (dwx / dt - ptr.vx) * k;
    ptr.vy += (dwy / dt - ptr.vy) * k;
    const spx = Math.hypot(x - ptr.x, y - ptr.y) / dt;
    ptr.speed += (spx - ptr.speed) * k;
    ptr.moved += Math.hypot(x - ptr.x, y - ptr.y);
    ptr.x = x; ptr.y = y; ptr.wx = wx; ptr.wy = wy;
    ptr.lastT = now;
    ptr.inside = true;
  }

  addEventListener('pointermove', (e) => {
    if (e.pointerType === 'touch' && touches.has(e.pointerId)) {
      touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pinch && touches.size === 2) {
        const [a, b] = [...touches.values()];
        const d = Math.hypot(a.x - b.x, a.y - b.y), cx = (a.x + b.x) / 2, cy = (a.y + b.y) / 2;
        zoomAt(cx, cy, pinch.d / Math.max(1, d));
        const [w0x, w0y] = toWorld(pinch.cx, pinch.cy), [w1x, w1y] = toWorld(cx, cy);
        cam.tx = wrap(cam.tx - wrap(w1x - w0x));
        cam.ty = wrap(cam.ty - wrap(w1y - w0y));
        panVelocity(-wrap(w1x - w0x), -wrap(w1y - w0y));
        pinch.moved = (pinch.moved || 0) + Math.abs(d - pinch.d) + Math.hypot(cx - pinch.cx, cy - pinch.cy);
        Object.assign(pinch, { d, cx, cy });
        return;
      }
    }
    if (e.target !== canvas && !ptr.down) { ptr.inside = false; return; }
    markInput();
    const px = ptr.x, py = ptr.y;
    updatePtr(e.clientX, e.clientY);
    if (!ptr.down) return;
    if (ptr.mode === 'pending' && Math.hypot(e.clientX - ptr.dx, e.clientY - ptr.dy) > 9) {
      ptr.mode = 'stir';
      did.add('stir');
      const [sx, sy] = toWorld(ptr.dx, ptr.dy);
      uni.dragStart(sx, sy);
    }
    if (ptr.mode === 'stir') {
      const [ax, ay] = toWorld(px, py);
      const steps = Math.min(4, 1 + Math.floor(Math.hypot(e.clientX - px, e.clientY - py) / 30));
      for (let i = 1; i <= steps; i++) {
        const t = i / steps;
        uni.dragMove(wrap(ax + wrap(ptr.wx - ax) * t), wrap(ay + wrap(ptr.wy - ay) * t), ptr.vx * 0.9, ptr.vy * 0.9);
      }
    } else if (ptr.mode === 'draw') {
      uni.addDraw(ptr.wx, ptr.wy, 1 - e.clientY / innerHeight);
    } else if (ptr.mode === 'pan') {
      const [ax, ay] = toWorld(px, py);
      cam.tx = wrap(cam.tx - wrap(ptr.wx - ax));
      cam.ty = wrap(cam.ty - wrap(ptr.wy - ay));
      panVelocity(-wrap(ptr.wx - ax), -wrap(ptr.wy - ay));
    }
  });

  function cancelPointer() {
    if (ptr.mode === 'charge') uni.releaseCharge();
    if (ptr.mode === 'grab' && ptr.target) uni.releaseGrab(ptr.target, 0, 0);
    if (ptr.mode === 'draw') uni.endDraw();
    if (ptr.mode === 'stir') uni.dragEnd(0, 0);
    ptr.mode = 'none';
    ptr.down = false;
    ptr.target = null;
    audio.setStir(0, 0);
    body.classList.remove('grabbing');
  }

  function endPointer(e) {
    if (e.pointerType === 'touch') {
      touches.delete(e.pointerId);
      if (pinch) {
        // a quick two-finger tap (no pinching) glides you out into the world around this one
        if (touches.size < 2 && (pinch.moved || 0) < 24 && performance.now() - pinch.t0 < 350 && state === 'live') {
          auto = { dir: 1 };
          C.haptic('arrive');
          uni._found('twotap', 'two fingers: rise out of this world');
        }
        if (touches.size < 2) pinch = null;
        return;
      }
    }
    if (!ptr.down) return;
    const heldS = (performance.now() - ptr.downT) / 1000;
    if (ptr.mode === 'pending' && heldS < 0.35) {
      uni.ping(ptr.wx, ptr.wy, 1 - ptr.y / innerHeight);
      did.add('tap');
      C.haptic('tap');
      // double tap on touch screens: glide into whatever you tapped
      const now = performance.now();
      if (e.pointerType === 'touch' && lastTap && now - lastTap.t < 320 && Math.hypot(ptr.x - lastTap.x, ptr.y - lastTap.y) < 40) {
        if (ensureInner(uni.diveTarget(ptr.wx, ptr.wy))) { auto = { dir: -1 }; C.haptic('arrive'); }
        lastTap = null;
      } else lastTap = { t: now, x: ptr.x, y: ptr.y };
    } else if (ptr.mode === 'charge' || ptr.mode === 'pending') {
      if (ptr.mode === 'pending') uni.startCharge(ptr.wx, ptr.wy, 1 - ptr.y / innerHeight);
      const r = uni.releaseCharge();
      did.add(r === 'star' ? 'star' : 'burst');
      C.haptic(r === 'star' ? 'bloom' : 'thud');
    } else if (ptr.mode === 'grab' && ptr.target) {
      uni.releaseGrab(ptr.target, ptr.vx, ptr.vy);
    } else if (ptr.mode === 'draw') {
      uni.endDraw();
    } else if (ptr.mode === 'stir') {
      uni.dragEnd(ptr.vx, ptr.vy);
    }
    ptr.mode = 'none';
    ptr.down = false;
    ptr.target = null;
    audio.setStir(0, 0);
    body.classList.remove('grabbing');
  }
  addEventListener('pointerup', endPointer);
  addEventListener('pointercancel', endPointer);
  canvas.addEventListener('pointerleave', () => { if (!ptr.down) ptr.inside = false; });
  let lastTap = null;

  // on touch screens there is no keyboard, so the scale lives on a row of pads
  const pads = $('pads');
  if (pads) {
    for (let i = 0; i < 8; i++) {
      const b = document.createElement('button');
      b.dataset.i = i;
      b.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (state === 'intro') { wake(); return; }
        if (!paused) audio.resume();
        const x = ptr.inside ? ptr.wx : cam.x, y = ptr.inside ? ptr.wy : cam.y;
        uni.playKey(i, x, y);
        did.add('key');
        C.haptic('tick');
        b.classList.add('hit');
        setTimeout(() => b.classList.remove('hit'), 180);
      });
      pads.appendChild(b);
    }
  }

  // double-click: glide into the thing (or follow a creature)
  canvas.addEventListener('dblclick', (e) => {
    if (state !== 'live') return;
    const [wx, wy] = toWorld(e.clientX, e.clientY);
    const hit = uni.pick(wx, wy);
    if (hit && hit.type === 'singer') {
      cam.follow = cam.follow === hit.obj ? null : hit.obj;
      if (cam.follow) uni._found('follow', 'riding along — double-click empty space to let go');
      return;
    }
    cam.follow = null;
    const target = uni.diveTarget(wx, wy);
    if (ensureInner(target)) auto = { dir: -1 };
  });

  function zoomAt(px, py, factor) {
    const [wx, wy] = toWorld(px, py);
    const old = cam.tViewH;
    const nh = C.clamp(old * factor, 0.02, 400);
    if (nh > 22 && factor > 1) uni._found('leave', 'keep zooming out — every world is inside another');
    if (nh < 3 && factor < 1) uni._found('fall', 'keep zooming in — everything has a world inside it');
    cam.tViewH = nh;
    if (!cam.follow) {
      const s = nh / old;
      cam.tx = wrap(wx + wrap(cam.tx - wx) * s);
      cam.ty = wrap(wy + wrap(cam.ty - wy) * s);
    }
  }
  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    markInput();
    if (state !== 'live') return;
    auto = null;
    let d = e.deltaY * (e.deltaMode === 1 ? 33 : e.deltaMode === 2 ? 400 : 1);
    d = C.clamp(d, -240, 240);
    zoomAt(e.clientX, e.clientY, Math.exp(d * 0.0016));
  }, { passive: false });

  // ------------------------------------------------------------------ keyboard
  const LOW = ['KeyA', 'KeyS', 'KeyD', 'KeyF', 'KeyG', 'KeyH', 'KeyJ', 'KeyK', 'KeyL', 'Semicolon'];
  const UP = ['KeyQ', 'KeyW', 'KeyE', 'KeyR', 'KeyT', 'KeyY', 'KeyU', 'KeyI', 'KeyO'];
  const BOT = ['KeyZ', 'KeyX', 'KeyC', 'KeyV', 'KeyB', 'KeyN', 'KeyM'];
  const arrows = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, 1], ArrowDown: [0, -1] };
  const held = new Set();
  addEventListener('keydown', (e) => {
    if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT')) return;
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    markInput();
    if (e.code === 'Tab') { e.preventDefault(); body.classList.toggle('hide-ui'); return; }
    if (state === 'intro') {
      if (e.code === 'Space' || e.code === 'Enter') { e.preventDefault(); wake(); }
      return;
    }
    const len = uni.scale.length;
    let idx = null;
    if (LOW.includes(e.code)) idx = LOW.indexOf(e.code);
    else if (UP.includes(e.code)) idx = UP.indexOf(e.code) + len;
    else if (BOT.includes(e.code)) idx = BOT.indexOf(e.code) - len;
    if (idx !== null) {
      if (e.repeat) return;
      const x = ptr.inside ? ptr.wx : cam.x, y = ptr.inside ? ptr.wy : cam.y;
      uni.playKey(idx, x, y);
      did.add('key');
      return;
    }
    if (arrows[e.code]) { held.add(e.code); e.preventDefault(); return; }
    switch (e.code) {
      case 'Space': e.preventDefault(); slowHeld = true; uni._found('slow', 'time, slowed'); break;
      case 'KeyP': togglePause(); break;
      case 'Escape': if (anyPanelOpen()) closePanels(); else auto = { dir: 1 }; break;
      case 'Backspace': auto = { dir: 1 }; break;
      case 'Enter': if (ensureInner(uni.diveTarget(ptr.inside ? ptr.wx : cam.x, ptr.inside ? ptr.wy : cam.y))) auto = { dir: -1 }; break;
      case 'Equal': case 'NumpadAdd': zoomAt(innerWidth / 2, innerHeight / 2, 0.8); break;
      case 'Minus': case 'NumpadSubtract': zoomAt(innerWidth / 2, innerHeight / 2, 1.25); break;
      case 'Slash': togglePanel('pHelp'); break;
    }
  });
  addEventListener('keyup', (e) => {
    held.delete(e.code);
    if (e.code === 'Space') slowHeld = false;
  });

  // ------------------------------------------------------------------ drag & drop songs
  addEventListener('dragover', (e) => { e.preventDefault(); body.classList.add('dragging'); });
  addEventListener('dragleave', (e) => { if (e.relatedTarget == null) body.classList.remove('dragging'); });
  addEventListener('drop', async (e) => {
    e.preventDefault();
    body.classList.remove('dragging');
    const files = await C.filesFromDrop(e.dataTransfer);
    if (files.length) addSongs(files);
  });
  // songs join the playlist (kept on this device) and the first one starts
  const playlist = new C.Playlist(music, {
    wake: () => { if (state === 'intro') wake(); },
    toast: (a, b) => showToast(a, b),
    world: () => cur.world.name,
  });
  const pack = new C.SoundPack(audio);
  async function addSongs(files) {
    if (state === 'intro') wake();
    const n = await playlist.add(files);
    if (n > 1) showToast(n + ' songs in your playlist', 'kept on this device · ⏭ or the lock screen skips');
  }

  // ------------------------------------------------------------------ interface
  const panels = ['pMusic', 'pSettings', 'pHelp', 'pJournal'];
  const anyPanelOpen = () => panels.some((p) => $(p).classList.contains('open'));
  function closePanels() { panels.forEach((p) => $(p).classList.remove('open')); }
  function togglePanel(id) {
    const open = $(id).classList.contains('open');
    closePanels();
    if (!open) $(id).classList.add('open');
  }
  function togglePause() {
    if (state === 'intro') return;
    paused = !paused;
    body.classList.toggle('paused', paused);
    $('bPause').classList.toggle('on', paused);
    if (paused) { audio.suspend(); if (music.el) music.el.pause(); }
    else { audio.resume(); if (music.el && music.kind === 'file') music.el.play(); }
  }
  $('bPause').onclick = togglePause;
  $('bDraw').onclick = () => { drawMode = !drawMode; $('bDraw').classList.toggle('on', drawMode); };
  $('bMusic').onclick = () => { if (state === 'intro') wake(); togglePanel('pMusic'); };
  $('bSettings').onclick = () => togglePanel('pSettings');
  $('bJournal').onclick = () => { $('bJournal').classList.remove('news'); togglePanel('pJournal'); renderJournal(); };
  $('bForget').onclick = async () => {
    if (!confirm('Forget every world, every species and every discovery on this device? This cannot be undone.')) return;
    await C.multiverse.forgetAll();
    clearTimeout(cellsSaveT); cells.clear(); cellsDirty = false; try { localStorage.removeItem(CELLS_KEY); } catch (e) {} // and where worlds lay
    C.journal.clear();
    // start again from a new seed of a universe (the worlds alive in memory would otherwise live on)
    location.reload();
  };
  $('bHelp').onclick = () => togglePanel('pHelp');
  $('bFull').onclick = () => { if (document.fullscreenElement) document.exitFullscreen(); else document.documentElement.requestFullscreen().catch(() => {}); };
  $('mFile').onclick = () => $('file').click();
  $('file').onchange = (e) => { const fs = [...e.target.files]; if (fs.length) addSongs(fs); e.target.value = ''; };
  $('mFolder').onclick = () => $('folder').click();
  $('folder').onchange = (e) => { const fs = [...e.target.files].filter(C.isAudioFile).sort((a, b) => (a.webkitRelativePath || a.name).localeCompare(b.webkitRelativePath || b.name)); if (fs.length) addSongs(fs); else showToast('no songs in that folder'); e.target.value = ''; };
  $('pPrev').onclick = () => playlist.prev();
  $('pNext').onclick = () => playlist.next();
  $('pPlay').onclick = () => playlist.toggle();
  $('pShuffle').onclick = () => playlist.setShuffle(!playlist.shuffle);
  const packStatus = () => { $('packStatus').textContent = pack.items.length ? pack.items.length + ' sound' + (pack.items.length > 1 ? 's' : '') + ': ' + pack.items.map((x) => x.name + ' (' + C.NOTE_NAMES[x.root % 12] + (Math.floor(x.root / 12) - 1) + ')').join(', ') : 'No sounds of yours yet.'; $('sPack').checked = pack.on; };
  $('mPack').onclick = () => $('packFile').click();
  $('packFile').onchange = async (e) => {
    const fs = [...e.target.files];
    e.target.value = '';
    if (state === 'intro') wake();
    const n = await pack.add(fs);
    showToast(n ? 'the creatures have your voice now' : 'those files could not be used', n ? n + ' sound' + (n > 1 ? 's' : '') + ' kept on this device' : 'try short wav or mp3 samples');
    packStatus();
  };
  $('sPack').onchange = (e) => { pack.setOn(e.target.checked); packStatus(); };
  $('mPackClear').onclick = () => { pack.clear(); packStatus(); };
  $('mTab').onclick = async () => {
    if (state === 'intro') wake();
    try { await music.useTab(); showToast('listening', 'to the tab you shared'); }
    catch (err) { showToast('no tab audio', String(err.message || err)); }
  };
  $('mMic').onclick = async () => {
    if (state === 'intro') wake();
    try { await music.useMic(); showToast('listening', 'through the microphone'); }
    catch (err) { showToast('microphone unavailable', String(err.message || err)); }
  };
  $('mPlay').onclick = () => { if (music.kind === 'file' || !music.active) playlist.toggle(); else music.togglePlay(); };
  $('mStop').onclick = () => { music.stop(); musicKey = null; playlist.render(); };
  music.onKey = (k) => {
    musicKey = k;
    let fit = null;
    for (const L of liveLayers()) { const f = L.uni.fitKey(music.chromaLong, k); if (L === cur) fit = f; }
    showToast('it has learned the notes of your song', fit ? 'retuning to ' + fit.name + ' so every world plays along' : 'this world keeps its own strange scale');
  };

  const sVol = $('sVol'), sMusicVol = $('sMusicVol'), sInt = $('sInt'), sTrail = $('sTrail'), sQual = $('sQual');
  sVol.value = settings.volume; sMusicVol.value = settings.musicVolume; sInt.value = settings.intensity; sTrail.value = settings.trails; sQual.value = settings.quality;
  $('sGuard').checked = settings.strongGuard; $('sReduced').checked = settings.reduced; $('sSynth').checked = settings.synth; $('sHints').checked = settings.hints;
  sVol.oninput = () => { settings.volume = +sVol.value; audio.setVolume(settings.volume); saveSettings(); };
  sMusicVol.oninput = () => { settings.musicVolume = +sMusicVol.value; audio.setMusicVolume(settings.musicVolume); saveSettings(); };
  sInt.oninput = () => { settings.intensity = +sInt.value; saveSettings(); };
  sTrail.oninput = () => { settings.trails = +sTrail.value; saveSettings(); };
  sQual.onchange = () => { settings.autoDetail = false; setQuality(sQual.value); };
  function setQuality(q) {
    settings.quality = q; sQual.value = q; saveSettings();
    // rebuild every live world at the new detail
    for (const L of liveLayers()) {
      renderer.destroyLayer(L.gpu);
      L.gpu = renderer.createLayer(QUALITY[settings.quality].side);
      L.uni.gpu = L.gpu;
      renderer.use(L.gpu);
      const here = L === cur || (side && L === side.L);
      L.uni.gpuInit(renderer, here ? cam.x : 0, here ? cam.y : 0);
      L.prevCam = null;
    }
    resize();
  }
  // Frame budget: if it can't keep up for several seconds, step the detail down one notch (never up on
  // its own, and never while a membrane is opening, when a third world briefly warms up). Choosing a
  // detail yourself turns this off.
  const LADDER = ['ultra', 'high', 'phone', 'low'];
  let slowFor = 0, budgetQuiet = 8;
  function frameBudget(realDt) {
    if (settings.autoDetail === false || state !== 'live' || paused || document.hidden || /[?&]drive/.test(location.search)) return;
    budgetQuiet -= realDt;
    if (inner && weightOf(cam.viewH * inner.link.S) > 0) budgetQuiet = Math.max(budgetQuiet, 2);
    if (budgetQuiet > 0) { slowFor = 0; return; }
    slowFor = fps < 42 ? slowFor + realDt : Math.max(0, slowFor - realDt * 2);
    if (slowFor < 5) return;
    slowFor = 0;
    budgetQuiet = 20;
    const i = LADDER.indexOf(settings.quality);
    if (i < 0 || i === LADDER.length - 1) return;
    setQuality(LADDER[i + 1]);
    showToast('lighter detail, to keep it smooth', 'change it in ⚙ any time');
  }
  $('sGuard').onchange = (e) => { settings.strongGuard = e.target.checked; saveSettings(); };
  $('sReduced').onchange = (e) => { settings.reduced = e.target.checked; saveSettings(); };
  $('sSynth').onchange = (e) => { settings.synth = e.target.checked; audio.setSynthOn(settings.synth); saveSettings(); };
  $('sHints').onchange = (e) => { settings.hints = e.target.checked; saveSettings(); };
  const sScore = $('sScore');
  sScore.value = audio.scoreVolume;
  sScore.oninput = () => audio.setScoreVolume(+sScore.value);
  $('sHaptics').checked = C.haptics.on;
  $('sHaptics').onchange = (e) => { C.haptics.on = e.target.checked; C.storage.set('haptics', C.haptics.on); C.haptic('tap'); };
  $('bInstall').onclick = () => C.install();
  $('sBuild').textContent = 'build ' + C.BUILD.sha + (C.BUILD.date ? ' · ' + C.BUILD.date : '');
  if (C.device.ios && !C.device.standalone) $('installHow').textContent = 'Make it an app: Safari → Share → Add to Home Screen.';
  // iOS can pause sound while the app is in the background; the next touch brings it back
  document.addEventListener('visibilitychange', () => { if (!document.hidden && state === 'live' && !paused) audio.resume(); });
  // ...and if the sound is suspended or interrupted while you are here (a call, Siri, an overloaded audio
  // thread), ask for it back at once; if the system says no, your next touch does it
  audio.onState = (s) => {
    if (s === 'running' || s === 'closed' || state !== 'live' || paused || document.hidden) return;
    setTimeout(() => { if (state === 'live' && !paused && !document.hidden) audio.resume(); }, 300);
  };

  // toasts
  const toastQ = [];
  let toastT = 0;
  function showToast(title, sub, sub2, priority) {
    if (priority) { toastQ.length = 0; toastT = Math.min(toastT, -1.3); }
    toastQ.push({ title, sub, sub2, at: performance.now() });
    while (toastQ.length > 3) toastQ.shift();
  }
  function updateToast(dt) {
    toastT -= dt;
    const el = $('toast');
    if (toastT <= 0.0 && el.classList.contains('on')) { el.classList.remove('on'); toastT = -1.2; }
    if (toastT < -1.2 && toastQ.length) {
      let t = toastQ.shift();
      while (t && toastQ.length && performance.now() - t.at > 8000) t = toastQ.shift();
      el.innerHTML = '';
      el.appendChild(document.createTextNode(t.title));
      if (t.sub) { const s = document.createElement('small'); s.textContent = t.sub; el.appendChild(s); }
      if (t.sub2) { const s = document.createElement('small'); s.className = 'verbs'; s.textContent = t.sub2; el.appendChild(s); }
      el.classList.add('on');
      toastT = t.sub2 ? 7 : 4.2;
    }
  }

  // hints: one at a time, only for things not yet discovered
  const HINTS = [
    { id: 'move', at: 4, text: 'move slowly — they can feel you', done: () => ptr.moved > 600 },
    { id: 'hold', at: 11, text: 'press and hold to gather light', done: () => did.has('burst') || did.has('star') },
    { id: 'stir', at: 24, text: 'drag to stir the tide', done: () => did.has('stir') },
    { id: 'zoom', at: 34, text: 'scroll into anything — there is a world inside it', done: () => did.has('dive') },
    { id: 'keys', at: 50, text: 'keys A S D F G H J K L sing — listen for an answer', done: () => did.has('key') },
    { id: 'pulsar', at: 64, text: 'hold even longer and a pulsar is born', done: () => did.has('star') },
    { id: 'draw', at: 80, text: 'right-drag to draw a melody that comes alive', done: () => did.has('draw') },
    { id: 'music', at: 110, text: 'drop a song anywhere — it will listen', done: () => music.active },
  ];
  const hintShown = new Set();
  let hintT = 0, hintGap = 0;
  let sessionStart = performance.now();
  function updateHints(dt) {
    const el = $('hint');
    hintT -= dt;
    hintGap -= dt;
    if (hintT <= 0 && el.classList.contains('on')) { el.classList.remove('on'); hintGap = 7; }
    if (!settings.hints || state !== 'live' || hintT > 0 || hintGap > 0 || (uni.genus !== 'tide' && !did.has('dive'))) return;
    const age = (performance.now() - sessionStart) / 1000;
    // once, on an iPhone in Safari: how to keep it as an app
    if (age > 75 && C.installHintDue()) {
      C.installHinted();
      showToast('keep COSMOS as an app', 'Share → Add to Home Screen', 'it opens full screen, works offline and can feel your tilt');
      return;
    }
    for (const h of HINTS) {
      if (hintShown.has(h.id) || h.done() || age < h.at) continue;
      if (uni.genus !== 'tide' && h.id !== 'zoom' && h.id !== 'music') continue;
      hintShown.add(h.id);
      el.textContent = h.text;
      el.classList.add('on');
      hintT = 6;
      break;
    }
  }

  // ------------------------------------------------------------------ the journal
  const ago = (ms) => { const s = (Date.now() - ms) / 1000; return s < 90 ? 'just now' : s < 5400 ? Math.round(s / 60) + ' min ago' : s < 129600 ? Math.round(s / 3600) + ' h ago' : Math.round(s / 86400) + ' days ago'; };
  const BARS = '▁▂▃▄▅▆▇█';
  const songShape = (m) => { if (!m) return ''; const pts = [0]; for (let i = 0; i < 3; i++) pts.push(pts[i] + m[i]); const lo = Math.min(...pts), hi = Math.max(...pts); return '♪' + pts.map((p) => BARS[hi === lo ? 3 : Math.round(((p - lo) / (hi - lo)) * 7)]).join(''); };
  const traitWords = (d) => [d[1] > 0.5 ? 'hunter' : 'grazer', d[3] < 0.3 ? 'cold-loving' : d[3] > 0.7 ? 'heat-loving' : 'temperate', d[2] > 0.6 ? 'fast' : d[2] < 0.25 ? 'slow' : ''].filter(Boolean).join(' · ');
  function renderJournal() {
    if (!$('pJournal').classList.contains('open')) return;
    const u = cur.uni, here = $('jHere');
    here.innerHTML = '';
    const head = document.createElement('div');
    head.className = 'env';
    const alive = u.singers.filter((x) => !x.dying).length;
    head.textContent = cur.world.name + ' · ' + u.env.word + ' (warmth ' + u.env.warmth.toFixed(2) + ') · ' + alive + ' singers' + (u.songSpecies ? ' · the score sings the song of the ' + u.songSpecies : '');
    here.appendChild(head);
    // the music here, in words, and taking it away
    if (composer && composer.uni === u && composer.words) {
      const mu = document.createElement('div');
      mu.className = 'env';
      mu.textContent = '♪ the music here ' + (C.FORM_WORDS[composer.form] || '') + ': ' + composer.words;
      here.appendChild(mu);
      const row = document.createElement('div');
      row.className = 'row';
      const mid = document.createElement('button');
      mid.textContent = 'keep the last 2 minutes (MIDI)';
      mid.onclick = () => saveMidi(u);
      const rec = document.createElement('button');
      rec.textContent = C.Capture && C.Capture.rec ? 'stop recording' : 'record a minute';
      rec.onclick = () => {
        if (C.Capture.rec) { C.Capture.stop(); return; }
        const p = C.Capture.record(audio, 60);
        if (!p) { showToast('this browser cannot record sound', 'the MIDI still works'); return; }
        showToast('recording', 'a minute of what you hear; tap again to stop sooner');
        const name = u.world.name.replace(/[^\w ]+/g, '');
        p.then((blob) => { C.Capture.save(blob, 'COSMOS ' + name + (/mp4/.test(blob.type) ? '.m4a' : /ogg/.test(blob.type) ? '.ogg' : '.webm')); renderJournal(); });
        renderJournal();
      };
      row.append(mid, rec);
      here.appendChild(row);
    }
    if (alive) {
      // time-lapse: watch evolution happen instead of waiting for it
      const tl = document.createElement('button');
      tl.className = 'wide';
      tl.textContent = 'Let an hour pass here';
      tl.onclick = () => timeLapse(u);
      here.appendChild(tl);
    }
    const sps = (u.species || []).filter((x) => !x.extinct && x.count > 0).sort((a, b) => b.count - a.count).slice(0, 8);
    if (!sps.length) { const p = document.createElement('div'); p.className = 'tiny'; p.textContent = alive ? 'No species told apart yet; give them a little time.' : 'Nothing that sings lives here (yet).'; here.appendChild(p); }
    for (const sp of sps) {
      const row = document.createElement('div');
      row.className = 'jsp';
      const a = document.createElement('span'); a.className = 'nm';
      const par = (u.species || []).find((x) => x.id === sp.parent);
      a.textContent = sp.name + (sp.status === 'emerging' ? ' (emerging)' : '') + (par ? ' ← ' + par.name : '');
      const b = document.createElement('span'); b.className = 'tr';
      // where its family began (lineages are inherited across worlds)
      const lins = new Map();
      for (const x of u.singers) if (x.sp === sp.id && !x.dying) lins.set(x.lin, (lins.get(x.lin) || 0) + 1);
      let lin = null, ln = 0;
      for (const [k, v] of lins) if (v > ln) { ln = v; lin = k; }
      const fam = lin && C.multiverse.lineages[lin];
      const from = fam && fam.home !== cur.seed ? ' · family from ' + fam.homeName : '';
      b.textContent = sp.count + ' · ' + traitWords(sp.centroid) + (sp.foreignShare > 0.5 ? ' · newcomers' : '') + from + ' ' + songShape(sp.motif);
      row.append(a, b);
      here.appendChild(row);
    }
    drawTree(u);
    const list = $('jList');
    list.innerHTML = '';
    if (!C.journal.list.length) { const p = document.createElement('div'); p.className = 'tiny'; p.textContent = 'No discoveries yet. Worlds need time: species form, hunters evolve, songs drift. Wander, come back later.'; list.appendChild(p); }
    for (const d of C.journal.list.slice(0, 60)) {
      const row = document.createElement('div'); row.className = 'jd';
      const tx = document.createElement('div'); tx.className = 'tx'; tx.textContent = '★ ' + d.text;
      const meta = document.createElement('div'); meta.className = 'meta';
      const where = document.createElement('span'); where.textContent = d.worldName + ' · ' + ago(d.at);
      meta.appendChild(where);
      if (d.notes && d.notes.length) { const mb = document.createElement('button'); mb.textContent = 'MIDI'; mb.onclick = () => saveMidi({ world: { seed: d.world, name: d.worldName } }, d.notes, d.text.slice(0, 40), d.meter, d.tempos); meta.appendChild(mb); }
      if (d.world !== cur.seed) { const go = document.createElement('button'); go.textContent = 'go there'; go.onclick = () => { closePanels(); visitSeed(d.world); }; meta.appendChild(go); }
      else if (d.snapshot && C.multiverse.valid(d.snapshot)) {
        // reproduce it: put this world back exactly as it was at the moment of the discovery
        const re = document.createElement('button'); re.textContent = 'relive';
        re.onclick = () => {
          if (!confirm('Put ' + d.worldName + ' back the way it was when this happened? What lives there now will be replaced.')) return;
          C.multiverse.restore(cur.uni, d.snapshot, true);
          showToast('back to that moment', d.text);
          renderJournal();
        };
        meta.appendChild(re);
      }
      row.append(tx, meta);
      list.appendChild(row);
    }
  }
  // The family tree of this world: each species is a line from when it appeared to when it died out (or
  // now), in its own lane, with its children just below it; a child branches from its parent's line.
  // Thickness is how many there were at their peak; colour runs from cold-loving blue to warm-loving gold.
  function drawTree(u) {
    const svg = $('jTree');
    const sps = (u.species || []).filter((x) => x.born != null && (x.peak >= 6 || (!x.extinct && x.count > 0)));
    svg.style.display = sps.length >= 2 ? 'block' : 'none';
    if (sps.length < 2) return;
    const t0 = Math.min(...sps.map((x) => x.born)), t1 = Math.max(u.time, t0 + 1);
    const byId = new Map(sps.map((x) => [x.id, x]));
    // lanes in family order: each lineage's children right below it, oldest first
    const kids = new Map(), roots = [];
    for (const sp of sps) { if (byId.has(sp.parent)) { if (!kids.has(sp.parent)) kids.set(sp.parent, []); kids.get(sp.parent).push(sp); } else roots.push(sp); }
    const order = [];
    const walk = (sp) => { order.push(sp); (kids.get(sp.id) || []).sort((a, b) => a.born - b.born).forEach(walk); };
    roots.sort((a, b) => a.born - b.born).forEach(walk);
    const lane = new Map(order.map((sp, i) => [sp.id, i]));
    const X = (t) => 8 + ((t - t0) / (t1 - t0)) * 284, Y = (sp) => 6 + (lane.get(sp.id) / Math.max(1, order.length - 1)) * 100;
    const col = (sp) => C.cssColor(C.hsl(0.6 - 0.48 * C.clamp(sp.centroid[3], 0, 1), 0.8, 0.6));
    let out = '<line x1="8" y1="113" x2="292" y2="113" stroke="rgba(255,255,255,0.12)" stroke-width="0.5"/><text x="8" y="120">then</text><text x="292" y="120" text-anchor="end">blue loves cold · gold loves warmth · now</text>';
    for (const sp of sps) {
      const x0 = X(sp.born), x1 = X(sp.extinct ? (sp.extinctT || sp.born + 60) : u.time), y = Y(sp), w = 0.8 + Math.sqrt(sp.peak || 1) * 0.55;
      const par = byId.get(sp.parent);
      if (par) out += `<path d="M${X(sp.born).toFixed(1)},${Y(par).toFixed(1)} C${(x0 + 6).toFixed(1)},${Y(par).toFixed(1)} ${(x0 + 2).toFixed(1)},${y.toFixed(1)} ${(x0 + 8).toFixed(1)},${y.toFixed(1)}" fill="none" stroke="${col(sp)}" stroke-width="0.6" opacity="0.6"/>`;
      out += `<line x1="${x0.toFixed(1)}" y1="${y.toFixed(1)}" x2="${Math.max(x0 + 2, x1).toFixed(1)}" y2="${y.toFixed(1)}" stroke="${col(sp)}" stroke-width="${w.toFixed(1)}" stroke-linecap="round" opacity="${sp.extinct ? 0.35 : 0.9}"/>`;
      if (!sp.extinct && sp.count > 0) out += `<circle cx="${x1.toFixed(1)}" cy="${y.toFixed(1)}" r="${(w * 0.9).toFixed(1)}" fill="${col(sp)}"/>`;
    }
    svg.innerHTML = out;
  }
  function timeLapse(u) {
    const now = Date.now();
    const eco = C.Eco.advance(u, 3600e3, now - 3600e3, C.hash(u.world.seed, now));
    C.Observatory.rebase(u);
    u._obsT = -1e9;
    u.lastWall = now;
    const allow = C.flash.request(0.4);
    u.addRing(cam.x, cam.y, 0.3, cam.viewH * 0.7, 3.5, u.palette.accent, 0.03, 0.6 * allow);
    audio.whoosh(2.2, true);
    const parts = awayParts({ eco });
    showToast('an hour passes', parts.length ? parts.join(' · ') : 'little changed');
    setTimeout(renderJournal, 400);
  }
  C.journal.listeners.push(() => renderJournal());
  C.journal.load();
  let journalT = 0;

  // HUD
  let hudT = 0;
  function updateHud(dt) {
    hudT -= dt;
    journalT -= dt;
    if (journalT <= 0) { journalT = 2; renderJournal(); }
    if (hudT > 0) return;
    hudT = 0.4;
    const w = cur.world;
    $('worldName').textContent = w.name;
    const d = cur.depth;
    const cell = cellOf(cur.seed);
    const away = (cell.ix ? Math.abs(cell.ix) + (cell.ix > 0 ? ' east' : ' west') : '') + (cell.ix && cell.iy ? ' ' : '') + (cell.iy ? Math.abs(cell.iy) + (cell.iy > 0 ? ' north' : ' south') : '');
    const depth = (d === 0 ? (away ? 'beside the origin' : 'origin') : d > 0 ? 'depth ' + d : 'outside ' + -d) + (away ? ' · ' + away : '');
    const key = C.NOTE_NAMES[((uni.root % 12) + 12) % 12] + ' ' + uni.scaleName;
    const meter = composer && composer.uni === uni && composer.plan ? ' · ' + (composer.plan.meter === 'free' ? 'free time' : composer.plan.meter) : '';
    $('worldMeta').textContent = `${C.describeWorld(w)} · ${key}${meter} · ${Math.round(audio.bpm / (1 - slow * 0.65))} bpm · ${uni.env.word} · ${depth}`;
    const census = uni.census();
    const mx = Math.max(1, ...census);
    const chord = $('chord');
    if (chord.children.length !== 12) { chord.innerHTML = ''; for (let i = 0; i < 12; i++) chord.appendChild(document.createElement('i')); }
    if (pads) for (const b of pads.children) {
      const col = C.cssColor(C.hsl(C.pcHue(uni.pcOf(+b.dataset.i)), 0.8, 0.6));
      b.style.borderColor = col;
      b.style.color = col;
    }
    for (let i = 0; i < 12; i++) {
      const pc = (i * 7) % 12;
      const el = chord.children[i];
      const s = census[pc] ? 3 + 7 * Math.sqrt(census[pc] / mx) : 2;
      el.style.width = el.style.height = s + 'px';
      const col = C.cssColor(C.hsl(C.pcHue(pc), 0.85, 0.6));
      el.style.background = col;
      el.style.color = col;
      el.style.opacity = census[pc] ? 0.9 : 0.15;
    }
    playlist.tick();
    if ($('pMusic').classList.contains('open')) {
      let st = 'Not listening.';
      if (music.active) {
        st = 'Listening to ' + music.label;
        if (music.key) st += ' · in tune with it';
        if (music.tempo && music.tempoConf > 0.3) st += ' · ~' + Math.round(music.tempo) + ' bpm';
      }
      $('mStatus').textContent = st;
    }
    if ($('pSettings').classList.contains('open')) {
      $('sStats').textContent = `${Math.round(fps)} fps · ${renderer.layers.size} live worlds · ${uniCache.size} remembered · ${uni.singers.length} singers here`;
    }
  }
  const specCtx = $('mSpec').getContext('2d');
  function drawSpec() {
    if (!$('pMusic').classList.contains('open')) return;
    const c = specCtx, W = 240, H = 34;
    c.clearRect(0, 0, W, H);
    const b = music.bands, names = ['sub', 'bass', 'lowmid', 'mid', 'high', 'air'];
    names.forEach((n, i) => {
      c.fillStyle = `rgba(140,255,236,${0.25 + 0.6 * b[n]})`;
      const h = 2 + b[n] * (H - 4);
      c.fillRect(i * 20, H - h, 14, h);
    });
    for (let i = 0; i < 12; i++) {
      const pc = (i * 7) % 12;
      c.fillStyle = C.cssColor(C.hsl(C.pcHue(pc), 0.85, 0.6));
      c.globalAlpha = 0.25 + 0.75 * music.chroma[pc];
      const h = 2 + music.chroma[pc] * (H - 4);
      c.fillRect(126 + i * 9.5, H - h, 7, h);
    }
    c.globalAlpha = 1;
  }

  // ------------------------------------------------------------------ camera
  const t0 = performance.now();
  function updateCamera(dt) {
    cam.aspect = innerWidth / innerHeight;
    for (const k of held) {
      const d = arrows[k];
      cam.tx = wrap(cam.tx + d[0] * cam.viewH * 0.7 * dt);
      cam.ty = wrap(cam.ty + d[1] * cam.viewH * 0.7 * dt);
    }
    if (cam.follow) {
      if (cam.follow.dying || !uni.singers.includes(cam.follow)) cam.follow = null;
      else { cam.tx = cam.follow.x; cam.ty = cam.follow.y; }
    }
    if (auto) {
      // a smooth, unhurried fall inward (or outward), with no cut anywhere
      if (auto.until === 'settle') {
        cam.tViewH += ((auto.dir < 0 ? 11 : 14) - cam.tViewH) * C.damp(1.2, dt);
        if (Math.abs(cam.tViewH - (auto.dir < 0 ? 11 : 14)) < 0.5) auto = null;
      } else cam.tViewH *= Math.exp(auto.dir * dt * 1.15);
    }
    // a pan you let go of keeps gliding (on phones especially: a flick sends you on your way)
    if (!pinch && ptr.mode !== 'pan' && (glide.vx || glide.vy)) {
      cam.tx = wrap(cam.tx + glide.vx * dt);
      cam.ty = wrap(cam.ty + glide.vy * dt);
      const k = Math.exp(-dt * 1.8);
      glide.vx *= k; glide.vy *= k;
      if (Math.hypot(glide.vx, glide.vy) < cam.viewH * 0.01) glide.vx = glide.vy = 0;
    }
    // idle drift: the camera wanders after the life
    drifting = state === 'live' && idleTime > 30 && !cam.follow && !ptr.down && !auto;
    if (drifting) {
      let sx = 0, sy = 0, n = 0;
      for (const s of uni.singers) {
        const dx = wrap(s.x - cam.x), dy = wrap(s.y - cam.y);
        if (dx * dx + dy * dy < 100) { sx += dx; sy += dy; n++; }
      }
      const t = performance.now() / 1000;
      const driftX = Math.cos(t * 0.021) * 0.35, driftY = Math.sin(t * 0.017) * 0.35;
      if (n) { cam.tx = wrap(cam.tx + (sx / n) * dt * 0.08 + driftX * dt); cam.ty = wrap(cam.ty + (sy / n) * dt * 0.08 + driftY * dt); }
      else { cam.tx = wrap(cam.tx + driftX * dt * 2); cam.ty = wrap(cam.ty + driftY * dt * 2); }
      if (cam.tViewH > 4 && cam.tViewH < 22) cam.tViewH += ((12 + 3 * Math.sin(t * 0.04)) - cam.tViewH) * dt * 0.05;
    }
    // while a membrane is open, the camera leans gently toward it so the passage stays centred
    if (inner) {
      const w = weightOf(cam.viewH * inner.link.S);
      if (w > 0) {
        const k = C.damp(1.6, dt) * Math.min(1, w * 3);
        cam.tx = wrap(cam.tx + wrap(inner.link.ax - cam.tx) * k);
        cam.ty = wrap(cam.ty + wrap(inner.link.ay - cam.ty) * k);
      }
    } else if (outer && cur.link && cam.viewH > IN_LO) {
      const k = C.damp(1.6, dt) * Math.min(1, (1 - weightOf(cam.viewH)) * 3);
      cam.tx = wrap(cam.tx + wrap(cur.link.cx - cam.tx) * k);
      cam.ty = wrap(cam.ty + wrap(cur.link.cy - cam.ty) * k);
    }
    const k = C.damp(cam.follow ? 3 : 7, dt);
    cam.x = wrap(cam.x + wrap(cam.tx - cam.x) * k);
    cam.y = wrap(cam.y + wrap(cam.ty - cam.y) * k);
    const kz = C.damp(state === 'intro' ? 1 : 5, dt);
    cam.viewH = Math.exp(Math.log(cam.viewH) + (Math.log(cam.tViewH) - Math.log(cam.viewH)) * kz);
    const t = (performance.now() - t0) / 1000;
    cam.roll = settings.reduced ? 0 : Math.sin(t * 0.027) * 0.06 * (0.4 + settings.intensity);
    cam.h = cam.viewH / (2 * C.TAN_HALF);
  }

  // Keep the stack of worlds in step with the zoom: create, reveal, hand over, release.
  function updateStack(realDt) {
    if (state !== 'live') return;
    // the worlds beside: travelled into sideways
    updateSide(realDt);
    // while a side passage is on screen the zoom stack waits (no new world inside or outside, no hand-over);
    // phones never prepare a zoom world beside a neighbour (two living worlds there, three on desktops)
    const passage = !!side && (sideShown > 0 || sideWeight(trav.x * side.dx + trav.y * side.dy) > 0);
    const room = !passage && !(C.MOBILE && side);
    // the world inside: chosen as you approach, re-chosen if you aim somewhere else (at most three live worlds)
    innerCheckT -= realDt;
    if (pendingDive && !(auto && auto.dir < 0)) pendingDive = null; // you changed your mind
    if (pendingDive && room) { const t = pendingDive; pendingDive = null; ensureInner(t); }
    if (cam.viewH < 10 && innerCheckT <= 0 && room && !(side && outer)) { innerCheckT = 0.8; ensureInner(); }
    if (inner && cam.viewH > 16 && weightOf(cam.viewH * inner.link.S) === 0 && !visiting()) { dropLayer(inner); inner = null; }
    // the world outside: prepared as you pull back
    if (cam.viewH > 15 && room && !(side && inner)) ensureOuter();
    if (outer && cam.viewH < 10 && !(cur.link && weightOf(cam.viewH) < 1)) { dropLayer(outer); outer = null; }
    // hand over at the halfway point, in either direction
    if (passage) return;
    if (inner && weightOf(cam.viewH * inner.link.S) > 0.5) becomeInner();
    else if (outer && cur.link && cam.viewH > IN_LO && weightOf(cam.viewH) < 0.5) becomeOuter();
  }

  // ------------------------------------------------------------------ the living multiverse (COSMOS 4)
  let mvSaveT = 20, pressureT = 10;
  function livingWorlds() { return liveLayers().map((L) => L.uni); }
  function livingMultiverse(realDt) {
    const live = livingWorlds();
    // migrants that slipped into an orb arrive in the world inside: live if it is awake, else they wait
    for (const u of live) {
      if (!u.emigrants.length) continue;
      for (const em of u.emigrants.splice(0)) {
        const target = uniCache.get(em.to);
        const lk = links.get(em.to);
        if (target && !target.restoring) {
          target.immigrate([em], lk ? lk.cx : 0, lk ? lk.cy : 0, em.fromCol);
          // a sleeping (cached) world is not in the regular saves: write it now so the newcomer is kept
          if (!live.includes(target)) C.multiverse.save(target);
        } else C.multiverse.addArrival(em.to, em, C.worldDefs.get(em.to));
      }
    }
    // overcrowded worlds inside an orb burst out: a rift that pours their real creatures into this one
    pressureT -= realDt;
    if (pressureT <= 0) {
      pressureT = 8;
      const u = cur.uni;
      if (!u.rift && u.intro < 0.1) for (const o of u.orbs) {
        const child = uniCache.get(o.seed);
        if (!child || (inner && inner.uni === child) || child.restoring || o.dying || o.grabbed) continue;
        const crowd = child.singers.filter((x) => !x.dying).length;
        if (crowd >= 118 && Math.random() < 0.5) {
          const pool = child.singers.filter((x) => !x.dying && !x.leviathan).sort(() => Math.random() - 0.5).slice(0, 12);
          const list = pool.map((x) => ({ g: x.g, energy: x.energy, sp: x.sp, gen: x.gen, home: x.home, lin: x.lin, hyb: !!x.hyb, from: child.world.seed, fromCol: child.palette.hot }));
          for (const x of pool) x.dead = true, x.dying = 1;
          u._rift(o, list);
          C.multiverse.save(child); // the world they left is asleep: record that they left
          break;
        }
      }
    }
    // the observatory watches every living world
    C.Observatory.tick(live, { discover });
    // memory: the worlds you are in are saved every 20 seconds (and when you leave them)
    mvSaveT -= realDt;
    if (mvSaveT <= 0) { mvSaveT = 20; for (const u of live) C.multiverse.save(u); diaspora(cur.uni); }
  }
  // a family that has spread: the same lineage alive (5 or more) in several remembered worlds
  function diaspora(u) {
    const reg = C.multiverse.lineages, counts = C.multiverse.lineageCounts(u);
    for (const lin in counts) {
      if (counts[lin] < 5 || !reg[lin]) continue;
      const where = C.multiverse.spread(lin);
      const done = reg[lin].reported || 1;
      if (where.length < 2 || where.length <= done) continue;
      reg[lin].reported = where.length;
      C.multiverse.nameLineage(lin, reg[lin].name, reg[lin].home, reg[lin].homeName);
      C.multiverse.saveIndex();
      const names = where.map((w) => w.name).join(', ');
      C.Observatory.record(u, { kind: 'diaspora', text: 'the family of the ' + reg[lin].name + ', from ' + reg[lin].homeName + ', now lives in ' + where.length + ' worlds: ' + names }, { discover });
    }
  }
  // Everything goes in the journal; only the rarer kinds speak up, at most one every three minutes, so a
  // discovery stays an event (the journal button glows when there is something new to read).
  const LOUD = { novel: 1, hybrid: 1, invasion: 1, dialect: 1, hunters: 1, cycle: 1, chorus: 1, speciation: 1, diaspora: 1, music: 1, instrument: 1 };
  // The music of a world changed character because of who lives there now (style.js): a discovery, kept
  // with the two minutes of music around it so it can be taken away as MIDI.
  function musicShift(u, from, to, st, harmony) {
    if (!u || !u.world) return;
    const pop = st.pop, two = !harmony && st.second && st.second.name !== to;
    const why = pop && pop.foreignShare > 0.25 ? 'newcomers brought it' : pop && pop.hybShare > 0.25 ? 'its hybrids carry both' : 'its people changed';
    const text = harmony ? 'the harmony of ' + u.world.name + ' has changed from ' + harmony.from + ' to ' + harmony.to + ': ' + why
      : two ? 'two peoples share ' + u.world.name + ': one counts in ' + to + ', the other in ' + st.second.name + ', and the music plays both at once'
      : 'the music of ' + u.world.name + ' has turned from ' + from + ' to ' + to + ': ' + why;
    // the music kept with it was mostly played in the meter it is leaving (or both, for two peoples)
    const meter = C.METERS.find((m) => m.name === from) || (composer && composer.meter);
    const notes = C.Capture ? C.Capture.recent(120, u.world.seed) : null;
    C.Observatory.record(u, { kind: 'music', text, notes, tempos: notes && C.Capture.tempoMapFor(notes), meter }, { discover });
  }
  function saveMidi(u, notes, label, meter, tempos) {
    if (!C.Capture) return;
    const evs = notes || C.Capture.recent(120, u.world.seed);
    const bytes = C.Capture.midi(evs, meter || (composer && composer.uni === u ? composer.meter : null), u.world.name + (label ? ' · ' + label : ''), tempos || null);
    if (!bytes) { showToast('nothing to keep yet', 'let it play a little first'); return; }
    C.Capture.save(new Blob([bytes], { type: 'audio/midi' }), 'COSMOS ' + u.world.name.replace(/[^\w ]+/g, '') + '.mid');
  }
  let lastLoud = -1e9;
  function discover(u, rec) {
    discoveries++;
    $('bJournal').classList.add('news');
    if (composer && /dialect|invasion|hybrid|novel|speciation/.test(rec.kind)) composer.adoptSong(u);
    if (composer) composer.react(rec.kind, u);
    if (u !== cur.uni || !LOUD[rec.kind] || performance.now() - lastLoud < 180000) return;
    lastLoud = performance.now();
    showToast('★ ' + rec.text, rec.worldName, null, false);
    // a soft three-note chime in the world's own key, never a flash
    const t = audio.now() + 0.05;
    [0, 2, 4].forEach((d, i) => audio.play({ midi: u.midiOf(d + u.scale.length * 2), timbre: 0.1, vel: 0.07, pan: (i - 1) * 0.3, dur: 2.5 }, t + i * 0.12));
    renderJournal();
  }
  let discoveries = 0;
  document.addEventListener('visibilitychange', () => { if (document.hidden) for (const u of livingWorlds()) C.multiverse.save(u); });
  addEventListener('pagehide', () => { for (const u of livingWorlds()) C.multiverse.save(u); });

  // ------------------------------------------------------------------ main loop
  let last = performance.now();
  let showT = 0; // the picture's own clock: it runs on through every hand-over between worlds
  let fps = 60;
  let slowBpmApplied = 0;
  const raf = /[?&]drive/.test(location.search) ? (cb) => setTimeout(() => cb(performance.now()), 16) : requestAnimationFrame.bind(window);

  function frameFor(L, lcam, dt, realDt, decay60) {
    const u = L.uni;
    const f = { cam: { x: lcam.x, y: lcam.y, h: lcam.viewH / (2 * C.TAN_HALF), roll: cam.roll, viewH: lcam.viewH }, prevCam: L.prevCam, overlay };
    f.time = u.time;
    f.realDt = realDt;
    f.simDt = dt;
    f.trailDecay = Math.pow(decay60, (realDt * 60) / (u.G && u.G.trailMul ? u.G.trailMul : 1));
    f.dustBright = 3.2 * (1 - 0.6 * u.intro) * (u.G && u.G.dustGain ? u.G.dustGain : 1);
    f.nebAmt = 1;
    f.bang = u.bangFrame;
    f.nut = u.nut;
    u.pack(f, settings);
    L.prevCam = f.cam;
    return f;
  }
  function simulate(L, lcam, dt, realDt, ticks, cursorActive, gain) {
    const u = L.uni;
    u.cam.x = lcam.x; u.cam.y = lcam.y; u.cam.viewH = lcam.viewH; u.cam.aspect = cam.aspect; u.cam.roll = cam.roll;
    u.shockMul = (0.55 + 0.75 * settings.intensity) * (settings.reduced ? 0.7 : 1);
    u.sim.tilt[0] = tilt[0];
    u.sim.tilt[1] = tilt[1];
    // equal-power crossfade: loudness stays level all the way through the membrane
    u.setGain(Math.sin((C.clamp(gain, 0, 1) * Math.PI) / 2));
    u.lastWall = Date.now();
    try {
      u.update(dt, realDt, ticks);
    } catch (err) {
      if (!loop.warned) { console.error(err); loop.warned = true; }
    }
    if (!cursorActive) u.cursor.active = false;
  }

  function loop(now) {
    raf(loop);
    let realDt = Math.min(0.05, (now - last) / 1000);
    last = now;
    if (realDt <= 0) realDt = 1 / 60;
    fps += (1 / realDt - fps) * 0.05;
    idleTime = (performance.now() - lastInput) / 1000;
    if (idleTime > 4 && !anyPanelOpen()) body.classList.add('idle');

    slow += ((slowHeld ? 1 : 0) - slow) * C.damp(slowHeld ? 5 : 3, realDt);
    const timeScale = paused ? 0 : 1 - slow * 0.85;
    const dt = realDt * timeScale;
    showT += dt;

    const baseBpm = music.active && music.tempo && music.tempoConf > 0.3 ? music.tempo : cur.world.bpm;
    const wantBpm = baseBpm * (1 - slow * 0.65);
    // (compare with the engine's own tempo: preparing a world inside an orb sets it to that world's, so the
    // world you're in would keep the wrong tempo until something else changed)
    if (Math.abs(wantBpm - slowBpmApplied) > 0.4 || Math.abs(wantBpm - audio.bpm) > 0.4) { audio.setBpm(wantBpm); slowBpmApplied = wantBpm; }
    audio.setSlow(slow);
    C.flash.guard = settings.strongGuard ? 1 : 0.5;
    C.flash.update(realDt);

    updateCamera(realDt);
    updateStack(realDt);
    frameBudget(realDt);
    uni = cur.uni;
    if (C.Capture) C.Capture.world = cur.seed;

    // which two worlds are on screen, and how far through the membrane are we?
    let A = cur, B = null, camA = cam, camB = null, t = 0, link = null;
    if (side && sideShown > 0) {
      B = side.L; camB = cam; t = sideShown; // a side passage (it keeps the screen until it closes): the neighbour shares your camera
    } else if (inner && weightOf(cam.viewH * inner.link.S) > 0) {
      B = inner; link = inner.link; camB = toInner(link, cam); t = weightOf(camB.viewH);
    } else if (outer && cur.link && cam.viewH > IN_LO) {
      A = outer; B = cur; link = cur.link; camA = toOuter(link, cam); camB = cam; t = weightOf(cam.viewH);
    }
    const sidePass = !!side && B === side.L;
    // a world being prepared out of sight still lives (CPU and GPU), so it never 'starts' when revealed
    let prep = null, prep2 = null;
    if (inner && inner !== B) prep = { L: inner, cam: toInner(inner.link, cam) };
    else if (outer && outer !== A && cur.link) prep = { L: outer, cam: toOuter(cur.link, cam) };
    if (side && !sidePass) prep2 = { L: side.L, cam };

    if (!paused) {
      music.update(realDt);
      audio.update(realDt);
      const ticks = audio.pollTicks(0.12);
      if (composer) composer.onTicks(ticks, cur.uni);
      ptr.speed *= Math.exp(-realDt * 6);
      // pointer, in the coordinates of the world you are in
      uni.cursor.x = ptr.wx; uni.cursor.y = ptr.wy;
      uni.cursor.active = ptr.inside && state === 'live';
      uni.cursor.speed = (ptr.speed / innerHeight) * cam.viewH;
      if (ptr.down && state === 'live') {
        const heldS = (performance.now() - ptr.downT) / 1000;
        if (ptr.mode === 'pending' && heldS > 0.2) { ptr.mode = 'charge'; uni.startCharge(ptr.wx, ptr.wy, 1 - ptr.y / innerHeight); }
        if (ptr.mode === 'charge') uni.updateCharge(ptr.wx, ptr.wy, realDt, 1 - ptr.y / innerHeight);
        if (ptr.mode === 'grab' && ptr.target) {
          const steps = Math.round((ptr.dy - ptr.y) / (innerHeight * 0.05));
          uni.moveGrab(ptr.target, ptr.wx, ptr.wy, realDt, steps, Math.hypot(ptr.vx, ptr.vy));
        }
        if (ptr.mode === 'stir') audio.setStir(Math.hypot(ptr.vx, ptr.vy), ((ptr.x / innerWidth) * 2 - 1) * 0.8);
      }
      if (!ptr.down) body.classList.toggle('grab', !!uni.hover(ptr.wx, ptr.wy, ptr.inside && state === 'live'));
      // every visible world lives; a world being prepared lives silently
      const gA = B ? 1 - t : 1;
      simulate(A, camA, dt, realDt, ticks, A === cur, gA);
      if (B) simulate(B, camB, dt, realDt, ticks, B === cur, t);
      for (const L of liveLayers()) if (L !== A && L !== B) L.uni.setGain(0);
      if (prep) simulate(prep.L, prep.cam, dt, realDt, ticks, false, 0);
      if (prep2) simulate(prep2.L, prep2.cam, dt, realDt, ticks, false, 0);
      livingMultiverse(realDt);
      for (const ev of C.uiEvents) showToast(ev.text);
      C.uiEvents.length = 0;
    }

    // render each visible world into its own layer, then through the membrane to the screen
    const decay60 = settings.reduced ? Math.min(0.86, 0.78 + 0.16 * settings.trails) : 0.78 + 0.18 * settings.trails;
    const fA = frameFor(A, camA, paused ? 0 : dt, realDt, decay60);
    renderer.renderLayer(A.gpu, fA);
    if (prep) renderer.renderLayer(prep.L.gpu, frameFor(prep.L, prep.cam, paused ? 0 : dt, realDt, decay60));
    if (prep2) renderer.renderLayer(prep2.L.gpu, frameFor(prep2.L, prep2.cam, paused ? 0 : dt, realDt, decay60));
    let ap = null;
    if (B) {
      const fB = frameFor(B, camB, paused ? 0 : dt, realDt, decay60);
      renderer.renderLayer(B.gpu, fB);
      const c = Math.cos(cam.roll), s = Math.sin(cam.roll);
      if (sidePass) {
        // the front between the two worlds: the neighbour's direction on screen, and how far across it is
        const ux = c * side.dx - s * side.dy, uy = s * side.dx + c * side.dy;
        const E = 0.5 * (Math.abs(ux) * cam.aspect + Math.abs(uy)) + 0.25;
        ap = { x: ux, y: uy, r: E - 2 * E * t, t: -1 };
      } else {
        const rx = wrap(link.ax - camA.x), ry = wrap(link.ay - camA.y);
        const sx = c * rx - s * ry, sy = s * rx + c * ry;
        ap = { x: 0.5 + sx / (camA.viewH * cam.aspect), y: 0.5 + sy / camA.viewH, r: R_IN / camB.viewH, t };
      }
    }
    const styA = C.STYLES[A.uni.style || 0], styB = B ? C.STYLES[B.uni.style || 0] : styA;
    const mixS = (k) => (B ? styA[k] * (1 - t) + styB[k] * t : styA[k]);
    renderer.post({
      time: showT, realDt,
      bloomAmt: (0.3 + 0.45 * settings.intensity) * mixS('bloom'),
      exposure: 1,
      safeLum: (settings.strongGuard ? 0.3 : 0.5) * mixS('safe'),
      ca: settings.reduced ? 0 : 0.5 * settings.intensity,
      overlay,
    }, { L: A.gpu, style: A.uni.style || 0, palette: A.uni.palette }, B ? { L: B.gpu, style: B.uni.style || 0, palette: B.uni.palette } : null, ap);

    updateToast(realDt);
    updateHints(realDt);
    updateHud(realDt);
    drawSpec();
  }

  body.classList.add('asleep');
  raf(loop);

  // ------------------------------------------------------------------ diagnostics (used for testing)
  const visitGenus = (genus, opts) => {
    const seed = C.hash('visit', genus, Math.random());
    C.makeWorld(seed, Object.assign({ genus, notStyle: [uni.style] }, opts || {}));
    if (ensureInner({ x: cam.x, y: cam.y, r: 0.6, seed, c2: uni.palette.hot })) auto = { dir: -1 };
  };
  function visitSeed(seed) {
    if (seed === cur.seed) return;
    if (side && side.L.seed === seed && sideShown > 0) {
      // the neighbour still on screen: finish the passage into it (the dissolve keeps its own pace)
      const d = trav.x * side.dx + trav.y * side.dy;
      if (d < SIDE_D1) { trav.x += side.dx * (SIDE_D1 - d); trav.y += side.dy * (SIDE_D1 - d); }
      pendingDive = null; auto = null; // this request replaces any dive that was waiting
      showToast('a door opens', 'to ' + side.L.world.name);
      return;
    }
    const def = C.mvDef(seed);
    C.makeWorld(seed, def ? Object.assign({}, def) : { notGenus: [uni.genus], notStyle: [uni.style] });
    // the world around you, already on screen: rise out into it
    if (outer && outer.seed === seed && shownLayer(outer)) auto = { dir: 1 };
    else if (ensureInner({ x: cam.x, y: cam.y, r: 0.6, seed, c2: uni.palette.hot })) auto = { dir: -1 };
    else return;
    showToast('a door opens', 'to ' + C.makeWorld(seed).name);
  }
  C.app = {
    get uni() { return cur.uni; }, audio, music, renderer, cam, settings, wake, visitGenus, visitSeed, playlist, pack, uniCache, links, livingWorlds,
    get state() { return state; }, get layers() { return { outer: outer && outer.world.name, cur: cur.world.name, inner: inner && inner.world.name, side: side && side.L.world.name }; },
    get travel() { return { x: +trav.x.toFixed(1), y: +trav.y.toFixed(1), shown: +sideShown.toFixed(2), cell: cellOf(cur.seed), dir: side && [side.dx, side.dy], auto: auto && (auto.until || auto.dir), pending: !!pendingDive, seeds: { cur: cur.seed, inner: inner && inner.seed, outer: outer && outer.seed, side: side && side.L.seed } }; },
    zoomIn: () => { if (ensureInner(uni.diveTarget(ptr.inside ? ptr.wx : cam.x, ptr.inside ? ptr.wy : cam.y))) auto = { dir: -1 }; }, zoomOut: () => { auto = { dir: 1 }; },
  };
  // Test hook: record what you'd hear for `sec` seconds and save it as a WAV (needs `node serve.js --dev`).
  // Only on a local server: the published app has no reason to send audio anywhere.
  if (/^(localhost|127\.0\.0\.1)$/.test(location.hostname)) C.recordWav = (sec, name) => new Promise((resolve, reject) => {
    if (!audio.ctx) return reject(new Error('not awake'));
    const ctx = audio.ctx, sp = ctx.createScriptProcessor(4096, 2, 2), L = [], R = [];
    let n = 0;
    const want = Math.floor(sec * ctx.sampleRate);
    sp.onaudioprocess = (e) => {
      if (n >= want) return;
      L.push(new Float32Array(e.inputBuffer.getChannelData(0)));
      R.push(new Float32Array(e.inputBuffer.getChannelData(1)));
      n += e.inputBuffer.length;
      if (n < want) return;
      audio.out.disconnect(sp);
      sp.disconnect();
      const len = Math.min(n, want), buf = new ArrayBuffer(44 + len * 4), v = new DataView(buf);
      const str = (o, x) => { for (let i = 0; i < x.length; i++) v.setUint8(o + i, x.charCodeAt(i)); };
      str(0, 'RIFF'); v.setUint32(4, 36 + len * 4, true); str(8, 'WAVE'); str(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true);
      v.setUint16(22, 2, true); v.setUint32(24, ctx.sampleRate, true); v.setUint32(28, ctx.sampleRate * 4, true); v.setUint16(32, 4, true); v.setUint16(34, 16, true);
      str(36, 'data'); v.setUint32(40, len * 4, true);
      let o = 44, i = 0;
      for (let b = 0; b < L.length && i < len; b++) for (let j = 0; j < L[b].length && i < len; j++, i++) {
        v.setInt16(o, Math.max(-1, Math.min(1, L[b][j])) * 32767, true); v.setInt16(o + 2, Math.max(-1, Math.min(1, R[b][j])) * 32767, true); o += 4;
      }
      fetch('/__save/' + name, { method: 'POST', body: new Blob([buf]) }).then((r) => resolve(r.status), reject);
    };
    audio.out.connect(sp);
    sp.connect(ctx.destination); // a ScriptProcessor only runs when connected; it outputs silence
  });
  C.debug = () => ({
    state, fps: Math.round(fps), world: cur.world.name, genus: cur.uni.genus, visitor: cur.world.visitor, style: C.STYLES[cur.uni.style || 0].name,
    depth: cur.depth, viewH: +cam.viewH.toFixed(2), layers: C.app.layers, live: renderer.layers.size, remembered: uniCache.size,
    singers: uni.singers.length,
    audio: audio.ctx ? { state: audio.ctx.state, rms: +audio.outputRMS().toFixed(4), bpm: Math.round(audio.bpm), voices: audio.voiceEnds.length } : null,
    exposure: renderer.readAdapt(),
  });
})();
