'use strict';
// Procedural instruments: an instrument is a recipe (a model and four tone genes: bright, metal, attack,
// body), and the sound is computed from it, so a species can evolve its instrument as it evolves its song.
//
// Models (methods reimplemented from the published descriptions; see docs/project/music-sources.md):
//   string  Karplus-Strong plucked string (Karplus & Strong 1983, with Jaffe & Smith's 1983 tuning allpass,
//           pick-position comb and loss filter), with a small body resonance
//   modal   a struck bar, bowl or bell: a bank of decaying resonant modes whose frequency ratios move from
//           harmonic (wood, marimba-like) to inharmonic (bells, plates) as `metal` rises
//   fm      two-operator FM (Chowning 1973) with a decaying index
//   pad     additive and slowly evolving: each partial breathes at its own rate, pairs beat gently
//   voice   additive through vowel formants: a choir that is not quite any choir
// Each recipe is rendered once per half-octave zone into an AudioBuffer (JavaScript, a few milliseconds per
// frame, never on the audio thread) and then played with one buffer source and one gain per note: cheaper on
// a phone than the oscillator instruments, whatever the recipe. The sustained models render one exactly
// periodic loop (zone frequencies are whole hertz and every partial and modulation completes whole cycles in
// the loop), so they can hold any length without a seam. Buffers live in a small least-recently-used cache.
(function () {
  const C = window.COSMOS;
  // half-octave zones in whole hertz: any note is at most three semitones from its zone
  const ZONES = [55, 78, 110, 156, 220, 311, 440, 622, 880, 1245, 1760, 2489];
  // one second; every sustained partial and modulation completes whole cycles in it
  const LOOP = 1;
  const SUSTAINED = { pad: 1, voice: 1 };
  const VOWELS = [[730, 1090, 2440], [570, 840, 2410], [300, 870, 2240], [530, 1840, 2480], [270, 2290, 3010]];
  // render rates: sustained voices stay below 9 kHz anyway; struck ones keep their shimmer up to 14 kHz
  const SR_SUS = 22050, SR_HIT = 32000;

  const stores = new WeakMap(); // AudioContext -> { map, bytes, tick, queue, job }
  function store(ctx) {
    let s = stores.get(ctx);
    if (!s) stores.set(ctx, (s = { map: new Map(), bytes: 0, tick: 0, queue: [], queued: new Set(), job: null }));
    return s;
  }
  const budget = () => (C.MOBILE ? 10 : 28) * 1024 * 1024;

  // ------------------------------------------------------------------ rendering (plain JavaScript DSP)
  // Each renderer is a generator that yields every few thousand samples, so the main loop can render a
  // little per frame (pump) and a phone never stutters while a new world's instruments are made.
  const CHUNK = 4096;
  function* renderString(sr, f0, p, secs) {
    const N = Math.floor(secs * sr), out = new Float32Array(N);
    const period = sr / f0;
    // two-point loss filter: a half-sample delay; the allpass takes up the fractional rest (Jaffe & Smith)
    const S = 0.5 - 0.3 * p.bright; // < 0.5: brighter and longer
    // loop = delay line (M samples) + loss filter (S samples) + allpass (d samples, 0.1..1.1)
    const M = Math.max(3, Math.floor(period - S - 0.1)), d = period - S - M;
    const ap = (1 - d) / (1 + d), L = M - 1;
    // decay: T60 in seconds, shorter for high strings, longer for a resonant body
    const t60 = (0.6 + 3.2 * p.body) * Math.pow(220 / f0, 0.35);
    const rho = Math.pow(0.001, 1 / (t60 * f0));
    const buf = new Float32Array(L + 1);
    // excitation: noise, softened (a finger more than a pick, unless the attack is hard), combed by the
    // pick position
    const r = C.rng(C.hash('ks', f0, p.bright, p.attack));
    let lp = 0, lp2 = 0;
    const k = (0.05 + 0.3 * p.attack) * Math.min(1, Math.sqrt(f0 / 330)); // low strings plucked softer still
    for (let i = 0; i <= L; i++) { lp += ((r() * 2 - 1) - lp) * k; lp2 += (lp - lp2) * k; buf[i] = lp2; }
    const pick = Math.max(1, Math.round(L * (0.08 + 0.3 * (1 - p.bright))));
    const ex = buf.slice();
    for (let i = 0; i <= L; i++) buf[i] = ex[i] - (i >= pick ? ex[i - pick] : 0) * 0.85;
    let mean = 0;
    for (let i = 0; i <= L; i++) mean += buf[i] / (L + 1);
    for (let i = 0; i <= L; i++) buf[i] -= mean;
    // and a gentle tone control on the way out
    const tc = 1 - Math.exp(-2 * Math.PI * Math.min(sr * 0.45, Math.min(1400 + 5000 * p.bright, f0 * 14)) / sr);
    let idx = 0, prev = 0, apX = 0, apY = 0, o = 0;
    for (let n = 0; n < N; n++) {
      const x = buf[idx];
      const y = rho * ((1 - S) * x + S * prev);
      prev = x;
      // fractional-delay allpass for exact tuning
      const a = ap * y + apX - ap * apY;
      apX = y; apY = a;
      buf[idx] = a;
      o += (x - o) * tc;
      out[n] = o;
      idx = idx >= L ? 0 : idx + 1;
      if (n % CHUNK === CHUNK - 1) yield;
    }
    yield;
    return yield* bodyRes(out, sr, p.body);
  }
  // a wooden body: two soft resonances and a little warmth (fixed in hertz, as a body is)
  function* bodyRes(x, sr, body) {
    if (body < 0.15) return x;
    const y = new Float32Array(x.length);
    for (const [fc, q, g] of [[190, 4, 0.5 * body], [470, 3, 0.35 * body]]) {
      const w = 2 * Math.PI * fc / sr, al = Math.sin(w) / (2 * q), a0 = 1 + al;
      const b0 = al / a0, b2 = -al / a0, a1 = -2 * Math.cos(w) / a0, a2 = (1 - al) / a0;
      let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
      for (let i = 0; i < x.length; i++) {
        const v = b0 * x[i] + b2 * x2 - a1 * y1 - a2 * y2;
        x2 = x1; x1 = x[i]; y2 = y1; y1 = v;
        y[i] += v * g;
        if (i % CHUNK === CHUNK - 1) yield;
      }
    }
    for (let i = 0; i < x.length; i++) { x[i] += y[i]; if (i % (CHUNK * 4) === CHUNK * 4 - 1) yield; }
    return x;
  }
  // mode ratios: harmonic -> free bar -> bowl -> bell
  const MODES = [
    [1, 2, 3, 4, 5, 6],
    [1, 3.93, 9.54, 2.0, 5.0, 0.5],
    [1, 2.76, 5.4, 8.93, 1.5, 2.0],
    [1, 2.71, 5.15, 8.17, 1.6, 3.5],
    [0.56, 1, 1.19, 1.71, 2, 2.74, 3, 3.76],
  ];
  function* renderModal(sr, f0, p, secs) {
    const N = Math.floor(secs * sr), out = new Float32Array(N);
    const set = MODES[C.clamp(Math.round(p.metal * (MODES.length - 1)), 0, MODES.length - 1)];
    const tau0 = (0.35 + 2.4 * p.body) * Math.pow(220 / f0, 0.3);
    const r = C.rng(C.hash('modal', f0, p.metal, p.body));
    for (let k = 0; k < set.length; k++) {
      const ratio = set[k], f = f0 * ratio;
      if (f > sr * 0.42 || f > 14000) continue;
      // hard mallets ring the upper modes; bright bodies let them last
      const amp = (k === 0 || ratio === 1 ? 1 : (0.25 + 0.6 * p.attack) / Math.pow(k + 1, 0.9 - 0.4 * p.bright));
      const tau = tau0 / Math.pow(Math.max(1, ratio), 0.9 - 0.5 * p.bright);
      const w = 2 * Math.PI * f / sr, rr = Math.exp(-1 / (tau * sr));
      const beat = p.body > 0.5 ? 1 + (r() - 0.5) * 0.0016 : 1;
      for (const [m, a] of beat === 1 ? [[1, 1]] : [[1, 0.6], [beat, 0.4]]) {
        const ww = w * m, c = 2 * rr * Math.cos(ww);
        let y2 = 0, y1 = amp * a * rr * Math.sin(ww);
        const end = Math.min(N, Math.floor(tau * sr * 7));
        for (let n = 1; n < end; n++) { const y = c * y1 - rr * rr * y2; out[n] += y1; y2 = y1; y1 = y; if (n % CHUNK === 0) yield; }
        yield;
      }
    }
    // the mallet: a click of filtered noise, harder with attack
    const clickN = Math.floor(sr * 0.006);
    let lp = 0;
    for (let n = 0; n < clickN && n < N; n++) { lp += ((r() * 2 - 1) - lp) * (0.2 + 0.6 * p.bright); out[n] += lp * 0.25 * p.attack * (1 - n / clickN); }
    return out;
  }
  function* renderFM(sr, f0, p, secs) {
    const N = Math.floor(secs * sr), out = new Float32Array(N);
    // harmonic ratios unless really metallic, and a modest index: high ratios at full index buzz (the audit)
    const ratios = [1, 2, 0.5, 3, 1, 1.414, 3.5];
    const ratio = ratios[C.clamp(Math.round(p.metal * (ratios.length - 1)), 0, ratios.length - 1)];
    const I0 = (0.4 + 2.2 * p.bright) * (ratio > 3 ? 0.6 : 1), tauI = 0.08 + 0.6 * (1 - p.attack) + 0.4 * p.body, tauA = (0.4 + 2.2 * p.body) * Math.pow(220 / f0, 0.3);
    const wc = 2 * Math.PI * f0 / sr, wm = wc * ratio, kI = Math.exp(-1 / (tauI * sr)), kA = Math.exp(-1 / (tauA * sr));
    let I = I0, A = 1;
    for (let n = 0; n < N; n++) {
      out[n] = Math.sin(wc * n + I * Math.sin(wm * n)) * A;
      I *= kI; A *= kA;
      if (n % CHUNK === CHUNK - 1) yield;
    }
    return out;
  }
  // additive and exactly periodic over LOOP seconds (f0 is a whole number of hertz)
  function* renderAdditive(sr, f0, p, vowel) {
    const N = Math.round(LOOP * sr), out = new Float32Array(N);
    const r = C.rng(C.hash('add', f0, p.bright, p.metal, p.body, vowel ? 1 : 0));
    const maxF = Math.min(sr * 0.4, vowel ? 5200 : 3200 + 6000 * p.bright);
    const K = Math.min(vowel ? 20 : 16, Math.floor(maxF / f0));
    // three slow breathing rates (1, 2 and 3 cycles per loop), each partial with its own phase; the swell
    // is computed every 32 samples (it moves at a hertz or so)
    const CR = 32, NC = Math.ceil(N / CR) + 1;
    const lfo = [1, 2, 3].map((m) => { const s = new Float32Array(NC), c = new Float32Array(NC); for (let j = 0; j < NC; j++) { const a = 2 * Math.PI * m * j * CR / N; s[j] = Math.sin(a); c[j] = Math.cos(a); } return [s, c]; });
    const depth = 0.15 + 0.45 * (1 - p.attack);
    const F = vowel ? VOWELS[Math.floor(p.body * 4.99)] : null;
    for (let k = 1; k <= K; k++) {
      const f = f0 * k;
      // a darker tilt than a sawtooth, a soft roll-off above 2.5 kHz (the audit heard nasal glare otherwise)
      let a = 1 / Math.pow(k, 2.3 - 1.0 * p.bright) / (1 + Math.pow(f / (2500 + 2500 * p.bright), 2));
      if (k % 2 === 0) a *= 1 - 0.5 * p.metal; // hollow, clarinet-like as metal rises
      if (F) { let fm = 0.08; for (let j = 0; j < 3; j++) fm += [1, 0.4, 0.12][j] * Math.exp(-Math.pow((f - F[j]) / (110 + F[j] * 0.1), 2)); a *= fm; }
      else if (p.body > 0.3) a *= 1 + p.body * 0.6 * Math.exp(-Math.pow((f - 300) / 200, 2)); // warmth low, not a nasal bump
      if (a < 1e-4) continue;
      const L = lfo[(k - 1) % 3], ph = r() * 6.283, cs = Math.cos(ph), sn = Math.sin(ph), ph0 = r() * 6.283;
      // sines by rotation (cheap), plus a beating twin one cycle per loop away for the first few partials
      const w = 2 * Math.PI * f / sr, cw = Math.cos(w), sw = Math.sin(w);
      const twin = k <= 4 ? 0.45 : 0, w2 = 2 * Math.PI * (f + 1 / LOOP) / sr, cw2 = Math.cos(w2), sw2 = Math.sin(w2);
      let x = Math.sin(ph0), y = Math.cos(ph0), x2 = 0, y2 = 1, since = 0;
      for (let j = 0, n = 0; n < N; j++) {
        if ((since += CR) >= CHUNK) { since = 0; yield; }
        const am0 = a * (1 + depth * (L[0][j] * cs + L[1][j] * sn)), am1 = a * (1 + depth * (L[0][j + 1] * cs + L[1][j + 1] * sn)), dm = (am1 - am0) / CR;
        let am = am0;
        for (const e = Math.min(N, n + CR); n < e; n++) {
          out[n] += am * (x + twin * x2);
          am += dm;
          const nx = x * cw + y * sw; y = y * cw - x * sw; x = nx;
          if (twin) { const nx2 = x2 * cw2 + y2 * sw2; y2 = y2 * cw2 - x2 * sw2; x2 = nx2; }
        }
      }
      yield;
    }
    return out;
  }

  // RMS-normalise, so every recipe sits at the same level for the same velocity
  function* normalise(x, sr, sustained, attack) {
    // a struck sound speaks over a few milliseconds (a raised-cosine onset, softer for soft tones): its
    // first instant was a near-impulse, which the audit heard as digital clicks
    const on = sustained ? 0 : Math.floor(sr * (0.0025 + 0.004 * (1 - (attack == null ? 0.5 : attack))));
    for (let i = 0; i < on && i < x.length; i++) x[i] *= 0.5 - 0.5 * Math.cos(Math.PI * i / on);
    const n = Math.min(x.length, Math.floor(sr * (sustained ? LOOP : 0.5)));
    const Y = CHUNK;
    let s = 0;
    for (let i = 0; i < n; i++) { s += x[i] * x[i]; if (i % Y === Y - 1) yield; }
    const rms = Math.sqrt(s / Math.max(1, n)) || 1;
    const g = (sustained ? 0.22 : 0.2) / rms;
    let pk = 0;
    for (let i = 0; i < x.length; i++) { const v = (x[i] *= g); if (v > pk) pk = v; else if (-v > pk) pk = -v; if (i % Y === Y - 1) yield; }
    // and its peak may not tower over its body
    const cap = sustained ? 0.95 : 0.6;
    if (pk > cap) for (let i = 0; i < x.length; i++) { x[i] *= cap / pk; if (i % Y === Y - 1) yield; }
    // no click at the end either: the last fifth fades out (a bar or a bell longer than its buffer used to
    // stop dead there)
    if (!sustained) {
      const f0 = Math.floor(x.length * 0.8), fl = x.length - f0;
      for (let i = f0; i < x.length; i++) { x[i] *= 0.5 + 0.5 * Math.cos(Math.PI * (i - f0) / fl); if ((i - f0) % Y === Y - 1) yield; }
    }
    return x;
  }

  function* render(ctx, rc, f0) {
    const p = rc, sus = SUSTAINED[p.model], sr = Math.min(ctx.sampleRate, sus ? SR_SUS : SR_HIT);
    const secs = C.clamp(0.5 + 2.4 * p.body + (p.model === 'modal' ? 0.6 : 0), 0.6, C.MOBILE ? 1.8 : 2.6);
    let x;
    if (p.model === 'string') x = yield* renderString(sr, f0, p, secs);
    else if (p.model === 'modal') x = yield* renderModal(sr, f0, p, secs);
    else if (p.model === 'fm') x = yield* renderFM(sr, f0, p, secs);
    else x = yield* renderAdditive(sr, f0, p, p.model === 'voice');
    yield* normalise(x, sr, sus, p.attack);
    yield;
    const b = ctx.createBuffer(1, x.length, sr);
    b.getChannelData(0).set(x);
    return b;
  }

  const zoneOf = (f) => { let best = ZONES[0]; for (const z of ZONES) if (Math.abs(Math.log(f / z)) < Math.abs(Math.log(f / best))) best = z; return best; };
  // The queue of buffers to make: a note that is actually being played (urgent) goes to the front; asking
  // ahead (prepare) goes to the back, and only while the queue is short; a new world forgets what the last
  // one asked for (forget). So the current world's voices never wait behind abandoned work.
  const MAXQ = 24;
  function get(ctx, rc, f, sync, urgent) {
    const s = store(ctx), z = zoneOf(f), key = rc.key + '@' + z;
    const hit = s.map.get(key);
    if (hit) { hit.used = ++s.tick; return hit; }
    if (!sync) {
      if (s.job && s.job.key === key) return null;
      if (s.queued.has(key)) {
        if (urgent) { const i = s.queue.findIndex((q) => q[2] === key); if (i > 0) s.queue.unshift(s.queue.splice(i, 1)[0]); }
        return null;
      }
      if (urgent) {
        s.queue.unshift([rc, z, key]);
        s.queued.add(key);
        while (s.queue.length > MAXQ) s.queued.delete(s.queue.pop()[2]);
      } else if (s.queue.length < MAXQ) { s.queue.push([rc, z, key]); s.queued.add(key); }
      return null;
    }
    const g = render(ctx, rc, z);
    let r = g.next();
    while (!r.done) r = g.next();
    return put(s, r.value, z, key);
  }
  function put(s, buf, z, key) {
    const bytes = buf.length * 4;
    while (s.bytes + bytes > budget() && s.map.size) {
      let old = null;
      for (const [k, v] of s.map) if (!old || v.used < old[1].used) old = [k, v];
      s.map.delete(old[0]);
      s.bytes -= old[1].bytes;
    }
    const e = { buf, f0: z, bytes, used: ++s.tick };
    s.map.set(key, e);
    s.bytes += bytes;
    s.queued.delete(key);
    return e;
  }

  // ------------------------------------------------------------------ recipes and playing them
  const recipes = {};
  const q = (x) => Math.round(C.clamp(x, 0, 1) * 6) / 6; // coarse steps, so near-identical tones share buffers
  function recipe(model, tone, fallback) {
    const [bright, metal, attack, body] = tone.map(q);
    const key = model + ':' + [bright, metal, attack, body].join(',');
    if (!recipes[key]) recipes[key] = { key, model, bright, metal, attack, body, fallback: fallback || 'glass' };
    return recipes[key];
  }

  function playRecipe(rc, e, t, f, v, d, dest, grain) {
    const ctx = e.ctx;
    // a plucked string low down twangs (the audit heard it): below ~E3 the same tone sings as a warm bar
    if (rc.model === 'string' && f < 165) rc = rc.low || (rc.low = recipe('modal', [rc.bright * 0.7, 0, rc.attack, rc.body], rc.fallback));
    const hit = get(ctx, rc, f, e.offline, true);
    if (!hit) {
      const fb = C.INSTR[rc.fallback];
      return fb ? fb(e, t, f, v, d, dest) : t;
    }
    const src = ctx.createBufferSource();
    src.buffer = hit.buf;
    src.playbackRate.value = f / hit.f0;
    const g = ctx.createGain(), sus = SUSTAINED[rc.model], rate = f / hit.f0;
    // silent until its envelope says otherwise: a source started part-way into its buffer otherwise lets one
    // full-level sample through before the first gain event lands (measured: a click per note)
    g.gain.value = 0;
    let end;
    if (grain) {
      // a grain: a short window into the sound
      const len = Math.max(0.03, d), at = Math.max(0, Math.random() * (hit.buf.duration - len * rate - 0.01));
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(v, t + len * 0.4);
      g.gain.linearRampToValueAtTime(0, t + len);
      src.start(t, at);
      end = t + len;
    } else if (sus) {
      src.loop = true;
      const att = 0.02 + 1.3 * (1 - rc.attack) * (d > 2 ? 1 : 0.5), off = t + Math.max(att, d), rel = 0.25 + 1.6 * rc.body * (d > 2 ? 1 : 0.5);
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(v, t + att);
      g.gain.setValueAtTime(v, off);
      g.gain.exponentialRampToValueAtTime(Math.max(1e-5, v * 1e-3), off + rel);
      src.start(t, Math.random() * hit.buf.duration);
      end = off + rel;
    } else {
      const natural = hit.buf.duration / rate;
      g.gain.setValueAtTime(v, t);
      if (d < natural * 0.85) {
        g.gain.setValueAtTime(v, t + d);
        g.gain.exponentialRampToValueAtTime(Math.max(1e-5, v * 1e-3), t + d + 0.15);
        end = t + d + 0.15;
      } else end = t + natural;
      src.start(t);
    }
    src.stop(end + 0.02);
    src.connect(g);
    g.connect(dest);
    src.onended = () => { try { src.disconnect(); g.disconnect(); } catch (err) {} };
    return end;
  }

  // An instrument name for C.INSTR, made from a model and tone genes.
  function instrument(model, tone, fallback) {
    const rc = recipe(model, tone, fallback), name = 'pv:' + rc.key;
    if (!C.INSTR[name]) {
      C.INSTR[name] = (e, t, f, v, d, dest) => playRecipe(rc, e, t, f, v, d, dest, false);
      C.INSTR[name].recipe = rc;
    }
    return name;
  }
  // which model a creature's tone genes describe: struck or sustained, wooden or metal, plain or voiced
  function modelOfTone(tone) {
    const [, metal, attack, body] = tone;
    if (attack > 0.55) return metal > 0.6 ? 'modal' : body > 0.5 ? 'string' : metal > 0.3 ? 'fm' : 'modal';
    return body > 0.6 ? 'voice' : metal > 0.65 ? 'fm' : 'pad';
  }

  C.Voices = {
    ZONES,
    instrument,
    modelOfTone,
    // a creature's own instrument
    forTone(tone, fallback) { return instrument(modelOfTone(tone), tone, fallback); },
    grain(name, e, t, f, v, d, dest) {
      const fn = C.INSTR[name];
      if (fn && fn.recipe) return playRecipe(fn.recipe, e, t, f, v, d, dest, true);
      return fn ? fn(e, t, f, v, d, dest) : t;
    },
    // ask for the buffers a voice will need, ahead of time (rendered a little at a time by pump)
    prepare(ctx, name, midis) {
      const fn = C.INSTR[name];
      if (!fn || !fn.recipe || !ctx) return;
      for (const m of midis) get(ctx, fn.recipe, C.midiToFreq(m), false);
    },
    // a new world: drop what earlier worlds asked for ahead of time (the buffer being made is finished)
    forget(ctx) { const s = ctx && stores.get(ctx); if (s) { s.queue.length = 0; s.queued.clear(); } },
    // render queued buffers from the main loop, within a time budget (ms), a chunk at a time
    pump(ctx, ms) {
      if (!ctx) return 0;
      const s = store(ctx), t0 = performance.now(), lim = ms || 3;
      let n = 0, first = true;
      // a step is a few thousand samples; don't start one that would run past the budget (its cost is
      // tracked as a running estimate), but always take at least one so work never stalls
      while (first || performance.now() - t0 + (s.stepMs || 0.2) < lim) {
        first = false;
        if (!s.job) {
          if (!s.queue.length) break;
          const [rc, z, key] = s.queue.shift();
          if (s.map.has(key)) { s.queued.delete(key); continue; }
          s.job = { gen: render(ctx, rc, z), z, key };
        }
        const ts = performance.now(), r = s.job.gen.next();
        s.stepMs = 0.9 * (s.stepMs || 0.2) + 0.1 * (performance.now() - ts);
        if (r.done) { put(s, r.value, s.job.z, s.job.key); s.job = null; n++; }
      }
      return n;
    },
    stats(ctx) { const s = ctx && stores.get(ctx); return s ? { buffers: s.map.size, mb: +(s.bytes / 1048576).toFixed(1), queued: s.queue.length + (s.job ? 1 : 0) } : null; },
  };
})();
