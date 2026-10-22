'use strict';
// The instrument library. Every instrument is plain Web Audio (oscillators, filters, envelopes), built
// to sound like a real thing: soft attacks with no clicks, partials that decay at their own rates,
// gentle detune, no harsh raw waveforms. Each world plays its own family of these (D5).
(function () {
  const C = window.COSMOS;

  // ------------------------------------------------------------------ wavetables (one set per context)
  const waves = new WeakMap();
  function wave(ctx, name) {
    let w = waves.get(ctx);
    if (!w) waves.set(ctx, (w = {}));
    if (w[name]) return w[name];
    const N = 32, re = new Float32Array(N), im = new Float32Array(N);
    for (let n = 1; n < N; n++) {
      let a = 0;
      if (name === 'warm') a = 1 / (n * n); // round, like a soft triangle with even harmonics
      else if (name === 'soft') a = 1 / Math.pow(n, 1.35) * Math.exp(-n / 14); // a filtered sawtooth
      else if (name === 'hollow') a = n % 2 ? 1 / (n * n * 0.7) : 0.04 / n; // clarinet-ish
      else if (name === 'organ') a = { 1: 1, 2: 0.7, 3: 0.45, 4: 0.35, 6: 0.18, 8: 0.12 }[n] || 0;
      else if (name === 'pulse') a = (n % 2 ? 1 : 0.35) / n * Math.exp(-n / 9); // a rounded 8-bit square
      else if (name === 'reed') a = Math.abs(Math.sin(n * 0.9)) / n; // a nasal, double-reed colour
      im[n] = a;
    }
    w[name] = ctx.createPeriodicWave(re, im);
    return w[name];
  }

  // ------------------------------------------------------------------ building blocks
  function osc(ctx, kind, f, t, end, detuneCents) {
    const o = ctx.createOscillator();
    if (kind === 'sine' || kind === 'triangle' || kind === 'sawtooth' || kind === 'square') o.type = kind;
    else o.setPeriodicWave(wave(ctx, kind));
    o.frequency.value = f;
    if (detuneCents) o.detune.value = detuneCents;
    o.start(t);
    o.stop(end + 0.05);
    return o;
  }
  // percussive envelope: quick attack, exponential decay
  function perc(ctx, t, peak, attack, decay) {
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(peak, t + attack);
    g.gain.exponentialRampToValueAtTime(Math.max(1e-5, peak * 1e-4), t + attack + decay);
    return g;
  }
  // held envelope: attack, hold until `off`, then release
  function held(ctx, t, peak, attack, off, release) {
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(peak, t + attack);
    g.gain.setValueAtTime(peak, Math.max(t + attack, off));
    g.gain.exponentialRampToValueAtTime(Math.max(1e-5, peak * 1e-4), Math.max(t + attack, off) + release);
    return g;
  }
  function lowpass(ctx, f, q) {
    const l = ctx.createBiquadFilter();
    l.type = 'lowpass';
    l.frequency.value = Math.min(18000, f);
    l.Q.value = q == null ? 0.5 : q;
    return l;
  }
  function noise(e, t, end) {
    const n = e.ctx.createBufferSource();
    n.buffer = e.noiseBuf;
    n.loop = true;
    n.start(t, Math.random() * 1.5);
    n.stop(end + 0.05);
    return n;
  }
  function done(nodes, last, out) {
    last.onended = () => { for (const n of nodes) { try { n.disconnect(); } catch (e) {} } try { out.disconnect(); } catch (e) {} };
  }
  // add a partial: oscillator -> its own decay -> dest
  function partial(ctx, kind, f, t, peak, attack, decay, dest, detune) {
    if (f > 16000) return null;
    const end = t + attack + decay;
    const o = osc(ctx, kind, f, t, end, detune);
    const g = perc(ctx, t, peak, attack, decay);
    o.connect(g);
    g.connect(dest);
    return { o, g, end };
  }

  // Every instrument: (engine, time, freq, velocity, duration, destination) -> end time.
  const I = {};

  // glass: a struck glass, sine with a few inharmonic shimmers that die first
  I.glass = (e, t, f, v, d, dest) => {
    const ctx = e.ctx, out = ctx.createGain();
    out.connect(dest);
    const ps = [[1, 1, d], [2.0, 0.17, d * 0.45], [3.01, 0.06, d * 0.25], [4.17, 0.025, d * 0.12]].map(([r, a, dd]) => partial(ctx, 'sine', f * r, t, v * a, 0.012, dd, out)).filter(Boolean);
    done(ps.flatMap((p) => [p.o, p.g]), ps[0].o, out);
    return t + d;
  };
  // celesta / music box: bright, short, a little metallic
  I.celesta = (e, t, f, v, d, dest) => {
    const ctx = e.ctx, out = ctx.createGain();
    out.connect(dest);
    const dd = Math.min(d, 2.2);
    const ps = [[1, 1, dd], [3.0, 0.12, dd * 0.3], [4.0, 0.22, dd * 0.22], [9.8, 0.04, 0.08]].map(([r, a, x]) => partial(ctx, 'sine', f * r, t, v * a, 0.006, x, out)).filter(Boolean);
    done(ps.flatMap((p) => [p.o, p.g]), ps[0].o, out);
    return t + dd;
  };
  // FM bell, kept gentle: the brightness falls away quickly so it never shrieks
  I.fmbell = (e, t, f, v, d, dest) => {
    const ctx = e.ctx, end = t + d;
    const car = osc(ctx, 'sine', f, t, end), mod = osc(ctx, 'sine', f * 3.5, t, end);
    const mg = ctx.createGain();
    mg.gain.setValueAtTime(f * 1.6, t);
    mg.gain.exponentialRampToValueAtTime(Math.max(1e-4, f * 0.08), t + 3 * (d * 0.12));
    mod.connect(mg);
    mg.connect(car.frequency);
    const g = perc(ctx, t, v * 0.8, 0.01, d);
    car.connect(g);
    const o2 = partial(ctx, 'sine', f * 2, t, v * 0.12, 0.003, d * 0.5, g);
    g.connect(dest);
    done([car, mod, mg, o2 && o2.g], car, g);
    return end;
  };
  // electric piano: FM tine over a warm body
  I.epiano = (e, t, f, v, d, dest) => {
    const ctx = e.ctx, dd = Math.max(0.8, Math.min(d, 3.2)), end = t + dd;
    const car = osc(ctx, 'sine', f, t, end), mod = osc(ctx, 'sine', f, t, end);
    const mg = ctx.createGain();
    mg.gain.setValueAtTime(f * (0.8 + v * 2), t);
    mg.gain.exponentialRampToValueAtTime(Math.max(1e-4, f * 0.15), t + 3 * (0.25));
    mod.connect(mg);
    mg.connect(car.frequency);
    const g = perc(ctx, t, v * 0.75, 0.003, dd);
    car.connect(g);
    g.connect(dest);
    const nodes = [car, mod, mg];
    if (f * 14 < 9000) { const tine = partial(ctx, 'sine', f * 14, t, v * 0.05, 0.001, 0.07, g); if (tine) nodes.push(tine.g); }
    done(nodes, car, g);
    return end;
  };
  // harp / guitar-like pluck: a soft sawtooth through a closing filter, doubled a hair apart
  I.pluck = (e, t, f, v, d, dest) => {
    const ctx = e.ctx, dd = Math.min(d, 2.4), end = t + dd;
    const lp = lowpass(ctx, f * 12, 0.8);
    lp.frequency.setValueAtTime(Math.min(14000, f * 12), t);
    lp.frequency.exponentialRampToValueAtTime(Math.max(300, f * 3.5), t + 0.3);
    const a = osc(ctx, 'soft', f, t, end), b = osc(ctx, 'soft', f, t, end, 4);
    const g = perc(ctx, t, v * 0.75, 0.004, dd);
    a.connect(lp); b.connect(lp); lp.connect(g); g.connect(dest);
    done([a, b, lp], a, g);
    return end;
  };
  // kalimba: a sine with a short, high, inharmonic tine
  I.kalimba = (e, t, f, v, d, dest) => {
    const ctx = e.ctx, out = ctx.createGain(), dd = Math.min(d, 1.8);
    out.connect(dest);
    const ps = [[1, 1, dd], [5.92, 0.16, 0.14], [2.0, 0.05, dd * 0.3]].map(([r, a, x]) => partial(ctx, 'sine', f * r, t, v * a, 0.0015, x, out)).filter(Boolean);
    done(ps.flatMap((p) => [p.o, p.g]), ps[0].o, out);
    return t + dd;
  };
  I.marimba = (e, t, f, v, d, dest) => {
    const ctx = e.ctx, out = ctx.createGain(), dd = Math.min(d, 1.6);
    out.connect(dest);
    const ps = [[1, 0.9, dd], [4, 0.2, 0.16], [9.9, 0.05, 0.05]].map(([r, a, x]) => partial(ctx, 'sine', f * r, t, v * a, 0.002, x, out)).filter(Boolean);
    done(ps.flatMap((p) => [p.o, p.g]), ps[0].o, out);
    return t + dd;
  };
  // breathy flute: rounded tone, a little breath noise, vibrato that arrives late
  I.flute = (e, t, f, v, d, dest) => {
    const ctx = e.ctx, off = t + Math.max(0.15, d * 0.6), end = off + 0.35;
    const o = osc(ctx, 'hollow', f, t, end);
    const vib = osc(ctx, 'sine', 5.1, t, end), vg = ctx.createGain();
    vg.gain.setValueAtTime(0, t);
    vg.gain.linearRampToValueAtTime(f * 0.006, t + 0.45);
    vib.connect(vg); vg.connect(o.frequency);
    const g = held(ctx, t, v * 0.55, 0.06, off, 0.3);
    o.connect(g);
    const n = noise(e, t, end), bp = ctx.createBiquadFilter();
    bp.type = 'bandpass'; bp.frequency.value = Math.min(9000, f * 2); bp.Q.value = 6;
    const ng = held(ctx, t, v * 0.12, 0.03, t + 0.12, 0.2);
    n.connect(bp); bp.connect(ng); ng.connect(g);
    g.connect(dest);
    done([o, vib, vg, n, bp, ng], o, g);
    return end;
  };
  // choir: two voices through vowel formants ("ah"), slow swell, vibrato
  // a long note (a pad) holds for its whole length and releases into the next one; a short one speaks and goes
  const holdFor = (t, d, frac, min) => t + (d > 2 ? d : Math.max(min, d * frac));
  I.choir = (e, t, f, v, d, dest) => {
    const ctx = e.ctx, off = holdFor(t, d, 0.7, 0.4), end = off + (d > 2 ? 1.8 : 0.9);
    const src = ctx.createGain();
    const a = osc(ctx, 'soft', f, t, end, -6), b = osc(ctx, 'soft', f, t, end, 6);
    const vib = osc(ctx, 'sine', 5.3, t, end), vg = ctx.createGain();
    vg.gain.value = f * 0.005;
    vib.connect(vg); vg.connect(a.frequency); vg.connect(b.frequency);
    a.connect(src); b.connect(src);
    const g = held(ctx, t, v * 0.9, 0.35, off, end - off);
    const nodes = [a, b, vib, vg, src];
    for (const [fr, q, amp] of [[730, 7, 1], [1090, 9, 0.55], [2440, 11, 0.22]]) {
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass'; bp.frequency.value = fr; bp.Q.value = q;
      const ga = ctx.createGain(); ga.gain.value = amp;
      src.connect(bp); bp.connect(ga); ga.connect(g);
      nodes.push(bp, ga);
    }
    g.connect(dest);
    done(nodes, a, g);
    return end;
  };
  // bowed strings: three detuned voices, slow bow, darkened
  I.strings = (e, t, f, v, d, dest) => {
    const ctx = e.ctx, off = holdFor(t, d, 0.75, 0.3), end = off + (d > 2 ? 1.8 : 0.7);
    const lp = lowpass(ctx, Math.min(5200, f * 5), 0.6);
    const os = [-8, 0, 7].map((c) => osc(ctx, 'soft', f, t, end, c));
    os.forEach((o) => o.connect(lp));
    const g = held(ctx, t, v * 0.42, d > 2 ? 0.6 : 0.22, off, end - off);
    lp.connect(g); g.connect(dest);
    done([...os, lp], os[0], g);
    return end;
  };
  I.organ = (e, t, f, v, d, dest) => {
    const ctx = e.ctx, off = holdFor(t, d, 0.8, 0.2), end = off + (d > 2 ? 2 : 0.25);
    const o = osc(ctx, 'organ', f, t, end), o2 = osc(ctx, 'organ', f, t, end, 3);
    // the higher the pipe, the softer its top harmonics (they pierce otherwise)
    const lp = lowpass(ctx, Math.min(3500, f * 6), 0.5);
    const g = held(ctx, t, v * 0.35, d > 2 ? 0.25 : 0.025, off, end - off);
    o.connect(lp); o2.connect(lp); lp.connect(g); g.connect(dest);
    done([o, o2, lp], o, g);
    return end;
  };
  // 8-bit, but rounded off so it's charming rather than harsh
  I.chip = (e, t, f, v, d, dest) => {
    const ctx = e.ctx, dd = Math.min(d, 0.45), end = t + dd;
    const o = osc(ctx, 'pulse', f, t, end);
    const lp = lowpass(ctx, Math.min(3200, f * 4), 0.4);
    const g = perc(ctx, t, v * 0.4, 0.002, dd);
    o.connect(lp); lp.connect(g); g.connect(dest);
    done([o, lp], o, g);
    return end;
  };
  // soft brass: the filter opens as the note speaks
  I.brass = (e, t, f, v, d, dest) => {
    const ctx = e.ctx, off = t + Math.max(0.2, d * 0.6), end = off + 0.35;
    const lp = lowpass(ctx, f * 1.2, 1.2);
    lp.frequency.setValueAtTime(f * 1.2, t);
    lp.frequency.linearRampToValueAtTime(Math.min(6000, f * 5), t + 0.07);
    lp.frequency.exponentialRampToValueAtTime(Math.min(4000, f * 3), t + 0.67);
    const a = osc(ctx, 'soft', f, t, end), b = osc(ctx, 'soft', f, t, end, 5);
    const g = held(ctx, t, v * 0.42, 0.05, off, 0.3);
    a.connect(lp); b.connect(lp); lp.connect(g); g.connect(dest);
    done([a, b, lp], a, g);
    return end;
  };
  // glass harmonica: slow attack, beating pairs, very pure
  I.glassharp = (e, t, f, v, d, dest) => {
    const ctx = e.ctx, out = ctx.createGain();
    out.connect(dest);
    const ps = [[1, 0, 0.7], [1, 0.9, 0.5], [2, 0, 0.14], [3, 0.4, 0.04]].map(([r, beat, a]) => partial(ctx, 'sine', f * r + beat, t, v * a, 0.09, d, out)).filter(Boolean);
    done(ps.flatMap((p) => [p.o, p.g]), ps[0].o, out);
    return t + d;
  };
  I.sine = (e, t, f, v, d, dest) => {
    const p = partial(e.ctx, 'sine', f, t, v * 0.7, 0.01, d, dest);
    if (p) done([p.o], p.o, p.g);
    return t + d;
  };
  // singing bowl: inharmonic partials, each a beating pair
  I.bowl = (e, t, f, v, d, dest) => {
    const ctx = e.ctx, out = ctx.createGain();
    out.connect(dest);
    const ps = [];
    for (const [r, a] of [[1, 1], [2.71, 0.4], [5.15, 0.18], [8.17, 0.07]]) {
      ps.push(partial(ctx, 'sine', f * r, t, v * a * 0.6, 0.03, d / (0.7 + r * 0.25), out));
      ps.push(partial(ctx, 'sine', f * r + 0.6 + r * 0.4, t, v * a * 0.45, 0.05, d / (0.7 + r * 0.25), out));
    }
    const ok = ps.filter(Boolean);
    done(ok.flatMap((p) => [p.o, p.g]), ok[0].o, out);
    return t + d;
  };
  // a water drop: the pitch falls into place
  I.drop = (e, t, f, v, d, dest) => {
    const ctx = e.ctx, out = ctx.createGain();
    out.connect(dest);
    const a = partial(ctx, 'sine', f, t, v * 0.85, 0.002, d, out);
    a.o.frequency.setValueAtTime(f * 1.7, t);
    a.o.frequency.exponentialRampToValueAtTime(f, t + 0.05);
    const b = partial(ctx, 'sine', f * 2.01, t, v * 0.16, 0.002, d * 0.4, out);
    done([a.o, a.g, b && b.o, b && b.g].filter(Boolean), a.o, out);
    return t + d;
  };

  // ---- the score's own voices
  // warm pad: two detuned warm waves and a quiet octave, slow swell
  I.pad = (e, t, f, v, d, dest) => {
    const ctx = e.ctx, off = t + d, end = off + 2.2;
    const lp = lowpass(ctx, Math.min(6500, f * 5.5), 0.4);
    const a = osc(ctx, 'soft', f, t, end, -9), b = osc(ctx, 'warm', f, t, end, 9), c = osc(ctx, 'soft', f * 2, t, end, 3);
    const cg = ctx.createGain(); cg.gain.value = 0.3;
    // carve the pad's low-mid body so the creatures' notes can be heard through it
    const dip = ctx.createBiquadFilter();
    dip.type = 'peaking'; dip.frequency.value = 320; dip.Q.value = 0.9; dip.gain.value = -4;
    a.connect(lp); b.connect(lp); c.connect(cg); cg.connect(lp);
    const g = held(ctx, t, v * 0.5, Math.min(1.4, d * 0.4), off, 2.2);
    lp.connect(dip); dip.connect(g); g.connect(dest);
    done([a, b, c, cg, lp, dip], a, g);
    return end;
  };
  // bass: a round sine with a little body, lightly plucked
  I.bass = (e, t, f, v, d, dest) => {
    const ctx = e.ctx, off = t + Math.max(0.12, d * 0.85), end = off + 0.18;
    const a = osc(ctx, 'sine', f, t, end), b = osc(ctx, 'warm', f, t, end);
    const lp = lowpass(ctx, Math.min(900, f * 4), 0.7);
    lp.frequency.setValueAtTime(Math.min(1400, f * 7), t);
    lp.frequency.exponentialRampToValueAtTime(Math.min(900, f * 3), t + 0.18);
    // less pure fundamental, more of the harmonics a phone speaker can actually play
    const bg = ctx.createGain(); bg.gain.value = 0.9;
    const ag = ctx.createGain(); ag.gain.value = 0.55;
    b.connect(bg); bg.connect(lp); a.connect(ag);
    const g = held(ctx, t, v * 0.9, 0.006, off, 0.12);
    ag.connect(g); lp.connect(g); g.connect(dest);
    done([a, b, bg, ag, lp], a, g);
    return end;
  };
  I.pluckbass = (e, t, f, v, d, dest) => {
    const ctx = e.ctx, dd = Math.min(d, 0.6), end = t + dd;
    const o = osc(ctx, 'soft', f, t, end);
    const s = osc(ctx, 'sine', f, t, end);
    const lp = lowpass(ctx, f * 8, 2);
    lp.frequency.setValueAtTime(Math.min(3000, f * 8), t);
    lp.frequency.exponentialRampToValueAtTime(Math.max(1e-4, f * 1.4), t + 3 * (0.07));
    const g = perc(ctx, t, v * 0.75, 0.003, dd);
    o.connect(lp); lp.connect(g); s.connect(g); g.connect(dest);
    done([o, s, lp], o, g);
    return end;
  };

  // ---- percussion (f is ignored except for toms and the deep boom)
  I.kick = (e, t, f, v, d, dest) => {
    const ctx = e.ctx, end = t + 0.45;
    const o = osc(ctx, 'sine', 140, t, end);
    o.frequency.setValueAtTime(140, t);
    o.frequency.exponentialRampToValueAtTime(46, t + 0.09);
    const g = perc(ctx, t, v, 0.002, 0.42);
    o.connect(g);
    const click = partial(ctx, 'sine', 1900, t, v * 0.06, 0.0005, 0.012, g);
    g.connect(dest);
    done([o, click && click.o, click && click.g].filter(Boolean), o, g);
    return end;
  };
  I.boom = (e, t, f, v, d, dest) => {
    const ctx = e.ctx, end = t + 1.6;
    const o = osc(ctx, 'sine', f * 2, t, end);
    o.frequency.setValueAtTime(f * 2, t);
    o.frequency.exponentialRampToValueAtTime(f, t + 0.25);
    const g = perc(ctx, t, v, 0.01, 1.5);
    o.connect(g); g.connect(dest);
    done([o], o, g);
    return end;
  };
  I.tom = (e, t, f, v, d, dest) => {
    const ctx = e.ctx, end = t + 0.7;
    const o = osc(ctx, 'sine', f * 1.6, t, end);
    o.frequency.setValueAtTime(f * 1.6, t);
    o.frequency.exponentialRampToValueAtTime(f, t + 0.12);
    const g = perc(ctx, t, v, 0.003, 0.65);
    o.connect(g); g.connect(dest);
    done([o], o, g);
    return end;
  };
  function noiseHit(e, t, v, type, freq, q, decay, dest) {
    const ctx = e.ctx, end = t + decay + 0.02;
    const n = noise(e, t, end), fl = ctx.createBiquadFilter();
    fl.type = type; fl.frequency.value = freq; fl.Q.value = q;
    const g = perc(ctx, t, v, 0.001, decay);
    n.connect(fl); fl.connect(g); g.connect(dest);
    done([n, fl], n, g);
    return end;
  }
  I.hat = (e, t, f, v, d, dest) => noiseHit(e, t, v * 0.8, 'highpass', 7500, 0.7, d > 0.2 ? 0.16 : 0.045, dest);
  I.shaker = (e, t, f, v, d, dest) => noiseHit(e, t, v * 0.4, 'bandpass', 5200, 1.1, 0.07, dest);
  I.rim = (e, t, f, v, d, dest) => {
    const p = partial(e.ctx, 'sine', 1750, t, v * 0.25, 0.0005, 0.03, dest);
    if (p) done([p.o], p.o, p.g);
    return noiseHit(e, t, v * 0.25, 'bandpass', 2600, 3, 0.025, dest);
  };
  I.clap = (e, t, f, v, d, dest) => {
    let end = t;
    for (let i = 0; i < 3; i++) end = noiseHit(e, t + i * 0.011, v * (i === 2 ? 0.5 : 0.3), 'bandpass', 1400, 1.4, i === 2 ? 0.14 : 0.012, dest);
    return end;
  };
  // thunder: a dark rumble of low-passed noise that rolls in, with a sub-boom falling under it
  I.thunder = (e, t, f, v, d, dest) => {
    const ctx = e.ctx, end = t + 4.2;
    const n = noise(e, t, end), lp = lowpass(ctx, 220, 0.7);
    lp.frequency.setValueAtTime(420, t);
    lp.frequency.exponentialRampToValueAtTime(90, t + 3.5);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(v, t + 0.25);
    g.gain.exponentialRampToValueAtTime(v * 1e-4, end);
    n.connect(lp); lp.connect(g); g.connect(dest);
    const b = osc(ctx, 'sine', 62, t, t + 2.4);
    b.frequency.setValueAtTime(62, t);
    b.frequency.exponentialRampToValueAtTime(34, t + 1.5);
    const bg = perc(ctx, t, v * 0.9, 0.04, 2.3);
    b.connect(bg); bg.connect(dest);
    done([n, lp], n, g);
    done([b], b, bg);
    return end;
  };
  // a filtered-noise swell that rises into the next section
  I.riser = (e, t, f, v, d, dest) => {
    const ctx = e.ctx, end = t + d + 0.05;
    const n = noise(e, t, end), bp = ctx.createBiquadFilter();
    bp.type = 'bandpass'; bp.Q.value = 1.6;
    bp.frequency.setValueAtTime(300, t);
    bp.frequency.exponentialRampToValueAtTime(6000, t + d);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(v, t + d * 0.95);
    g.gain.linearRampToValueAtTime(0, t + d + 0.04);
    n.connect(bp); bp.connect(g); g.connect(dest);
    done([n, bp], n, g);
    return end;
  };

  C.INSTR = I;

  // Each world's band: [soft, middle, edgy] for the creatures (by their timbre), then the score's voices.
  // trim: the score's level for that world, set from measured loudness (tests/score-test.html) so worlds sit
  // within a few dB of each other and a zoom never jumps in volume.
  C.FAMILIES = {
    tide:      { notes: ['glass', 'fmbell', 'pluck'],       pad: 'pad',       bass: 'bass',      arp: 'celesta', lead: 'flute',    groove: 'tide', maxE: 0.6, trim: 1.2 },
    mycelium:  { notes: ['kalimba', 'marimba', 'pluck'],    pad: 'pad',       bass: 'bass',      arp: 'kalimba', lead: 'epiano',   groove: 'wood', maxE: 0.75, trim: 1.12 },
    orrery:    { notes: ['celesta', 'glass', 'kalimba'],    pad: 'glassharp', bass: 'bass',      arp: 'celesta', lead: 'glass',    groove: 'clock', maxE: 0.7, trim: 1.16 },
    skin:      { notes: ['flute', 'epiano', 'strings'],     pad: 'strings',   bass: 'bass',      arp: 'epiano',  lead: 'flute',    groove: 'heart', maxE: 0.7, ext: 'add9', trim: 0.77 },
    resonance: { notes: ['glass', 'glassharp', 'bowl'],     pad: 'glassharp', bass: 'bass',      arp: 'glass',   lead: null,       groove: null, maxE: 0.55, trim: 1.22 },
    attractor: { notes: ['fmbell', 'glassharp', 'epiano'],  pad: 'pad',       bass: 'bass',      arp: 'fmbell',  lead: 'glass',    groove: 'soft', maxE: 0.7, trim: 1.01 },
    flame:     { notes: ['pluck', 'glass', 'strings'],      pad: 'strings',   bass: 'bass',      arp: 'pluck',   lead: 'flute',    groove: 'soft', maxE: 0.75, trim: 0.94 },
    plife:     { notes: ['kalimba', 'marimba', 'pluck'],    pad: 'pad',       bass: 'pluckbass', arp: 'kalimba', lead: 'epiano',   groove: 'wood', maxE: 0.75, trim: 1.38 },
    murmur:    { notes: ['flute', 'choir', 'pluck'],        pad: 'choir',     bass: 'bass',      arp: 'pluck',   lead: 'flute',    groove: null, maxE: 0.6, trim: 1.15 },
    fluid:     { notes: ['epiano', 'glass', 'flute'],       pad: 'pad',       bass: 'bass',      arp: 'epiano',  lead: 'flute',    groove: 'soft', maxE: 0.65, trim: 1.08 },
    ripple:    { notes: ['drop', 'glass', 'kalimba'],       pad: 'glassharp', bass: 'bass',      arp: 'kalimba', lead: null,       groove: 'drip', maxE: 0.65, trim: 1.19 },
    scope:     { notes: ['sine', 'glass', 'sine'],          pad: 'pad',       bass: 'bass',      arp: null,      lead: null,       groove: null, maxE: 0.5, trim: 1.16 },
    blackhole: { notes: ['strings', 'fmbell', 'choir'],     pad: 'strings',   bass: 'bass',      arp: 'fmbell',  lead: 'choir',    groove: 'deep', maxE: 0.75, ext: 'seventh', trim: 0.86 },
    julia:     { notes: ['glassharp', 'celesta', 'glass'],  pad: 'glassharp', bass: 'bass',      arp: 'celesta', lead: 'glass',    groove: null, maxE: 0.55, ext: 'add9', trim: 1.32 },
    tunnel:    { notes: ['pluck', 'epiano', 'chip'],        pad: 'pad',       bass: 'pluckbass', arp: 'pluck',   lead: 'brass',    groove: 'drive', maxE: 1, minE: 0.58, bassGain: 2.2, drumGain: 1.8, trim: 1.01 },
    cathedral: { notes: ['organ', 'choir', 'glass'],        pad: 'organ',     bass: 'bass',      arp: 'celesta', lead: 'choir',    groove: null, maxE: 0.6, bassGain: 0.6, trim: 1.24 },
    life:      { notes: ['chip', 'marimba', 'celesta'],     pad: 'organ',     bass: 'pluckbass', arp: 'chip',    lead: 'chip',     groove: 'chip', maxE: 0.9, minE: 0.4, bassGain: 1.5, drumGain: 1.3, trim: 1.27 },
    storm:     { notes: ['strings', 'brass', 'fmbell'],     pad: 'strings',   bass: 'bass',      arp: 'glass',   lead: 'brass',    groove: 'toms', maxE: 0.9, minE: 0.35, bassGain: 1.4, drumGain: 1.4, trim: 0.71 },
  };
  C.familyOf = (genus) => C.FAMILIES[genus] || C.FAMILIES.tide;
})();
