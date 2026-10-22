'use strict';
// Renderer. Every world is a live GPU *layer* (its own dust, trails, fields and HDR scene).
// Layers are composited through a phasing aperture with their own visual style, then share
// bloom -> flash-guarded exposure -> screen. Two worlds can be alive on screen at once.
(function () {
  const C = window.COSMOS;
  const G = C.GL;

  const FOV = (50 * Math.PI) / 180;
  const TAN_HALF = Math.tan(FOV / 2);
  C.TAN_HALF = TAN_HALF;

  // Looks a world can wear. bloom/safe tune the shared post chain while that style dominates.
  C.STYLES = [
    { name: 'luminous', bloom: 1, safe: 1 },
    { name: 'ink', bloom: 0.06, safe: 2.4 },
    { name: 'kaleidoscope', bloom: 1, safe: 1 },
    { name: 'thermal', bloom: 0.5, safe: 1.6 },
    { name: 'halftone', bloom: 0.25, safe: 1.6 },
    { name: 'stained glass', bloom: 0.45, safe: 1.6 },
    { name: 'x-ray', bloom: 0.7, safe: 1.3 },
    { name: 'contour', bloom: 0.6, safe: 1.2 },
    { name: 'dither', bloom: 0.1, safe: 1.8 },
    { name: 'chromatic', bloom: 1.1, safe: 1 },
    { name: 'glitch', bloom: 0.9, safe: 1 },
    { name: 'neon', bloom: 1.2, safe: 1.2 },
    { name: 'terminal', bloom: 0.6, safe: 1.4 },
    { name: 'psychedelic', bloom: 0.8, safe: 1.2 },
  ];

  function perspective(aspect, near, far) {
    const f = 1 / TAN_HALF, nf = 1 / (near - far);
    return new Float32Array([f / aspect, 0, 0, 0, 0, f, 0, 0, 0, 0, (far + near) * nf, -1, 0, 0, 2 * far * near * nf, 0]);
  }

  class Renderer {
    constructor(canvas) {
      this.canvas = canvas;
      const gl = (this.gl = canvas.getContext('webgl2', {
        antialias: false, alpha: false, depth: false, stencil: false,
        premultipliedAlpha: false, powerPreference: 'high-performance', preserveDrawingBuffer: false,
      }));
      if (!gl) throw new Error('WebGL2 is not available in this browser.');
      if (!gl.getExtension('EXT_color_buffer_float')) throw new Error('This GPU/browser cannot render to float textures (EXT_color_buffer_float).');
      this.floatLinear = !!gl.getExtension('OES_texture_float_linear');

      const S = C.SH;
      this.P = {
        sim: G.program(gl, S.fullVS, S.simFS, 'sim'),
        dust: G.program(gl, S.dustVS, S.dustFS, 'dust'),
        trail: G.program(gl, S.fullVS, S.trailFS, 'trail'),
        copy: G.program(gl, S.fullVS, S.copyFS, 'copy'),
        nebula: G.program(gl, S.fullVS, S.nebulaFS, 'nebula'),
        singer: G.program(gl, S.singerVS, S.singerFS, 'singer'),
        sprite: G.program(gl, S.spriteVS, S.spriteFS, 'sprite'),
        ribbon: G.program(gl, S.ribbonVS, S.ribbonFS, 'ribbon'),
        orb: G.program(gl, S.orbVS, S.orbFS, 'orb'),
        down: G.program(gl, S.fullVS, S.downFS, 'down'),
        up: G.program(gl, S.fullVS, S.upFS, 'up'),
        lum: G.program(gl, S.fullVS, S.lumFS, 'lum'),
        adapt: G.program(gl, S.fullVS, S.adaptFS, 'adapt'),
        final: G.program(gl, S.fullVS, S.finalFS, 'final'),
        deposit: G.program(gl, S.depositVS, S.depositFS, 'deposit'),
        diffuse: G.program(gl, S.fullVS, S.diffuseFS, 'diffuse'),
        rd: G.program(gl, S.fullVS, S.rdFS, 'rd'),
        field: G.program(gl, S.fullVS, S.fieldFS, 'field'),
        box: G.program(gl, S.fullVS, S.boxFS, 'box'),
        composite: G.program(gl, S.fullVS, S.compositeFS, 'composite'),
        fAdvect: G.program(gl, S.fullVS, S.fAdvectFS, 'fAdvect'),
        fCurl: G.program(gl, S.fullVS, S.fCurlFS, 'fCurl'),
        fVort: G.program(gl, S.fullVS, S.fVortFS, 'fVort'),
        fDiv: G.program(gl, S.fullVS, S.fDivFS, 'fDiv'),
        fPres: G.program(gl, S.fullVS, S.fPresFS, 'fPres'),
        fGrad: G.program(gl, S.fullVS, S.fGradFS, 'fGrad'),
        fSplat: G.program(gl, S.fullVS, S.fSplatFS, 'fSplat'),
        ripple: G.program(gl, S.fullVS, S.rippleFS, 'ripple'),
        life: G.program(gl, S.fullVS, S.lifeFS, 'life'),
        lenia: G.program(gl, S.fullVS, S.leniaFS, 'lenia'),
      };
      // iOS reports float-texture filtering unreliably, so never rely on it there
      this.isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
      if (this.isIOS) this.floatLinear = false;
      this.readTex = G.texture(gl, 64, 64, gl.RGBA32F, gl.RGBA, gl.FLOAT, gl.NEAREST, gl.CLAMP_TO_EDGE);
      this.readFbo = G.fbo(gl, [this.readTex]);
      this.readBuf = new Float32Array(64 * 64 * 4);

      // geometry
      this.triVAO = gl.createVertexArray();
      gl.bindVertexArray(this.triVAO);
      const tb = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, tb);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
      gl.enableVertexAttribArray(0);
      gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
      const quad = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, quad);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
      const mkInstVAO = (floats, attrs) => {
        const vao = gl.createVertexArray();
        gl.bindVertexArray(vao);
        gl.bindBuffer(gl.ARRAY_BUFFER, quad);
        gl.enableVertexAttribArray(0);
        gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
        const buf = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, buf);
        for (let i = 0; i < attrs; i++) {
          gl.enableVertexAttribArray(1 + i);
          gl.vertexAttribPointer(1 + i, 4, gl.FLOAT, false, floats * 4, i * 16);
          gl.vertexAttribDivisor(1 + i, 1);
        }
        return { vao, buf };
      };
      this.singerI = mkInstVAO(16, 4);
      this.spriteI = mkInstVAO(12, 3);
      this.orbVAO = gl.createVertexArray();
      gl.bindVertexArray(this.orbVAO);
      gl.bindBuffer(gl.ARRAY_BUFFER, quad);
      gl.enableVertexAttribArray(0);
      gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
      this.ribbonVAO = gl.createVertexArray();
      gl.bindVertexArray(this.ribbonVAO);
      this.ribbonBuf = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, this.ribbonBuf);
      gl.enableVertexAttribArray(0);
      gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 32, 0);
      gl.enableVertexAttribArray(1);
      gl.vertexAttribPointer(1, 1, gl.FLOAT, false, 32, 12);
      gl.enableVertexAttribArray(2);
      gl.vertexAttribPointer(2, 4, gl.FLOAT, false, 32, 16);
      this.emptyVAO = gl.createVertexArray();
      gl.bindVertexArray(null);

      const NS = 256;
      this.noiseData = C.makeNoiseTexData(NS);
      this.noiseTex = G.texture(gl, NS, NS, gl.RGBA16F, gl.RGBA, gl.FLOAT, gl.LINEAR, gl.REPEAT, this.noiseData);

      this.lumTex = G.texture(gl, 32, 18, gl.RGBA16F, gl.RGBA, gl.HALF_FLOAT, gl.NEAREST, gl.CLAMP_TO_EDGE);
      this.lumFbo = G.fbo(gl, [this.lumTex]);
      this.adapt = [0, 1].map(() => {
        const t = G.texture(gl, 1, 1, gl.RGBA16F, gl.RGBA, gl.HALF_FLOAT, gl.NEAREST, gl.CLAMP_TO_EDGE);
        return { t, f: G.fbo(gl, [t]) };
      });
      this.adaptCur = 0;
      this.w = 0;
      this.h = 0;
      this.L = null;
      this.layers = new Set();
      this.palA = new Float32Array(12);
      this.palB = new Float32Array(12);
    }

    // ---------------------------------------------------------------- layers
    createLayer(side) {
      const gl = this.gl;
      const L = { side, n: side * side, dustCur: 0, trailCur: 0, trailWCur: 0, rdCur: 0, w: 0, h: 0, trailW: null, rd: null, rdN: 512 };
      L.dust = [0, 1].map(() => {
        const pos = G.texture(gl, side, side, gl.RGBA32F, gl.RGBA, gl.FLOAT, gl.NEAREST, gl.CLAMP_TO_EDGE);
        const vel = G.texture(gl, side, side, gl.RGBA32F, gl.RGBA, gl.FLOAT, gl.NEAREST, gl.CLAMP_TO_EDGE);
        return { pos, vel, fbo: G.fbo(gl, [pos, vel]) };
      });
      L.nutTex = G.texture(gl, 64, 64, gl.R16F, gl.RED, gl.FLOAT, gl.LINEAR, gl.REPEAT, new Float32Array(64 * 64).fill(0.3));
      this.layers.add(L);
      this._screen(L);
      return L;
    }
    destroyLayer(L) {
      const gl = this.gl;
      const delF = (o) => { if (!o) return; o.tex.forEach((t) => gl.deleteTexture(t)); gl.deleteFramebuffer(o); };
      for (const d of L.dust) { gl.deleteTexture(d.pos); gl.deleteTexture(d.vel); gl.deleteFramebuffer(d.fbo); }
      gl.deleteTexture(L.nutTex);
      delF(L.sceneFbo);
      (L.trail || []).forEach(delF);
      for (const k of ['trailW', 'rd']) if (L[k]) for (const t of L[k]) { gl.deleteTexture(t.t); gl.deleteFramebuffer(t.f); }
      const delP = (t) => { gl.deleteTexture(t.t); gl.deleteFramebuffer(t.f); };
      if (L.fluid) { [...L.fluid.vel, ...L.fluid.pres, ...L.fluid.dye, L.fluid.div, L.fluid.curl].forEach(delP); L.fluid = null; }
      if (L.ripple) { L.ripple.p.forEach(delP); L.ripple = null; }
      if (L.life) { L.life.p.forEach(delP); L.life = null; }
      this.layers.delete(L);
      if (this.L === L) this.L = null;
    }
    use(L) {
      this.L = L;
      return L;
    }
    _screen(L) {
      const gl = this.gl;
      if (L.w === this.w && L.h === this.h && L.sceneFbo) return;
      const delF = (o) => { if (!o) return; o.tex.forEach((t) => gl.deleteTexture(t)); gl.deleteFramebuffer(o); };
      delF(L.sceneFbo);
      (L.trail || []).forEach(delF);
      const w = Math.max(1, this.w), h = Math.max(1, this.h);
      const tex = () => G.texture(gl, w, h, gl.RGBA16F, gl.RGBA, gl.HALF_FLOAT, gl.LINEAR, gl.CLAMP_TO_EDGE);
      L.sceneFbo = G.fbo(gl, [tex()]);
      L.trail = [0, 1].map(() => G.fbo(gl, [tex()]));
      for (const t of L.trail) {
        gl.bindFramebuffer(gl.FRAMEBUFFER, t);
        gl.clearColor(0, 0, 0, 1);
        gl.clear(gl.COLOR_BUFFER_BIT);
      }
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      L.w = this.w;
      L.h = this.h;
    }
    _trailW(L) {
      if (L.trailW) return L.trailW;
      const gl = this.gl;
      L.trailW = [0, 1].map(() => {
        const t = G.texture(gl, 1024, 1024, gl.RGBA16F, gl.RGBA, gl.HALF_FLOAT, gl.LINEAR, gl.REPEAT);
        return { t, f: G.fbo(gl, [t]) };
      });
      this._clear(L.trailW);
      return L.trailW;
    }
    _rd(L) {
      if (L.rd) return L.rd;
      const gl = this.gl;
      L.rd = [0, 1].map(() => {
        const t = G.texture(gl, L.rdN, L.rdN, gl.RGBA32F, gl.RGBA, gl.FLOAT, this.floatLinear ? gl.LINEAR : gl.NEAREST, gl.REPEAT);
        return { t, f: G.fbo(gl, [t]) };
      });
      return L.rd;
    }
    _pair(w, h, filter) {
      const gl = this.gl;
      return [0, 1].map(() => {
        const t = G.texture(gl, w, h, gl.RGBA16F, gl.RGBA, gl.HALF_FLOAT, filter || gl.LINEAR, gl.REPEAT);
        return { t, f: G.fbo(gl, [t]) };
      });
    }
    // a Navier-Stokes fluid that wraps around the torus (no walls: the world has none)
    _fluid(L, res, dyeRes) {
      if (L.fluid && L.fluid.res === res) return L.fluid;
      const F = { res, dyeRes, vel: this._pair(res, res), pres: this._pair(res, res), dye: this._pair(dyeRes, dyeRes), vc: 0, pc: 0, dc: 0 };
      const gl = this.gl;
      const one = () => { const t = G.texture(gl, res, res, gl.RGBA16F, gl.RGBA, gl.HALF_FLOAT, gl.LINEAR, gl.REPEAT); return { t, f: G.fbo(gl, [t]) }; };
      F.div = one();
      F.curl = one();
      this._clear(F.vel); this._clear(F.pres); this._clear(F.dye);
      L.fluid = F;
      return F;
    }
    _ripple(L, res) {
      if (L.ripple && L.ripple.res === res) return L.ripple;
      L.ripple = { res, p: this._pair(res, res), c: 0 };
      this._clear(L.ripple.p);
      return L.ripple;
    }
    // Game of Life state, seeded with a random soup
    _life(L, res, soft, blobs) {
      if (L.life && L.life.res === res) return L.life;
      const gl = this.gl;
      const p = [0, 1].map(() => { const t = G.texture(gl, res, res, gl.RGBA16F, gl.RGBA, gl.FLOAT, gl.NEAREST, gl.REPEAT); return { t, f: G.fbo(gl, [t]) }; });
      const d = new Float32Array(res * res * 4);
      if (soft) {
        // continuous life starts from soft random blobs (a uniform soup just dies or boils)
        for (let k = 0; k < (blobs || 10); k++) {
          // a patch of uniform noise a little wider than a creature (Lenia's own way of seeding)
          const cx = Math.random() * res, cy = Math.random() * res, rr = res * (0.03 + Math.random() * 0.03);
          for (let y = -rr; y <= rr; y++) for (let x = -rr; x <= rr; x++) {
            if (x * x + y * y > rr * rr) continue;
            const i = ((((Math.floor(cy + y) % res) + res) % res) * res + (((Math.floor(cx + x) % res) + res) % res)) * 4;
            d[i] = Math.random();
          }
        }
      } else for (let i = 0; i < res * res; i++) if (Math.random() < 0.22) { d[i * 4] = 1; d[i * 4 + 2] = 1; }
      for (const x of p) { gl.bindTexture(gl.TEXTURE_2D, x.t); gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, res, res, gl.RGBA, gl.FLOAT, d); }
      L.life = { res, p, c: 0 };
      return L.life;
    }
    _stepLife(L, fd, time) {
      const gl = this.gl, Lf = this._life(L, fd.res);
      gl.disable(gl.BLEND);
      for (let i = 0; i < fd.steps; i++) {
        const a = Lf.p[Lf.c], b = Lf.p[1 - Lf.c];
        this._pass(fd.kind === 10 ? this.P.lenia : this.P.life, b.f, Lf.res, Lf.res, (u) => {
          this._tex(0, a.t, u.uSrc);
          gl.uniform2f(u.uTexel, 1 / Lf.res, 1 / Lf.res);
          if (fd.kind === 10) {
            gl.uniform1f(u.uR, fd.R);
            gl.uniform1f(u.uMu, fd.mu);
            gl.uniform1f(u.uSigma, fd.sigma);
            gl.uniform1f(u.uDt, fd.dt);
            gl.uniform1f(u.uMode, fd.mode);
          } else {
            gl.uniform1i(u.uBirth, fd.birth);
            gl.uniform1i(u.uSurvive, fd.survive);
          }
          gl.uniform4fv(u.uBrush, fd.brush);
          gl.uniform1i(u.uNBrush, i === 0 ? fd.nBrush : 0);
          gl.uniform1f(u.uW, C.W);
          gl.uniform1f(u.uTime, time + i * 0.37);
        });
        Lf.c = 1 - Lf.c;
      }
    }
    _pass(prog, target, w, h, setup) {
      const gl = this.gl;
      gl.bindFramebuffer(gl.FRAMEBUFFER, target);
      gl.viewport(0, 0, w, h);
      gl.useProgram(prog.p);
      setup(prog.u);
      this._full();
    }
    _stepFluid(L, fd, dt) {
      const gl = this.gl, P = this.P, F = this._fluid(L, fd.res, fd.dyeRes);
      const W = C.W, n = F.res, tx = 1 / n, dx = W / n;
      gl.disable(gl.BLEND);
      const V = () => F.vel[F.vc], V2 = () => F.vel[1 - F.vc];
      const swapV = () => { F.vc = 1 - F.vc; };
      // splats: your touch pushes the fluid and pours ink into it
      if (fd.nSplat) {
        this._pass(P.fSplat, V2().f, n, n, (u) => { this._tex(0, V().t, u.uSrc); gl.uniform4fv(u.uSplat, fd.splat); gl.uniform4fv(u.uSplatV, fd.splatV); gl.uniform1i(u.uN, fd.nSplat); gl.uniform1i(u.uDye, 0); gl.uniform1f(u.uW, W); });
        swapV();
        const D = F.dye[F.dc], D2 = F.dye[1 - F.dc];
        this._pass(P.fSplat, D2.f, F.dyeRes, F.dyeRes, (u) => { this._tex(0, D.t, u.uSrc); gl.uniform4fv(u.uSplat, fd.splat); gl.uniform4fv(u.uSplatV, fd.splatC); gl.uniform1i(u.uN, fd.nSplat); gl.uniform1i(u.uDye, 1); gl.uniform1f(u.uW, W); });
        F.dc = 1 - F.dc;
      }
      this._pass(P.fCurl, F.curl.f, n, n, (u) => { this._tex(0, V().t, u.uVel); gl.uniform2f(u.uTexel, tx, tx); gl.uniform1f(u.uDx, dx); });
      this._pass(P.fVort, V2().f, n, n, (u) => { this._tex(0, V().t, u.uVel); this._tex(1, F.curl.t, u.uCurl); gl.uniform2f(u.uTexel, tx, tx); gl.uniform1f(u.uCurlAmt, fd.curl); gl.uniform1f(u.uDt, dt); });
      swapV();
      this._pass(P.fDiv, F.div.f, n, n, (u) => { this._tex(0, V().t, u.uVel); gl.uniform2f(u.uTexel, tx, tx); gl.uniform1f(u.uDx, dx); });
      for (let i = 0; i < fd.iters; i++) {
        const a = F.pres[F.pc], b = F.pres[1 - F.pc];
        this._pass(P.fPres, b.f, n, n, (u) => { this._tex(0, a.t, u.uP); this._tex(1, F.div.t, u.uDiv); gl.uniform2f(u.uTexel, tx, tx); gl.uniform1f(u.uDx, dx); });
        F.pc = 1 - F.pc;
      }
      this._pass(P.fGrad, V2().f, n, n, (u) => { this._tex(0, F.pres[F.pc].t, u.uP); this._tex(1, V().t, u.uVel); gl.uniform2f(u.uTexel, tx, tx); gl.uniform1f(u.uDx, dx); });
      swapV();
      this._pass(P.fAdvect, V2().f, n, n, (u) => { this._tex(0, V().t, u.uVel); this._tex(1, V().t, u.uSrc); gl.uniform1f(u.uDt, dt); gl.uniform1f(u.uW, W); gl.uniform1f(u.uDiss, fd.velDiss); });
      swapV();
      const D = F.dye[F.dc], D2 = F.dye[1 - F.dc];
      this._pass(P.fAdvect, D2.f, F.dyeRes, F.dyeRes, (u) => { this._tex(0, V().t, u.uVel); this._tex(1, D.t, u.uSrc); gl.uniform1f(u.uDt, dt); gl.uniform1f(u.uW, W); gl.uniform1f(u.uDiss, fd.dyeDiss); });
      F.dc = 1 - F.dc;
    }
    _stepRipple(L, rd) {
      const gl = this.gl, R = this._ripple(L, rd.res);
      gl.disable(gl.BLEND);
      for (let i = 0; i < rd.steps; i++) {
        const a = R.p[R.c], b = R.p[1 - R.c];
        this._pass(this.P.ripple, b.f, R.res, R.res, (u) => {
          this._tex(0, a.t, u.uSrc);
          gl.uniform2f(u.uTexel, 1 / R.res, 1 / R.res);
          gl.uniform1f(u.uC2, rd.c2);
          gl.uniform1f(u.uDamp, rd.damp);
          gl.uniform1f(u.uW, C.W);
          gl.uniform4fv(u.uSrcs, rd.srcs);
          gl.uniform1i(u.uN, rd.nSrc);
        });
        R.c = 1 - R.c;
      }
    }
    _clear(pairs) {
      const gl = this.gl;
      for (const t of pairs) {
        gl.bindFramebuffer(gl.FRAMEBUFFER, t.f);
        gl.clearColor(0, 0, 0, 1);
        gl.clear(gl.COLOR_BUFFER_BIT);
      }
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    }
    get dustN() {
      return this.L ? this.L.n : 0;
    }

    // ---------------------------------------------------------------- seeding (acts on the bound layer)
    // 'seed': a small spinning seed that bangs outward; 'agents': slime-mould agents with headings;
    // 'uniform': evenly spread; 'rings': a disc around a sun; 'cloud': a soft gaussian cloud.
    seedDust(cx, cy, radius, mode) {
      const L = this.L, n = L.n;
      const pos = new Float32Array(n * 4), vel = new Float32Array(n * 4);
      const r = C.rng(777 + Math.floor(Math.random() * 1e6));
      for (let i = 0; i < n; i++) {
        const seed = r();
        let x, y, z = -2.6 + 3.4 * ((seed * 13.7) % 1);
        if (mode === 'agents') {
          x = (r() - 0.5) * C.W; y = (r() - 0.5) * C.W; z = r() * Math.PI * 2;
        } else if (mode === 'uniform') {
          x = (r() - 0.5) * C.W; y = (r() - 0.5) * C.W; z = -1.2 + 1.6 * ((seed * 13.7) % 1);
        } else if (mode === 'rings') {
          const rr = 1.2 + Math.pow(r(), 0.8) * 13, a = r() * Math.PI * 2;
          x = cx + Math.cos(a) * rr; y = cy + Math.sin(a) * rr; z = -0.6 + 0.8 * ((seed * 13.7) % 1);
        } else if (mode === 'cloud') {
          x = cx + C.gauss(r) * radius; y = cy + C.gauss(r) * radius; z = -1.5 + 2 * ((seed * 13.7) % 1);
        } else {
          const a = r() * Math.PI * 2, rr = radius * Math.pow(r(), 0.7);
          const arm = (i & 1 ? Math.PI : 0) + rr * 1.2;
          const ang = r() < 0.5 ? a : arm + C.gauss(r) * 0.35;
          x = cx + Math.cos(ang) * rr; y = cy + Math.sin(ang) * rr;
        }
        pos[i * 4] = mode === 'agents' ? x : C.wrap(x);
        pos[i * 4 + 1] = mode === 'agents' ? y : C.wrap(y);
        pos[i * 4 + 2] = z;
        pos[i * 4 + 3] = seed;
      }
      const gl = this.gl;
      for (const d of L.dust) {
        gl.bindTexture(gl.TEXTURE_2D, d.pos);
        gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, L.side, L.side, gl.RGBA, gl.FLOAT, pos);
        gl.bindTexture(gl.TEXTURE_2D, d.vel);
        gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, L.side, L.side, gl.RGBA, gl.FLOAT, vel);
      }
      if (mode === 'agents') this._clear(this._trailW(L));
    }
    seedSkin(seed, blobs) {
      const gl = this.gl, L = this.L, N = L.rdN;
      const rd = this._rd(L);
      const d = new Float32Array(N * N * 4);
      for (let i = 0; i < N * N; i++) d[i * 4] = 1;
      const r = C.rng(seed);
      const list = blobs || Array.from({ length: 70 }, () => [(r() - 0.5) * C.W, (r() - 0.5) * C.W, 0.25 + r() * 0.5]);
      for (const [bx, by, br] of list) {
        const cx = Math.floor((bx / C.W + 0.5) * N), cy = Math.floor((by / C.W + 0.5) * N);
        const rad = Math.ceil((br / C.W) * N);
        for (let y = -rad; y <= rad; y++) for (let x = -rad; x <= rad; x++) {
          if (x * x + y * y > rad * rad) continue;
          const ix = (((cx + x) % N) + N) % N, iy = (((cy + y) % N) + N) % N;
          d[(iy * N + ix) * 4] = 0.5;
          d[(iy * N + ix) * 4 + 1] = 0.25 + r() * 0.1;
        }
      }
      for (const t of rd) {
        gl.bindTexture(gl.TEXTURE_2D, t.t);
        gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, N, N, gl.RGBA, gl.FLOAT, d);
      }
    }
    // Box-average a layer's world field down to 64x64 and read it back (a few times a second).
    readField(kind, L) {
      L = L || this.L;
      const gl = this.gl;
      const src = kind === 'life' ? L.life.p[L.life.c].t : kind === 'skin' ? this._rd(L)[L.rdCur].t : this._trailW(L)[L.trailWCur].t;
      const srcN = src.w;
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.readFbo);
      gl.viewport(0, 0, 64, 64);
      gl.disable(gl.BLEND);
      const pr = this.P.box;
      gl.useProgram(pr.p);
      this._tex(0, src, pr.u.uSrc);
      gl.uniform1i(pr.u.uTaps, srcN / 64);
      gl.uniform2f(pr.u.uTexel, 1 / srcN, 1 / srcN);
      this._full();
      gl.readPixels(0, 0, 64, 64, gl.RGBA, gl.FLOAT, this.readBuf);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      return this.readBuf;
    }

    resize(w, h) {
      const gl = this.gl;
      if (w === this.w && h === this.h) return;
      this.w = w;
      this.h = h;
      this.canvas.width = w;
      this.canvas.height = h;
      const delF = (o) => { if (!o) return; o.tex.forEach((t) => gl.deleteTexture(t)); gl.deleteFramebuffer(o); };
      delF(this.compFbo);
      (this.bloom || []).forEach(delF);
      const tex = (W, H) => G.texture(gl, W, H, gl.RGBA16F, gl.RGBA, gl.HALF_FLOAT, gl.LINEAR, gl.CLAMP_TO_EDGE);
      this.compFbo = G.fbo(gl, [tex(w, h)]);
      this.bloom = [];
      let bw = Math.max(1, w >> 1), bh = Math.max(1, h >> 1);
      for (let i = 0; i < 6; i++) {
        this.bloom.push(G.fbo(gl, [tex(bw, bh)]));
        bw = Math.max(1, bw >> 1);
        bh = Math.max(1, bh >> 1);
      }
      for (const L of this.layers) this._screen(L);
    }

    _tex(unit, tex, loc) {
      const gl = this.gl;
      gl.activeTexture(gl.TEXTURE0 + unit);
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.uniform1i(loc, unit);
    }
    _full() {
      const gl = this.gl;
      gl.bindVertexArray(this.triVAO);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    }
    _camU(pr, f) {
      const gl = this.gl, u = pr.u;
      if (u.uCam) gl.uniform2f(u.uCam, f.cam.x, f.cam.y);
      if (u.uCamH) gl.uniform1f(u.uCamH, f.cam.h);
      if (u.uRoll) gl.uniform1f(u.uRoll, f.cam.roll);
      if (u.uW) gl.uniform1f(u.uW, C.W);
      if (u.uProj) gl.uniformMatrix4fv(u.uProj, false, this.proj);
      if (u.uTime) gl.uniform1f(u.uTime, f.time);
    }

    // ---------------------------------------------------------------- one world into its layer
    renderLayer(L, f) {
      const gl = this.gl, P = this.P;
      this.use(L);
      this._screen(L);
      const w = this.w, h = this.h;
      this.proj = perspective(w / h, 0.02, 2000);
      gl.disable(gl.DEPTH_TEST);
      gl.disable(gl.CULL_FACE);
      if (f.nut) {
        gl.bindTexture(gl.TEXTURE_2D, L.nutTex);
        gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, 64, 64, gl.RED, gl.FLOAT, f.nut);
      }
      const s = f.sim;
      const trailW = s.mode === 1 ? this._trailW(L) : null;
      if (f.field && f.field.kind === 3) this._fluid(L, f.field.res, f.field.dyeRes);
      if (f.field && f.field.kind === 4) this._ripple(L, f.field.res);
      if (f.field && (f.field.kind === 9 || f.field.kind === 10)) {
        if (f.field.reseed && L.life) { L.life.p.forEach((x) => { gl.deleteTexture(x.t); gl.deleteFramebuffer(x.f); }); L.life = null; }
        this._life(L, f.field.res, f.field.kind === 10, f.field.blobs);
        if (f.simDt > 0 && f.field.steps) this._stepLife(L, f.field, f.time);
      }
      if (f.field && f.field.kind === 3 && f.simDt > 0) this._stepFluid(L, f.field, Math.min(f.simDt, 0.033));
      if (f.field && f.field.kind === 4 && f.simDt > 0) this._stepRipple(L, f.field);
      const fluidTex = s.mode === 5 && L.fluid ? L.fluid.vel[L.fluid.vc].t : s.mode === 6 && L.ripple ? L.ripple.p[L.ripple.c].t : this.noiseTex;

      // 1. simulate dust
      if (f.simDt > 0 || f.bang) {
        const src = L.dust[L.dustCur], dst = L.dust[1 - L.dustCur];
        gl.bindFramebuffer(gl.FRAMEBUFFER, dst.fbo);
        gl.viewport(0, 0, L.side, L.side);
        gl.disable(gl.BLEND);
        const pr = P.sim, u = pr.u;
        gl.useProgram(pr.p);
        this._tex(0, src.pos, u.uPos);
        this._tex(1, src.vel, u.uVel);
        this._tex(2, this.noiseTex, u.uNoise);
        this._tex(3, trailW ? trailW[L.trailWCur].t : this.noiseTex, u.uTrailW);
        gl.uniform1f(u.uDt, Math.max(f.simDt, 1e-4));
        gl.uniform1f(u.uTime, f.time);
        gl.uniform1f(u.uW, C.W);
        gl.uniform1f(u.uFlowT, s.flowT);
        gl.uniform1f(u.uRespawn, s.respawn);
        gl.uniform4fv(u.uLaw, s.law);
        gl.uniform4fv(u.uLaw2, s.law2);
        gl.uniform4fv(u.uWells, s.wells);
        gl.uniform4fv(u.uWellsB, s.wellsB);
        gl.uniform1i(u.uNWells, s.nWells);
        gl.uniform4fv(u.uShocks, s.shocks);
        gl.uniform4fv(u.uShocksB, s.shocksB);
        gl.uniform1i(u.uNShocks, s.nShocks);
        gl.uniform4fv(u.uStirs, s.stirs);
        gl.uniform1i(u.uNStirs, s.nStirs);
        gl.uniform1f(u.uStirR, s.stirR);
        gl.uniform4fv(u.uCursor, s.cursor);
        gl.uniform4fv(u.uAudio, s.audio);
        gl.uniform4fv(u.uIntro, s.intro);
        gl.uniform4fv(u.uModes, s.modes);
        gl.uniform1i(u.uMode, s.mode);
        gl.uniform4fv(u.uPhys, s.phys);
        gl.uniform4fv(u.uLight, s.light);
        gl.uniform4fv(u.uSun, s.sun);
        gl.uniform4fv(u.uRing, s.ring);
        gl.uniform4fv(u.uAttr, s.attr);
        gl.uniform1f(u.uCymSense, s.cymSense);
        gl.uniform4fv(u.uXf, s.xf);
        gl.uniform1i(u.uNXf, s.nxf);
        gl.uniform4fv(u.uFlame, s.flame);
        this._tex(4, fluidTex, u.uFluid);
        gl.uniform2fv(u.uTilt, s.tilt || [0, 0]);
        this._full();
        L.dustCur = 1 - L.dustCur;
      }
      const dust = L.dust[L.dustCur];

      // slime mould: agents deposit into the world trail map, which then diffuses and fades
      if (trailW && f.simDt > 0) {
        const cur = trailW[L.trailWCur], nxt = trailW[1 - L.trailWCur];
        gl.bindFramebuffer(gl.FRAMEBUFFER, cur.f);
        gl.viewport(0, 0, cur.t.w, cur.t.h);
        gl.enable(gl.BLEND);
        gl.blendFunc(gl.ONE, gl.ONE);
        const pd = P.deposit;
        gl.useProgram(pd.p);
        this._tex(0, dust.pos, pd.u.uPos);
        gl.uniform1i(pd.u.uTexW, L.side);
        gl.uniform1f(pd.u.uW, C.W);
        gl.uniform1f(pd.u.uAmt, f.field.deposit * Math.min(2, f.simDt * 60) * (262144 / L.n) * 0.25);
        gl.bindVertexArray(this.emptyVAO);
        gl.drawArrays(gl.POINTS, 0, L.n);
        gl.disable(gl.BLEND);
        gl.bindFramebuffer(gl.FRAMEBUFFER, nxt.f);
        const pf = P.diffuse;
        gl.useProgram(pf.p);
        this._tex(0, cur.t, pf.u.uSrc);
        gl.uniform2f(pf.u.uTexel, 1 / cur.t.w, 1 / cur.t.h);
        gl.uniform1f(pf.u.uDecay, Math.pow(f.field.decay, Math.min(3, f.simDt * 60)));
        gl.uniform1f(pf.u.uW, C.W);
        gl.uniform4fv(pf.u.uFood, f.field.food);
        gl.uniform1i(pf.u.uNFood, f.field.nFood);
        this._full();
        L.trailWCur = 1 - L.trailWCur;
      }
      // living skin: several Gray-Scott steps per frame
      if (f.field && f.field.kind === 2 && f.simDt > 0) {
        const rd = this._rd(L);
        const pr = P.rd, u = pr.u;
        gl.useProgram(pr.p);
        gl.viewport(0, 0, L.rdN, L.rdN);
        gl.disable(gl.BLEND);
        this._tex(1, this.noiseTex, u.uNoise);
        gl.uniform2f(u.uTexel, 1 / L.rdN, 1 / L.rdN);
        gl.uniform4fv(u.uFK, f.field.fk);
        gl.uniform1f(u.uW, C.W);
        gl.uniform1f(u.uTime, f.time);
        gl.uniform1f(u.uFeedBoost, f.field.feedBoost);
        gl.uniform4fv(u.uBrush, f.field.brush);
        gl.uniform4fv(u.uModes, s.modes);
        gl.uniform1f(u.uCymFeed, f.field.cymFeed || 0);
        const iters = Math.max(1, Math.round(f.field.iters * Math.min(2, f.simDt * 60)));
        for (let i = 0; i < iters; i++) {
          const a = rd[L.rdCur], b = rd[1 - L.rdCur];
          gl.bindFramebuffer(gl.FRAMEBUFFER, b.f);
          this._tex(0, a.t, u.uSrc);
          gl.uniform1i(u.uNBrush, i === 0 ? f.field.nBrush : 0);
          this._full();
          L.rdCur = 1 - L.rdCur;
        }
      }

      // 2. trails: fade the previous frame (reprojected), then add the dust
      {
        const prev = L.trail[L.trailCur], next = L.trail[1 - L.trailCur];
        gl.bindFramebuffer(gl.FRAMEBUFFER, next);
        gl.viewport(0, 0, w, h);
        gl.disable(gl.BLEND);
        const pr = P.trail, u = pr.u;
        gl.useProgram(pr.p);
        this._tex(0, prev.tex[0], u.uPrev);
        gl.uniform1f(u.uDecay, f.trailDecay);
        const pc = f.prevCam || f.cam;
        gl.uniform4f(u.uRep, C.wrap(f.cam.x - pc.x), C.wrap(f.cam.y - pc.y), f.cam.roll, pc.roll);
        gl.uniform3f(u.uRep2, f.cam.viewH, pc.viewH, w / h);
        this._full();
        gl.enable(gl.BLEND);
        gl.blendFunc(gl.ONE, gl.ONE);
        const pd = P.dust, ud = pd.u;
        gl.useProgram(pd.p);
        this._camU(pd, f);
        this._tex(0, dust.pos, ud.uPos);
        this._tex(1, dust.vel, ud.uVel);
        this._tex(2, L.nutTex, ud.uNut);
        gl.uniform1i(ud.uTexW, L.side);
        gl.uniform1i(ud.uMode, s.mode);
        gl.uniform1f(ud.uPxScale, h / (2 * TAN_HALF));
        gl.uniform1f(ud.uFocus, 0.0);
        // far away, a whole world is a few hundred pixels: keep its total light roughly constant
        const far = Math.min(1, 26 / Math.max(f.cam.viewH, 1e-3));
        gl.uniform1f(ud.uBright, f.dustBright * (1 - f.trailDecay) * 2.2 * (262144 / L.n) * (0.35 + 0.65 * far));
        const pal = f.palette;
        gl.uniform3fv(ud.uPal0, pal.dust0);
        gl.uniform3fv(ud.uPal1, pal.dust1);
        gl.uniform3fv(ud.uPal2, pal.dust2);
        gl.uniform3fv(ud.uPal3, pal.dust3);
        gl.bindVertexArray(this.emptyVAO);
        gl.drawArrays(gl.POINTS, 0, L.n);
        L.trailCur = 1 - L.trailCur;
      }
      const trailTex = L.trail[L.trailCur].tex[0];

      // 3. HDR scene of this world
      gl.bindFramebuffer(gl.FRAMEBUFFER, L.sceneFbo);
      gl.viewport(0, 0, w, h);
      gl.disable(gl.BLEND);
      {
        const pr = P.nebula, u = pr.u;
        gl.useProgram(pr.p);
        this._camU(pr, f);
        this._tex(0, this.noiseTex, u.uNoise);
        this._tex(1, L.nutTex, u.uNut);
        gl.uniform1f(u.uTanHalf, TAN_HALF);
        gl.uniform1f(u.uAspect, w / h);
        gl.uniform1f(u.uNebAmt, f.nebAmt);
        gl.uniform3fv(u.uDeep, f.palette.deep);
        gl.uniform3fv(u.uMid, f.palette.mid);
        gl.uniform3fv(u.uHot, f.palette.hot);
        gl.uniform3fv(u.uAcc, f.palette.accent);
        gl.uniform4fv(u.uAudio, s.audio);
        this._full();
      }
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE);
      if (f.field && f.field.kind) {
        const pr = P.field, u = pr.u;
        gl.useProgram(pr.p);
        this._camU(pr, f);
        const k = f.field.kind;
        const tex = k === 2 ? this._rd(L)[L.rdCur].t : k === 3 ? L.fluid.dye[L.fluid.dc].t : k === 4 ? L.ripple.p[L.ripple.c].t : k === 9 || k === 10 ? L.life.p[L.life.c].t : k >= 5 ? this.noiseTex : this._trailW(L)[L.trailWCur].t;
        this._tex(1, this.noiseTex, u.uNoise);
        gl.uniform4fv(u.uP1, f.field.p1 || [0, 0, 0, 0]);
        gl.uniform4fv(u.uP2, f.field.p2 || [0, 0, 0, 0]);
        gl.uniform4fv(u.uP3, f.field.p3 || [0, 0, 0, 0]);
        gl.uniform1i(u.uLowQ, C.MOBILE ? 1 : 0);
        this._tex(0, tex, u.uField);
        gl.uniform1i(u.uKind, f.field.kind);
        gl.uniform2f(u.uTexel, 1 / tex.w, 1 / tex.h);
        gl.uniform1f(u.uTanHalf, TAN_HALF);
        gl.uniform1f(u.uAspect, w / h);
        gl.uniform1f(u.uGain, f.field.gain);
        gl.uniform1f(u.uRelief, f.field.relief || 1);
        gl.uniform4fv(u.uScan, f.field.scan);
        gl.uniform3fv(u.uDeep, f.palette.deep);
        gl.uniform3fv(u.uMid, f.palette.mid);
        gl.uniform3fv(u.uHot, f.palette.hot);
        gl.uniform3fv(u.uAcc, f.palette.accent);
        this._full();
      }
      {
        const pr = P.copy;
        gl.useProgram(pr.p);
        this._tex(0, trailTex, pr.u.uSrc);
        gl.uniform1f(pr.u.uGain, f.dustLayer == null ? 1 : f.dustLayer);
        this._full();
      }
      if (f.ribbonCount > 0) {
        const pr = P.ribbon;
        gl.useProgram(pr.p);
        this._camU(pr, f);
        gl.bindVertexArray(this.ribbonVAO);
        gl.bindBuffer(gl.ARRAY_BUFFER, this.ribbonBuf);
        gl.bufferData(gl.ARRAY_BUFFER, f.ribbons.subarray(0, f.ribbonCount * 8), gl.DYNAMIC_DRAW);
        gl.drawArrays(gl.TRIANGLES, 0, f.ribbonCount);
      }
      if (f.orbs.length) {
        gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
        const pr = P.orb, u = pr.u;
        gl.useProgram(pr.p);
        this._camU(pr, f);
        gl.bindVertexArray(this.orbVAO);
        for (const o of f.orbs) {
          gl.uniform2f(u.uOrbPos, o.x, o.y);
          gl.uniform1f(u.uOrbR, o.r);
          gl.uniform3fv(u.uC1, o.c1);
          gl.uniform3fv(u.uC2, o.c2);
          gl.uniform3fv(u.uC3, o.c3);
          gl.uniform1f(u.uSeed, o.seedF);
          gl.uniform1f(u.uHover, o.hover);
          gl.uniform1f(u.uBorn, o.born);
          gl.uniform1i(u.uGenus, C.GENERA.indexOf(o.genus));
          gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
        }
        gl.blendFunc(gl.ONE, gl.ONE);
      }
      if (f.singerCount > 0) {
        const pr = P.singer;
        gl.useProgram(pr.p);
        this._camU(pr, f);
        gl.bindVertexArray(this.singerI.vao);
        gl.bindBuffer(gl.ARRAY_BUFFER, this.singerI.buf);
        gl.bufferData(gl.ARRAY_BUFFER, f.singers.subarray(0, f.singerCount * 16), gl.DYNAMIC_DRAW);
        gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, f.singerCount);
      }
      if (f.spriteCount > 0) {
        const pr = P.sprite;
        gl.useProgram(pr.p);
        this._camU(pr, f);
        gl.bindVertexArray(this.spriteI.vao);
        gl.bindBuffer(gl.ARRAY_BUFFER, this.spriteI.buf);
        gl.bufferData(gl.ARRAY_BUFFER, f.sprites.subarray(0, f.spriteCount * 12), gl.DYNAMIC_DRAW);
        gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, f.spriteCount);
      }
      gl.disable(gl.BLEND);
      gl.bindVertexArray(null);
    }

    // ---------------------------------------------------------------- composite + post
    // A = the outer world, B = the world inside it (optional). ap = aperture {x, y (uv), r (screen heights), t}.
    post(post, A, B, ap) {
      const gl = this.gl, P = this.P;
      const w = this.w, h = this.h;
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.compFbo);
      gl.viewport(0, 0, w, h);
      gl.disable(gl.BLEND);
      {
        const pr = P.composite, u = pr.u;
        gl.useProgram(pr.p);
        this._tex(0, A.L.sceneFbo.tex[0], u.uA);
        this._tex(1, B ? B.L.sceneFbo.tex[0] : A.L.sceneFbo.tex[0], u.uB);
        this._tex(2, this.noiseTex, u.uNoise);
        gl.uniform1i(u.uHasB, B ? 1 : 0);
        gl.uniform1i(u.uStyleA, A.style);
        gl.uniform1i(u.uStyleB, B ? B.style : 0);
        const pal = (arr, p) => { arr.set(p.deep, 0); arr.set(p.mid, 3); arr.set(p.hot, 6); arr.set(p.accent, 9); return arr; };
        gl.uniform3fv(u.uPalA, pal(this.palA, A.palette));
        gl.uniform3fv(u.uPalB, pal(this.palB, B ? B.palette : A.palette));
        gl.uniform4f(u.uAp, ap ? ap.x : 0.5, ap ? ap.y : 0.5, ap ? ap.r : 0, ap ? ap.t : 0);
        gl.uniform1f(u.uAspect, w / h);
        gl.uniform1f(u.uTime, post.time);
        gl.uniform2f(u.uRes, w, h);
        this._full();
      }
      // bloom
      const Bl = this.bloom;
      {
        const pr = P.down, u = pr.u;
        gl.useProgram(pr.p);
        let src = this.compFbo.tex[0], sw = w, sh = h;
        for (let i = 0; i < Bl.length; i++) {
          gl.bindFramebuffer(gl.FRAMEBUFFER, Bl[i]);
          gl.viewport(0, 0, Bl[i].w, Bl[i].h);
          this._tex(0, src, u.uSrc);
          gl.uniform2f(u.uTexel, 1 / sw, 1 / sh);
          gl.uniform1f(u.uThreshold, 0.55);
          gl.uniform1i(u.uFirst, i === 0 ? 1 : 0);
          this._full();
          src = Bl[i].tex[0];
          sw = Bl[i].w;
          sh = Bl[i].h;
        }
      }
      {
        const pr = P.up, u = pr.u;
        gl.useProgram(pr.p);
        gl.enable(gl.BLEND);
        gl.blendFunc(gl.ONE, gl.ONE);
        for (let i = Bl.length - 1; i > 0; i--) {
          gl.bindFramebuffer(gl.FRAMEBUFFER, Bl[i - 1]);
          gl.viewport(0, 0, Bl[i - 1].w, Bl[i - 1].h);
          this._tex(0, Bl[i].tex[0], u.uSrc);
          gl.uniform2f(u.uTexel, 1 / Bl[i].w, 1 / Bl[i].h);
          this._full();
        }
        gl.disable(gl.BLEND);
      }
      // luminance + adaptation (the flash guard)
      {
        gl.bindFramebuffer(gl.FRAMEBUFFER, this.lumFbo);
        gl.viewport(0, 0, 32, 18);
        const pr = P.lum, u = pr.u;
        gl.useProgram(pr.p);
        this._tex(0, this.compFbo.tex[0], u.uScene);
        this._tex(1, Bl[0].tex[0], u.uBloom);
        gl.uniform1f(u.uBloomAmt, post.bloomAmt);
        gl.uniform2f(u.uCell, 1 / 32, 1 / 18);
        this._full();
        const a = this.adapt[this.adaptCur], b = this.adapt[1 - this.adaptCur];
        gl.bindFramebuffer(gl.FRAMEBUFFER, b.f);
        gl.viewport(0, 0, 1, 1);
        const pa = P.adapt;
        gl.useProgram(pa.p);
        this._tex(0, this.lumTex, pa.u.uLum);
        this._tex(1, a.t, pa.u.uPrev);
        gl.uniform1f(pa.u.uDt, Math.max(post.realDt, 1 / 240));
        gl.uniform2i(pa.u.uSize, 32, 18);
        this._full();
        this.adaptCur = 1 - this.adaptCur;
      }
      // final
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(0, 0, w, h);
      {
        const pr = P.final, u = pr.u;
        gl.useProgram(pr.p);
        this._tex(0, this.compFbo.tex[0], u.uScene);
        this._tex(1, Bl[0].tex[0], u.uBloom);
        this._tex(2, this.adapt[this.adaptCur].t, u.uAdapt);
        gl.uniform1f(u.uBloomAmt, post.bloomAmt);
        gl.uniform1f(u.uExposure, post.exposure);
        gl.uniform1f(u.uSafeLum, post.safeLum);
        gl.uniform1f(u.uCA, post.ca);
        gl.uniform1f(u.uTime, post.time);
        gl.uniform1f(u.uVig, 1.1);
        gl.uniform1f(u.uGrain, 0.018);
        gl.uniform4fv(u.uOverlay, post.overlay);
        this._full();
      }
      gl.bindVertexArray(null);
    }

    readAdapt() {
      const gl = this.gl;
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.adapt[this.adaptCur].f);
      const out = new Float32Array(4);
      gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.FLOAT, out);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      return { adapted: out[0], instant: out[1] };
    }
  }

  C.Renderer = Renderer;
})();
