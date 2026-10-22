'use strict';
// Your music, kept on your device: a playlist (shuffle, next, remembered between visits), lock-screen and
// Control Center controls (Media Session), whole folders dropped in on a PC, and "your sounds": samples
// from your own library that become the creatures' voices. Nothing here is uploaded or published.
(function () {
  const C = window.COSMOS;
  const AUDIO_RE = /\.(mp3|wav|ogg|oga|flac|m4a|aac|opus|webm|mp4|aif|aiff|caf)$/i;
  C.isAudioFile = (f) => !!f && ((f.type && f.type.startsWith('audio')) || AUDIO_RE.test(f.name || ''));

  // Every audio file in a drop, including whole folders (Chrome/Edge/Safari: webkitGetAsEntry).
  C.filesFromDrop = async function (dt) {
    const out = [];
    const items = dt.items ? [...dt.items] : [];
    const entries = items.map((it) => (it.webkitGetAsEntry ? it.webkitGetAsEntry() : null)).filter(Boolean);
    if (!entries.length) return [...(dt.files || [])].filter(C.isAudioFile);
    const fileOf = (e) => new Promise((res) => e.file(res, () => res(null)));
    const readAll = (dir) => new Promise((res) => {
      const reader = dir.createReader(), acc = [];
      const step = () => reader.readEntries((batch) => { if (!batch.length) return res(acc); acc.push(...batch); step(); }, () => res(acc));
      step();
    });
    const walk = async (e, depth) => {
      if (out.length > 500 || depth > 6) return;
      if (e.isFile) { const f = await fileOf(e); if (C.isAudioFile(f)) out.push(f); }
      else if (e.isDirectory) for (const c of (await readAll(e)).sort((a, b) => a.name.localeCompare(b.name))) await walk(c, depth + 1);
    };
    for (const e of entries) await walk(e, 0);
    return out;
  };

  const songId = (f) => 's' + C.hash(f.name, f.size, f.lastModified || 0).toString(36);
  const shuffled = (arr) => { const a = arr.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };

  class Playlist {
    constructor(music, hooks) {
      this.music = music;
      this.hooks = hooks; // { wake(), toast(title, sub), world() -> name }
      this.songs = []; // {id, name, type, size, blob, kept}
      this.order = []; // ids in play order (shuffled or not)
      this.shuffle = false;
      this.current = null;
      this.ready = this._load();
      music.onEnd = (why) => { if (why === 'ended') this.next(); };
      this._mediaSession();
    }

    async _load() {
      try {
        const [rows, meta] = await Promise.all([C.db.all('songs'), C.db.get('kv', 'playlist')]);
        const byId = new Map(rows.map((r) => [r.id, r]));
        const ids = meta && meta.ids ? meta.ids.filter((id) => byId.has(id)) : [];
        for (const r of rows) if (!ids.includes(r.id)) ids.push(r.id);
        this.songs = ids.map((id) => Object.assign({ kept: true }, byId.get(id)));
        this.shuffle = !!(meta && meta.shuffle);
        this.current = meta && meta.current && byId.has(meta.current) ? meta.current : null;
      } catch (e) { this.songs = []; }
      this._reorder(this.current);
      this.render();
    }
    _save() {
      C.db.put('kv', { ids: this.songs.map((s) => s.id), shuffle: this.shuffle, current: this.current }, 'playlist').catch(() => {});
    }
    _reorder(keepFirst) {
      const ids = this.songs.map((s) => s.id);
      this.order = this.shuffle ? shuffled(ids) : ids;
      if (keepFirst && this.shuffle) this.order = [keepFirst].concat(this.order.filter((x) => x !== keepFirst));
    }

    // Add songs (from the picker, a drop or a folder). The first new one starts playing.
    async add(files, playNow) {
      await this.ready;
      files = [...files].filter(C.isAudioFile);
      if (!files.length) return 0;
      C.db.persist();
      let first = null, notKept = 0;
      for (const f of files) {
        const id = songId(f);
        let s = this.songs.find((x) => x.id === id);
        if (!s) {
          s = { id, name: (f.name || 'a song').replace(/\.[^.]+$/, ''), type: f.type || '', size: f.size || 0, blob: f, added: Date.now(), kept: false };
          this.songs.push(s);
          try { await C.db.put('songs', { id, name: s.name, type: s.type, size: s.size, blob: f, added: s.added }); s.kept = true; }
          catch (e) { notKept++; }
        }
        if (!first) first = s;
      }
      this._reorder(this.current);
      this._save();
      this.render();
      if (notKept) this.hooks.toast('playing, but not kept', notKept + ' song' + (notKept > 1 ? 's are' : ' is') + ' too big for this device to remember');
      if (playNow !== false && first) await this.play(first.id);
      return files.length;
    }

    async remove(id) {
      const i = this.songs.findIndex((s) => s.id === id);
      if (i < 0) return;
      this.songs.splice(i, 1);
      this.order = this.order.filter((x) => x !== id);
      C.db.del('songs', id).catch(() => {});
      if (this.current === id) { this.current = null; if (this.music.kind === 'file') this.music.stop(); }
      this._save();
      this.render();
    }

    async play(id) {
      const s = this.songs.find((x) => x.id === id);
      if (!s) return;
      this.hooks.wake();
      this.current = id;
      this._save();
      try {
        await this.music.useFile(s.blob, s.name);
        this.hooks.toast('listening', s.name);
      } catch (err) {
        this.hooks.toast('could not play that song', String(err.message || err));
      }
      this._updateSession();
      this.render();
    }

    // At the end of the list it wraps round, so it never just stops. Shuffle deals a fresh order and
    // starts it from the top, with the song that just played kept out of first place.
    next() {
      if (!this.order.length) return;
      const i = this.order.indexOf(this.current);
      if (i === this.order.length - 1 && this.shuffle && this.order.length > 1) {
        this.order = shuffled(this.songs.map((s) => s.id));
        if (this.order[0] === this.current) [this.order[0], this.order[1]] = [this.order[1], this.order[0]];
        this.play(this.order[0]);
        return;
      }
      this.play(this.order[(i + 1) % this.order.length]);
    }
    prev() {
      if (!this.order.length) return;
      if (this.music.el && this.music.el.currentTime > 4) { this.music.el.currentTime = 0; return; }
      const i = this.order.indexOf(this.current);
      this.play(this.order[(i - 1 + this.order.length) % this.order.length]);
    }
    resume() {
      const el = this.music.el;
      if (el) { if (el.paused) el.play().catch(() => {}); this._updateSession(); this.render(); }
      else if (this.current) this.play(this.current);
      else if (this.order.length) this.play(this.order[0]);
    }
    pause() {
      const el = this.music.el;
      if (el && !el.paused) el.pause();
      this._updateSession();
      this.render();
    }
    toggle() {
      if (this.music.el) { this.music.togglePlay(); this._updateSession(); this.render(); }
      else if (this.current) this.play(this.current);
      else if (this.order.length) this.play(this.order[0]);
    }
    setShuffle(on) {
      this.shuffle = on;
      this._reorder(this.current);
      this._save();
      this.render();
    }

    // Lock screen, Control Center, headphone buttons, car stereos.
    _mediaSession() {
      const ms = navigator.mediaSession;
      if (!ms) return;
      const h = (k, fn) => { try { ms.setActionHandler(k, fn); } catch (e) {} };
      h('play', () => this.resume());
      h('pause', () => this.pause());
      h('nexttrack', () => this.next());
      h('previoustrack', () => this.prev());
      h('seekto', (d) => { if (this.music.el && d.seekTime != null) this.music.el.currentTime = d.seekTime; });
      h('stop', () => this.music.stop());
    }
    _updateSession() {
      const ms = navigator.mediaSession;
      if (!ms || typeof MediaMetadata === 'undefined') return;
      const s = this.songs.find((x) => x.id === this.current);
      if (!s) return;
      try {
        ms.metadata = new MediaMetadata({
          title: s.name, artist: 'COSMOS', album: this.hooks.world ? this.hooks.world() : 'COSMOS',
          artwork: [{ src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' }, { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' }],
        });
        ms.playbackState = this.music.el && !this.music.el.paused ? 'playing' : 'paused';
      } catch (e) {}
    }
    tick() {
      // redraw only when something changed (a rebuilt list under your finger would swallow the tap)
      const sig = this.current + '|' + (this.music.kind === 'file' && this.music.el && !this.music.el.paused);
      if (sig !== this._sig) { this._sig = sig; this.render(); this._updateSession(); }
      const ms = navigator.mediaSession, el = this.music.el;
      if (!ms || !el || !ms.setPositionState || !isFinite(el.duration) || !el.duration) return;
      try { ms.setPositionState({ duration: el.duration, playbackRate: el.playbackRate || 1, position: Math.min(el.currentTime, el.duration) }); } catch (e) {}
    }

    render() {
      const list = document.getElementById('plist');
      if (!list) return;
      list.innerHTML = '';
      const playing = this.music.kind === 'file' && this.music.el && !this.music.el.paused;
      for (const s of this.songs) {
        const row = document.createElement('div');
        row.className = 'song' + (s.id === this.current ? ' cur' : '');
        const name = document.createElement('button');
        name.className = 'sname';
        name.textContent = (s.id === this.current ? (playing ? '▶ ' : '❚❚ ') : '') + s.name;
        name.title = s.kept ? 'kept on this device' : 'this visit only';
        name.onclick = () => (s.id === this.current ? this.toggle() : this.play(s.id));
        const x = document.createElement('button');
        x.className = 'sdel';
        x.textContent = '×';
        x.title = 'remove from the playlist (and this device)';
        x.onclick = () => this.remove(s.id);
        row.append(name, x);
        list.appendChild(row);
      }
      const ctl = document.getElementById('pctl');
      if (ctl) ctl.hidden = !this.songs.length;
      const sh = document.getElementById('pShuffle');
      if (sh) sh.classList.toggle('on', this.shuffle);
      const pp = document.getElementById('pPlay');
      if (pp) pp.textContent = playing ? '❚❚' : '▶';
    }
  }
  C.Playlist = Playlist;

  // ------------------------------------------------------------------ your sounds (decision D9's default)
  // Samples you pick from your own library: kept only on this device, never part of the published app.
  // A note name in the file name ("pad C3.wav", "bell_A#4.mp3") sets its root; otherwise it is taken as C4.
  const NOTE = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
  function rootOf(name) {
    const m = /(?:^|[^A-Za-z])([A-G])([#♯b♭]?)(-?\d)(?![\d])/.exec(name.replace(/\.[^.]+$/, ''));
    if (!m) return 60;
    const acc = m[2] === '#' || m[2] === '♯' ? 1 : m[2] === 'b' || m[2] === '♭' ? -1 : 0;
    return 12 * (+m[3] + 1) + NOTE[m[1]] + acc;
  }
  C.sampleRoot = rootOf;

  // Budgets, so a pack can never eat a phone's memory: decoded audio is ~10 MB per stereo minute.
  const PACK_MAX = 24, SAMPLE_SEC = 8, PACK_SEC = 96;
  class SoundPack {
    constructor(audio) {
      this.audio = audio;
      this.items = []; // {id, name, root, buf}
      this.on = C.storage.get('packOn', true);
      this.ready = Promise.resolve();
    }
    // decoded only while switched on (and only once)
    async load() {
      if (!this.audio.ctx || !this.on || this.loaded) { this._apply(); return; }
      this.loaded = true;
      try {
        const rows = await C.db.all('samples');
        for (const r of rows) if (!this.items.some((x) => x.id === r.id)) await this._decode(r);
      } catch (e) {}
      this._apply();
    }
    _seconds() { return this.items.reduce((a, x) => a + x.buf.duration, 0); }
    async _decode(r) {
      if (this.items.length >= PACK_MAX || this._seconds() >= PACK_SEC) return false;
      try {
        const ab = await r.blob.arrayBuffer();
        let buf = await new Promise((res, rej) => this.audio.ctx.decodeAudioData(ab, res, rej));
        // a sample is a few seconds: keep only the start of anything longer
        const keep = Math.min(buf.duration, SAMPLE_SEC, PACK_SEC - this._seconds());
        if (keep < buf.duration) {
          const n = Math.max(1, Math.floor(keep * buf.sampleRate)), short = this.audio.ctx.createBuffer(buf.numberOfChannels, n, buf.sampleRate);
          for (let c = 0; c < buf.numberOfChannels; c++) short.copyToChannel(buf.getChannelData(c).subarray(0, n), c);
          buf = short;
        }
        this.items.push({ id: r.id, name: r.name, root: r.root, buf });
        this.items.sort((a, b) => a.root - b.root);
        return true;
      } catch (e) { return false; }
    }
    async add(files) {
      let ok = 0;
      if (!this.on) this.setOn(true);
      await this.load();
      for (const f of [...files].filter(C.isAudioFile).slice(0, PACK_MAX)) {
        if (this.items.length >= PACK_MAX || this._seconds() >= PACK_SEC) break;
        if (f.size > 12e6) continue; // a sample, not a song
        const r = { id: songId(f), name: f.name.replace(/\.[^.]+$/, ''), root: rootOf(f.name), blob: f };
        if (this.items.some((x) => x.id === r.id)) continue;
        if (await this._decode(r)) { ok++; C.db.put('samples', r).catch(() => {}); }
      }
      this._apply();
      return ok;
    }
    clear() {
      this.items = [];
      this.loaded = true;
      C.db.clear('samples').catch(() => {});
      this._apply();
    }
    setOn(on) { this.on = on; C.storage.set('packOn', on); if (on) this.load(); else this._apply(); }
    _apply() { this.audio.userPack = this.on && this.items.length ? this : null; }
    // nearest sample by pitch, played faster or slower to reach the note
    voice(e, t, f, v, d, dest) {
      const ctx = e.ctx;
      const midi = 69 + 12 * Math.log2(f / 440);
      let best = this.items[0];
      for (const it of this.items) if (Math.abs(it.root - midi) < Math.abs(best.root - midi)) best = it;
      const rate = C.clamp(Math.pow(2, (midi - best.root) / 12), 0.25, 4);
      const src = ctx.createBufferSource();
      src.buffer = best.buf;
      src.playbackRate.value = rate;
      const len = Math.min(best.buf.duration / rate, Math.max(0.25, d) + 1.2);
      const g = ctx.createGain(), end = t + len;
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(v * 1.4, t + 0.005);
      g.gain.setValueAtTime(v * 1.4, Math.max(t + 0.006, end - 0.25));
      g.gain.linearRampToValueAtTime(0, end);
      src.connect(g);
      g.connect(dest);
      src.start(t);
      src.stop(end + 0.02);
      src.onended = () => { try { src.disconnect(); g.disconnect(); } catch (er) {} };
      return end;
    }
  }
  C.SoundPack = SoundPack;
})();
