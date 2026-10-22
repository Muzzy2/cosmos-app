'use strict';
// All GLSL lives here.
(function () {
  const C = window.COSMOS;
  const H = `#version 300 es
precision highp float;
precision highp int;
`;

  const ROT = `
vec2 rot2(vec2 p, float a){ float c = cos(a), s = sin(a); return vec2(c*p.x - s*p.y, s*p.x + c*p.y); }
`;

  const SNOISE2 = `
vec3 permute3(vec3 x){ return mod(((x*34.0)+1.0)*x, 289.0); }
float snoise2(vec2 v){
  const vec4 C = vec4(0.211324865405187, 0.366025403784439, -0.577350269189626, 0.024390243902439);
  vec2 i = floor(v + dot(v, C.yy));
  vec2 x0 = v - i + dot(i, C.xx);
  vec2 i1 = (x0.x > x0.y) ? vec2(1.0, 0.0) : vec2(0.0, 1.0);
  vec4 x12 = x0.xyxy + C.xxzz;
  x12.xy -= i1;
  i = mod(i, 289.0);
  vec3 p = permute3(permute3(i.y + vec3(0.0, i1.y, 1.0)) + i.x + vec3(0.0, i1.x, 1.0));
  vec3 m = max(0.5 - vec3(dot(x0,x0), dot(x12.xy,x12.xy), dot(x12.zw,x12.zw)), 0.0);
  m = m*m; m = m*m;
  vec3 x = 2.0 * fract(p * C.www) - 1.0;
  vec3 h = abs(x) - 0.5;
  vec3 ox = floor(x + 0.5);
  vec3 a0 = x - ox;
  m *= 1.79284291400159 - 0.85373472095314 * (a0*a0 + h*h);
  vec3 g;
  g.x = a0.x * x0.x + h.x * x0.y;
  g.yz = a0.yz * x12.xz + h.yz * x12.yw;
  return 130.0 * dot(m, g);
}
`;

  C.SH = {};

  C.SH.fullVS = H + `
layout(location=0) in vec2 aPos;
out vec2 vUv;
void main(){ vUv = aPos*0.5 + 0.5; gl_Position = vec4(aPos, 0.0, 1.0); }
`;

  // ---------------------------------------------------------------- particle simulation
  C.SH.simFS = H + ROT + `
uniform sampler2D uPos, uVel, uNoise;
uniform float uDt, uTime, uW, uFlowT, uRespawn;
uniform vec4 uLaw;    // curl, central, cym, sign
uniform vec4 uLaw2;   // drag, k, flow, unused
uniform vec4 uWells[16];
uniform vec4 uWellsB[16];  // soft, jet, axis, core
uniform int uNWells;
uniform vec4 uShocks[24];
uniform vec4 uShocksB[24]; // width, heat, zkick, 0
uniform int uNShocks;
uniform vec4 uStirs[8];
uniform int uNStirs;
uniform float uStirR;
uniform vec4 uCursor;  // x, y, strength, radius
uniform vec4 uAudio;   // bass, mid, high, level
uniform vec4 uIntro;   // amount, bang, cx, cy
uniform vec4 uModes[4]; // Chladni modes: n, m, amplitude, 0
uniform int uMode;       // 0 flow, 1 slime-mould agents, 2 orbital rings
uniform sampler2D uTrailW;
uniform vec4 uPhys;      // sensor angle, sensor distance, turn per step, speed
uniform vec4 uLight;     // x, y, strength, radius (agents avoid light)
uniform vec4 uSun;       // x, y, mass, ring spacing
uniform vec4 uRing;      // ring strength, exponent, 0, 0
uniform vec4 uAttr;      // Clifford a, b, c, d
uniform float uCymSense; // standing waves steer slime-mould agents
uniform vec4 uXf[20];    // fractal flame: 5 vec4 per transform (affine, translate+weight+colour, 3x variation weights)
uniform int uNXf;
uniform vec4 uFlame;     // scale, rotation, 0, 0
uniform sampler2D uFluid; // fluid velocity (mode 5) or ripple height (mode 6)
uniform vec2 uTilt;      // the phone's tilt, as a wind
in vec2 vUv;
layout(location=0) out vec4 oPos;
layout(location=1) out vec4 oVel;

float hash13(vec3 p){ p = fract(p*0.1031); p += dot(p, p.zyx + 31.32); return fract((p.x + p.y)*p.z); }
vec2 wrapD(vec2 d){ return d - uW*floor(d/uW + 0.5); }

float psi(vec2 p, float t){
  vec2 uv = p/uW;
  float k = uLaw2.y;
  vec4 a = texture(uNoise, uv*k + vec2(0.011, 0.007)*t);
  vec4 b = texture(uNoise, uv*k*2.0 + vec2(-0.009, 0.012)*t);
  float m = 0.5 + 0.5*sin(t*0.21);
  return mix(a.x, a.y, m) + 0.45*mix(b.z, b.w, 1.0 - m);
}
vec2 curlF(vec2 p, float t){
  float e = 0.15;
  float n1 = psi(p + vec2(0.0, e), t), n2 = psi(p - vec2(0.0, e), t);
  float n3 = psi(p + vec2(e, 0.0), t), n4 = psi(p - vec2(e, 0.0), t);
  return vec2(n1 - n2, n4 - n3)/(2.0*e);
}
vec3 chladni(vec2 p, float n, float m){
  float k = 6.2831853/uW;
  float a = n*k, b = m*k;
  float f = cos(a*p.x)*cos(b*p.y) - cos(b*p.x)*cos(a*p.y);
  vec2 df = vec2(-a*sin(a*p.x)*cos(b*p.y) + b*sin(b*p.x)*cos(a*p.y),
                 -b*cos(a*p.x)*sin(b*p.y) + a*cos(b*p.x)*sin(a*p.y));
  return vec3(2.0*f*df, abs(f));
}

float plate(vec2 p){
  float f = 0.0;
  float k = 6.2831853/uW;
  for (int i = 0; i < 4; i++){
    vec4 md = uModes[i];
    if (md.z < 0.001) continue;
    float a = md.x*k, b = md.y*k;
    f += md.z*(cos(a*p.x)*cos(b*p.y) - cos(b*p.x)*cos(a*p.y));
  }
  return f;
}
float sense(vec2 q){
  vec4 t = texture(uTrailW, q/uW + 0.5);
  vec2 dl = wrapD(q - uLight.xy);
  float light = uLight.z*exp(-dot(dl, dl)/(uLight.w*uLight.w));
  float s = t.r + t.g*4.0 - light*6.0;
  if (uCymSense > 0.0) s -= abs(plate(q))*uCymSense;
  return s;
}
void physarum(vec4 P, vec4 V){
  vec2 p = P.xy;
  float ang = P.z, seed = P.w, heat = V.w;
  float steps = uDt*60.0;
  vec2 dir = vec2(cos(ang), sin(ang));
  float sa = uPhys.x, sd = uPhys.y;
  float F = sense(p + dir*sd);
  float L = sense(p + vec2(cos(ang + sa), sin(ang + sa))*sd);
  float R = sense(p + vec2(cos(ang - sa), sin(ang - sa))*sd);
  float rnd = hash13(vec3(seed*31.0, uTime, 5.0));
  float turn = uPhys.z*steps;
  if (F >= L && F >= R) {}
  else if (F < L && F < R) ang += (rnd < 0.5 ? -1.0 : 1.0)*turn;
  else if (L > R) ang += turn;
  else ang -= turn;
  ang += (rnd - 0.5)*0.05*steps;
  dir = vec2(cos(ang), sin(ang));
  vec2 push = vec2(0.0);
  for (int i = 0; i < 24; i++){
    if (i >= uNShocks) break;
    vec4 s = uShocks[i]; vec4 sb = uShocksB[i];
    vec2 d = wrapD(p - s.xy);
    float r = length(d) + 1e-4;
    float x = (r - s.z)/sb.x;
    float ring = exp(-x*x);
    push += d/r*ring*s.w*1.5;
    heat += ring*s.w*0.4;
  }
  for (int i = 0; i < 8; i++){
    if (i >= uNStirs) break;
    vec4 s = uStirs[i];
    vec2 d = wrapD(p - s.xy);
    push += s.zw*exp(-dot(d, d)/(uStirR*uStirR))*0.8;
  }
  float spd = uPhys.w*(0.8 + 0.4*fract(seed*7.7))*(1.0 + uAudio.x*0.8);
  p += (dir*spd + push)*uDt;
  if (uIntro.y > 0.5){
    p = (vec2(hash13(vec3(seed, 3.0, 1.0)), hash13(vec3(seed, 4.0, 2.0))) - 0.5)*uW;
    ang = hash13(vec3(seed, 5.0, 3.0))*6.2831853;
  }
  heat *= exp(-uDt*2.0);
  oPos = vec4(wrapD(p), ang, seed);
  oVel = vec4(dir*spd, 0.0, heat);
}
// one step of the chaos game (Draves & Reckase's fractal flame)
void flame(vec4 P, vec4 V){
  float seed = P.w;
  vec2 p = rot2(P.xy/uFlame.x, -uFlame.y);
  float pick = hash13(vec3(seed*13.1, uTime, 7.0));
  int k = 0;
  for (int i = 0; i < 4; i++){ if (i >= uNXf) break; k = i; if (pick <= uXf[i*5 + 1].z) break; }
  vec4 A = uXf[k*5], B = uXf[k*5 + 1], V0 = uXf[k*5 + 2], V1 = uXf[k*5 + 3], V2 = uXf[k*5 + 4];
  vec2 q = vec2(A.x*p.x + A.y*p.y + B.x, A.z*p.x + A.w*p.y + B.y);
  float r2 = dot(q, q) + 1e-6, r = sqrt(r2), th = atan(q.x, q.y);
  float om = hash13(vec3(seed, uTime, 3.0)) < 0.5 ? 0.0 : 3.14159265;
  vec2 o = V0.x*q + V0.y*sin(q) + V0.z*q/r2
         + V0.w*vec2(q.x*sin(r2) - q.y*cos(r2), q.x*cos(r2) + q.y*sin(r2))
         + V1.x*vec2((q.x - q.y)*(q.x + q.y), 2.0*q.x*q.y)/r
         + V1.y*vec2(th/3.14159265, r - 1.0)
         + V1.z*r*vec2(sin(th*r), -cos(th*r))
         + V1.w*(th/3.14159265)*vec2(sin(3.14159265*r), cos(3.14159265*r))
         + V2.x*vec2(cos(th) + sin(r), sin(th) - cos(r))/r
         + V2.y*sqrt(r)*vec2(cos(th*0.5 + om), sin(th*0.5 + om));
  float col = mix(V.w, B.w, 0.5);
  bool bad = any(isnan(o)) || any(isinf(o)) || abs(o.x) > 40.0 || abs(o.y) > 40.0;
  if (bad || hash13(vec3(vUv*311.7, uTime)) < 0.004){
    o = vec2(hash13(vec3(seed, uTime, 1.0)), hash13(vec3(seed, uTime, 2.0)))*2.0 - 1.0;
  }
  vec2 pw = rot2(o, uFlame.y)*uFlame.x;
  // a shockwave scatters the flame for a moment
  for (int i = 0; i < 24; i++){
    if (i >= uNShocks) break;
    vec4 s = uShocks[i]; vec4 sb = uShocksB[i];
    vec2 d = wrapD(pw - s.xy);
    float rr = length(d) + 1e-4;
    float x = (rr - s.z)/sb.x;
    pw += d/rr*exp(-x*x)*s.w*0.25;
  }
  oPos = vec4(wrapD(pw), mix(-1.4, 0.4, col), seed);
  oVel = vec4(wrapD(pw - P.xy), 0.0, col);
}
// strange attractor: every grain is iterated through the Clifford map once per frame, so together
// they paint its true density; the shape itself morphs as the parameters drift
void attractor(vec4 P, vec4 V){
  float sc = 6.5, seed = P.w;
  vec2 q = P.xy/sc;
  vec2 o = vec2(sin(uAttr.x*q.y) + uAttr.z*cos(uAttr.x*q.x), sin(uAttr.y*q.x) + uAttr.w*cos(uAttr.y*q.y));
  if (hash13(vec3(vUv*217.3, uTime)) < 0.003) o = vec2(hash13(vec3(seed, uTime, 1.0)), hash13(vec3(seed, uTime, 2.0)))*4.0 - 2.0;
  vec2 pw = o*sc;
  for (int i = 0; i < 8; i++){
    if (i >= uNWells) break;
    vec4 w = uWells[i];
    vec2 d = wrapD(w.xy - pw);
    float r2 = dot(d, d);
    pw += d*clamp(w.z*0.04/(r2 + 0.5), 0.0, 0.6);
  }
  for (int i = 0; i < 24; i++){
    if (i >= uNShocks) break;
    vec4 s = uShocks[i]; vec4 sb = uShocksB[i];
    vec2 d = wrapD(pw - s.xy);
    float rr = length(d) + 1e-4;
    float x = (rr - s.z)/sb.x;
    pw += d/rr*exp(-x*x)*s.w*0.25;
  }
  for (int i = 0; i < 8; i++){
    if (i >= uNStirs) break;
    vec4 s = uStirs[i];
    vec2 d = wrapD(pw - s.xy);
    pw += s.zw*exp(-dot(d, d)/(uStirR*uStirR))*0.05;
  }
  float travel = length(wrapD(pw - P.xy));
  oPos = vec4(wrapD(pw), mix(-1.2, 0.5, fract(seed*7.3)), seed);
  oVel = vec4(wrapD(pw - P.xy)*0.05, 0.0, clamp(travel/12.0, 0.0, 1.0));
}
void main(){
  vec4 P = texture(uPos, vUv);
  vec4 V = texture(uVel, vUv);
  if (uMode == 1){ physarum(P, V); return; }
  if (uMode == 3){ attractor(P, V); return; }
  if (uMode == 4){ flame(P, V); return; }
  vec2 p = P.xy, v = V.xy;
  float z = P.z, vz = V.z, seed = P.w, heat = V.w;
  float dt = uDt;
  float drag = uLaw2.x;

  vec2 flow = curlF(p, uFlowT) * uLaw.x * 2.6 * (1.0 + uAudio.y*0.9);
  // a little compression so dust gathers into veins and filaments instead of a uniform fog
  {
    float e = 0.2;
    vec2 gp = vec2(psi(p + vec2(e, 0.0), uFlowT) - psi(p - vec2(e, 0.0), uFlowT),
                   psi(p + vec2(0.0, e), uFlowT) - psi(p - vec2(0.0, e), uFlowT))/(2.0*e);
    flow -= gp * uLaw.x * 1.8;
  }
  vec2 dc = wrapD(p);
  float rc = length(dc) + 1e-4;
  flow += vec2(-dc.y, dc.x)/rc * uLaw.y * 1.3 * rc/(rc + 3.0);
  vec2 acc = vec2(0.0);

  // gravity wells: stars, orbs, the one you are charging
  for (int i = 0; i < 16; i++){
    if (i >= uNWells) break;
    vec4 w = uWells[i]; vec4 wb = uWellsB[i];
    vec2 d = wrapD(w.xy - p);
    float r2 = dot(d, d), r = sqrt(r2) + 1e-4;
    float g = w.z * uLaw.w * (1.0 + uAudio.x*0.8) / (r2 + wb.x*wb.x);
    acc += d/r * g + vec2(-d.y, d.x)/r * w.w * g;
    if (wb.y > 0.0 && r < wb.w){
      // jets: matter that falls into a star's heart is thrown out along its axis
      float side = hash13(vec3(seed*17.0, uTime, 3.0)) < 0.5 ? -1.0 : 1.0;
      vec2 ax = vec2(cos(wb.z), sin(wb.z));
      vec2 sp = vec2(-ax.y, ax.x) * (hash13(vec3(seed, uTime, 9.0)) - 0.5) * 0.6;
      v = (ax*side + sp) * wb.y * (0.7 + 0.6*hash13(vec3(seed, 2.0, uTime)));
      p = w.xy - d*0.2;
      heat = 1.6;
    }
  }

  // cymatics: dust migrates to the silent nodal lines of a Chladni plate
  {
    // cymatics: the plate's figure is the sum of every mode that is sounding
    float f = 0.0; vec2 df = vec2(0.0); float amp = 0.0;
    float k = 6.2831853/uW;
    for (int i = 0; i < 4; i++){
      vec4 md = uModes[i];
      if (md.z < 0.001) continue;
      float a = md.x*k, b = md.y*k;
      f += md.z*(cos(a*p.x)*cos(b*p.y) - cos(b*p.x)*cos(a*p.y));
      df += md.z*vec2(-a*sin(a*p.x)*cos(b*p.y) + b*sin(b*p.x)*cos(a*p.y),
                      -b*cos(a*p.x)*sin(b*p.y) + a*cos(b*p.x)*sin(a*p.y));
      amp += md.z;
    }
    if (amp > 0.001){
      float cymA = uLaw.z;
      acc -= 2.0*f*df*cymA*0.5;
      float jit = abs(f)*cymA*0.6;
      v += (vec2(hash13(vec3(seed, uTime, 1.0)), hash13(vec3(seed, uTime, 2.0))) - 0.5)*jit;
    }
  }

  // fluid: the dust is carried by a real Navier-Stokes velocity field
  if (uMode == 5) flow = texture(uFluid, p/uW + 0.5).xy*1.1 + flow*0.1;
  // ripple tank: the dust slides off wave crests and bobs with the surface
  if (uMode == 6){
    float e = 0.12;
    float hx = texture(uFluid, (p + vec2(e, 0.0))/uW + 0.5).x - texture(uFluid, (p - vec2(e, 0.0))/uW + 0.5).x;
    float hy = texture(uFluid, (p + vec2(0.0, e))/uW + 0.5).x - texture(uFluid, (p - vec2(0.0, e))/uW + 0.5).x;
    flow = -vec2(hx, hy)/(2.0*e)*2.5 + flow*0.3;
    heat += abs(texture(uFluid, p/uW + 0.5).x)*dt*2.0;
  }
  flow += uTilt;
  // orbital rings: dust circles the sun in bands, like a ring system
  if (uMode == 2){
    vec2 d = wrapD(p - uSun.xy);
    float r = length(d) + 1e-3;
    vec2 tang = vec2(-d.y, d.x)/r;
    flow += tang*sqrt(uSun.z/pow(r, uRing.y - 1.0))*0.9;
    acc += -d/r*sin(6.2831853*r/uSun.w)*uRing.x*1.5;
    acc += -d/r*smoothstep(13.0, 18.0, r)*2.0;
  }

  // shockwaves: rings that push and heat
  for (int i = 0; i < 24; i++){
    if (i >= uNShocks) break;
    vec4 s = uShocks[i]; vec4 sb = uShocksB[i];
    vec2 d = wrapD(p - s.xy);
    float r = length(d) + 1e-4;
    float x = (r - s.z)/sb.x;
    float ring = exp(-x*x);
    v += d/r * ring * s.w * dt * 9.0;
    vz += ring * s.w * sb.z * dt * 4.0;
    heat += ring * s.w * sb.y * dt * 5.0;
  }

  // stirring: your drag drags the medium
  for (int i = 0; i < 8; i++){
    if (i >= uNStirs) break;
    vec4 s = uStirs[i];
    vec2 d = wrapD(p - s.xy);
    float g = exp(-dot(d, d)/(uStirR*uStirR));
    v = mix(v, s.zw, clamp(g*dt*9.0, 0.0, 1.0));
    heat += g * length(s.zw) * dt * 0.25;
  }

  // your presence: a small eddy that follows you
  vec2 dcur = wrapD(p - uCursor.xy);
  float gc = exp(-dot(dcur, dcur)/(uCursor.w*uCursor.w));
  acc += vec2(-dcur.y, dcur.x) * gc * uCursor.z * 1.5 - dcur*gc*uCursor.z*0.15;

  // the sleeping seed before the first breath
  if (uIntro.x > 0.001){
    vec2 d = wrapD(p - uIntro.zw);
    float r = length(d) + 1e-4;
    vec2 tang = vec2(-d.y, d.x)/r;
    vec2 iflow = tang * 2.2 * r/(r + 0.7) + curlF(p*1.7, uFlowT*2.0) * 0.35;
    flow = mix(flow, iflow, uIntro.x);
    acc += -d/r * smoothstep(1.6, 3.6, r) * 4.0 * uIntro.x;
  }

  v += (flow - v) * (1.0 - exp(-drag*dt));
  v += acc*dt;
  if (uIntro.y > 0.5){
    vec2 d = wrapD(p - uIntro.zw);
    float r = length(d) + 1e-4;
    float u = hash13(vec3(seed*91.7, 3.1, 7.7));
    v = d/r * drag * 19.0 * sqrt(u) * (0.85 + 0.3*hash13(vec3(seed, 1.0, 2.0)));
    vz += (hash13(vec3(seed, 5.0, 1.0)) - 0.5)*3.0;
    heat = 0.6;
  }
  float sp = length(v);
  if (sp > 30.0) v *= 30.0/sp;

  float zHome = mix(-2.6, 0.8, fract(seed*13.7));
  vz += (zHome - z)*0.35*dt;
  vz *= exp(-dt*0.8);
  z += vz*dt;
  p += v*dt;

  heat *= exp(-dt*1.3);
  heat += uAudio.z * 0.9 * dt * step(0.97, hash13(vec3(seed, floor(uTime*8.0), 4.0)));

  if (hash13(vec3(vUv*517.3, uTime)) < dt*uRespawn){
    p = (vec2(hash13(vec3(seed, uTime, 11.0)), hash13(vec3(seed, uTime, 12.0))) - 0.5)*uW;
    v = vec2(0.0);
    z = zHome;
    heat = 0.0;
  }
  oPos = vec4(wrapD(p), z, seed);
  oVel = vec4(v, vz, heat);
}
`;

  // ---------------------------------------------------------------- particle render
  C.SH.dustVS = H + ROT + `
uniform sampler2D uPos, uVel, uNut;
uniform int uTexW;
uniform vec2 uCam;
uniform float uCamH, uRoll, uW, uPxScale, uFocus, uBright;
uniform mat4 uProj;
uniform vec3 uPal0, uPal1, uPal2, uPal3;
uniform int uMode;
out vec3 vCol;
void main(){
  int id = gl_VertexID;
  ivec2 tc = ivec2(id % uTexW, id / uTexW);
  vec4 P = texelFetch(uPos, tc, 0);
  vec4 V = texelFetch(uVel, tc, 0);
  if (uMode == 1) P.z = -0.02;
  vec2 rel = P.xy - uCam;
  rel -= uW*floor(rel/uW + 0.5);
  rel = rot2(rel, uRoll);
  vec3 vp = vec3(rel, P.z - uCamH);
  gl_Position = uProj * vec4(vp, 1.0);
  float dist = max(-vp.z, 0.01);
  float s = fract(P.w*7.31);
  float size = mix(0.016, 0.05, s*s);
  float coc = abs(P.z - uFocus)*0.028;
  float ws = size + coc;
  float px = ws*uPxScale/dist;
  float bright = (size*size)/(ws*ws);
  if (px < 1.5){ bright *= (px*px)/2.25; px = 1.5; }
  px = min(px, 28.0);
  gl_PointSize = px;
  float speed = length(V.xy);
  float heat = V.w;
  vec3 c = mix(uPal0, uPal1, smoothstep(0.4, 3.5, speed));
  c = mix(c, uPal2, clamp(heat*0.45, 0.0, 1.0));
  if (fract(P.w*13.37) < 0.06) c = uPal3*1.4;
  if (uMode == 4 || uMode == 3){
    float ci = clamp(V.w, 0.0, 1.0);
    c = ci < 0.33 ? mix(uPal0, uPal1, ci*3.0) : ci < 0.66 ? mix(uPal1, uPal2, (ci - 0.33)*3.0) : mix(uPal2, uPal3*1.2, (ci - 0.66)*3.0);
    heat = 0.2;
  }
  float nut = texture(uNut, P.xy/uW + 0.5).r;
  float b = uBright * (0.3 + nut*1.4) * (1.0 + heat*1.2) * bright * (0.55 + 0.9*s);
  b *= smoothstep(0.35*uCamH, 0.95*uCamH, dist) * mix(0.4, 1.0, smoothstep(-2.6, 0.2, P.z));
  vCol = c*b;
}
`;
  C.SH.dustFS = H + `
in vec3 vCol;
out vec4 o;
void main(){
  vec2 q = gl_PointCoord*2.0 - 1.0;
  float d2 = dot(q, q);
  if (d2 > 1.0) discard;
  o = vec4(vCol*exp(-d2*4.0), 1.0);
}
`;

  // trail persistence with camera reprojection
  C.SH.trailFS = H + ROT + `
uniform sampler2D uPrev;
uniform float uDecay;
uniform vec4 uRep;   // cam - camPrev (wrapped), roll, rollPrev
uniform vec3 uRep2;  // viewH, viewHPrev, aspect
in vec2 vUv;
out vec4 o;
void main(){
  vec2 ndc = vUv*2.0 - 1.0;
  vec2 rr = vec2(ndc.x*uRep2.z, ndc.y)*uRep2.x*0.5;
  vec2 rel = rot2(rr, -uRep.z) + uRep.xy;
  vec2 rrp = rot2(rel, uRep.w);
  vec2 uvp = rrp/(vec2(uRep2.z, 1.0)*uRep2.y*0.5)*0.5 + 0.5;
  if (uvp.x < 0.0 || uvp.y < 0.0 || uvp.x > 1.0 || uvp.y > 1.0){ o = vec4(0.0); return; }
  o = vec4(texture(uPrev, uvp).rgb*uDecay, 1.0);
}
`;

  C.SH.copyFS = H + `
uniform sampler2D uSrc;
uniform float uGain;
in vec2 vUv;
out vec4 o;
void main(){ o = vec4(texture(uSrc, vUv).rgb*uGain, 1.0); }
`;

  // ---------------------------------------------------------------- nebula / background
  C.SH.nebulaFS = H + ROT + `
uniform sampler2D uNoise, uNut;
uniform vec2 uCam;
uniform float uCamH, uRoll, uW, uTanHalf, uAspect, uTime, uNebAmt;
uniform vec3 uDeep, uMid, uHot, uAcc;
uniform vec4 uAudio;
in vec2 vUv;
out vec4 o;
vec2 planeAt(vec2 ndc, float z){
  float depth = uCamH - z;
  vec2 rr = vec2(ndc.x*uAspect, ndc.y)*uTanHalf*depth;
  return uCam + rot2(rr, -uRoll);
}
float hashI(ivec2 p){
  uint x = uint(p.x)*1597334677u ^ uint(p.y)*3812015801u;
  x = (x ^ (x >> 16u))*2246822519u;
  x ^= x >> 13u;
  return float(x)/4294967295.0;
}
void main(){
  vec2 ndc = vUv*2.0 - 1.0;
  vec2 p0 = planeAt(ndc, 0.0);
  vec2 p1 = planeAt(ndc, -6.0);
  vec2 p2 = planeAt(ndc, -16.0);
  float nut = texture(uNut, p0/uW + 0.5).r;
  vec4 n1 = texture(uNoise, p1/uW*2.0 + vec2(uTime*0.0015, 0.0));
  vec4 n2 = texture(uNoise, p1/uW*5.0 - vec2(0.0, uTime*0.002));
  float neb = smoothstep(-0.25, 0.95, n1.x*0.7 + n2.y*0.4);
  float neb2 = smoothstep(0.1, 1.0, n1.z*0.6 + n2.w*0.5);
  float breath = 1.0 + uAudio.x*0.5;
  vec3 col = uDeep*(0.7 + 0.3*n2.x);
  col += uMid*neb*neb*0.055*uNebAmt*breath + uAcc*neb2*neb*0.03*uNebAmt;
  col += uMid*nut*0.06 + uHot*nut*nut*0.035;
  vec2 sp = p2/uW*256.0;
  ivec2 ci = ivec2(floor(sp));
  ci = ((ci % 256) + 256) % 256;
  vec2 f = fract(sp);
  float h = hashI(ci);
  if (h > 0.93){
    vec2 c = vec2(hashI(ci + ivec2(7, 3)), hashI(ci + ivec2(1, 9)))*0.6 + 0.2;
    float d = length(f - c);
    float tw = 0.55 + 0.45*sin(uTime*(0.6 + h*2.5) + h*80.0);
    vec3 sc = mix(vec3(0.7, 0.8, 1.0), mix(uHot, uAcc, h), 0.35);
    col += sc*exp(-d*d*90.0)*tw*(h - 0.93)*9.0;
  }
  o = vec4(col, 1.0);
}
`;

  // ---------------------------------------------------------------- singers (instanced)
  C.SH.singerVS = H + ROT + `
layout(location=0) in vec2 aCorner;
layout(location=1) in vec4 iA; // x, y, size, heading
layout(location=2) in vec4 iB; // rgb, alpha
layout(location=3) in vec4 iC; // lobes, pulse, spike, seed
layout(location=4) in vec4 iD; // glow, hover, notes, squash
uniform vec2 uCam;
uniform float uCamH, uRoll, uW;
uniform mat4 uProj;
out vec2 vQ;
out vec4 vB;
out vec4 vC;
out vec4 vD;
void main(){
  vec2 rel = iA.xy - uCam;
  rel -= uW*floor(rel/uW + 0.5);
  float R = iA.z*2.6;
  vec2 fwd = vec2(cos(iA.w), sin(iA.w));
  vec2 side = vec2(-fwd.y, fwd.x);
  float sq = iD.w;
  vec2 off = (fwd*aCorner.y*(1.0 + sq) + side*aCorner.x*(1.0 - sq*0.4))*R;
  vec2 pos = rot2(rel + off, uRoll);
  gl_Position = uProj*vec4(pos, -uCamH, 1.0);
  vQ = aCorner*2.6;
  vB = iB; vC = iC; vD = iD;
}
`;
  C.SH.singerFS = H + `
in vec2 vQ;
in vec4 vB;
in vec4 vC;
in vec4 vD;
uniform float uTime;
out vec4 o;
void main(){
  vec2 q = vQ;
  float r = length(q);
  if (r > 2.6) discard;
  float th = atan(q.y, q.x);
  float lobes = vC.x, pulse = vC.y, spike = vC.z, seed = vC.w;
  float glowE = vD.x, hover = vD.y, nN = vD.z;
  float t = uTime + seed*10.0;
  float contract = 1.0 - 0.22*pulse;
  float edge = contract*(1.0 + (0.05 + 0.12*spike)*sin(lobes*th + t*0.6) + 0.025*sin(2.0*lobes*th - t*1.3));
  float inside = smoothstep(edge, edge - 0.2, r);
  float rim = exp(-pow((r - edge)/0.05, 2.0));
  float canal = pow(abs(cos(lobes*0.5*th + 0.3*sin(t*0.5))), 24.0) * smoothstep(edge, 0.25, r) * smoothstep(0.1, 0.35, r);
  float ringIn = exp(-pow((r - 0.5*contract)/0.06, 2.0));
  float seg = 6.2831853/lobes;
  float a = mod(th + t*0.1, seg) - seg*0.5;
  float br = edge*0.86;
  float bead = exp(-((r - br)*(r - br) + (r*a)*(r*a))/0.006);
  float core = 0.0;
  for (int k = 0; k < 3; k++){
    if (float(k) >= nN) break;
    float ang = float(k)*6.2831853/max(nN, 1.0) + t*0.8;
    vec2 cp = nN > 1.5 ? vec2(cos(ang), sin(ang))*0.24 : vec2(0.0);
    vec2 dq = q - cp;
    core += exp(-dot(dq, dq)*22.0);
  }
  float halo = exp(-r*r*1.1)*0.12;
  vec3 col = vB.rgb;
  vec3 hot = mix(col, vec3(1.0), 0.55);
  vec3 c = col*(inside*0.07 + rim*0.5 + canal*0.3 + ringIn*0.22 + halo*(0.4 + glowE))
         + hot*(core*(0.65 + 2.2*pulse) + bead*(0.35 + pulse));
  c *= 1.0 + glowE*0.8;
  c += vec3(1.0)*exp(-pow((r - edge*1.45)/0.05, 2.0))*hover*0.6;
  c += col*exp(-pow((r - edge*(1.0 + pulse*0.8))/0.12, 2.0))*pulse*0.6;
  o = vec4(c*vB.a, 1.0);
}
`;

  // ---------------------------------------------------------------- sprites: rings, glows, stars, wisp
  C.SH.spriteVS = H + ROT + `
layout(location=0) in vec2 aCorner;
layout(location=1) in vec4 iA; // x, y, z, radius
layout(location=2) in vec4 iB; // rgb, alpha
layout(location=3) in vec4 iC; // type, p1, p2, p3
uniform vec2 uCam;
uniform float uCamH, uRoll, uW;
uniform mat4 uProj;
out vec2 vQ;
out vec4 vB;
out vec4 vC;
void main(){
  vec2 rel = iA.xy - uCam;
  rel -= uW*floor(rel/uW + 0.5);
  vec2 pos = rot2(rel + aCorner*iA.w, uRoll);
  gl_Position = uProj*vec4(pos, iA.z - uCamH, 1.0);
  vQ = aCorner;
  vB = iB; vC = iC;
}
`;
  C.SH.spriteFS = H + `
in vec2 vQ;
in vec4 vB;
in vec4 vC;
uniform float uTime;
out vec4 o;
void main(){
  vec2 q = vQ;
  float r = length(q);
  if (r > 1.0) discard;
  float type = vC.x;
  float a = 0.0;
  vec3 c = vB.rgb;
  float fade = smoothstep(1.0, 0.8, r);
  if (type < 0.5){
    float d = (r - 0.8)/max(vC.y, 0.004);
    a = exp(-d*d);
  } else if (type < 1.5){
    a = exp(-r*r*vC.y);
  } else if (type < 2.5){
    float m = vC.y;
    float core = exp(-r*r*500.0)*3.0 + exp(-r*r*70.0)*0.9 + exp(-r*7.0)*0.22;
    float ro = vC.z;
    vec2 rq = vec2(cos(ro)*q.x - sin(ro)*q.y, sin(ro)*q.x + cos(ro)*q.y);
    float spikes = (exp(-abs(rq.y)*120.0)*exp(-abs(rq.x)*5.0) + exp(-abs(rq.x)*120.0)*exp(-abs(rq.y)*5.0))*0.3;
    float ang = atan(q.y, q.x);
    float disk = exp(-pow((r - 0.17)/0.06, 2.0))*(0.5 + 0.5*sin(ang*3.0 - uTime*4.0 + r*40.0))*min(m, 1.5)*0.5;
    a = core + spikes + disk;
    c = mix(vB.rgb, vec3(1.0), clamp(exp(-r*r*150.0), 0.0, 1.0)*0.8);
  } else {
    a = exp(-r*r*22.0)*1.1 + exp(-r*r*3.5)*0.12;
    c = mix(vB.rgb, vec3(1.0), exp(-r*r*70.0));
  }
  o = vec4(c*a*vB.a*fade, 1.0);
}
`;

  // ---------------------------------------------------------------- ribbons (tails, serpents)
  C.SH.ribbonVS = H + ROT + `
layout(location=0) in vec3 aPos;   // camera-relative
layout(location=1) in float aSide;
layout(location=2) in vec4 aCol;
uniform float uCamH, uRoll;
uniform mat4 uProj;
out float vSide;
out vec4 vCol;
void main(){
  vec2 pos = rot2(aPos.xy, uRoll);
  gl_Position = uProj*vec4(pos, aPos.z - uCamH, 1.0);
  vSide = aSide;
  vCol = aCol;
}
`;
  C.SH.ribbonFS = H + `
in float vSide;
in vec4 vCol;
out vec4 o;
void main(){ o = vec4(vCol.rgb*vCol.a*exp(-vSide*vSide*2.8), 1.0); }
`;

  // ---------------------------------------------------------------- orbs: worlds within worlds
  C.SH.orbVS = H + ROT + `
layout(location=0) in vec2 aCorner;
uniform vec2 uCam, uOrbPos;
uniform float uCamH, uRoll, uW, uOrbR;
uniform mat4 uProj;
out vec2 vQ;
void main(){
  vec2 rel = uOrbPos - uCam;
  rel -= uW*floor(rel/uW + 0.5);
  vec2 pos = rot2(rel + aCorner*uOrbR*1.7, uRoll);
  gl_Position = uProj*vec4(pos, -uCamH, 1.0);
  vQ = rot2(aCorner*1.7, uRoll);
}
`;
  C.SH.orbFS = H + SNOISE2 + `
in vec2 vQ;
uniform vec3 uC1, uC2, uC3;
uniform float uSeed, uHover, uTime, uBorn;
uniform int uGenus;
out vec4 o;
void main(){
  vec2 q = vQ;
  float r = length(q);
  vec3 col = vec3(0.0);
  float alpha = 0.0;
  if (r < 1.0){
    float z = sqrt(1.0 - r*r);
    vec3 n = vec3(q, z);
    float fres = pow(1.0 - z, 2.2);
    vec2 uv = q*(1.0 + 0.5*(1.0 - z));
    float t = uTime*0.12 + uSeed;
    float ang = atan(uv.y, uv.x), rr = length(uv);
    float sw = ang + rr*2.5 - t*1.3;
    vec2 sp = vec2(cos(sw), sin(sw))*rr;
    float f1 = snoise2(sp*2.2 + vec2(uSeed*3.1, t));
    float f2 = snoise2(uv*4.0 - vec2(t*0.7, uSeed));
    float neb = smoothstep(-0.3, 1.0, f1*0.65 + f2*0.35);
    // each orb shows a miniature of the kind of universe inside it
    if (uGenus == 1) neb = pow(1.0 - abs(snoise2(uv*3.0 + vec2(uSeed, t*0.3))), 6.0) + 0.6*pow(1.0 - abs(f2), 8.0);
    else if (uGenus == 2) neb = pow(0.5 + 0.5*cos(rr*28.0 - t*2.0), 6.0)*smoothstep(0.08, 0.2, rr) + exp(-rr*rr*60.0)*2.0;
    else if (uGenus == 3) neb = smoothstep(0.1, 0.35, snoise2(uv*5.0 + vec2(uSeed, t*0.2)));
    else if (uGenus == 4){
      float cl = cos(5.0*uv.x*3.14)*cos(8.0*uv.y*3.14) - cos(8.0*uv.x*3.14)*cos(5.0*uv.y*3.14 + sin(t)*0.5);
      neb = exp(-abs(cl)*12.0);
    }
    else if (uGenus == 5) neb = pow(abs(sin(uv.x*5.0 + sin(uv.y*4.0 + t)*2.2)), 14.0) + pow(abs(sin(uv.y*6.0 + sin(uv.x*3.0 - t)*2.0)), 14.0);
    else if (uGenus == 6) neb = pow(0.5 + 0.5*sin(ang*3.0 + log(rr + 0.02)*7.0 - t*2.0), 10.0)*smoothstep(0.02, 0.2, rr)*1.5;
    else if (uGenus == 7) neb = smoothstep(0.55, 0.95, sin(uv.x*13.0 + t*0.7)*sin(uv.y*13.0 - t*0.5) + 0.3*snoise2(uv*3.0 + t*0.2));
    else if (uGenus == 8) neb = pow(1.0 - abs(snoise2(uv*2.2 + vec2(t*0.6, 0.0))), 10.0)*1.4;
    else if (uGenus == 9) neb = smoothstep(-0.2, 0.8, snoise2(sp*1.5 + vec2(snoise2(uv*2.0 + t), t)));
    else if (uGenus == 10) neb = pow(0.5 + 0.5*cos(length(uv - vec2(0.3, 0.1))*30.0 - t*4.0) * cos(length(uv + vec2(0.25, 0.2))*30.0 - t*4.0), 3.0);
    else if (uGenus == 11) neb = exp(-abs(length(vec2(sin(ang*3.0 + t), cos(ang*2.0)))*0.5 - rr)*30.0)*1.5;
    else if (uGenus == 12) neb = exp(-pow((rr - 0.45)/0.05, 2.0))*2.0 + smoothstep(0.5, 0.9, rr)*0.4*(0.5 + 0.5*sin(ang*3.0 - t*3.0)) - smoothstep(0.42, 0.3, rr);
    else if (uGenus == 13){ vec2 z = uv*1.6; float it = 0.0; for (int i = 0; i < 24; i++){ z = vec2(z.x*z.x - z.y*z.y, 2.0*z.x*z.y) + vec2(-0.8 + 0.05*sin(t), 0.156); if (dot(z, z) > 4.0) break; it += 1.0; } neb = it/24.0; }
    else if (uGenus == 14) neb = smoothstep(0.9, 1.0, max(abs(fract(ang/6.2831853*6.0) - 0.5), abs(fract(1.0/(rr + 0.05) + t) - 0.5))*2.0)*1.5;
    else if (uGenus == 15) neb = smoothstep(0.3, 0.0, abs(fract(uv.x*3.0) - 0.5)*abs(fract(uv.y*3.0) - 0.5)*8.0)*0.8 + 0.3*snoise2(uv*5.0 + t);
    else if (uGenus == 16) neb = step(0.62, fract(sin(dot(floor(uv*9.0 + floor(t*2.0)*0.0), vec2(12.9898, 78.233)) + floor(t*3.0))*43758.5453))*1.2;
    else if (uGenus == 17) neb = pow(1.0 - abs(snoise2(vec2(uv.x*2.0, uv.y*6.0 + t*3.0))), 18.0)*2.5;
    vec3 inner = mix(uC1*0.2, uC2, clamp(neb, 0.0, 1.5));
    inner += uC3*pow(max(f2, 0.0), 3.0)*(uGenus == 0 ? 1.5 : 0.4);
    vec2 g = uv*14.0 + vec2(t*2.0, 0.0);
    vec2 gi = floor(g), gf = fract(g) - 0.5;
    float h = fract(sin(dot(gi, vec2(12.9898, 78.233)) + uSeed)*43758.5453);
    float st = step(0.82, h)*exp(-dot(gf, gf)*40.0)*(0.5 + 0.5*sin(uTime*3.0 + h*40.0));
    inner += mix(uC3, vec3(1.0), 0.5)*st*1.2;
    inner += uC2*exp(-rr*rr*6.0)*0.6;
    float spec = pow(max(dot(n, normalize(vec3(-0.45, 0.55, 0.7))), 0.0), 60.0);
    col = inner*(0.5 + 0.5*z)*(1.0 + uHover*0.6) + mix(uC2, vec3(1.0), 0.35)*fres*(1.1 + uHover) + vec3(spec)*0.8;
    alpha = mix(0.8, 1.0, fres);
    float edge = smoothstep(1.0, 0.985, r);
    col *= edge;
    alpha *= edge;
  } else {
    float halo = exp(-(r - 1.0)*5.0)*smoothstep(1.7, 1.1, r)*(0.22 + 0.4*uHover);
    col = uC2*halo;
  }
  o = vec4(col*uBorn, alpha*uBorn);
}
`;

  // ---------------------------------------------------------------- bloom + exposure + final
  C.SH.downFS = H + `
uniform sampler2D uSrc;
uniform vec2 uTexel;
uniform float uThreshold;
uniform int uFirst;
in vec2 vUv;
out vec4 o;
vec3 s(vec2 off){ return texture(uSrc, vUv + off*uTexel).rgb; }
void main(){
  vec3 a = s(vec2(-2.0, 2.0)), b = s(vec2(0.0, 2.0)), c = s(vec2(2.0, 2.0));
  vec3 d = s(vec2(-2.0, 0.0)), e = s(vec2(0.0)), f = s(vec2(2.0, 0.0));
  vec3 g = s(vec2(-2.0, -2.0)), h = s(vec2(0.0, -2.0)), i = s(vec2(2.0, -2.0));
  vec3 j = s(vec2(-1.0, 1.0)), k = s(vec2(1.0, 1.0)), l = s(vec2(-1.0, -1.0)), m = s(vec2(1.0, -1.0));
  vec3 col = e*0.125 + (a + c + g + i)*0.03125 + (b + d + f + h)*0.0625 + (j + k + l + m)*0.125;
  if (uFirst == 1){
    float br = max(col.r, max(col.g, col.b));
    float soft = clamp(br - uThreshold + 0.4, 0.0, 0.8);
    soft = soft*soft/(4.0*0.4 + 1e-4);
    float contrib = max(soft, br - uThreshold)/max(br, 1e-4);
    col *= max(contrib, 0.0);
  }
  o = vec4(min(col, vec3(500.0)), 1.0);
}
`;
  C.SH.upFS = H + `
uniform sampler2D uSrc;
uniform vec2 uTexel;
in vec2 vUv;
out vec4 o;
vec3 s(vec2 off){ return texture(uSrc, vUv + off*uTexel).rgb; }
void main(){
  vec3 col = s(vec2(-1.0, 1.0)) + 2.0*s(vec2(0.0, 1.0)) + s(vec2(1.0, 1.0))
           + 2.0*s(vec2(-1.0, 0.0)) + 4.0*s(vec2(0.0)) + 2.0*s(vec2(1.0, 0.0))
           + s(vec2(-1.0, -1.0)) + 2.0*s(vec2(0.0, -1.0)) + s(vec2(1.0, -1.0));
  o = vec4(col/16.0, 1.0);
}
`;
  // average scene luminance into a small grid
  C.SH.lumFS = H + `
uniform sampler2D uScene, uBloom;
uniform float uBloomAmt;
uniform vec2 uCell;
in vec2 vUv;
out vec4 o;
void main(){
  float s = 0.0;
  for (int y = 0; y < 4; y++) for (int x = 0; x < 4; x++){
    vec2 uv = vUv + (vec2(float(x), float(y)) - 1.5)/4.0*uCell;
    vec3 c = texture(uScene, uv).rgb + texture(uBloom, uv).rgb*uBloomAmt;
    s += min(dot(c, vec3(0.2126, 0.7152, 0.0722)), 8.0);
  }
  o = vec4(s/16.0, 0.0, 0.0, 1.0);
}
`;
  // asymmetric adaptation: rises fast (catches flashes), relaxes slowly
  C.SH.adaptFS = H + `
uniform sampler2D uLum, uPrev;
uniform float uDt;
uniform ivec2 uSize;
out vec4 o;
void main(){
  float s = 0.0;
  for (int y = 0; y < 18; y++) for (int x = 0; x < 32; x++){
    if (x >= uSize.x || y >= uSize.y) continue;
    s += texelFetch(uLum, ivec2(x, y), 0).r;
  }
  float L = s/float(uSize.x*uSize.y);
  float prev = texelFetch(uPrev, ivec2(0), 0).r;
  float k = L > prev ? 1.0 - exp(-uDt*14.0) : 1.0 - exp(-uDt*0.9);
  o = vec4(mix(prev, L, k), L, 0.0, 1.0);
}
`;
  C.SH.finalFS = H + `
uniform sampler2D uScene, uBloom, uAdapt;
uniform float uBloomAmt, uExposure, uSafeLum, uCA, uTime, uVig, uGrain;
uniform vec4 uOverlay;
in vec2 vUv;
out vec4 o;
vec3 aces(vec3 x){ return clamp((x*(2.51*x + 0.03))/(x*(2.43*x + 0.59) + 0.14), 0.0, 1.0); }
float hash12(vec2 p){ vec3 p3 = fract(vec3(p.xyx)*0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y)*p3.z); }
void main(){
  vec2 c = vUv - 0.5;
  vec3 col;
  if (uCA > 0.0){
    vec2 off = c*uCA*0.012;
    col = vec3(texture(uScene, vUv + off).r, texture(uScene, vUv).g, texture(uScene, vUv - off).b);
  } else col = texture(uScene, vUv).rgb;
  col += texture(uBloom, vUv).rgb*uBloomAmt;
  float L = texelFetch(uAdapt, ivec2(0), 0).r;
  float lim = min(1.0, uSafeLum/max(L, 1e-4));
  col *= uExposure*lim;
  col = aces(col);
  col *= 1.0 - dot(c, c)*uVig;
  float od = length(c);
  float ov = uOverlay.a*(1.0 - smoothstep(0.0, 0.95, od)*(1.0 - uOverlay.a));
  col = mix(col, uOverlay.rgb, clamp(ov, 0.0, 1.0));
  col = pow(col, vec3(1.0/2.2));
  col += (hash12(vUv*vec2(1920.0, 1080.0) + fract(uTime*7.0)*100.0) - 0.5)*uGrain;
  o = vec4(col, 1.0);
}
`;

  // ---------------------------------------------------------------- slime-mould trail map (world space)
  C.SH.depositVS = H + `
uniform sampler2D uPos;
uniform int uTexW;
uniform float uW, uAmt;
out float vA;
void main(){
  int id = gl_VertexID;
  vec4 P = texelFetch(uPos, ivec2(id % uTexW, id / uTexW), 0);
  gl_Position = vec4(P.xy/uW*2.0, 0.0, 1.0);
  gl_PointSize = 1.0;
  vA = uAmt;
}
`;
  C.SH.depositFS = H + `
in float vA;
out vec4 o;
void main(){ o = vec4(vA, 0.0, 0.0, 1.0); }
`;
  C.SH.diffuseFS = H + `
uniform sampler2D uSrc;
uniform vec2 uTexel;
uniform float uDecay, uW;
uniform vec4 uFood[24];
uniform int uNFood;
in vec2 vUv;
out vec4 o;
vec2 wrapD(vec2 d){ return d - uW*floor(d/uW + 0.5); }
void main(){
  vec4 s = vec4(0.0);
  for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) s += texture(uSrc, vUv + vec2(float(x), float(y))*uTexel);
  s /= 9.0;
  float r = min(s.r*uDecay, 40.0);
  float g = s.g*0.9;
  vec2 wp = (vUv - 0.5)*uW;
  for (int i = 0; i < 24; i++){
    if (i >= uNFood) break;
    vec4 f = uFood[i];
    vec2 d = wrapD(wp - f.xy);
    g += f.z*exp(-dot(d, d)/(f.w*f.w))*0.6;
  }
  o = vec4(r, min(g, 6.0), 0.0, 1.0);
}
`;

  // ---------------------------------------------------------------- reaction-diffusion skin (Gray-Scott)
  C.SH.rdFS = H + `
uniform sampler2D uSrc, uNoise;
uniform vec2 uTexel;
uniform vec4 uFK;
uniform float uW, uTime, uFeedBoost;
uniform vec4 uBrush[12];
uniform int uNBrush;
uniform vec4 uModes[4];
uniform float uCymFeed;
in vec2 vUv;
out vec4 o;
vec2 wrapD(vec2 d){ return d - uW*floor(d/uW + 0.5); }
void main(){
  vec2 c = texture(uSrc, vUv).xy;
  float plateF = 0.0;
  if (uCymFeed > 0.0){
    vec2 pp = (vUv - 0.5)*uW;
    float k = 6.2831853/uW;
    for (int i = 0; i < 4; i++){
      vec4 md = uModes[i];
      if (md.z < 0.001) continue;
      float a = md.x*k, b = md.y*k;
      plateF += md.z*(cos(a*pp.x)*cos(b*pp.y) - cos(b*pp.x)*cos(a*pp.y));
    }
  }
  vec2 n = texture(uSrc, vUv + vec2(0.0, uTexel.y)).xy, s = texture(uSrc, vUv - vec2(0.0, uTexel.y)).xy;
  vec2 e = texture(uSrc, vUv + vec2(uTexel.x, 0.0)).xy, w = texture(uSrc, vUv - vec2(uTexel.x, 0.0)).xy;
  vec2 ne = texture(uSrc, vUv + uTexel).xy, nw = texture(uSrc, vUv + vec2(-uTexel.x, uTexel.y)).xy;
  vec2 se = texture(uSrc, vUv + vec2(uTexel.x, -uTexel.y)).xy, sw = texture(uSrc, vUv - uTexel).xy;
  vec2 lap = -c + 0.2*(n + s + e + w) + 0.05*(ne + nw + se + sw);
  float u = c.x, v = c.y;
  float m = smoothstep(-0.4, 0.6, texture(uNoise, vUv + vec2(uTime*0.0004, 0.0)).x);
  float F = mix(uFK.x, uFK.z, m) + uFeedBoost - abs(plateF)*uCymFeed, K = mix(uFK.y, uFK.w, m);
  float uvv = u*v*v;
  u += lap.x - uvv + F*(1.0 - u);
  v += 0.5*lap.y + uvv - (F + K)*v;
  vec2 wp = (vUv - 0.5)*uW;
  for (int i = 0; i < 12; i++){
    if (i >= uNBrush) break;
    vec4 b = uBrush[i];
    vec2 d = wrapD(wp - b.xy);
    float g = exp(-dot(d, d)/(b.z*b.z));
    if (b.w > 0.0){ v = mix(v, 0.5, clamp(g*b.w, 0.0, 1.0)); u = mix(u, 0.3, clamp(g*b.w, 0.0, 1.0)); }
    else { v = mix(v, 0.0, clamp(-g*b.w, 0.0, 1.0)); u = mix(u, 1.0, clamp(-g*b.w, 0.0, 1.0)); }
  }
  o = vec4(clamp(u, 0.0, 1.0), clamp(v, 0.0, 1.0), 0.0, 1.0);
}
`;

  // ---------------------------------------------------------------- world-space fields drawn onto the scene
  C.SH.fieldFS = H + ROT + `
uniform sampler2D uField;
uniform int uKind;          // 1 mould veins, 2 skin
uniform vec2 uCam, uTexel;
uniform float uCamH, uRoll, uW, uTanHalf, uAspect, uTime, uGain, uRelief;
uniform vec3 uDeep, uMid, uHot, uAcc;
uniform vec4 uScan;         // playhead: x (relative to camera), width, glow, 0
uniform vec4 uP1, uP2, uP3; // per-kind parameters
uniform int uLowQ;          // phones: fewer iterations
uniform sampler2D uNoise;
in vec2 vUv;
out vec4 o;
vec2 wrapW(vec2 d){ return d - uW*floor(d/uW + 0.5); }
float h21(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233)))*43758.5453); }
// a Menger sponge (after Inigo Quilez), each level twisted a little: a cathedral of mirrors
float sdBox(vec3 p, vec3 b){ vec3 q = abs(p) - b; return length(max(q, 0.0)) + min(max(q.x, max(q.y, q.z)), 0.0); }
float kifs(vec3 p, vec4 k){
  float d = sdBox(p, vec3(1.0));
  float s = 1.0;
  for (int m = 0; m < 5; m++){
    if (uLowQ == 1 && m > 3) break;
    p.xy = rot2(p.xy, k.y);
    p.yz = rot2(p.yz, k.z);
    vec3 a = mod(p*s, 2.0) - 1.0;
    s *= k.x;
    vec3 r = abs(1.0 - 3.0*abs(a));
    float da = max(r.x, r.y), db = max(r.y, r.z), dc = max(r.z, r.x);
    d = max(d, (min(da, min(db, dc)) - 1.0)/s);
  }
  return d;
}
void main(){
  vec2 ndc = vUv*2.0 - 1.0;
  vec2 rr = vec2(ndc.x*uAspect, ndc.y)*uTanHalf*uCamH;
  vec2 p = uCam + rot2(rr, -uRoll);
  vec2 uv = p/uW + 0.5;
  vec3 col = vec3(0.0);
  if (uKind == 5){
    // a black hole: the sky behind it is bent around it; its disk glows brighter on the side coming toward you
    vec2 d = wrapW(p - uP1.xy);
    float r = length(d) + 1e-4, Rh = uP1.z;
    vec2 q = p + d/r*(Rh*Rh*2.4/r);
    vec4 n = texture(uNoise, q/uW*3.0 + uTime*0.0008);
    vec3 sky = uDeep*2.0 + uMid*smoothstep(0.25, 1.0, n.x)*0.12 + uAcc*smoothstep(0.5, 1.0, n.z)*0.05;
    vec2 sp = q/uW*260.0;
    vec2 cell = floor(sp), f = fract(sp) - 0.5;
    sky += vec3(0.9, 0.95, 1.0)*step(0.982, h21(cell))*exp(-dot(f, f)*28.0)*1.6;
    vec2 dd = vec2(d.x, d.y/0.3);
    float rd = length(dd), ang = atan(dd.y, dd.x);
    float disk = smoothstep(Rh*1.5, Rh*2.1, rd)*(1.0 - smoothstep(Rh*3.8, Rh*7.5, rd));
    float sw = 0.55 + 0.45*sin(ang*3.0 - uTime*uP1.w*7.0/pow(rd/Rh, 1.5) + texture(uNoise, vec2(rd*0.07, ang*0.25)).x*7.0);
    float dop = 1.0 + 0.75*cos(ang);
    vec3 dcol = mix(uHot, vec3(1.0, 0.86, 0.7), 0.35)*disk*sw*sw*dop*(Rh*2.2/rd)*(0.55 + uP2.x*1.5);
    float back = smoothstep(Rh*1.45, Rh*1.85, r)*(1.0 - smoothstep(Rh*2.3, Rh*3.4, r))*smoothstep(0.0, Rh*0.8, d.y);
    vec3 bcol = uHot*back*0.55*(0.6 + 0.4*sin(atan(d.y, d.x)*5.0 + uTime*uP1.w*2.0));
    float shadow = 1.0 - smoothstep(Rh*0.97, Rh*1.04, r);
    float ring = exp(-pow((r - Rh*1.5)/(Rh*0.05), 2.0));
    vec3 c = sky*(1.0 - shadow) + bcol*(1.0 - shadow) + mix(uAcc, vec3(1.0), 0.5)*ring*(0.7 + uP2.x*2.0);
    col = (dd.y < 0.0 ? c + dcol : c + dcol*(1.0 - shadow))*uGain;
  } else if (uKind == 6){
    // a Julia set: z -> z^2 + c, coloured by how fast each point escapes
    vec2 z = wrapW(p - uP1.xy)/uP1.z;
    vec2 c = uP2.xy;
    int maxI = uLowQ == 1 ? 56 : 110;
    float it = 0.0, trap = 1e9;
    for (int i = 0; i < 128; i++){
      if (i >= maxI) break;
      z = vec2(z.x*z.x - z.y*z.y, 2.0*z.x*z.y) + c;
      trap = min(trap, abs(length(z) - 0.6));
      if (dot(z, z) > 256.0) break;
      it += 1.0;
    }
    if (it >= float(maxI) - 0.5) col = uDeep*2.5 + uAcc*exp(-trap*16.0)*0.9 + uHot*exp(-trap*40.0)*0.6;
    else {
      float sm = it - log2(log2(dot(z, z))) + 4.0;
      float k = sm/float(maxI);
      vec3 cyc = 0.5 + 0.5*cos(6.2831853*(k*2.5 + uTime*0.02 + vec3(0.0, 0.33, 0.67)));
      col = mix(uMid, uHot, cyc.x)*cyc*1.3*pow(clamp(k*1.6, 0.0, 1.0), 0.5);
    }
    col *= uGain;
  } else if (uKind == 7){
    // a hyperspace tunnel: polar coordinates fold the plane into an endless corridor
    vec2 rel = wrapW(p - uP1.xy)/uP1.z;
    float a = atan(rel.y, rel.x) + uP2.y;
    float r = length(rel) + 1e-3;
    float sides = uP2.x, seg = 6.2831853/sides;
    float pr = r*cos(mod(a, seg) - seg*0.5)/cos(seg*0.5);
    float depth = 1.0/pr + uP1.w;
    vec2 tuv = vec2(a/6.2831853*sides, depth);
    float g = max(abs(fract(tuv.x) - 0.5), abs(fract(tuv.y*1.5) - 0.5))*2.0;
    float grid = smoothstep(0.86, 1.0, g);
    float n = texture(uNoise, vec2(tuv.x*0.07, tuv.y*0.04)).x;
    float fog = smoothstep(0.02, 0.45, pr);
    vec3 c1 = mix(uMid, uHot, 0.5 + 0.5*sin(depth*1.1));
    vec3 c2 = mix(uAcc, uMid, n*0.5 + 0.5);
    col = (c1*grid*1.4 + c2*smoothstep(0.35, 0.95, n)*0.3)*fog*(1.0 + uP2.z*1.8) + mix(uHot, vec3(1.0), 0.5)*exp(-pr*pr*60.0)*1.2;
    col *= uGain;
  } else if (uKind == 8){
    // a cathedral of mirrors: a real 3D fractal, ray-marched
    vec2 sc = rr/(uTanHalf*uCamH*2.0);
    float dist = 2.6 + 4.0*clamp(uCamH/14.0, 0.02, 3.0);
    float yaw = uP2.x + uCam.x*0.08, pitch = uP2.y + uCam.y*0.05;
    vec3 ro = vec3(sin(yaw)*cos(pitch), sin(pitch), cos(yaw)*cos(pitch))*dist;
    vec3 fw = normalize(-ro), rt = normalize(cross(vec3(0.0, 1.0, 0.0), fw)), up = cross(fw, rt);
    vec3 rd = normalize(fw*1.05 + rt*sc.x + up*sc.y);
    int maxS = uLowQ == 1 ? 42 : 80;
    float t = 0.0, glow = 0.0, hit = 0.0, st = 0.0;
    for (int i = 0; i < 96; i++){
      if (i >= maxS) break;
      float d = kifs(ro + rd*t, uP3);
      glow += exp(-d*25.0);
      if (d < 0.0012*t){ hit = 1.0; break; }
      t += d*0.85;
      st += 1.0;
      if (t > 14.0) break;
    }
    float ao = 1.0 - st/float(maxS);
    vec3 pos = ro + rd*t;
    float band = exp(-pow(t - uP2.w, 2.0)*6.0);
    if (hit > 0.5){
      vec2 e = vec2(0.0015, 0.0);
      vec3 n = normalize(vec3(kifs(pos + e.xyy, uP3) - kifs(pos - e.xyy, uP3), kifs(pos + e.yxy, uP3) - kifs(pos - e.yxy, uP3), kifs(pos + e.yyx, uP3) - kifs(pos - e.yyx, uP3)));
      vec3 Ld = normalize(vec3(0.6, 0.8, -0.4));
      float dif = clamp(dot(n, Ld), 0.0, 1.0), rim = pow(1.0 - clamp(dot(n, -rd), 0.0, 1.0), 3.0);
      vec3 base = mix(uMid, uHot, 0.5 + 0.5*sin(pos.y*3.0 + uTime*0.2));
      col = base*(0.03 + dif*0.55)*ao + uAcc*rim*0.35*ao + mix(uAcc, vec3(1.0), 0.4)*band*1.4;
    }
    col += uAcc*glow*0.0025;
    col *= uGain;
  } else if (uKind == 10){
    // continuous life: soft bodies, their growing edges lit, a faint wake where they have been
    vec2 q = uv*uP1.x - 0.5, f = fract(q), i0 = (floor(q) + 0.5)/uP1.x, tx = vec2(1.0/uP1.x, 0.0), ty = vec2(0.0, 1.0/uP1.x);
    vec4 cc = mix(mix(texture(uField, i0), texture(uField, i0 + tx), f.x), mix(texture(uField, i0 + ty), texture(uField, i0 + tx + ty), f.x), f.y);
    float v = cc.r, edge = clamp(cc.g, 0.0, 1.0)*smoothstep(0.02, 0.3, v);
    vec3 body = mix(uMid*0.9, uHot, smoothstep(0.25, 0.85, v));
    body = mix(body, vec3(1.0), smoothstep(0.85, 1.0, v)*0.35);
    col = body*smoothstep(0.03, 0.4, v)*1.25 + uAcc*edge*0.6 + uAcc*cc.b*0.07 + uDeep*1.5;
    col *= uGain;
  } else if (uKind == 9){
    // the Game of Life, drawn as glowing tiles that cool as they age
    float N = uP1.x;
    vec2 cu = (floor(uv*N) + 0.5)/N, fr = fract(uv*N) - 0.5;
    vec4 cc = texture(uField, cu);
    float box = smoothstep(0.5, 0.34, max(abs(fr.x), abs(fr.y)));
    vec3 young = mix(uHot, vec3(1.0), 0.3), old = uMid*0.8;
    col = (mix(young, old, clamp(cc.g*0.35, 0.0, 1.0))*cc.r*1.3 + uAcc*cc.b*0.18)*box + uDeep*1.5;
    col *= uGain;
  } else if (uKind == 3){
    // fluid dye, lit by its own gradients
    vec3 d = texture(uField, uv).rgb;
    float l0 = dot(d, vec3(0.3, 0.6, 0.1));
    float lx = dot(texture(uField, uv + vec2(uTexel.x, 0.0)).rgb, vec3(0.3, 0.6, 0.1)) - l0;
    float ly = dot(texture(uField, uv + vec2(0.0, uTexel.y)).rgb, vec3(0.3, 0.6, 0.1)) - l0;
    vec3 n = normalize(vec3(lx, ly, 0.06));
    float diff = clamp(dot(n, normalize(vec3(-0.4, 0.5, 0.8))) + 0.65, 0.6, 1.15);
    col = d*diff*uGain;
  } else if (uKind == 4){
    // ripple tank: a lit, refracting water surface
    float h = texture(uField, uv).x;
    float hx = texture(uField, uv + vec2(uTexel.x, 0.0)).x - texture(uField, uv - vec2(uTexel.x, 0.0)).x;
    float hy = texture(uField, uv + vec2(0.0, uTexel.y)).x - texture(uField, uv - vec2(0.0, uTexel.y)).x;
    vec3 n = normalize(vec3(-hx*uRelief, -hy*uRelief, 1.0));
    vec3 L = normalize(vec3(-0.4, 0.5, 0.75));
    float spec = pow(max(dot(reflect(-L, n), vec3(0.0, 0.0, 1.0)), 0.0), 60.0);
    float caust = texture(uField, uv + n.xy*0.02).x;
    float bend = length(n.xy);
    col = uDeep*1.2 + uMid*clamp(h*1.2 + 0.03, 0.0, 1.2)*0.28 + uHot*clamp(-h, 0.0, 1.0)*0.18
        + uAcc*smoothstep(0.15, 0.7, bend)*0.3 + vec3(spec)*0.8 + uMid*max(caust, 0.0)*0.06;
    col *= uGain;
  } else if (uKind == 1){
    vec4 t = texture(uField, uv);
    float v = 1.0 - exp(-t.r*uGain);
    float core = smoothstep(0.55, 1.0, v);
    col = uMid*v*0.6 + uHot*core*0.35 + uAcc*min(t.g, 3.0)*0.1;
  } else {
    float v = texture(uField, uv).y;
    float vx = texture(uField, uv + vec2(uTexel.x, 0.0)).y - texture(uField, uv - vec2(uTexel.x, 0.0)).y;
    float vy = texture(uField, uv + vec2(0.0, uTexel.y)).y - texture(uField, uv - vec2(0.0, uTexel.y)).y;
    vec3 L = normalize(vec3(-0.5, 0.6, 0.6));
    vec3 nrm = normalize(vec3(-vx*uRelief*18.0, -vy*uRelief*18.0, 1.0));
    float body = smoothstep(0.14, 0.3, v);
    float edge = smoothstep(0.1, 0.2, v) - smoothstep(0.22, 0.34, v);
    float light = clamp(dot(nrm, L), 0.0, 1.0);
    float spec = pow(max(dot(reflect(-L, nrm), vec3(0.0, 0.0, 1.0)), 0.0), 24.0);
    vec3 flesh = mix(uDeep*2.0, uMid*0.5 + uDeep, body);
    col = flesh*(0.3 + 0.8*light) + uHot*edge*0.55 + vec3(spec)*body*0.22;
    col += uAcc*smoothstep(0.3, 0.45, v)*0.35;
    float sd = abs(rr.x - uScan.x);
    col += mix(uAcc, vec3(1.0), 0.3)*exp(-sd*sd/(uScan.y*uScan.y))*uScan.z*(0.03 + edge*0.9 + body*0.2);
  }
  o = vec4(col, 1.0);
}
`;
  C.SH.boxFS = H + `
uniform sampler2D uSrc;
uniform int uTaps;
uniform vec2 uTexel;
in vec2 vUv;
out vec4 o;
void main(){
  vec2 base = vUv - uTexel*float(uTaps)*0.5;
  vec4 s = vec4(0.0);
  for (int y = 0; y < 16; y++){
    if (y >= uTaps) break;
    for (int x = 0; x < 16; x++){
      if (x >= uTaps) break;
      s += texture(uSrc, base + (vec2(float(x), float(y)) + 0.5)*uTexel);
    }
  }
  o = s/float(uTaps*uTaps);
}
`;

  // ---------------------------------------------------------------- composite: two worlds, one membrane
  C.SH.compositeFS = H + `
uniform sampler2D uA, uB, uNoise;
uniform int uHasB, uStyleA, uStyleB;
uniform vec3 uPalA[4];
uniform vec3 uPalB[4];
uniform vec4 uAp;          // aperture centre (uv), radius (screen heights), t (inner weight)
uniform float uAspect, uTime;
uniform vec2 uRes;
in vec2 vUv;
out vec4 o;
float lum(vec3 c){ return dot(c, vec3(0.2126, 0.7152, 0.0722)); }
float h12(vec2 p){ vec3 p3 = fract(vec3(p.xyx)*0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y)*p3.z); }
vec2 h22(vec2 p){ return vec2(h12(p), h12(p + 17.31)); }
float bayer(vec2 p){
  ivec2 q = ivec2(mod(p, 4.0));
  int i = q.x + q.y*4;
  int m[16] = int[16](0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5);
  return (float(m[i]) + 0.5)/16.0;
}
vec3 styled(sampler2D tex, int s, vec2 uv, vec3 P0, vec3 P1, vec3 P2, vec3 P3){
  if (s == 2){
    // kaleidoscope: the world folded into six mirrored wedges
    vec2 c = (uv - 0.5)*vec2(uAspect, 1.0);
    float a = atan(c.y, c.x) + uTime*0.02, r = length(c);
    float seg = 6.2831853/6.0;
    a = mod(a, seg); a = abs(a - seg*0.5);
    return texture(tex, vec2(cos(a), sin(a))*r/vec2(uAspect, 1.0) + 0.5).rgb;
  }
  if (s == 9){
    // chromatic: prismatic split and a slow liquid warp
    vec2 c = uv - 0.5;
    vec2 wv = vec2(sin(uv.y*11.0 + uTime*0.6), cos(uv.x*9.0 - uTime*0.45))*0.004;
    vec3 col = vec3(texture(tex, uv + wv + c*0.014).r, texture(tex, uv + wv).g, texture(tex, uv + wv - c*0.014).b);
    float L = lum(col);
    return max(mix(vec3(L), col, 1.7), 0.0)*1.1;
  }
  if (s == 4){
    // halftone print
    float cell = 7.0;
    vec2 px = uv*uRes;
    vec2 ctr = (floor(px/cell) + 0.5)*cell;
    vec3 cc = texture(tex, ctr/uRes).rgb;
    float l = 1.0 - exp(-lum(cc)*5.0);
    float d = length(px - ctr)/(cell*0.62);
    float dotm = smoothstep(sqrt(l) + 0.06, sqrt(l) - 0.06, d);
    vec3 ink = cc/(lum(cc) + 0.04)*0.35 + P3*0.25;
    return mix(P0*0.6, ink, dotm);
  }
  if (s == 5){
    // stained glass: voronoi panes with dark leading
    vec2 g = uv*uRes/46.0;
    vec2 ip = floor(g), fp = fract(g);
    float d1 = 9.0, d2 = 9.0; vec2 best = vec2(0.0);
    for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++){
      vec2 nb = vec2(float(x), float(y));
      vec2 pt = nb + 0.5 + 0.38*sin(uTime*0.15 + 6.2831*h22(ip + nb));
      float d = length(pt - fp);
      if (d < d1){ d2 = d1; d1 = d; best = ip + pt; }
      else if (d < d2) d2 = d;
    }
    vec3 cc = texture(tex, best*46.0/uRes).rgb;
    cc = cc*1.5 + P1*0.05;
    float lead = 1.0 - smoothstep(0.03, 0.09, d2 - d1);
    return mix(cc, vec3(0.005), lead);
  }
  if (s == 6){
    // x-ray: cool glow and bright edges
    vec2 e = 1.5/uRes;
    float gx = lum(texture(tex, uv + vec2(e.x, 0.0)).rgb) - lum(texture(tex, uv - vec2(e.x, 0.0)).rgb);
    float gy = lum(texture(tex, uv + vec2(0.0, e.y)).rgb) - lum(texture(tex, uv - vec2(0.0, e.y)).rgb);
    float x = 1.0 - exp(-lum(texture(tex, uv).rgb)*2.0);
    float edge = clamp(length(vec2(gx, gy))*4.0, 0.0, 1.0);
    return vec3(0.62, 0.82, 1.0)*(0.03 + x*0.45 + edge*0.9);
  }
  if (s == 10){
    // glitch: torn scanlines, slipped colour planes, blocks that jump
    float tt = floor(uTime*6.0);
    float row = floor(uv.y*48.0);
    float tear = step(0.86, h12(vec2(row, tt)))*(h12(vec2(row, tt + 1.0)) - 0.5)*0.12;
    vec2 blk = floor(uv*vec2(16.0, 9.0));
    vec2 jump = step(0.95, h12(blk + tt))*(h22(blk + tt*3.0) - 0.5)*0.08;
    vec2 g = uv + vec2(tear, 0.0) + jump;
    vec3 col = vec3(texture(tex, g + vec2(0.006, 0.0)).r, texture(tex, g).g, texture(tex, g - vec2(0.006, 0.0)).b);
    col *= 0.85 + 0.15*sin(uv.y*uRes.y*1.6);
    return col*1.15;
  }
  if (s == 12){
    // a terminal: brightness becomes characters
    vec2 px = uv*uRes;
    vec2 cellN = floor(px/vec2(7.0, 11.0));
    vec2 cuv = (cellN + 0.5)*vec2(7.0, 11.0)/uRes;
    vec3 cc = texture(tex, cuv).rgb;
    float l = clamp(1.0 - exp(-lum(cc)*3.0), 0.0, 0.999);
    vec2 f = fract(px/vec2(7.0, 11.0))*vec2(5.0, 5.0);
    ivec2 b = ivec2(floor(f.x), 4 - int(floor(f.y)));
    // 5x5 glyphs for " .:-=+*#%@", one bit per pixel, row-major from the top
    int g0[10] = int[10](0, 4194304, 131200, 14336, 1016800, 4357252, 22369621, 11512810, 26284307, 33093311);
    int gi = int(l*10.0);
    int glyph = g0[gi];
    int bit = b.y*5 + b.x;
    float on = (b.y >= 0 && b.y < 5) ? float((glyph >> bit) & 1) : 0.0;
    vec3 ink = mix(P1, vec3(0.55, 1.0, 0.65), 0.55);
    return ink*on*(0.35 + l*1.3) + P0*0.3;
  }
  vec3 c = texture(tex, uv).rgb;
  float L = lum(c);
  if (s == 11){
    // neon: only the edges of things, in light that cycles through the spectrum
    vec2 e = 1.2/uRes;
    float gx = lum(texture(tex, uv + vec2(e.x, 0.0)).rgb) - lum(texture(tex, uv - vec2(e.x, 0.0)).rgb);
    float gy = lum(texture(tex, uv + vec2(0.0, e.y)).rgb) - lum(texture(tex, uv - vec2(0.0, e.y)).rgb);
    float edge = clamp(length(vec2(gx, gy))*6.0, 0.0, 1.5);
    vec3 hue = 0.5 + 0.5*cos(6.2831853*(uv.x*0.6 + uv.y*0.4 + uTime*0.08 + vec3(0.0, 0.33, 0.67)));
    return hue*edge*1.6 + c*0.06;
  }
  if (s == 13){
    // psychedelic: brightness mapped onto a hue wheel that never stops turning
    float x = 1.0 - exp(-L*2.5);
    vec3 hue = 0.5 + 0.5*cos(6.2831853*(x*2.2 - uTime*0.07 + vec3(0.0, 0.33, 0.67)));
    return hue*(0.01 + x*x*1.6);
  }
  if (s == 1){
    // ink on paper: light becomes ink
    float g = (h12(floor(uv*uRes)) - 0.5)*0.05 + (texture(uNoise, uv*3.0).x)*0.03;
    vec3 paper = vec3(0.88, 0.83, 0.72)*(0.95 + g);
    float ink = clamp(1.0 - exp(-L*2.8), 0.0, 1.0);
    vec3 inkc = mix(vec3(0.03, 0.025, 0.05), c/(L + 0.05)*0.08, 0.55);
    return mix(paper, inkc, ink);
  }
  if (s == 3){
    // thermal camera
    float x = 1.0 - exp(-L*2.2);
    vec3 col = x < 0.25 ? mix(vec3(0.0, 0.0, 0.03), vec3(0.25, 0.0, 0.45), x/0.25)
             : x < 0.5 ? mix(vec3(0.25, 0.0, 0.45), vec3(0.9, 0.1, 0.05), (x - 0.25)/0.25)
             : x < 0.75 ? mix(vec3(0.9, 0.1, 0.05), vec3(1.0, 0.75, 0.0), (x - 0.5)/0.25)
             : mix(vec3(1.0, 0.75, 0.0), vec3(1.0), (x - 0.75)/0.25);
    return col*1.1;
  }
  if (s == 7){
    // contour map: brightness drawn as topographic lines
    float v = log2(L*60.0 + 1.0);
    float f = fract(v*1.5);
    float line = smoothstep(0.09, 0.0, min(f, 1.0 - f));
    float k = clamp(v/6.0, 0.0, 1.0);
    return mix(P0*2.0, P1*0.25, k)*0.6 + mix(P1, P2, k)*line*1.3;
  }
  if (s == 8){
    // ordered dither into a four-ink palette
    float x = 1.0 - exp(-L*2.4);
    float lv = floor(x*3.0 + bayer(uv*uRes));
    return lv < 0.5 ? P0*0.25 : lv < 1.5 ? P1*0.55 : lv < 2.5 ? P2*0.9 : P3*1.3 + 0.2;
  }
  return c;
}
void main(){
  vec2 uv = vUv;
  vec3 a = styled(uA, uStyleA, uv, uPalA[0], uPalA[1], uPalA[2], uPalA[3]);
  if (uHasB == 0){ o = vec4(a, 1.0); return; }
  float t = uAp.w;
  vec2 d = (uv - uAp.xy)*vec2(uAspect, 1.0);
  float r = length(d)/max(uAp.z, 1e-4);
  float n = texture(uNoise, uv*1.7 + vec2(uTime*0.01, 0.0)).x;
  float edge = r + n*0.22*(1.0 - t*0.8);
  float inside = 1.0 - smoothstep(0.78, 1.0, edge);
  // the membrane is a lens: the inner world bulges outward near the rim
  vec2 dir = d/max(length(d), 1e-5);
  float bulge = exp(-pow((r - 0.85)/0.18, 2.0))*0.035*(1.0 - t);
  vec2 uvB = uv - dir/vec2(uAspect, 1.0)*bulge*uAp.z;
  vec3 b = styled(uB, uStyleB, uvB, uPalB[0], uPalB[1], uPalB[2], uPalB[3]);
  float show = inside*(0.45*smoothstep(0.0, 0.12, t) + 0.55*smoothstep(0.1, 0.65, t));
  vec3 col = mix(a, b, show);
  float rim = exp(-pow((edge - 0.9)/0.07, 2.0))*(1.0 - smoothstep(0.75, 1.0, t))*smoothstep(0.0, 0.06, t);
  col += mix(uPalB[3], uPalA[2], 0.5 + 0.5*sin(uTime*0.7 + atan(d.y, d.x)*3.0))*rim*0.45;
  o = vec4(col, 1.0);
}
`;

  // ---------------------------------------------------------------- stable fluids (Stam 1999; pipeline after Dobryakov's WebGL fluid)
  C.SH.fAdvectFS = H + `
uniform sampler2D uVel, uSrc;
uniform float uDt, uW, uDiss;
in vec2 vUv;
out vec4 o;
void main(){
  vec2 v = texture(uVel, vUv).xy;
  o = texture(uSrc, vUv - uDt*v/uW)/(1.0 + uDiss*uDt);
}
`;
  C.SH.fCurlFS = H + `
uniform sampler2D uVel;
uniform vec2 uTexel;
uniform float uDx;
in vec2 vUv;
out vec4 o;
void main(){
  float L = texture(uVel, vUv - vec2(uTexel.x, 0.0)).y, R = texture(uVel, vUv + vec2(uTexel.x, 0.0)).y;
  float T = texture(uVel, vUv + vec2(0.0, uTexel.y)).x, B = texture(uVel, vUv - vec2(0.0, uTexel.y)).x;
  o = vec4((R - L - T + B)/(2.0*uDx), 0.0, 0.0, 1.0);
}
`;
  C.SH.fVortFS = H + `
uniform sampler2D uVel, uCurl;
uniform vec2 uTexel;
uniform float uCurlAmt, uDt;
in vec2 vUv;
out vec4 o;
void main(){
  float L = texture(uCurl, vUv - vec2(uTexel.x, 0.0)).x, R = texture(uCurl, vUv + vec2(uTexel.x, 0.0)).x;
  float T = texture(uCurl, vUv + vec2(0.0, uTexel.y)).x, B = texture(uCurl, vUv - vec2(0.0, uTexel.y)).x;
  float c = texture(uCurl, vUv).x;
  vec2 f = 0.5*vec2(abs(T) - abs(B), abs(R) - abs(L));
  f /= length(f) + 1e-4;
  f *= uCurlAmt*c*0.02;
  f.y *= -1.0;
  vec2 v = texture(uVel, vUv).xy + f*uDt;
  o = vec4(clamp(v, -40.0, 40.0), 0.0, 1.0);
}
`;
  C.SH.fDivFS = H + `
uniform sampler2D uVel;
uniform vec2 uTexel;
uniform float uDx;
in vec2 vUv;
out vec4 o;
void main(){
  float L = texture(uVel, vUv - vec2(uTexel.x, 0.0)).x, R = texture(uVel, vUv + vec2(uTexel.x, 0.0)).x;
  float T = texture(uVel, vUv + vec2(0.0, uTexel.y)).y, B = texture(uVel, vUv - vec2(0.0, uTexel.y)).y;
  o = vec4(0.5*(R - L + T - B)/uDx, 0.0, 0.0, 1.0);
}
`;
  C.SH.fPresFS = H + `
uniform sampler2D uP, uDiv;
uniform vec2 uTexel;
uniform float uDx;
in vec2 vUv;
out vec4 o;
void main(){
  float L = texture(uP, vUv - vec2(uTexel.x, 0.0)).x, R = texture(uP, vUv + vec2(uTexel.x, 0.0)).x;
  float T = texture(uP, vUv + vec2(0.0, uTexel.y)).x, B = texture(uP, vUv - vec2(0.0, uTexel.y)).x;
  o = vec4((L + R + T + B - texture(uDiv, vUv).x*uDx*uDx)*0.25, 0.0, 0.0, 1.0);
}
`;
  C.SH.fGradFS = H + `
uniform sampler2D uP, uVel;
uniform vec2 uTexel;
uniform float uDx;
in vec2 vUv;
out vec4 o;
void main(){
  float L = texture(uP, vUv - vec2(uTexel.x, 0.0)).x, R = texture(uP, vUv + vec2(uTexel.x, 0.0)).x;
  float T = texture(uP, vUv + vec2(0.0, uTexel.y)).x, B = texture(uP, vUv - vec2(0.0, uTexel.y)).x;
  vec2 v = texture(uVel, vUv).xy - vec2(R - L, T - B)*0.5/uDx;
  o = vec4(v, 0.0, 1.0);
}
`;
  C.SH.fSplatFS = H + `
uniform sampler2D uSrc;
uniform vec4 uSplat[8];   // x, y (world), radius, 0
uniform vec4 uSplatV[8];  // velocity xy, or dye rgb
uniform int uN, uDye;
uniform float uW;
in vec2 vUv;
out vec4 o;
vec2 wrapD(vec2 d){ return d - uW*floor(d/uW + 0.5); }
void main(){
  vec4 c = texture(uSrc, vUv);
  vec2 wp = (vUv - 0.5)*uW;
  for (int i = 0; i < 8; i++){
    if (i >= uN) break;
    vec2 d = wrapD(wp - uSplat[i].xy);
    float g = exp(-dot(d, d)/(uSplat[i].z*uSplat[i].z));
    if (uDye == 1) c.rgb += uSplatV[i].rgb*g; else c.xy += uSplatV[i].xy*g;
  }
  o = vec4(c.rgb, 1.0);
}
`;
  // ---------------------------------------------------------------- ripple tank (2D wave equation)
  C.SH.rippleFS = H + `
uniform sampler2D uSrc;
uniform vec2 uTexel;
uniform float uC2, uDamp, uW;
uniform vec4 uSrcs[8];  // x, y, radius, drive (this step)
uniform int uN;
in vec2 vUv;
out vec4 o;
vec2 wrapD(vec2 d){ return d - uW*floor(d/uW + 0.5); }
void main(){
  vec2 c = texture(uSrc, vUv).xy;
  float L = texture(uSrc, vUv - vec2(uTexel.x, 0.0)).x, R = texture(uSrc, vUv + vec2(uTexel.x, 0.0)).x;
  float T = texture(uSrc, vUv + vec2(0.0, uTexel.y)).x, B = texture(uSrc, vUv - vec2(0.0, uTexel.y)).x;
  float v = (c.y + uC2*(L + R + T + B - 4.0*c.x))*uDamp;
  vec2 wp = (vUv - 0.5)*uW;
  for (int i = 0; i < 8; i++){
    if (i >= uN) break;
    vec2 d = wrapD(wp - uSrcs[i].xy);
    v += exp(-dot(d, d)/(uSrcs[i].z*uSrcs[i].z))*uSrcs[i].w;
  }
  float h = clamp(c.x + v, -4.0, 4.0);
  o = vec4(h, v, 0.0, 1.0);
}
`;
  // ---------------------------------------------------------------- Game of Life (any life-like rule, as bit masks)

  // Continuous life (Lenia / SmoothLife): every cell feels a smooth ring of neighbours and grows or
  // fades by how full that ring is. Out of this come gliders, worms and dividing cells.
  C.SH.leniaFS = H + `
uniform sampler2D uSrc;
uniform vec2 uTexel;
uniform float uR, uMu, uSigma, uDt, uMode, uW, uTime;
uniform int uNBrush;
uniform vec4 uBrush[12];
in vec2 vUv;
out vec4 o;
vec2 wrapW(vec2 d){ return d - uW*floor(d/uW + 0.5); }
float h31(vec3 p){ p = fract(p*0.1031); p += dot(p, p.zyx + 31.32); return fract((p.x + p.y)*p.z); }
float s1(float x, float a, float al){ return 1.0/(1.0 + exp(-(x - a)*4.0/al)); }
void main(){
  vec4 c = texture(uSrc, vUv);
  float a = c.r, nxt, grow;
  int R = int(ceil(uR));
  if (uMode < 0.5){
    // Lenia: one smooth shell kernel, a bell-shaped growth curve
    float sum = 0.0, wsum = 0.0;
    for (int y = -16; y <= 16; y++){ if (y < -R || y > R) continue;
      for (int x = -16; x <= 16; x++){ if (x < -R || x > R) continue;
        float r = length(vec2(float(x), float(y)))/uR;
        if (r > 1.0) continue;
        float k = exp(-pow((r - 0.5)/0.15, 2.0)*0.5);
        sum += k*texture(uSrc, vUv + vec2(float(x), float(y))*uTexel).r;
        wsum += k;
      }
    }
    float u = sum/max(wsum, 1e-4);
    grow = 2.0*exp(-pow(u - uMu, 2.0)/(2.0*uSigma*uSigma)) - 1.0;
    nxt = clamp(a + uDt*grow, 0.0, 1.0);
  } else {
    // SmoothLife (Rafler): inner disk m, outer annulus n, birth/death intervals that blend with m
    float ri = uR/3.0, M = 0.0, Mw = 0.0, N = 0.0, Nw = 0.0;
    for (int y = -16; y <= 16; y++){ if (y < -R || y > R) continue;
      for (int x = -16; x <= 16; x++){ if (x < -R || x > R) continue;
        float r = length(vec2(float(x), float(y)));
        float v = texture(uSrc, vUv + vec2(float(x), float(y))*uTexel).r;
        float wi = clamp(ri + 0.5 - r, 0.0, 1.0);
        float wo = clamp(uR + 0.5 - r, 0.0, 1.0)*(1.0 - wi);
        M += wi*v; Mw += wi; N += wo*v; Nw += wo;
      }
    }
    float m = M/max(Mw, 1e-4), n = N/max(Nw, 1e-4);
    float sm = s1(m, 0.5, 0.147);
    float lo = mix(0.278, 0.267, sm), hi = mix(0.365, 0.445, sm);
    float s = s1(n, lo, 0.028)*(1.0 - s1(n, hi, 0.028));
    grow = 2.0*s - 1.0;
    nxt = clamp(mix(a, s, uDt), 0.0, 1.0);
  }
  vec2 wp = (vUv - 0.5)*uW;
  for (int i = 0; i < 12; i++){
    if (i >= uNBrush) break;
    vec4 b = uBrush[i];
    vec2 d = wrapW(wp - b.xy);
    float g = exp(-dot(d, d)/(b.z*b.z));
    if (b.w > 0.0) nxt = max(nxt, g*b.w*step(0.35, h31(vec3(vUv*517.0, uTime))));
    else nxt *= 1.0 - g*min(1.0, -b.w);
  }
  o = vec4(nxt, grow, max(nxt, c.b*0.94), 1.0);
}
`;
  C.SH.lifeFS = H + `
uniform sampler2D uSrc;
uniform vec2 uTexel;
uniform int uBirth, uSurvive, uNBrush;
uniform vec4 uBrush[12];
uniform float uW, uTime;
in vec2 vUv;
out vec4 o;
vec2 wrapW(vec2 d){ return d - uW*floor(d/uW + 0.5); }
float h31(vec3 p){ p = fract(p*0.1031); p += dot(p, p.zyx + 31.32); return fract((p.x + p.y)*p.z); }
void main(){
  vec4 c = texture(uSrc, vUv);
  int n = 0;
  for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++){
    if (x == 0 && y == 0) continue;
    if (texture(uSrc, vUv + vec2(float(x), float(y))*uTexel).r > 0.5) n++;
  }
  bool alive = c.r > 0.5;
  bool next = alive ? ((uSurvive >> n) & 1) == 1 : ((uBirth >> n) & 1) == 1;
  vec2 wp = (vUv - 0.5)*uW;
  for (int i = 0; i < 12; i++){
    if (i >= uNBrush) break;
    vec4 b = uBrush[i];
    vec2 d = wrapW(wp - b.xy);
    float g = exp(-dot(d, d)/(b.z*b.z));
    if (b.w > 0.0 && h31(vec3(vUv*913.0, uTime)) < g*b.w) next = true;
    if (b.w < 0.0 && g > 0.3) next = false;
  }
  float age = next ? (alive ? c.g + 0.08 : 0.0) : 0.0;
  float trail = next ? 1.0 : c.b*0.82;
  o = vec4(next ? 1.0 : 0.0, age, trail, 1.0);
}
`;
})();
