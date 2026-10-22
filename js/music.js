'use strict';
// Listening to your music: bands, spectral flux onsets, kicks, centroid, chroma, key and tempo.
// Sources: a local file (played through the universe), a shared browser tab, or the microphone.
(function () {
  const C = window.COSMOS;

  // Krumhansl-Kessler key profiles
  const MAJ = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
  const MIN = [6.33, 2.68, 3.52, 5.38, 2.6, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];
  const BANDS = [['sub', 25, 60], ['bass', 60, 160], ['lowmid', 160, 500], ['mid', 500, 2000], ['high', 2000, 6000], ['air', 6000, 16000]];

  function pearson(a, b) {
    let ma = 0, mb = 0;
    for (let i = 0; i < 12; i++) { ma += a[i]; mb += b[i]; }
    ma /= 12; mb /= 12;
    let num = 0, da = 0, db = 0;
    for (let i = 0; i < 12; i++) {
      const x = a[i] - ma, y = b[i] - mb;
      num += x * y; da += x * x; db += y * y;
    }
    return num / Math.sqrt(da * db + 1e-12);
  }

  class Music {
    constructor(audio) {
      this.audio = audio;
      this.active = false;
      this.kind = null; // 'file' | 'tab' | 'mic'
      this.label = '';
      this.level = 0; // overall 0..1 (adaptive)
      this.bands = {};
      this.bandMax = {};
      for (const [n] of BANDS) { this.bands[n] = 0; this.bandMax[n] = 1e-4; }
      this.chroma = new Float32Array(12);
      this.chromaLong = new Float32Array(12);
      this.centroid = 0.5;
      this.events = []; // {type, strength, time}
      this.onsetTimes = [];
      this.fluxHist = [];
      this.lowHist = [];
      this.lastOnset = 0;
      this.lastKick = 0;
      this.key = null; // {root, minor, name}
      this._keyCand = null;
      this._keyStreak = 0;
      this._keyTimer = 0;
      this._tempoTimer = 0;
      this.tempo = null;
      this.tempoConf = 0;
      this.playTime = 0;
      this.silentFor = 0;
      this.onKey = null;
      this.onEnd = null;
    }

    _ensureAnalyser() {
      const ctx = this.audio.ctx;
      if (this.analyser) return;
      this.analyser = ctx.createAnalyser();
      this.analyser.fftSize = 4096;
      this.analyser.smoothingTimeConstant = 0;
      this.analyser.minDecibels = -110;
      this.analyser.maxDecibels = -10;
      this.db = new Float32Array(this.analyser.frequencyBinCount);
      this.mag = new Float32Array(this.analyser.frequencyBinCount);
      this.prev = new Float32Array(this.analyser.frequencyBinCount);
    }

    stop() {
      if (this.el) { this.el.pause(); this.el.src = ''; this.el = null; }
      if (this.srcNode) { try { this.srcNode.disconnect(); } catch (e) {} this.srcNode = null; }
      this._split = null;
      this.aL = this.aR = null;
      if (this.stream) { this.stream.getTracks().forEach((t) => t.stop()); this.stream = null; }
      this.active = false;
      this.kind = null;
      this.label = '';
      this.key = null;
      this.tempo = null;
      this.tempoConf = 0;
      this.chromaLong.fill(0);
      this.onsetTimes = [];
      this.audio.setDuck(1);
    }

    _reset(kind, label) {
      this.active = true;
      this.kind = kind;
      this.label = label;
      this.playTime = 0;
      this.key = null;
      this._keyCand = null;
      this._keyStreak = 0;
      this.tempo = null;
      this.tempoConf = 0;
      this.chromaLong.fill(0);
      this.onsetTimes = [];
      for (const [n] of BANDS) this.bandMax[n] = 1e-4;
      this.audio.setDuck(0.42);
    }

    async useFile(file) {
      this.stop();
      this._ensureAnalyser();
      const ctx = this.audio.ctx;
      const el = new Audio();
      el.src = URL.createObjectURL(file);
      el.loop = false;
      el.crossOrigin = 'anonymous';
      this.el = el;
      this.srcNode = ctx.createMediaElementSource(el);
      this.srcNode.connect(this.analyser);
      this.srcNode.connect(this.audio.musicBus);
      this._stereoTap(this.srcNode);
      el.onended = () => { if (this.onEnd) this.onEnd(); this.stop(); };
      await el.play();
      this._reset('file', file.name.replace(/\.[^.]+$/, ''));
    }

    async useTab() {
      this.stop();
      this._ensureAnalyser();
      if (!navigator.mediaDevices || !navigator.mediaDevices.getDisplayMedia) throw new Error('This browser cannot capture tab audio.');
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: true,
        audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
        preferCurrentTab: false,
        selfBrowserSurface: 'exclude',
        systemAudio: 'include',
      });
      if (!stream.getAudioTracks().length) {
        stream.getTracks().forEach((t) => t.stop());
        throw new Error('No audio was shared. Pick a tab and tick “Share tab audio”.');
      }
      this.stream = stream;
      this.srcNode = this.audio.ctx.createMediaStreamSource(new MediaStream(stream.getAudioTracks()));
      this.srcNode.connect(this.analyser); // analysed only; the tab already plays its own sound
      this._stereoTap(this.srcNode);
      stream.getAudioTracks()[0].onended = () => { if (this.onEnd) this.onEnd(); this.stop(); };
      this._reset('tab', 'a shared tab');
    }

    async useMic() {
      this.stop();
      this._ensureAnalyser();
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
      });
      this.stream = stream;
      this.srcNode = this.audio.ctx.createMediaStreamSource(stream);
      this.srcNode.connect(this.analyser);
      this._reset('mic', 'the microphone');
    }

    // Left and right of the song, for the oscilloscope world.
    _stereoTap(node) {
      const ctx = this.audio.ctx;
      const sp = ctx.createChannelSplitter(2);
      node.connect(sp);
      this.aL = ctx.createAnalyser();
      this.aR = ctx.createAnalyser();
      this.aL.fftSize = this.aR.fftSize = 2048;
      sp.connect(this.aL, 0);
      sp.connect(this.aR, 1);
      this._split = sp;
    }
    // Fill L/R with the song's waveform. A mono source has no width, so it is drawn against itself
    // a moment later (a phase portrait), which turns a single line into a figure.
    readStereo(L, R) {
      if (!this.active || !this.analyser) return false;
      if (this.aL && this._split) {
        this.aL.getFloatTimeDomainData(L);
        this.aR.getFloatTimeDomainData(R);
        let diff = 0;
        for (let i = 0; i < L.length; i += 8) diff += Math.abs(L[i] - R[i]) + Math.abs(R[i]) * 0.0;
        if (diff > 0.02) return true;
      }
      if (!this._td || this._td.length !== this.analyser.fftSize) this._td = new Float32Array(this.analyser.fftSize);
      this.analyser.getFloatTimeDomainData(this._td);
      const tau = 14;
      for (let i = 0; i < L.length; i++) { L[i] = this._td[i] || 0; R[i] = this._td[i + tau] || 0; }
      return true;
    }

    togglePlay() {
      if (!this.el) return;
      if (this.el.paused) this.el.play(); else this.el.pause();
    }

    update(dt) {
      this.events.length = 0;
      if (!this.active || !this.analyser || dt <= 0) {
        this.level *= Math.exp(-dt * 2);
        for (const [n] of BANDS) this.bands[n] *= Math.exp(-dt * 3);
        for (let i = 0; i < 12; i++) this.chroma[i] *= Math.exp(-dt * 2);
        return;
      }
      const ctx = this.audio.ctx;
      const sr = ctx.sampleRate, N = this.analyser.fftSize, binHz = sr / N;
      this.analyser.getFloatFrequencyData(this.db);
      const nb = this.db.length, mag = this.mag, prev = this.prev;
      let total = 0;
      for (let i = 0; i < nb; i++) {
        const d = this.db[i];
        const m = d > -200 ? Math.pow(10, d / 20) : 0;
        mag[i] = m;
        total += m * m;
      }
      const totalDb = 10 * Math.log10(total / nb + 1e-20);
      const silent = totalDb < -95;
      this.silentFor = silent ? this.silentFor + dt : 0;
      if (!silent) this.playTime += dt;

      // bands with adaptive gain so quiet and loud masters both work
      for (const [n, lo, hi] of BANDS) {
        let s = 0, c = 0;
        for (let i = Math.max(1, Math.floor(lo / binHz)); i <= Math.min(nb - 1, Math.ceil(hi / binHz)); i++) { s += mag[i] * mag[i]; c++; }
        const v = Math.sqrt(s / Math.max(1, c));
        this.bandMax[n] = Math.max(v, this.bandMax[n] * Math.exp(-dt * 0.12));
        const norm = silent ? 0 : C.clamp(v / (this.bandMax[n] + 1e-9), 0, 1);
        const cur = this.bands[n];
        this.bands[n] = cur + (norm - cur) * C.damp(norm > cur ? 30 : 5, dt);
      }
      const b = this.bands;
      const lvl = 0.3 * b.bass + 0.25 * b.lowmid + 0.25 * b.mid + 0.2 * b.high;
      this.level += (lvl - this.level) * C.damp(8, dt);

      // spectral flux (log magnitude), full band and low band
      let flux = 0, lowFlux = 0, cn = 0, cd = 0;
      const top = Math.min(nb - 1, Math.floor(9000 / binHz)), lowTop = Math.floor(150 / binHz);
      for (let i = 2; i < top; i++) {
        const a = Math.log(1 + 1000 * mag[i]), p = Math.log(1 + 1000 * prev[i]);
        const d = a - p;
        if (d > 0) { flux += d; if (i <= lowTop) lowFlux += d; }
        cn += i * binHz * mag[i];
        cd += mag[i];
        prev[i] = mag[i];
      }
      const cen = cd > 0 ? cn / cd : 500;
      const cenN = C.clamp(Math.log2(Math.max(100, cen) / 100) / Math.log2(80), 0, 1);
      this.centroid += (cenN - this.centroid) * C.damp(2, dt);

      const now = ctx.currentTime;
      const latency = N / 2 / sr + 0.01;
      const stats = (h) => {
        let m = 0;
        for (const x of h) m += x;
        m /= h.length || 1;
        let v = 0;
        for (const x of h) v += (x - m) * (x - m);
        return [m, Math.sqrt(v / (h.length || 1))];
      };
      const [fm, fs] = stats(this.fluxHist);
      const [lm, ls] = stats(this.lowHist);
      if (!silent && this.fluxHist.length > 20) {
        if (flux > fm + 1.5 * fs + 2 && now - this.lastOnset > 0.11) {
          this.lastOnset = now;
          const strength = C.clamp((flux - fm) / (fs * 4 + 1e-6), 0, 1);
          this.events.push({ type: 'onset', strength, time: now - latency });
          this.onsetTimes.push(now - latency);
        }
        // kicks: a sharp rise in the low band (steady four-on-the-floor raises the mean, so use a median-ish floor)
        const lowSorted = this.lowHist.slice().sort((x, y) => x - y);
        const lowMed = lowSorted[Math.floor(lowSorted.length * 0.5)] || 0;
        if (lowFlux > Math.max(lowMed * 2.5 + 0.4, lm + 0.8 * ls) && b.bass > 0.12 && now - this.lastKick > 0.24) {
          this.lastKick = now;
          const strength = C.clamp((lowFlux - lowMed) / (ls * 4 + 1e-6), 0.2, 1);
          this.events.push({ type: 'kick', strength, time: now - latency });
        }
      }
      this.fluxHist.push(flux);
      this.lowHist.push(lowFlux);
      if (this.fluxHist.length > 45) this.fluxHist.shift();
      if (this.lowHist.length > 45) this.lowHist.shift();
      while (this.onsetTimes.length && now - this.onsetTimes[0] > 12) this.onsetTimes.shift();

      // chroma: fold 105 Hz .. 4.2 kHz onto 12 pitch classes
      if (!silent) {
        const ch = new Float32Array(12);
        const lo = Math.floor(105 / binHz), hi = Math.min(nb - 1, Math.floor(4200 / binHz));
        for (let i = lo; i <= hi; i++) {
          const f = i * binHz;
          const midi = 69 + 12 * Math.log2(f / 440);
          const near = Math.round(midi);
          const dev = Math.abs(midi - near);
          const w = mag[i] * mag[i] * Math.max(0, 1 - dev * 2);
          ch[((near % 12) + 12) % 12] += w;
        }
        let mx = 1e-12;
        for (let i = 0; i < 12; i++) mx = Math.max(mx, ch[i]);
        const k = C.damp(7, dt), kl = Math.exp(-dt / 30);
        for (let i = 0; i < 12; i++) {
          const v = ch[i] / mx;
          this.chroma[i] += (v - this.chroma[i]) * k;
          this.chromaLong[i] = this.chromaLong[i] * kl + v * dt;
        }
      }

      this._keyTimer += dt;
      if (this._keyTimer > 1 && this.playTime > 6) {
        this._keyTimer = 0;
        this._detectKey();
      }
      this._tempoTimer += dt;
      if (this._tempoTimer > 1.5) {
        this._tempoTimer = 0;
        this._detectTempo();
      }
    }

    _detectKey() {
      let best = -2, second = -2, bestKey = null;
      for (let r = 0; r < 12; r++) {
        for (let mode = 0; mode < 2; mode++) {
          const prof = mode ? MIN : MAJ;
          const rot = new Array(12);
          for (let i = 0; i < 12; i++) rot[(i + r) % 12] = prof[i];
          const c = pearson(this.chromaLong, rot);
          if (c > best) { second = best; best = c; bestKey = { root: r, minor: !!mode }; }
          else if (c > second) second = c;
        }
      }
      if (!bestKey || best < 0.55) return;
      const same = this._keyCand && this._keyCand.root === bestKey.root && this._keyCand.minor === bestKey.minor;
      this._keyStreak = same ? this._keyStreak + 1 : 1;
      this._keyCand = bestKey;
      const changed = !this.key || this.key.root !== bestKey.root || this.key.minor !== bestKey.minor;
      if (changed && this._keyStreak >= 4) {
        bestKey.name = C.NOTE_NAMES[bestKey.root] + (bestKey.minor ? ' minor' : ' major');
        bestKey.confidence = best;
        this.key = bestKey;
        if (this.onKey) this.onKey(bestKey);
      }
    }

    _detectTempo() {
      const ts = this.onsetTimes;
      if (ts.length < 10) { this.tempoConf *= 0.8; return; }
      const hist = new Float32Array(121); // 60..180 bpm
      for (let i = 0; i < ts.length; i++) {
        for (let j = i + 1; j < ts.length && j < i + 8; j++) {
          const d = ts[j] - ts[i];
          if (d < 0.25 || d > 2.2) continue;
          let bpm = 60 / d;
          while (bpm < 60) bpm *= 2;
          while (bpm > 180) bpm /= 2;
          const w = 1 / (j - i);
          for (let k = Math.max(0, Math.floor(bpm - 66)); k <= Math.min(120, Math.ceil(bpm - 54)); k++) {
            const x = k + 60 - bpm;
            hist[k] += w * Math.exp(-(x * x) / 8);
          }
        }
      }
      let best = 0, bi = 0, mean = 0;
      for (let k = 0; k <= 120; k++) {
        const prior = Math.exp(-Math.pow((k + 60 - 112) / 45, 2));
        hist[k] *= 0.6 + 0.4 * prior;
        mean += hist[k];
        if (hist[k] > best) { best = hist[k]; bi = k; }
      }
      mean /= 121;
      const conf = best / (mean + 1e-9);
      const bpm = bi + 60;
      if (conf > 2.4) {
        if (!this.tempo || Math.abs(bpm - this.tempo) / this.tempo > 0.04) this.tempo = bpm;
        else this.tempo += (bpm - this.tempo) * 0.3;
        this.tempoConf = Math.min(1, conf / 5);
      } else this.tempoConf *= 0.85;
    }
  }

  C.Music = Music;
})();
