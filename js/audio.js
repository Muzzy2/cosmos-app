'use strict';
// Sound engine: every voice here is triggered by something that lives in the world.
// Master chain: voices -> synth lowpass -> synth bus -> (reverb, delay) -> master (the universe's mix)
// -> high-pass -> glue compressor -> sum. Your song goes straight to the sum, untouched. The sum ->
// volume -> a safety limiter that only catches stray peaks -> out.
(function () {
  const C = window.COSMOS;

  // Disconnect a node when the audio clock (not the wall clock) reaches `end`: correct while paused
  // and in offline renders, where idle nodes left connected would pile up and slow everything.
  function releaseAt(ctx, node, end) {
    const s = ctx.createConstantSource();
    s.offset.value = 0;
    s.start(Math.max(ctx.currentTime, end - 0.01));
    s.stop(end);
    s.onended = () => { try { node.disconnect(); } catch (e) {} };
  }

  const OCTAVE_UP = { glass: 1, celesta: 1, kalimba: 1, fmbell: 1, chip: 1, flute: 1, glassharp: 1 };

  class AudioEngine {
    constructor() {
      this.ctx = null;
      this.started = false;
      this.bpm = 82;
      this.clockStart = performance.now() / 1000;
      this.nextTick = 0;
      this.maxPerSlot = 2;
      this.maxVoices = 26;
      this.voiceEnds = [];
      this.slotCounts = new Map();
      this.level = 0; // rough loudness of what we've played, drives cymatics
      this.volume = C.storage.get('volume', 0.6);
      this.synthOn = true;
      this.duck = 1;
      this.composer = null; // set by main: the score, whose current chord colours the creatures' notes
      this.defaultFam = 'tide';
      this.scoreVolume = C.storage.get('scoreVolume', 0.8);
    }

    static peakCurve() {
      const N = 32769, c = new Float32Array(N), T = Math.pow(10, -2 / 20);
      for (let i = 0; i < N; i++) {
        const x = ((i / (N - 1)) * 2 - 1) * 4, a = Math.abs(x);
        c[i] = Math.sign(x) * (a <= T ? a : T + (1 - T) * Math.tanh((a - T) / (1 - T)));
      }
      return c;
    }

    now() {
      return this.ctx ? this.ctx.currentTime : performance.now() / 1000;
    }
    tickDur() {
      return 60 / this.bpm / 4;
    }
    beatDur() {
      return 60 / this.bpm;
    }

    // ctxOverride: an OfflineAudioContext, so tests can render and measure the real engine
    start(ctxOverride) {
      if (this.started) return;
      const AC = window.AudioContext || window.webkitAudioContext;
      // iOS: without this, Web Audio is silenced by the ringer switch
      if (!ctxOverride) try { if ('audioSession' in navigator) navigator.audioSession.type = 'playback'; } catch (e) {}
      const ctx = (this.ctx = ctxOverride || new AC({ latencyHint: 'interactive' }));
      this.started = true;
      // Every note is a handful of nodes the audio thread renders 375 times a second. A full chorus (26
      // creature voices of up to three notes each) cost 50-95% of a desktop core (offline render bench,
      // 2026-10-23), and a phone overloads: crackles, then iOS drops the sound. So the budget counts notes,
      // not calls (see play), and phones get a smaller one.
      if (!ctxOverride && C.MOBILE) this.maxVoices = 12;
      // the context can be suspended or interrupted under us (a call, Siri, an overloaded audio thread):
      // main.js asks for it back while you are there
      ctx.onstatechange = () => {
        if (ctx.state === 'running' && this.held) { ctx.suspend().catch(() => {}); return; }
        if (this.onState) this.onState(ctx.state);
      };
      this.clockStart = ctx.currentTime + 0.15;
      this.nextTick = 0;
      this.slotCounts.clear();

      // the universe's own mix gets glued together gently
      this.master = ctx.createGain();
      this.master.gain.value = 1;
      const hp = ctx.createBiquadFilter();
      hp.type = 'highpass';
      hp.frequency.value = 32;
      hp.Q.value = 0.6;
      this.glue = ctx.createDynamicsCompressor();
      this.glue.threshold.value = -22;
      this.glue.knee.value = 12;
      this.glue.ratio.value = 2.5;
      this.glue.attack.value = 0.025;
      this.glue.release.value = 0.35;
      this.makeup = ctx.createGain();
      this.makeup.gain.value = 1.5; // set from a live recording: about -17 LUFS at the default volume
      // a gentle presence shelf: almost everything here is made of sines, which reads as muffled on a phone
      const air = ctx.createBiquadFilter();
      air.type = 'highshelf';
      air.frequency.value = 4000;
      air.gain.value = 2;
      this.master.connect(hp);
      hp.connect(this.glue);
      this.glue.connect(air);
      air.connect(this.makeup);
      this.sum = ctx.createGain();
      this.makeup.connect(this.sum);
      // volume (fades in on waking), then a peak guard: exactly linear below -2 dBFS, rounding off
      // only what would clip. (A DynamicsCompressor can't do this job: it adds ~1 dB of makeup gain
      // and 6 ms of latency to everything, which the song test caught.)
      this.vol = ctx.createGain();
      this.vol.gain.value = 0;
      this.vol.gain.setTargetAtTime(this.volume, ctx.currentTime + 0.05, 1.2);
      const pre = ctx.createGain();
      pre.gain.value = 0.25; // the curve spans +-4 (12 dB above full scale) before it saturates
      this.limiter = ctx.createWaveShaper();
      this.limiter.curve = AudioEngine.peakCurve();
      this.limiter.oversample = '4x';
      this.out = ctx.createGain();
      this.out.gain.value = 1;
      this.sum.connect(this.vol);
      this.vol.connect(pre);
      pre.connect(this.limiter);
      this.limiter.connect(this.out);
      this.out.connect(ctx.destination);
      this.outAnalyser = ctx.createAnalyser();
      this.outAnalyser.fftSize = 1024;
      this.out.connect(this.outAnalyser);
      this._outBuf = new Float32Array(1024);

      // shared FX
      this.reverb = ctx.createConvolver();
      this.reverb.buffer = this._impulse(4.2);
      this.reverbIn = ctx.createGain();
      this.reverbIn.gain.value = 1;
      this.reverbOut = ctx.createGain();
      this.reverbOut.gain.value = 0.5;
      // keep the reverb out of the low end, where it turns to mud
      const revHP = ctx.createBiquadFilter();
      revHP.type = 'highpass';
      revHP.frequency.value = 220;
      this.reverbIn.connect(revHP);
      revHP.connect(this.reverb);
      this.reverb.connect(this.reverbOut);
      this.reverbOut.connect(this.master);

      this.delayL = ctx.createDelay(2);
      this.delayR = ctx.createDelay(2);
      this.delayFb = ctx.createGain();
      this.delayFb.gain.value = 0.38;
      this.delayTone = ctx.createBiquadFilter();
      this.delayTone.type = 'lowpass';
      this.delayTone.frequency.value = 2600;
      this.delayIn = ctx.createGain();
      this.delayIn.gain.value = 1;
      const merger = ctx.createChannelMerger(2);
      this.delayIn.connect(this.delayL);
      this.delayL.connect(this.delayTone);
      this.delayTone.connect(this.delayR);
      this.delayR.connect(this.delayFb);
      this.delayFb.connect(this.delayL);
      this.delayL.connect(merger, 0, 0);
      this.delayR.connect(merger, 0, 1);
      this.delayOut = ctx.createGain();
      this.delayOut.gain.value = 0.35;
      merger.connect(this.delayOut);
      this.delayOut.connect(this.master);
      this._setDelayTimes();

      // synth bus: everything the universe plays
      this.synthIn = ctx.createGain();
      this.synthLP = ctx.createBiquadFilter();
      this.synthLP.type = 'lowpass';
      this.synthLP.frequency.value = 18000;
      this.synthLP.Q.value = 0.5;
      this.synthBus = ctx.createGain();
      this.synthBus.gain.value = 1;
      this.synthIn.connect(this.synthLP);
      this.synthLP.connect(this.synthBus);
      this.synthBus.connect(this.master);
      this.revSend = ctx.createGain();
      this.revSend.gain.value = 0.45;
      this.synthBus.connect(this.revSend);
      this.revSend.connect(this.reverbIn);
      this.dlySend = ctx.createGain();
      this.dlySend.gain.value = 0.22;
      this.synthBus.connect(this.dlySend);
      this.dlySend.connect(this.delayIn);

      // music bus: uploaded songs play here, straight to the sum: no compression, no colouring
      // (captured tabs/mic are analysed only, never re-played)
      this.musicBus = ctx.createGain();
      this.musicBus.gain.value = C.storage.get('musicVolume', 0.8);
      this.musicBus.connect(this.sum);

      // the score: the composer's band, with its own lowpass (time-slowing and diving sink it too)
      this.scoreBus = ctx.createGain();
      this.scoreBus.gain.value = 0;
      this.scoreLP = ctx.createBiquadFilter();
      this.scoreLP.type = 'lowpass';
      this.scoreLP.frequency.value = 18000;
      this.scoreLP.Q.value = 0.5;
      this.scoreBus.connect(this.scoreLP);
      this.scoreLP.connect(this.master);
      const sRev = ctx.createGain();
      sRev.gain.value = 0.38;
      this.scoreLP.connect(sRev);
      sRev.connect(this.reverbIn);
      const sDly = ctx.createGain();
      sDly.gain.value = 0.1;
      this.scoreLP.connect(sDly);
      sDly.connect(this.delayIn);


      this.noiseBuf = this._noise(2);
      this._buildDroneBus();
      this._buildStir();
    }

    // A hall: 18 ms pre-delay, a few early reflections, then a decorrelated stereo tail whose highs
    // die faster than its lows (as air and walls do). RT60 = sec.
    _impulse(sec) {
      const ctx = this.ctx, sr = ctx.sampleRate, len = Math.floor(sr * sec);
      const buf = ctx.createBuffer(2, len, sr);
      const pre = Math.floor(sr * 0.018);
      for (let ch = 0; ch < 2; ch++) {
        const d = buf.getChannelData(ch);
        let lp = 0;
        for (let i = pre; i < len; i++) {
          const t = (i - pre) / sr;
          const env = Math.exp((-6.9 * t) / sec);
          const v = (Math.random() * 2 - 1) * env;
          const k = 0.08 + 0.75 * Math.exp(-t / (sec * 0.35)); // darker as it decays
          lp += (v - lp) * k;
          d[i] = lp * Math.min(1, (i - pre) / (sr * 0.03)) * 0.9;
        }
        for (let r = 0; r < 7; r++) {
          const at = pre + Math.floor(sr * (0.006 + Math.random() * 0.06));
          if (at < len) d[at] += (Math.random() < 0.5 ? -1 : 1) * (0.5 - r * 0.05);
        }
      }
      return buf;
    }
    _noise(sec) {
      const ctx = this.ctx, len = Math.floor(ctx.sampleRate * sec);
      const buf = ctx.createBuffer(1, len, ctx.sampleRate);
      const d = buf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      return buf;
    }
    _setDelayTimes() {
      if (!this.ctx) return;
      const b = this.beatDur(), t = this.ctx.currentTime;
      this.delayL.delayTime.setTargetAtTime(Math.min(1.9, b * 0.75), t, 0.2);
      this.delayR.delayTime.setTargetAtTime(Math.min(1.9, b * 0.5), t, 0.2);
    }

    setVolume(v) {
      this.volume = v;
      C.storage.set('volume', v);
      if (this.vol) this.vol.gain.setTargetAtTime(v, this.ctx.currentTime, 0.1);
    }
    setScoreVolume(v) {
      this.scoreVolume = v;
      C.storage.set('scoreVolume', v);
    }
    setMusicVolume(v) {
      C.storage.set('musicVolume', v);
      if (this.musicBus) this.musicBus.gain.setTargetAtTime(v, this.ctx.currentTime, 0.1);
    }
    setSynthOn(on) {
      this.synthOn = on;
      this._applyBus();
    }
    setDuck(d) {
      // when your music plays, the universe steps back and plays along softly
      this.duck = d;
      this._applyBus();
    }
    // the score makes no voices while it can't be heard (your song is playing, or sounds are off)
    scoreMuted() {
      return !this.synthOn || this.duck < 1 || this.scoreVolume <= 0.001;
    }
    _applyBus() {
      if (!this.ctx) return;
      const g = this.synthOn ? this.duck : 0;
      this.synthBus.gain.setTargetAtTime(g, this.ctx.currentTime, 0.4);
      this.droneBus.gain.setTargetAtTime(this.synthOn ? (this.duck < 1 ? 0.35 : 1) : 0, this.ctx.currentTime, 0.8);
    }

    setBpm(b) {
      b = C.clamp(b, 20, 200);
      if (Math.abs(b - this.bpm) < 1e-3) return;
      const now = this.now();
      const pos = (now - this.clockStart) / this.tickDur();
      this.bpm = b;
      this.clockStart = now - pos * this.tickDur();
      this._setDelayTimes();
    }
    // phase-lock nudge from detected beats in your music
    nudgePhase(onsetTime, amount) {
      const bd = this.beatDur();
      let e = (onsetTime - this.clockStart) / bd;
      e = e - Math.round(e);
      this.clockStart += e * bd * amount;
    }

    // Grid ticks (16ths) inside the look-ahead window, each emitted exactly once.
    pollTicks(lookahead) {
      const out = [];
      const now = this.now(), td = this.tickDur();
      let t = this.clockStart + this.nextTick * td;
      if (t < now - 0.25) {
        this.nextTick = Math.ceil((now - this.clockStart) / td);
        t = this.clockStart + this.nextTick * td;
      }
      while (t < now + lookahead) {
        out.push({ tick: this.nextTick, time: t });
        this.nextTick++;
        t = this.clockStart + this.nextTick * td;
      }
      if (this.slotCounts.size > 64) {
        const cut = this.nextTick - 8;
        for (const k of this.slotCounts.keys()) if (k < cut) this.slotCounts.delete(k);
      }
      return out;
    }
    nextGrid(minDelay) {
      const now = this.now(), td = this.tickDur();
      const k = Math.ceil((now + (minDelay || 0.03) - this.clockStart) / td);
      return { tick: k, time: this.clockStart + k * td };
    }

    // is there room in the budget for n more notes?
    _voiceRoom(n) {
      const now = this.now();
      this.voiceEnds = this.voiceEnds.filter((e) => e > now);
      return this.voiceEnds.length + (n || 1) <= this.maxVoices;
    }

    // Quantised note for a creature. Returns the time it will sound, or null if the band is full.
    requestNote(spec) {
      if (!this.ctx || !this.synthOn) return null;
      if (!this._voiceRoom(spec.notes ? spec.notes.length : 1)) return null;
      let { tick, time } = this.nextGrid(0.03);
      for (let i = 0; i < 3; i++) {
        const c = this.slotCounts.get(tick) || 0;
        if (c < this.maxPerSlot) {
          this.slotCounts.set(tick, c + 1);
          this.play(spec, time);
          return time;
        }
        tick++;
        time += this.tickDur();
      }
      return null;
    }

    // spec: {midi | freq, timbre 0..1, vel, pan, dur, notes:[midi...]}
    play(spec, time) {
      if (!this.ctx) return;
      const ctx = this.ctx;
      // the band has a limit: quiet background notes give way when it is crowded
      const notes = spec.notes || [spec.midi];
      if (!this._voiceRoom(notes.length) && (spec.vel == null ? 0.2 : spec.vel) < 0.2) return;
      // louder notes may go over the budget, but never far: a burst of events can't pile up voices
      if (this.voiceEnds.length + notes.length > this.maxVoices + 8) return;
      const t = Math.max(time || ctx.currentTime, ctx.currentTime);
      const vel = C.clamp(spec.vel == null ? 0.2 : spec.vel, 0, 1) / Math.sqrt(notes.length);
      const pan = ctx.createStereoPanner();
      pan.pan.value = C.clamp(spec.pan || 0, -0.95, 0.95);
      pan.connect(this.synthIn);
      const timbre = spec.timbre == null ? 0.3 : spec.timbre;
      const dur = spec.dur || (timbre < 0.33 ? 2.2 : timbre < 0.66 ? 2.6 : 0.9);
      // the world's band decides what a creature sounds like; its timbre picks soft, middle or edgy
      const fam = C.familyOf(spec.fam || this.defaultFam);
      const instName = C.INSTR[spec.voice] ? spec.voice : fam.notes[timbre < 0.33 ? 0 : timbre < 0.66 ? 1 : 2];
      // your own sound pack, if you loaded one, sings for the creatures instead of the world's band
      const pack = this.userPack && !spec.voice && !spec.freq ? this.userPack : null;
      const inst = pack ? (e, t0, f, v, d, dest) => pack.voice(e, t0, f, v, d, dest) : C.INSTR[instName];
      const chord = this.composer && this.composer.chordPcs;
      let end = t;
      for (const m of notes) {
        // bell-like voices sound an octave above the written note, as a celesta does
        const f = spec.freq || C.midiToFreq(m + (OCTAVE_UP[instName] && !pack ? 12 : 0));
        // notes outside the score's current chord still sound, but as quieter passing colour
        const pc = ((Math.round(m) % 12) + 12) % 12;
        const v = chord && !spec.freq && !chord.has(pc) ? vel * 0.6 : vel;
        end = Math.max(end, inst(this, t, f, v, dur, pan));
      }
      this.voiceEnds.push(end);
      for (let i = 1; i < notes.length; i++) this.voiceEnds.push(end); // the budget counts every note
      this.level = Math.min(2, this.level + vel * 1.5);
      releaseAt(ctx, pan, end + 0.3);
    }

    // One note from the instrument library into the score, through one of five fixed stereo positions
    // (no per-note panner: the score plays hundreds of notes a minute, and phones notice).
    playInst(name, midi, time, vel, dur, pan) {
      if (!this.ctx) return 0;
      const inst = C.INSTR[name];
      if (!inst) return 0;
      if (!this.scorePans) {
        this.scorePans = [-0.6, -0.3, 0, 0.3, 0.6].map((x) => {
          const p = this.ctx.createStereoPanner();
          p.pan.value = x;
          p.connect(this.scoreBus);
          return p;
        });
      }
      const t = Math.max(time, this.ctx.currentTime);
      const lane = Math.round(C.clamp((pan || 0) / 0.3, -2, 2)) + 2;
      // a few cents of drift per note, so held tones never sound sequenced
      const drift = Math.pow(2, ((Math.random() - 0.5) * 8) / 1200);
      return inst(this, t, C.midiToFreq(midi) * drift, vel, dur, this.scorePans[lane]);
    }

    // A world's view of the engine: its notes are played by its own band.
    forWorld(u) {
      const eng = this;
      return new Proxy(eng, {
        get(target, k) {
          if (k === 'play') return (spec, time) => eng.play(Object.assign({ fam: u.genus }, spec), time);
          if (k === 'requestNote') return (spec) => eng.requestNote(Object.assign({ fam: u.genus }, spec));
          const v = target[k];
          return typeof v === 'function' ? v.bind(target) : v;
        },
        set(target, k, v) { target[k] = v; return true; },
      });
    }

    // Pulsar heartbeat: a soft pitched kick.
    thump(time, freq, vel, pan) {
      if (!this.ctx || !this.synthOn || !this._voiceRoom()) return;
      const ctx = this.ctx, t = Math.max(time, ctx.currentTime);
      const o = ctx.createOscillator();
      o.type = 'sine';
      o.frequency.setValueAtTime(freq * 3, t);
      o.frequency.exponentialRampToValueAtTime(freq, t + 0.07);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(vel, t + 0.003);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.55);
      const p = ctx.createStereoPanner();
      p.pan.value = C.clamp(pan, -0.9, 0.9);
      o.connect(g); g.connect(p); p.connect(this.synthIn);
      // a breath of filtered noise on top
      const n = ctx.createBufferSource();
      n.buffer = this.noiseBuf;
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = 1800 + freq * 8;
      bp.Q.value = 1.2;
      const ng = ctx.createGain();
      ng.gain.setValueAtTime(vel * 0.12, t);
      ng.gain.exponentialRampToValueAtTime(0.0005, t + 0.09);
      n.connect(bp); bp.connect(ng); ng.connect(p);
      o.start(t); o.stop(t + 0.6);
      n.start(t, Math.random()); n.stop(t + 0.12);
      o.onended = () => { try { p.disconnect(); } catch (e) {} };
      this.voiceEnds.push(t + 0.55);
      this.level = Math.min(2, this.level + vel);
    }

    // Shockwave / supernova body: noise sweep + sub + optional chord.
    burst(strength, pan, chord, timbre) {
      if (!this.ctx || !this.synthOn) return;
      const ctx = this.ctx, t = ctx.currentTime + 0.01;
      const p = ctx.createStereoPanner();
      p.pan.value = C.clamp(pan, -0.9, 0.9);
      p.connect(this.synthIn);
      const n = ctx.createBufferSource();
      n.buffer = this.noiseBuf;
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.Q.value = 0.9;
      bp.frequency.setValueAtTime(3500, t);
      bp.frequency.exponentialRampToValueAtTime(160, t + 0.9 + strength * 0.6);
      const ng = ctx.createGain();
      const v = 0.12 + 0.25 * strength;
      ng.gain.setValueAtTime(0, t);
      ng.gain.linearRampToValueAtTime(v, t + 0.01);
      ng.gain.exponentialRampToValueAtTime(0.0005, t + 1.2 + strength);
      n.connect(bp); bp.connect(ng); ng.connect(p);
      n.start(t); n.stop(t + 2.4 + strength);
      const o = ctx.createOscillator();
      o.frequency.setValueAtTime(110, t);
      o.frequency.exponentialRampToValueAtTime(38, t + 0.5);
      const og = ctx.createGain();
      og.gain.setValueAtTime(0, t);
      og.gain.linearRampToValueAtTime(0.18 + 0.25 * strength, t + 0.005);
      og.gain.exponentialRampToValueAtTime(0.001, t + 0.9 + strength * 0.5);
      o.connect(og); og.connect(p);
      o.start(t); o.stop(t + 1.6 + strength);
      o.onended = () => { try { p.disconnect(); } catch (e) {} };
      if (chord) {
        chord.forEach((m, i) => this.play({ midi: m, timbre: timbre == null ? 0.2 : timbre, vel: 0.12 + 0.1 * strength, pan, dur: 3 + strength * 2 }, t + 0.03 + i * 0.07));
      }
      this.level = Math.min(2, this.level + strength);
    }

    // Long whoosh used for diving between worlds.
    whoosh(dur, up) {
      if (!this.ctx) return;
      const ctx = this.ctx, t = ctx.currentTime;
      const n = ctx.createBufferSource();
      n.buffer = this.noiseBuf;
      n.loop = true;
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.Q.value = 2.5;
      bp.frequency.setValueAtTime(up ? 200 : 4000, t);
      bp.frequency.exponentialRampToValueAtTime(up ? 5000 : 180, t + dur);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(0.22, t + dur * 0.8);
      g.gain.linearRampToValueAtTime(0, t + dur * 1.15);
      n.connect(bp); bp.connect(g); g.connect(this.master);
      g.connect(this.reverbIn);
      n.start(t); n.stop(t + dur * 1.2);
      this.synthLP.frequency.cancelScheduledValues(t);
      this.synthLP.frequency.setTargetAtTime(500, t, dur * 0.3);
      this.synthLP.frequency.setTargetAtTime(18000, t + dur, 0.6);
      this.scoreLP.frequency.cancelScheduledValues(t);
      this.scoreLP.frequency.setTargetAtTime(700, t, dur * 0.3);
      this.scoreLP.frequency.setTargetAtTime(18000, t + dur, 0.6);
    }

    // Continuous voices ----------------------------------------------------------------
    _buildDroneBus() {
      const ctx = this.ctx;
      this.droneBus = ctx.createGain();
      this.droneBus.gain.value = 1;
      this.droneBus.connect(this.master);
      const dRev = ctx.createGain();
      dRev.gain.value = 0.9;
      this.droneBus.connect(dRev);
      dRev.connect(this.reverbIn);
    }

    // The oscilloscope world's own clean stereo bus: left = x, right = y.
    _scopeBus() {
      if (this.scopeMerger) return;
      const ctx = this.ctx;
      this.scopeMerger = ctx.createChannelMerger(2);
      const out = ctx.createGain();
      out.gain.value = 1;
      this.scopeMerger.connect(out);
      out.connect(this.master);
      const sp = ctx.createChannelSplitter(2);
      this.scopeMerger.connect(sp);
      this.scopeAL = ctx.createAnalyser();
      this.scopeAR = ctx.createAnalyser();
      this.scopeAL.fftSize = this.scopeAR.fftSize = 2048;
      sp.connect(this.scopeAL, 0);
      sp.connect(this.scopeAR, 1);
    }
    scopeVoice() {
      if (!this.ctx) return null;
      this._scopeBus();
      const ctx = this.ctx, M = this.scopeMerger;
      const mk = (ch) => {
        const o = ctx.createOscillator();
        const g = ctx.createGain();
        g.gain.value = 0;
        o.connect(g);
        g.connect(M, 0, ch);
        o.start();
        return { o, g };
      };
      const X = mk(0), Y = mk(1), K = mk(1);
      const self = this;
      return {
        set(fx, fy, gain, knot) {
          const t = ctx.currentTime, on = self.synthOn ? 1 : 0;
          X.o.frequency.setTargetAtTime(fx, t, 0.05);
          Y.o.frequency.setTargetAtTime(fy, t, 0.05);
          K.o.frequency.setTargetAtTime(fx * 3, t, 0.05);
          X.g.gain.setTargetAtTime(gain * on, t, 0.08);
          Y.g.gain.setTargetAtTime(gain * on, t, 0.08);
          K.g.gain.setTargetAtTime(gain * knot * 0.6 * on, t, 0.15);
        },
        stop() {
          for (const v of [X, Y, K]) { v.g.gain.setTargetAtTime(0, ctx.currentTime, 0.1); setTimeout(() => { try { v.o.stop(); v.g.disconnect(); } catch (e) {} }, 800); }
        },
      };
    }
    readScope(L, R) {
      if (!this.scopeAL) { L.fill(0); R.fill(0); return; }
      this.scopeAL.getFloatTimeDomainData(L);
      this.scopeAR.getFloatTimeDomainData(R);
    }

    // Every world owns a drone, so two worlds can crossfade while you zoom between them.
    // Each medium has its own bed: the drone changes its whole character, not just its key.
    createDrone() {
      if (!this.ctx) return null;
      const ctx = this.ctx;
      const out = ctx.createGain();
      out.gain.value = 0;
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 520;
      lp.Q.value = 2;
      const lfo = ctx.createOscillator();
      lfo.frequency.value = 0.03 + Math.random() * 0.04;
      const lfoG = ctx.createGain();
      lfoG.gain.value = 220;
      lfo.connect(lfoG);
      lfoG.connect(lp.frequency);
      lfo.start();
      lp.connect(out);
      out.connect(this.droneBus);
      const osc = [];
      const parts = [['sawtooth', 1, 0.5], ['sawtooth', 1.004, 0.5], ['sawtooth', 1.5, 0.32], ['sine', 0.5, 0.9], ['triangle', 2, 0.12]];
      for (const [type, mul, gain] of parts) {
        const o = ctx.createOscillator();
        o.type = type;
        o.frequency.value = 73 * mul;
        const g = ctx.createGain();
        g.gain.value = gain;
        o.connect(g);
        g.connect(lp);
        o.start();
        osc.push({ o, mul });
      }
      const TIMBRES = {
        tide: [['sawtooth', 'sawtooth', 'sawtooth', 'sine', 'triangle'], 520, 0.055],
        mycelium: [['sawtooth', 'square', 'sawtooth', 'sine', 'sine'], 240, 0.06],
        orrery: [['triangle', 'triangle', 'sine', 'sine', 'sine'], 1400, 0.045],
        skin: [['sawtooth', 'triangle', 'triangle', 'sine', 'sine'], 380, 0.06],
        resonance: [['sine', 'sine', 'sine', 'sine', 'sine'], 2200, 0.035],
        fluid: [['sawtooth', 'triangle', 'sine', 'sine', 'sine'], 450, 0.05],
        ripple: [['sine', 'triangle', 'sine', 'sine', 'sine'], 1100, 0.04],
        scope: [['sine', 'sine', 'sine', 'sine', 'sine'], 600, 0.02],
        blackhole: [['sawtooth', 'sawtooth', 'sine', 'sine', 'square'], 180, 0.07],
        julia: [['triangle', 'sine', 'sine', 'sine', 'triangle'], 1200, 0.035],
        tunnel: [['sawtooth', 'square', 'sawtooth', 'sine', 'sawtooth'], 700, 0.05],
        cathedral: [['sine', 'triangle', 'sine', 'sine', 'sine'], 900, 0.05],
        life: [['square', 'triangle', 'square', 'sine', 'sine'], 500, 0.035],
        storm: [['sawtooth', 'sawtooth', 'sawtooth', 'sine', 'square'], 300, 0.06],
        attractor: [['sine', 'triangle', 'sine', 'sine', 'sawtooth'], 900, 0.045],
        plife: [['square', 'square', 'triangle', 'sine', 'sine'], 330, 0.04],
        murmur: [['triangle', 'sawtooth', 'sine', 'sine', 'sine'], 700, 0.045],
      };
      const d = {
        base: 520, level: 0.055, gain: 0,
        setKey(rootMidi, fifthSemis) {
          const f = C.midiToFreq(rootMidi), t = ctx.currentTime;
          const fifthMul = Math.pow(2, fifthSemis / 12);
          osc.forEach((x, i) => x.o.frequency.setTargetAtTime(f * (i === 2 ? fifthMul : x.mul), t, 1.2));
        },
        setTimbre(kind) {
          const T = TIMBRES[kind] || TIMBRES.tide;
          osc.forEach((x, i) => { x.o.type = T[0][i]; });
          d.base = T[1];
          d.level = T[2];
          lp.frequency.setTargetAtTime(T[1], ctx.currentTime, 1.5);
        },
        setBright(x) {
          lp.frequency.setTargetAtTime(d.base * 0.6 + x * d.base * 1.7, ctx.currentTime, 1.5);
        },
        setGain(g) {
          if (Math.abs(g - d.gain) < 0.01) return;
          d.gain = g;
          out.gain.setTargetAtTime(d.level * g, ctx.currentTime, 0.25);
        },
        stop() {
          out.gain.setTargetAtTime(0, ctx.currentTime, 0.3);
          setTimeout(() => { osc.forEach((x) => { try { x.o.stop(); } catch (e) {} }); try { lfo.stop(); out.disconnect(); } catch (e) {} }, 2500);
        },
      };
      return d;
    }

    _buildStir() {
      const ctx = this.ctx;
      const n = ctx.createBufferSource();
      n.buffer = this.noiseBuf;
      n.loop = true;
      this.stirBP = ctx.createBiquadFilter();
      this.stirBP.type = 'bandpass';
      this.stirBP.Q.value = 1.4;
      this.stirBP.frequency.value = 400;
      this.stirG = ctx.createGain();
      this.stirG.gain.value = 0;
      this.stirPan = ctx.createStereoPanner();
      n.connect(this.stirBP);
      this.stirBP.connect(this.stirG);
      this.stirG.connect(this.stirPan);
      this.stirPan.connect(this.synthIn);
      n.start();
    }
    setStir(speed, pan) {
      if (!this.ctx) return;
      const t = this.ctx.currentTime;
      this.stirG.gain.setTargetAtTime(Math.min(0.16, speed * 0.012), t, 0.06);
      this.stirBP.frequency.setTargetAtTime(250 + Math.min(4000, speed * 160), t, 0.08);
      this.stirPan.pan.setTargetAtTime(C.clamp(pan, -0.9, 0.9), t, 0.05);
    }

    // A held, gliding voice (grabbed creature, charging star, orb hum).
    sustain(kind) {
      if (!this.ctx) return null;
      const ctx = this.ctx, t = ctx.currentTime;
      const g = ctx.createGain();
      g.gain.value = 0;
      const p = ctx.createStereoPanner();
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = kind === 'hum' ? 900 : 2400;
      lp.Q.value = kind === 'charge' ? 6 : 1;
      lp.connect(g);
      g.connect(p);
      p.connect(kind === 'hum' ? this.master : this.synthIn);
      if (kind === 'hum') {
        const s = ctx.createGain();
        s.gain.value = 1.2;
        g.connect(s);
        s.connect(this.reverbIn);
      }
      const oscs = [];
      const vib = ctx.createOscillator();
      vib.frequency.value = 5.2;
      const vibG = ctx.createGain();
      vibG.gain.value = 0;
      vib.connect(vibG);
      vib.start();
      const n = kind === 'hum' ? 3 : 2;
      for (let i = 0; i < n; i++) {
        const o = ctx.createOscillator();
        o.type = kind === 'charge' ? (i ? 'sawtooth' : 'sine') : kind === 'hum' ? 'sine' : i ? 'triangle' : 'sine';
        o.frequency.value = 220;
        vibG.connect(o.frequency);
        const og = ctx.createGain();
        og.gain.value = kind === 'hum' ? 0.33 : i ? 0.35 : 0.8;
        o.connect(og);
        og.connect(lp);
        o.start(t);
        oscs.push(o);
      }
      const self = this;
      return {
        set(freqs, gain, pan, vibrato, bright) {
          const now = ctx.currentTime;
          oscs.forEach((o, i) => {
            const f = Array.isArray(freqs) ? freqs[i % freqs.length] : freqs * (kind === 'charge' && i ? 1.5 : kind === 'grab' && i ? 2 : 1);
            o.frequency.setTargetAtTime(f * (kind === 'hum' ? 1 + i * 0.0015 : 1), now, 0.04);
          });
          g.gain.setTargetAtTime(gain * (self.synthOn ? 1 : 0), now, 0.05);
          p.pan.setTargetAtTime(C.clamp(pan || 0, -0.9, 0.9), now, 0.05);
          vibG.gain.setTargetAtTime(vibrato || 0, now, 0.05);
          if (bright != null) lp.frequency.setTargetAtTime(bright, now, 0.05);
        },
        stop(fade) {
          const now = ctx.currentTime;
          g.gain.cancelScheduledValues(now);
          g.gain.setTargetAtTime(0, now, fade || 0.08);
          setTimeout(() => {
            oscs.forEach((o) => { try { o.stop(); } catch (e) {} });
            try { vib.stop(); p.disconnect(); } catch (e) {}
          }, ((fade || 0.08) * 6 + 0.1) * 1000);
        },
      };
    }

    // Space: slow time. The whole band sinks underwater.
    setSlow(amount) {
      if (!this.ctx) return;
      const t = this.ctx.currentTime;
      this.synthLP.frequency.setTargetAtTime(18000 * Math.pow(0.05, amount), t, 0.15);
      this.scoreLP.frequency.setTargetAtTime(18000 * Math.pow(0.05, amount), t, 0.15);
      this.revSend.gain.setTargetAtTime(0.45 + amount * 0.6, t, 0.2);
    }

    outputRMS() {
      if (!this.outAnalyser) return 0;
      this.outAnalyser.getFloatTimeDomainData(this._outBuf);
      let s = 0;
      for (let i = 0; i < this._outBuf.length; i++) s += this._outBuf[i] * this._outBuf[i];
      return Math.sqrt(s / this._outBuf.length);
    }

    update(dt) {
      this.level *= Math.exp(-dt * 1.6);
    }

    // Pause is an intent, not a state: a resume already on its way (after an interruption) must not
    // undo it, so a context that starts running while held is suspended again (onstatechange in start).
    suspend() {
      this.held = true;
      if (this.ctx && this.ctx.state !== 'closed') this.ctx.suspend().catch(() => {});
    }
    resume() {
      this.held = false;
      if (this.ctx && this.ctx.state !== 'running' && this.ctx.state !== 'closed') this.ctx.resume().catch(() => {});
    }
  }

  C.AudioEngine = AudioEngine;
})();
