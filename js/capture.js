'use strict';
// Keeping the music: every note the universe plays (the score and the creatures) is remembered for a few
// minutes, on the beat grid it was played on, so a moment you liked can be taken away as a MIDI file
// (one track per voice, the world's meter and tempo, General MIDI drums on channel 10) for any music
// software. "Record" also captures the actual sound, as an audio file. Nothing leaves the device unless
// you save it.
(function () {
  const C = window.COSMOS;
  const KEEP_S = 180, MAX = 6000;
  const events = [];
  const tempos = []; // {t, beat, bpm}: every tempo change, where it happened on the beat grid
  // tracks: the score's layers and the creatures; General MIDI programs that resemble each role
  const TRACKS = { pad: [0, 89, 'pad'], bass: [1, 33, 'bass'], arp: [2, 46, 'arpeggio'], lead: [3, 73, 'lead'], counter: [4, 42, 'counter-voice'], canon: [5, 11, 'canon'], drone: [6, 92, 'drone'], texture: [7, 98, 'grains'], fx: [8, 99, 'swells'], creatures: [10, 13, 'creatures'], drums: [9, 0, 'percussion'] };
  const GM_DRUM = { kick: 36, boom: 35, rim: 37, clap: 39, hat: 42, shaker: 70, tom: 45, thunder: 49, chip: 76, drop: 77, riser: 52 };

  const Capture = {
    on: true,
    // called by the engine for every note it schedules: t (audio clock), beat position on the grid
    // world: the world that played it (the engine passes it on for each world's creatures and the score);
    // the current world is only the fallback
    note(eng, layer, inst, midi, t, vel, dur, world) {
      if (!this.on || !isFinite(midi) || !isFinite(t)) return;
      const beat = (t - eng.clockStart) / eng.beatDur();
      events.push({ t, beat, layer, inst, midi: Math.round(midi), vel, dur: dur || 0.25, bpm: eng.bpm, world: world != null ? world : Capture.world });
      if (events.length > MAX) events.splice(0, events.length - MAX);
      if (events.length % 200 === 0) { const cut = t - KEEP_S; let i = 0; while (i < events.length && events[i].t < cut) i++; if (i) events.splice(0, i); }
    },
    tempo(t, beat, bpm) {
      if (!isFinite(t) || !isFinite(beat) || !isFinite(bpm)) return;
      tempos.push({ t, beat, bpm });
      if (tempos.length > 4000) tempos.splice(0, tempos.length - 4000);
    },
    world: null, meter: null,
    recent(secs, world) {
      const now = events.length ? events[events.length - 1].t : 0;
      return events.filter((e) => e.t >= now - secs && (!world || e.world === world));
    },
    // A Standard MIDI File (format 1) from these events. Positions are on the beat grid the notes were played
    // on; the tempo can change along the way (slow time, a song's tempo), so the file carries a tempo map.
    midi(evs, meter, title) {
      if (!evs.length) return null;
      evs = evs.slice().sort((a, b) => a.beat - b.beat);
      const PPQ = 480, b0 = Math.floor(evs[0].beat), bpm = evs[0].bpm || 82, bEnd = evs[evs.length - 1].beat;
      const vlq = (n) => { const out = [n & 0x7f]; while ((n >>= 7)) out.unshift((n & 0x7f) | 0x80); return out; };
      const str = (s) => Array.from(unescape(encodeURIComponent(s))).map((c) => c.charCodeAt(0));
      const tracks = [];
      // conductor: tempo, the world's meter, its name
      const tempoMeta = (b) => { const us = Math.round(60e6 / b); return [0xff, 0x51, 3, (us >> 16) & 255, (us >> 8) & 255, us & 255]; };
      const us = Math.round(60e6 / bpm);
      const n = meter ? meter.n : 16, eighths = meter && meter.g.some((g) => g === 6);
      const num = eighths ? n / 2 : n / 4, den = eighths ? 3 : 2;
      const cond = [0, 0xff, 0x03, ...vlq(str(title || 'COSMOS').length), ...str(title || 'COSMOS'), 0, 0xff, 0x51, 3, (us >> 16) & 255, (us >> 8) & 255, us & 255, 0, 0xff, 0x58, 4, Math.round(num), den, 24, 8];
      // the tempo map: the engine reports each change with the beat it happened on (a run of small changes,
      // as when time slows, is thinned to steps of more than half a beat per minute)
      let lastBpm = bpm, lastTick = 0;
      // (notes kept with a discovery come from another session: their own tempos are the map)
      const map = evs[0].t == null ? evs.map((e) => ({ beat: e.beat, bpm: e.bpm })) : tempos;
      for (const c of map) {
        if (c.beat <= b0 || c.beat > bEnd || Math.abs(c.bpm - lastBpm) <= 0.5) continue;
        const tick = Math.max(lastTick, Math.round((c.beat - b0) * PPQ));
        cond.push(...vlq(tick - lastTick), ...tempoMeta(c.bpm));
        lastTick = tick; lastBpm = c.bpm;
      }
      tracks.push(cond);
      // a note's length is in seconds: walk it through the tempo map from where it starts
      const bpmAt = (t, fallback) => { let x = fallback; for (const c of tempos) { if (c.t > t) break; x = c.bpm; } return x; };
      const endBeat = (e) => {
        if (e.t == null) return e.beat + (e.dur * (e.bpm || bpm)) / 60; // (kept discoveries carry no times)
        let b = e.beat, t = e.t, bp = bpmAt(e.t, e.bpm || bpm), left = e.dur;
        for (const c of tempos) {
          if (c.t <= t) continue;
          if (c.t >= t + left) break;
          b += ((c.t - t) * bp) / 60; left -= c.t - t; t = c.t; bp = c.bpm;
        }
        return b + (left * bp) / 60;
      };
      const by = {};
      for (const e of evs) { const k = TRACKS[e.layer] ? e.layer : 'creatures'; (by[k] = by[k] || []).push(e); }
      for (const k in by) {
        const [ch, prog, name] = TRACKS[k];
        const msgs = [];
        for (const e of by[k]) {
          const on = Math.max(0, Math.round((e.beat - b0) * PPQ));
          const len = Math.max(30, Math.round((endBeat(e) - e.beat) * PPQ));
          const key = k === 'drums' || NOT_PITCHED[e.inst] ? GM_DRUM[e.inst] || 37 : C.clamp(e.midi, 0, 127);
          const c = k === 'drums' || NOT_PITCHED[e.inst] ? 9 : ch;
          const v = C.clamp(Math.round(20 + e.vel * 420), 1, 127);
          msgs.push([on, 0x90 | c, key, v], [on + len, 0x80 | c, key, 0]);
        }
        msgs.sort((a, b) => a[0] - b[0] || (a[1] & 0xf0) - (b[1] & 0xf0));
        const tr = [0, 0xff, 0x03, ...vlq(str(name).length), ...str(name)];
        if (ch !== 9) tr.push(0, 0xc0 | ch, prog);
        let last = 0;
        for (const [t, a, b, c] of msgs) { tr.push(...vlq(t - last), a, b, c); last = t; }
        tracks.push(tr);
      }
      const bytes = [0x4d, 0x54, 0x68, 0x64, 0, 0, 0, 6, 0, 1, 0, tracks.length, (PPQ >> 8) & 255, PPQ & 255];
      for (const tr of tracks) {
        tr.push(0, 0xff, 0x2f, 0);
        bytes.push(0x4d, 0x54, 0x72, 0x6b, (tr.length >>> 24) & 255, (tr.length >>> 16) & 255, (tr.length >>> 8) & 255, tr.length & 255, ...tr);
      }
      return new Uint8Array(bytes);
    },
    // Record what you hear, from now, for up to `secs` (an audio file in the browser's own format).
    record(eng, secs) {
      if (!eng.ctx || typeof MediaRecorder === 'undefined' || this.rec) return null;
      const dest = eng.ctx.createMediaStreamDestination();
      eng.out.connect(dest);
      const type = ['audio/webm;codecs=opus', 'audio/mp4', 'audio/webm', 'audio/ogg'].find((x) => MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported(x)) || '';
      const mr = new MediaRecorder(dest.stream, type ? { mimeType: type } : undefined);
      const chunks = [];
      mr.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };
      this.rec = mr;
      const done = new Promise((res) => {
        mr.onstop = () => { try { eng.out.disconnect(dest); } catch (e) {} this.rec = null; res(new Blob(chunks, { type: mr.mimeType || type || 'audio/webm' })); };
      });
      mr.start(1000);
      this.recTimer = setTimeout(() => this.stop(), (secs || 60) * 1000);
      return done;
    },
    stop() { clearTimeout(this.recTimer); if (this.rec && this.rec.state !== 'inactive') this.rec.stop(); },
    save(blob, name) {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = name;
      document.body.appendChild(a);
      a.click();
      setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 2000);
    },
    _events: events,
  };
  const NOT_PITCHED = { kick: 1, hat: 1, shaker: 1, rim: 1, clap: 1, boom: 1, tom: 1, thunder: 1, riser: 1 };
  C.Capture = Capture;
})();
