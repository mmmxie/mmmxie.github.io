/* The universe: one particle pool from the entrance to the last section.
 *
 * Everything is simulated on the CPU in typed arrays and drawn with WebGL points
 * (Canvas 2D when WebGL is missing), so the pointer, the entrance and the section
 * shapes all agree on where every particle actually is.
 *
 *   entrance   spiral galaxy (face-on) → collapses onto CHENG EN HSIEH → the
 *              letters break off tile by tile (the tiles are the glyph bitmap) →
 *              the pieces fly out into the cloud
 *   ambient    the galaxy, expanded around the viewer and turning slowly; scroll
 *              pulls the camera back and orbits it, so near dust crosses faster
 *   sections   about → orbit · work → data sphere · side projects → twin helix ·
 *              experience → the axis and the star · capabilities → constellations ·
 *              contact → the logo
 *
 * The pointer pushes particles aside; each carries its own spring back home.
 */

const TAU = Math.PI * 2;
const clamp01 = v => (v < 0 ? 0 : v > 1 ? 1 : v);
const seg = (t, a, b) => clamp01((t - a) / (b - a));
const easeOut = x => 1 - Math.pow(1 - x, 3);
const easeInOut = x => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);
const smooth = (a, b, x) => { const t = clamp01((x - a) / (b - a)); return t * t * (3 - 2 * t); };

// glyph tiles are drawn this much larger than their grid step. Point size and
// position land on fractional device pixels, so tiles cut exactly to the grid
// leave hairline gaps that read as black lines across the name.
const TILE_OVER = 1.34;
const INK = [0.925, 0.933, 0.945];
const CLUSTERS = [[0.1, 0.24], [0.9, 0.2], [0.07, 0.74], [0.93, 0.78], [0.3, 0.93], [0.7, 0.07]];
const GOLD = [0.80, 0.72, 0.54];
// share of the shaped particles that drift by the Experience star: 7 of ~2,800 at the full
// tier (counted by replaying alloc()'s random sequence; a lower tier draws no shapes at all)
const MOTES = 0.0035;

export function createUniverse(opts) {
  let { back } = opts;
  const { front = null, tier = 'high', intro = null, nameEl = null, logoPath = '', onForm = null, onRenderer = null } = opts;
  const abort = new AbortController();
  const listen = (el, ev, fn, o = {}) => el.addEventListener(ev, fn, { signal: abort.signal, passive: true, ...o });

  const TIERS = {
    high: { n: 5600, dpr: 2, forms: true, pointer: true, front: true },
    mid: { n: 2200, dpr: 1.25, forms: false, pointer: false, front: false },
    low: { n: 1200, dpr: 1, forms: false, pointer: false, front: false }
  };
  let cfg = TIERS[tier] || TIERS.high;
  let W = 0, H = 0, dpr = 1;
  let N = 0;

  /* ---------- particle state (structure of arrays) ---------- */
  let P = null;          // static per-particle data
  let X, Y, S, A, M, L;   // per-frame output: x, y, size, alpha, tile mix, layer
  let OX, OY, VX, VY;     // pointer displacement and its velocity
  let FX, FY, FA, FS;     // skip snapshot

  function alloc(n) {
    N = n;
    const f = () => new Float32Array(n);
    P = {
      gx: f(), gy: f(), gz: f(), rxz: f(), sx: f(), sy: f(), sz: f(),
      scale: f(), bright: f(), seed: f(), r2: f(), r3: f(), r4: f(),
      tone: new Uint8Array(n), stable: new Uint8Array(n), form: new Uint8Array(n),
      nx: f(), ny: f(), delay: f(), tu: f(), tv: f(), tile: new Uint8Array(n),
      lx: f(), ly: f(),
      // precomputed rotation pairs: the per-frame cloud needs no sin/cos at all
      cb: f(), sb: f(), cp: f(), sp: f(), cq: f(), sq: f(),
      ux: f(), uy: f(), uz: f()        // a fixed point on the unit sphere (work scene)
    };
    X = f(); Y = f(); S = f(); A = f(); M = f(); L = f();
    OX = f(); OY = f(); VX = f(); VY = f();
    FX = f(); FY = f(); FA = f(); FS = f();
    let s = 91813;
    const rnd = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
    const ARMS = 3, SPREAD = 2.55;
    for (let i = 0; i < n; i++) {
      const r = Math.pow(rnd(), 0.55) * SPREAD;
      const branch = ((i % ARMS) / ARMS) * TAU + r * 2.4;
      const jitter = 0.26 * (1 - (r / SPREAD) * 0.45);
      const j = () => Math.pow(rnd(), 3) * (rnd() < 0.5 ? 1 : -1) * jitter;
      P.gx[i] = Math.cos(branch) * r + j();
      P.gy[i] = j() * 0.42;
      P.gz[i] = Math.sin(branch) * r + j();
      P.rxz[i] = Math.hypot(P.gx[i], P.gz[i]);
      const th = rnd() * TAU, ph = Math.acos(2 * rnd() - 1);
      P.sx[i] = Math.sin(ph) * Math.cos(th);
      P.sy[i] = Math.sin(ph) * Math.sin(th) * 0.6;
      P.sz[i] = Math.cos(ph);
      P.scale[i] = 0.35 + Math.pow(rnd(), 2) * 0.95;
      P.bright[i] = 0.42 + (1 - r / SPREAD) * 0.58;
      P.seed[i] = rnd(); P.r2[i] = rnd(); P.r3[i] = rnd(); P.r4[i] = rnd();
      P.tone[i] = rnd() < 0.06 ? 1 : 0;
      P.stable[i] = rnd() < 0.2 ? 1 : 0;
      P.form[i] = rnd() < 0.5 ? 1 : 0;
      const b0 = P.rxz[i] * 0.14, ph0 = P.seed[i] * TAU;
      P.cb[i] = Math.cos(b0); P.sb[i] = Math.sin(b0);
      P.cp[i] = Math.cos(ph0); P.sp[i] = Math.sin(ph0);
      P.cq[i] = Math.cos(ph0 * 1.3); P.sq[i] = Math.sin(ph0 * 1.3);
      const un = P.seed[i] * 2 - 1, ut = P.r2[i] * TAU, ur = Math.sqrt(1 - un * un);
      P.ux[i] = ur * Math.cos(ut); P.uy[i] = un; P.uz[i] = ur * Math.sin(ut);
    }
  }

  /* ---------- renderers ---------- */
  let gl = null, ctx2d = null, glFront = null;
  let R = null, RF = null; // WebGL resources per context
  let glyph = null;        // { canvas, w, h, ratio, ox, oy }

  const VS = `
    attribute vec2 aPos; attribute float aSize; attribute float aAlpha; attribute float aMix;
    attribute float aLayer; attribute vec2 aTile; attribute float aTone;
    uniform vec2 uRes; uniform float uDpr; uniform float uLayer;
    varying float vA; varying float vMix; varying vec2 vTile; varying float vTone; varying float vSize;
    void main(){
      vec2 p = aPos * uDpr;
      gl_Position = vec4(p.x / uRes.x * 2.0 - 1.0, 1.0 - p.y / uRes.y * 2.0, 0.0, 1.0);
      float on = step(abs(aLayer - uLayer), 0.5) * step(0.004, aAlpha);
      gl_PointSize = aSize * uDpr * on;
      if (on < 0.5) gl_Position = vec4(2.0, 2.0, 0.0, 1.0);
      vA = aAlpha; vMix = aMix; vTile = aTile; vTone = aTone; vSize = aSize * uDpr;
    }`;
  const FS_SRC = `
    precision mediump float;
    uniform sampler2D uGlyph; uniform vec2 uGlyphSize; uniform float uTileTex;
    varying float vA; varying float vMix; varying vec2 vTile; varying float vTone; varying float vSize;
    void main(){
      vec2 pc = gl_PointCoord;
      float d = length(pc - 0.5);
      /* small points stay crisp, large ones open into soft bokeh */
      float soft = clamp((vSize - 4.0) / 26.0, 0.0, 1.0);
      float dotA = 1.0 - smoothstep(mix(0.3, 0.02, soft), 0.5, d);
      dotA *= mix(1.0, 0.55, soft);
      float a = dotA;
      if (vMix > 0.001) {
        vec2 uv = (vTile + pc * uTileTex) / uGlyphSize;
        a = mix(dotA, texture2D(uGlyph, uv).a, vMix);
      }
      vec3 col = mix(vec3(${INK.join(',')}), vec3(${GOLD.join(',')}), vTone * (1.0 - vMix));
      a *= vA;
      gl_FragColor = vec4(col * a, a);
    }`;

  function initGL(canvas) {
    const opt = { alpha: true, antialias: false, premultipliedAlpha: true, depth: false, stencil: false, powerPreference: 'low-power', preserveDrawingBuffer: false };
    const g = canvas.getContext('webgl2', opt) || canvas.getContext('webgl', opt);
    if (!g) return null;
    const res = buildGL(g);
    return { g, res };
  }
  function buildGL(g) {
    const sh = (type, src) => { const s = g.createShader(type); g.shaderSource(s, src); g.compileShader(s); if (!g.getShaderParameter(s, g.COMPILE_STATUS)) { const e = g.getShaderInfoLog(s); g.deleteShader(s); throw new Error(e); } return s; };
    const vs = sh(g.VERTEX_SHADER, VS), fs = sh(g.FRAGMENT_SHADER, FS_SRC);
    const prog = g.createProgram();
    g.attachShader(prog, vs); g.attachShader(prog, fs); g.linkProgram(prog);
    g.deleteShader(vs); g.deleteShader(fs);
    if (!g.getProgramParameter(prog, g.LINK_STATUS)) throw new Error(g.getProgramInfoLog(prog));
    g.useProgram(prog);
    const loc = n => g.getAttribLocation(prog, n);
    const uni = n => g.getUniformLocation(prog, n);
    const dyn = g.createBuffer(), stat = g.createBuffer();
    const tex = g.createTexture();
    g.bindTexture(g.TEXTURE_2D, tex);
    // the glyph tiles are magnified on screen; LINEAR keeps the letter edges smooth
    // instead of printing the tile grid back onto the name
    g.texParameteri(g.TEXTURE_2D, g.TEXTURE_MIN_FILTER, g.LINEAR);
    g.texParameteri(g.TEXTURE_2D, g.TEXTURE_MAG_FILTER, g.LINEAR);
    g.texParameteri(g.TEXTURE_2D, g.TEXTURE_WRAP_S, g.CLAMP_TO_EDGE);
    g.texParameteri(g.TEXTURE_2D, g.TEXTURE_WRAP_T, g.CLAMP_TO_EDGE);
    g.texImage2D(g.TEXTURE_2D, 0, g.RGBA, 1, 1, 0, g.RGBA, g.UNSIGNED_BYTE, new Uint8Array(4));
    g.disable(g.DEPTH_TEST);
    g.enable(g.BLEND);
    g.blendFunc(g.ONE, g.ONE);
    return {
      prog, dyn, stat, tex, glyphStamp: -1,
      a: { pos: loc('aPos'), size: loc('aSize'), alpha: loc('aAlpha'), mix: loc('aMix'), layer: loc('aLayer'), tile: loc('aTile'), tone: loc('aTone') },
      u: { res: uni('uRes'), dpr: uni('uDpr'), layer: uni('uLayer'), glyph: uni('uGlyph'), glyphSize: uni('uGlyphSize'), tileTex: uni('uTileTex') }
    };
  }
  function uploadStatic(g, res) {
    const d = new Float32Array(N * 3);
    for (let i = 0; i < N; i++) { d[i * 3] = P.tu[i]; d[i * 3 + 1] = P.tv[i]; d[i * 3 + 2] = P.tone[i]; }
    g.bindBuffer(g.ARRAY_BUFFER, res.stat);
    g.bufferData(g.ARRAY_BUFFER, d, g.STATIC_DRAW);
    g.bindBuffer(g.ARRAY_BUFFER, res.dyn);
    g.bufferData(g.ARRAY_BUFFER, N * 6 * 4, g.DYNAMIC_DRAW);
  }
  function freeGL(g, res) {
    if (!g || !res) return;
    try { g.deleteBuffer(res.dyn); g.deleteBuffer(res.stat); g.deleteTexture(res.tex); g.deleteProgram(res.prog); } catch (e) { /* context already gone */ }
  }

  /* ---------- geometry of the page, pushed in by site.js ---------- */
  let sections = [];      // [{ top, bottom, scene }]
  let markBox = null;     // contact logo, page coordinates
  let lineX = 0;          // experience axis, viewport x
  let logoPts = null;     // Float32Array of normalised logo points

  function sampleLogo() {
    if (!logoPath || typeof Path2D === 'undefined') return;
    const c = document.createElement('canvas'); c.width = 500; c.height = 294;
    const x = c.getContext('2d', { willReadFrequently: true });
    x.scale(0.5, 0.5); x.fillStyle = '#fff'; x.fill(new Path2D(logoPath));
    const d = x.getImageData(0, 0, 500, 294).data, out = [];
    for (let y = 0; y < 294; y += 2) for (let xx = 0; xx < 500; xx += 2) if (d[(y * 500 + xx) * 4 + 3] > 128) out.push(xx / 500, y / 294);
    logoPts = new Float32Array(out);
    const L2 = logoPts.length / 2;
    for (let i = 0; i < N; i++) { const k = (i * 7919) % L2; P.lx[i] = logoPts[k * 2]; P.ly[i] = logoPts[k * 2 + 1]; }
  }

  /* ---------- the name, sampled from the DOM exactly as it is drawn ---------- */
  let tileCSS = 3, T = 0, glyphStamp = 0;
  function rasterName() {
    if (!nameEl) return false;
    const rect = nameEl.getBoundingClientRect();
    const node = nameEl.firstChild;
    if (!node || rect.width < 20) return false;
    const style = getComputedStyle(nameEl);
    const ratio = dpr;
    const gw = Math.ceil(rect.width), gh = Math.ceil(rect.height);
    const off = document.createElement('canvas');
    off.width = Math.ceil(gw * ratio); off.height = Math.ceil(gh * ratio);
    const c = off.getContext('2d', { willReadFrequently: true });
    c.scale(ratio, ratio);
    c.font = `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
    c.fillStyle = '#fff'; c.textAlign = 'left'; c.textBaseline = 'alphabetic';
    try { c.fontKerning = 'none'; } catch (e) { /* older engines */ }
    // real character boxes and the real baseline, so letter-spacing always matches
    const marker = document.createElement('span');
    marker.style.cssText = 'display:inline-block;width:0;height:0;vertical-align:baseline';
    nameEl.append(marker);
    const baseline = marker.getBoundingClientRect().top - rect.top;
    marker.remove();
    const range = document.createRange();
    for (let i = 0; i < node.textContent.length; i++) {
      range.setStart(node, i); range.setEnd(node, i + 1);
      const cr = range.getBoundingClientRect();
      c.fillText(node.textContent[i], cr.left - rect.left, baseline);
    }
    const data = c.getImageData(0, 0, off.width, off.height).data;
    // tile size so the letters need at most ~80% of the pool
    let filled = 0;
    for (let k = 3; k < data.length; k += 16) if (data[k] > 8) filled++;
    const area = (filled * 4) / (ratio * ratio);
    tileCSS = Math.max(2, Math.ceil(Math.sqrt(area / (N * 0.8))));
    const tiles = [], pts = [];
    for (let y = 0; y < gh; y += tileCSS) {
      for (let x = 0; x < gw; x += tileCSS) {
        let hit = false;
        const y0 = Math.floor(y * ratio), y1 = Math.min(Math.ceil((y + tileCSS) * ratio), off.height);
        const x0 = Math.floor(x * ratio), x1 = Math.min(Math.ceil((x + tileCSS) * ratio), off.width);
        for (let yy = y0; yy < y1 && !hit; yy++) for (let xx = x0; xx < x1; xx++) if (data[(yy * off.width + xx) * 4 + 3] > 8) { hit = true; break; }
        if (hit) tiles.push(x, y);
        if (hit) pts.push(x + tileCSS / 2, y + tileCSS / 2);
      }
    }
    if (!tiles.length) return false;
    T = Math.min(N, tiles.length / 2);
    let s = 4211;
    const rnd = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
    const pad = ((TILE_OVER - 1) / 2) * tileCSS * ratio;
    for (let i = 0; i < N; i++) {
      if (i < T) {
        const x = tiles[i * 2], y = tiles[i * 2 + 1];
        P.tile[i] = 1; P.nx[i] = x + tileCSS / 2; P.ny[i] = y + tileCSS / 2;
        P.tu[i] = x * ratio - pad; P.tv[i] = y * ratio - pad;
        P.delay[i] = (x / gw) * 0.26 + rnd() * 0.22;
      } else {
        const k = (i * 7919) % (pts.length / 2);
        P.tile[i] = 0; P.nx[i] = pts[k * 2] + (rnd() - 0.5) * tileCSS; P.ny[i] = pts[k * 2 + 1] + (rnd() - 0.5) * tileCSS;
        P.tu[i] = 0; P.tv[i] = 0;
        P.delay[i] = (pts[k * 2] / gw) * 0.26 + rnd() * 0.22;
      }
    }
    glyph = { canvas: off, w: off.width, h: off.height, ratio, ox: rect.left, oy: rect.top, gw, gh };
    glyphStamp++;
    if (R) uploadStatic(gl, R);
    if (RF) uploadStatic(glFront, RF);
    return true;
  }
  function syncGlyph(g, res) {
    if (!glyph || res.glyphStamp === glyphStamp) return;
    g.bindTexture(g.TEXTURE_2D, res.tex);
    g.pixelStorei(g.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    g.texImage2D(g.TEXTURE_2D, 0, g.RGBA, g.RGBA, g.UNSIGNED_BYTE, glyph.canvas);
    res.glyphStamp = glyphStamp;
  }

  /* ---------- sizing ---------- */
  function size() {
    W = innerWidth; H = innerHeight;
    // cap the backing store: a 5K screen at DPR 2 would otherwise ask for two ~60 MB surfaces
    const surfaces = front && cfg.front ? 2 : 1;
    dpr = Math.min(devicePixelRatio || 1, cfg.dpr, Math.sqrt(5.2e6 / surfaces / Math.max(1, W * H)));
    for (const c of [back, front]) {
      if (!c) continue;
      c.width = Math.round(W * dpr); c.height = Math.round(H * dpr);
    }
  }

  /* ---------- state ---------- */
  let spin = 0, spinI = 0, curSpin = 0, sceneS = 0, sceneTarget = 0, scrollY0 = 0, heldScene = null;
  let time = 0, last = 0, frameId = 0, paused = false, hidden = document.hidden, still = false, disposed = false;
  let draws = 0, formOn = false, frameCost = 0, slow = 0, drawN = 0, lastNow = 0, ivEMA = 0, refresh = 40;
  const sceneFade = new Float32Array(7).fill(1);   // one dimmer per scene, indexed by scene number
  const ring = new Float32Array(240); let ringI = 0;
  const ptr = { x: -1e4, y: -1e4, tx: -1e4, ty: -1e4, energy: 0, has: false, vx: 0, vy: 0 };
  let brkProgress = 0, brkSkipAt = -1, brkSkipProg = 0, skipT = -1, introDone = !intro;

  /* camera for the ambient cloud */
  function camera(par) {
    const p = Math.max(0, par);
    return {
      z: 3 + Math.min(p, 1.4) * 1.1,
      y: 0.8 * Math.tanh(p * 0.7),
      yaw: p * 0.2,
      tilt: 0.62
    };
  }

  /* project the cloud position of particle i; writes into tmp */
  const tmp = { x: 0.5, y: 0.5, s: 0.5, a: 0.5, z: 0.5 };   // doubles from the start, so V8 never re-boxes them
  // per-frame trig, shared by every particle (angle-sum identities do the rest)
  const T0 = { cs: 1, ss: 0, a1: 0, b1: 1, a2: 0, b2: 1, a3: 1, b3: 0, sc: 1, ss2: 0 };
  function frameTrig() {
    T0.sc = Math.cos(time * 0.12); T0.ss2 = Math.sin(time * 0.12);
    T0.cs = Math.cos(curSpin); T0.ss = Math.sin(curSpin);
    T0.a1 = Math.sin(time * 0.11); T0.b1 = Math.cos(time * 0.11);
    T0.a2 = Math.sin(time * 0.7); T0.b2 = Math.cos(time * 0.7);
    T0.a3 = Math.cos(time * 0.09); T0.b3 = Math.sin(time * 0.09);
  }
  function cloudAt(i, cam, cT, sT, cY, sY, f, intr) {
    // cos/sin(spin + b) from precomputed cos/sin(b)
    const c = T0.cs * P.cb[i] - T0.ss * P.sb[i], s = T0.ss * P.cb[i] + T0.cs * P.sb[i];
    const gx = P.gx[i], gz = P.gz[i];
    const rx = c * gx + s * gz, rz = -s * gx + c * gz;
    const cp = P.cp[i], sp = P.sp[i];
    let x = rx * 2.7 + P.sx[i] * 1.9 + (T0.a1 * cp + T0.b1 * sp) * 0.05;
    let y = P.gy[i] * 2.7 + P.sy[i] * 1.9 + (T0.a2 * cp + T0.b2 * sp) * 0.012 + (T0.a3 * P.cq[i] - T0.b3 * P.sq[i]) * 0.04;
    let z = rz * 2.7 + P.sz[i] * 1.9;
    if (intr) { x = rx + P.sx[i] * intr.spawn * 7; y = P.gy[i] + P.sy[i] * intr.spawn * 7; z = rz + P.sz[i] * intr.spawn * 7; }
    // object rotation: tilt about x, then yaw about y
    let y1 = y * cT - z * sT, z1 = y * sT + z * cT;
    let x2 = x * cY + z1 * sY, z2 = -x * sY + z1 * cY;
    const zc = cam.z - z2;
    if (zc < 0.08) { tmp.a = 0; tmp.x = -999; tmp.y = -999; tmp.s = 0; tmp.z = zc; return; }
    const k = f / zc;
    tmp.x = W * 0.5 + x2 * k;
    tmp.y = H * 0.5 - (y1 - cam.y) * k;
    tmp.z = zc;
    const sz = P.scale[i] * (H / 900) * 7.2 / zc;
    tmp.s = sz < 0.8 ? 0.8 : sz > 30 ? 30 : sz;
    tmp.a = (0.35 + P.scale[i] * 0.65) * P.bright[i] * smooth(0.18, 1.1, zc) * (1 - smooth(9, 15, zc));
  }

  /* section shapes, screen space; writes into tmp */
  function shapeAt(scene, i) {
    const sd = P.seed[i], r2 = P.r2[i], r3 = P.r3[i];
    const wide = W >= 900;
    switch (scene) {
      case 1: { // about: a tilted orbit, two rings
        const cx = wide ? W * 0.76 : W * 0.5, cy = H * 0.42;
        const rx = Math.min(W * (wide ? 0.2 : 0.4), H * 0.4) * (r3 < 0.3 ? 0.6 : 1);
        const a = sd * TAU + time * 0.07 * (r3 < 0.3 ? -1.3 : 1);
        const zf = Math.sin(a);
        tmp.x = cx + Math.cos(a) * rx * (0.96 + r2 * 0.08);
        tmp.y = cy + zf * rx * 0.28 + (r2 - 0.5) * 10 - Math.cos(a) * rx * 0.1;
        tmp.s = 1 + (zf + 1) * 0.6 + P.scale[i] * 0.5;
        tmp.a = 0.16 + (zf + 1) * 0.16;
        return;
      }
      case 2: { // work: a slowly turning sphere of data points
        const px = P.ux[i], py = P.uy[i], pz = P.uz[i];
        const qx = px * T0.sc + pz * T0.ss2, qz = -px * T0.ss2 + pz * T0.sc;
        const qy = py * 0.9131 - qz * 0.4078, qz2 = py * 0.4078 + qz * 0.9131;   // fixed 0.42 rad tilt
        const R0 = Math.min(W * (wide ? 0.15 : 0.32), H * 0.28) * (r3 < 0.12 ? 1.35 : 1);
        const persp = 1 / (1 + qz2 * 0.35);
        tmp.x = (wide ? W * 0.76 : W * 0.5) + qx * R0 * persp;
        tmp.y = H * 0.4 + qy * R0 * persp;
        tmp.s = (0.9 + (1 - qz2) * 0.7) * (r3 < 0.12 ? 0.8 : 1);
        tmp.a = (0.1 + (1 - qz2) * 0.22) * (r3 < 0.12 ? 0.6 : 1);
        return;
      }
      case 3: { // side projects: two strands winding round each other, rising
        const cx = wide ? W * 0.76 : W * 0.5;
        const amp = Math.min(W * (wide ? 0.135 : 0.29), H * 0.21);
        let v = sd + time * 0.03; v -= Math.floor(v);
        const ph = v * TAU * 2.3 + (r3 < 0.5 ? 0 : Math.PI) + time * 0.32;
        const depth = Math.cos(ph);
        tmp.x = cx + Math.sin(ph) * amp * (r2 < 0.14 ? 1.28 : 1) + (r2 - 0.5) * 7;
        tmp.y = H * 0.11 + v * H * 0.78;
        tmp.s = (0.95 + (depth + 1) * 0.62) * (r2 < 0.05 ? 2 : 1) + P.scale[i] * 0.45;
        tmp.a = (0.16 + (depth + 1) * 0.21) * smooth(0, 0.05, v) * (1 - smooth(0.95, 1, v));
        return;
      }
      case 4: { // experience: the axis, and a few motes drifting slowly by the star
        if (r3 < MOTES) {
          // a few of the shaped particles (Mark, 2026-09-13: a few, slow, near the star,
          // where there used to be 840 on fast orbits). Each wanders on its own slow
          // ellipse whose radius breathes, some one way round and some the other, outside
          // the star's glow, and large and bright enough to read as motes, not as dust
          const k = r3 / MOTES;
          const a = sd * TAU + time * (0.05 + r2 * 0.06) * (k < 0.5 ? 1 : -1);
          const rr = 38 + r2 * 56 + Math.sin(time * 0.21 + sd * 17) * 9;
          tmp.x = lineX + Math.cos(a) * rr;
          tmp.y = H * 0.5 + Math.sin(a) * rr * 0.78 + Math.sin(time * 0.15 + sd * 9) * 6;
          tmp.s = 3 + P.scale[i] * 1.4;
          tmp.a = 0.8 + 0.15 * (1 - r2);
          return;
        }
        let v = sd + time * 0.022; v -= Math.floor(v);
        tmp.x = lineX + (r2 - 0.5) * 9 + Math.sin(time * 0.9 + sd * 40) * 1.6;
        tmp.y = -H * 0.05 + v * H * 1.1;
        if (r3 < 0.3) { tmp.s = 1; tmp.a = 0; return; }   // the old orbiters: they join the axis and fade out there
        const pulse = Math.pow(0.5 + 0.5 * Math.sin(tmp.y * 0.018 - time * 2.4), 6);
        tmp.s = 1.15 + P.scale[i]; tmp.a = (0.26 + 0.74 * pulse) * smooth(0, 0.08, v) * (1 - smooth(0.92, 1, v));
        return;
      }
      case 5: { // capabilities: six constellations around the edges
        const k = Math.floor(sd * 6);
        const C = CLUSTERS[k];
        const rr = Math.pow(r2, 1.6) * Math.min(W, H) * 0.15, a = r3 * TAU + time * 0.05 * (k % 2 ? 1 : -1);
        tmp.x = C[0] * W + Math.cos(a) * rr; tmp.y = C[1] * H + Math.sin(a) * rr * 0.8;
        tmp.s = r2 < 0.05 ? 3.6 : 1.2 + P.scale[i] * 1.1;
        tmp.a = r2 < 0.05 ? 0.95 : 0.48 + 0.34 * (1 - r2);
        return;
      }
      case 6: { // contact: the CH mark
        if (!markBox || !logoPts) { tmp.a = 0; tmp.x = W / 2; tmp.y = H / 2; tmp.s = 1; return; }
        const bx = markBox.x, by = markBox.top - scrollY0;
        tmp.x = bx + P.lx[i] * markBox.w + (r2 - 0.5) * 1.5 + Math.sin(time * 0.8 + sd * 30) * 0.6;
        tmp.y = by + P.ly[i] * markBox.h + (r3 - 0.5) * 1.5;
        tmp.s = 1.3 + P.scale[i] * 0.9; tmp.a = 0.85;
        return;
      }
    }
    tmp.a = 0;
  }

  /* ---------- the frame ---------- */
  function step(now) {
    const dt = last ? Math.min((now - last) / 1000, 0.05) : 1 / 60;
    last = now;
    if (!still) time += dt;
    scrollY0 = window.scrollY || window.pageYOffset || 0;
    const f = (H * 0.5) / Math.tan((37.5 * Math.PI) / 180);

    /* entrance clock */
    let it = -1, intr = null, tilt, cam;
    let introPhase = intro && !introDone && intro.t0 != null;
    const Tl = intro ? intro.T : null;
    if (introPhase) {
      it = (now - intro.t0) / 1000;
      if (it < Tl.brk && skipT < 0) {
        // the galaxy settles in step with the collapse onto the name (conv[0]), so moving
        // the entrance timings in site.js moves this with them
        const spawn = 1 - easeOut(seg(it, 0, Tl.conv[0] - 0.6));
        intr = { spawn };
        spinI += (0.35 * (1 - seg(it, 0, Tl.conv[0] + 0.2)) + 0.07) * dt;
        if (it > Tl.conv[0] - 0.3 && glyph == null) rasterName();
      }
    }
    if (!still) spin += 0.055 * dt;
    curSpin = intr ? spinI : spin;
    frameTrig();
    // lost the glyphs (font never resolved, zero-size name): skip rather than break on nothing
    if (introPhase && it >= Tl.brk - 0.05 && !glyph && skipT < 0) { freezeAndEase(now); introPhase = !introDone; }

    const par = scrollY0 / Math.max(1, H);
    const target = sectionScene();
    sceneTarget = target;
    sceneS += (sceneTarget - sceneS) * (1 - Math.exp(-dt * 2.4));
    if (Math.abs(sceneTarget - sceneS) < 0.0005) sceneS = sceneTarget;
    if (heldScene != null) sceneS = heldScene;   // tests only: a transition held at one point
    const nowForm = cfg.forms && sceneS > 5.55;
    if (nowForm !== formOn) { formOn = nowForm; onForm && onForm(formOn); }

    cam = camera(par);
    tilt = cam.tilt;
    if (intr) { tilt = 1.38 * (1 - easeInOut(seg(it, 0.4, Tl.conv[0] + 0.6))); cam = { z: 3, y: 0, yaw: 0 }; }
    const cT = Math.cos(tilt), sT = Math.sin(tilt), cY = Math.cos(cam.yaw), sY = Math.sin(cam.yaw);
    // during the break the cloud eases from edge-on to its resting tilt
    let cTb = cT, sTb = sT;
    if (introPhase && it >= Tl.brk) {
      const tb = 0.62 * easeInOut(clamp01(brkProgress));
      cTb = Math.cos(tb); sTb = Math.sin(tb);
    }

    /* pointer */
    const kP = 1 - Math.exp(-dt * 18);
    const px0 = ptr.x, py0 = ptr.y;
    if (ptr.has) { ptr.x += (ptr.tx - ptr.x) * kP; ptr.y += (ptr.ty - ptr.y) * kP; }
    // the pointer's own velocity, smoothed: it drives the scatter at Contact, so the push
    // stops the moment the pointer rests instead of holding a hole open under it
    if (ptr.has && dt > 0.001) { const kv = 1 - Math.exp(-dt * 14); ptr.vx += ((ptr.x - px0) / dt - ptr.vx) * kv; ptr.vy += ((ptr.y - py0) / dt - ptr.vy) * kv; }
    else { ptr.vx = 0; ptr.vy = 0; }
    ptr.energy *= Math.exp(-dt / 0.42);
    const usePtr = cfg.pointer && ptr.has && ptr.energy > 0.01 && introDone;
    const PR = 92, PR2 = PR * PR;
    // Contact (Mark, 2026-09-13): the mark scatters like smoke, further than the loose cloud,
    // and floats home. A plain radial push swept every particle it reached out to the same
    // edge, so the mark opened a clean black disc ringed with dots, which is what read as a
    // dark patch under the pointer. Here every particle of the mark takes part (the stable
    // 20% left dots standing in the hole), each leaves on its own bent heading with a
    // heavy-tailed strength (most are nudged, a few are thrown), one already flying is not
    // pushed harder, and a soft, lightly damped spring brings the pieces back.
    const logoK = cfg.forms && sceneS > 5 ? smooth(5, 6, sceneS) : 0;
    const LR = PR + 48 * logoK, LR2 = LR * LR;
    const stroke = Math.min(1, Math.hypot(ptr.vx, ptr.vy) / 420);
    const scatter = cfg.pointer && ptr.has && introDone && logoK > 0 && stroke > 0.01;

    const s0 = Math.floor(sceneS), s1 = Math.min(s0 + 1, 6), sf = sceneS - s0;
    // A shape is at full strength while its section heading is in view, then steps
    // back so it never sits on top of the reading. One factor per scene, each read
    // from its OWN section's scroll depth: switching a single factor on sceneTarget
    // made the whole shape jump the frame the target changed (0.28 -> 1 crossing into
    // Experience, and back the other way scrolling up).
    // The axis and the mark hold; the constellations sit at the edges so they only
    // step back a little; shapes that share space with the reading step back fully.
    for (let k = 0; k < sceneFade.length; k++) sceneFade[k] = 1;
    for (const sc of sections) {
      const d = (scrollY0 + H * 0.5 - sc.top) / H;
      if (d <= 0 || sc.scene >= sceneFade.length) continue;
      const depth = sc.scene === 4 || sc.scene === 6 ? 0 : sc.scene === 5 ? 0.3 : 0.72;
      sceneFade[sc.scene] = 1 - depth * smooth(0.55, 1.35, d);
    }
    const readAlpha = 1 - 0.46 * smooth(0.05, 0.6, Math.min(sceneS, 1));
    // break progress on the same wall clock as the page; a late skip compresses the rest into 0.5 s
    if (introPhase && it >= Tl.brk) {
      brkProgress = brkSkipAt < 0 ? (it - Tl.brk) / Tl.brkDur : brkSkipProg + ((it - brkSkipAt) / 0.5) * (1 - brkSkipProg);
      brkProgress = clamp01(brkProgress);
    }
    const conv = introPhase ? easeInOut(seg(it, Tl.conv[0], Tl.conv[1])) : 0;
    const dotsOut = introPhase ? seg(it, Tl.nameIn[0], Tl.nameIn[1]) : 0;
    const galA = introPhase ? easeOut(seg(it, 0, 1.4)) * 0.5 : 0;
    const skipK = skipT >= 0 ? (now - skipT) / 1000 : -1;

    for (let i = 0; i < drawN; i++) {
      let x, y, s, a, mix = 0, layer = 0;

      if (introPhase && skipK < 0 && it < Tl.brk) {
        // galaxy, then collapse onto the letters
        cloudAt(i, cam, cT, sT, 1, 0, f, intr);
        const nmv = clamp01((conv - P.seed[i] * 0.42) / 0.58);
        const nx = glyph ? glyph.ox + P.nx[i] : tmp.x, ny = glyph ? glyph.oy + P.ny[i] : tmp.y;
        x = tmp.x + (nx - tmp.x) * nmv; y = tmp.y + (ny - tmp.y) * nmv;
        s = tmp.s + ((P.tile[i] ? tileCSS * TILE_OVER : 1.4) - tmp.s) * nmv;
        a = (tmp.a * galA) + (0.95 - tmp.a * galA) * nmv;
        a *= 1 - dotsOut;
      } else if (introPhase && skipK < 0 && glyph) {
        // the letters break away: tiles first carry the glyph itself, then become dust
        cloudAt(i, cam, cTb, sTb, cY, sY, f, null);
        const rel = easeInOut(clamp01((brkProgress - P.delay[i]) / (1 - P.delay[i])));
        const sx0 = glyph.ox + P.nx[i], sy0 = glyph.oy + P.ny[i];
        // swoop on a quadratic arc instead of a straight line
        const mx = (sx0 + tmp.x) * 0.5 + (P.r2[i] - 0.5) * (tmp.y - sy0) * 0.5;
        const my = (sy0 + tmp.y) * 0.5 - (P.r2[i] - 0.5) * (tmp.x - sx0) * 0.5;
        const u = 1 - rel;
        x = u * u * sx0 + 2 * u * rel * mx + rel * rel * tmp.x;
        y = u * u * sy0 + 2 * u * rel * my + rel * rel * tmp.y;
        let cloudA = tmp.a * readAlpha;
        if (cfg.front && rel > 0.5 && tmp.z < 1.35 && tmp.z > 0.08) { layer = 1; cloudA *= 0.55; }
        if (P.tile[i]) {
          const tm = 1 - smooth(0.22, 0.42, rel);
          mix = tm;
          s = tm > 0 ? tileCSS * TILE_OVER * tm + tmp.s * (1 - tm) : tmp.s;
          a = 1 + (cloudA - 1) * smooth(0.15, 1, rel);
        } else {
          s = 1.2 + (tmp.s - 1.2) * rel; a = cloudA * rel;
        }
      } else if (introPhase && skipK >= 0) {
        // skipped: ease from wherever each particle was straight into the cloud
        cloudAt(i, cam, cT, sT, cY, sY, f, null);
        const k = easeInOut(clamp01((skipK - P.seed[i] * 0.25) / 0.55));
        x = FX[i] + (tmp.x - FX[i]) * k; y = FY[i] + (tmp.y - FY[i]) * k;
        s = FS[i] + (tmp.s - FS[i]) * k; a = FA[i] + (tmp.a * readAlpha - FA[i]) * k;
      } else {
        cloudAt(i, cam, cT, sT, cY, sY, f, null);
        x = tmp.x; y = tmp.y; s = tmp.s; a = tmp.a * readAlpha;
        const depthFront = cfg.front && tmp.z < 1.35 && tmp.z > 0.08;
        if (depthFront) { layer = 1; a *= 0.55; }
        if (cfg.forms && P.form[i] && sceneS > 0.001) {
          // bamlab-style handover: each particle leaves on its own delay and arcs
          let x0 = x, y0 = y, sz0 = s, a0 = a;
          if (s0 > 0) { shapeAt(s0, i); x0 = tmp.x; y0 = tmp.y; sz0 = tmp.s; a0 = tmp.a * sceneFade[s0]; }
          if (sf > 0) {
            shapeAt(s1, i);
            const d0 = P.r4[i] * 0.42;
            const l = smooth(d0, d0 + 0.55, sf);
            const mx = (x0 + tmp.x) * 0.5 + (P.r3[i] - 0.5) * (tmp.y - y0) * 0.45;
            const my = (y0 + tmp.y) * 0.5 - (P.r3[i] - 0.5) * (tmp.x - x0) * 0.45;
            const u = 1 - l;
            x = u * u * x0 + 2 * u * l * mx + l * l * tmp.x;
            y = u * u * y0 + 2 * u * l * my + l * l * tmp.y;
            s = sz0 + (tmp.s - sz0) * l;
            a = (a0 + (tmp.a * sceneFade[s1] - a0) * l) * (1 - 0.55 * Math.sin(Math.PI * l));
          } else { x = x0; y = y0; s = sz0; a = a0; }
          layer = 0;
        }
      }

      /* the pointer pushes; a spring brings each particle home */
      // on the way into Contact a shaped particle hands over from the loose cloud's push to
      // the mark's scatter in proportion to logoK, so neither switches off at the boundary
      const inLogo = logoK > 0 && P.form[i] === 1;
      if (inLogo) {
        if (scatter) {
          const dx = x + OX[i] - ptr.x, dy = y + OY[i] - ptr.y, d2 = dx * dx + dy * dy;
          if (d2 < LR2 && d2 > 0.01) {
            const d = Math.sqrt(d2), q = 1 - d / LR;
            const sw = (P.r2[i] - 0.5) * 3.6 + 1.2 * Math.sin(time * 2.3 + P.seed[i] * 40);
            const cs = Math.cos(sw), sn = Math.sin(sw), ox = dx / d, oy = dy / d;
            const ux = ox * cs - oy * sn, uy = ox * sn + oy * cs;
            const sp0 = Math.hypot(VX[i], VY[i]), room = sp0 < 820 ? 1 - sp0 / 820 : 0;
            const kick = q * stroke * 4400 * (0.1 + 2.6 * P.r4[i] * P.r4[i]) * room * logoK;
            const drag = q * 0.6 * room * logoK;
            VX[i] += (ux * kick + ptr.vx * drag) * dt; VY[i] += (uy * kick + ptr.vy * drag) * dt;
          }
        }
      }
      const loose = inLogo ? 1 - logoK : 1;
      if (usePtr && loose > 0 && !P.stable[i]) {
        const dx = x + OX[i] - ptr.x, dy = y + OY[i] - ptr.y, d2 = dx * dx + dy * dy;
        if (d2 < PR2 && d2 > 0.01) {
          const d = Math.sqrt(d2), q = 1 - d / PR;
          const push = q * q * ptr.energy * 2600 * (0.55 + P.scale[i] * 0.6) * loose;
          VX[i] += (dx / d) * push * dt; VY[i] += (dy / d) * push * dt;
        }
      }
      if (OX[i] !== 0 || OY[i] !== 0 || VX[i] !== 0 || VY[i] !== 0) {
        // the mark's pieces float home on a soft spring; everything else snaps back
        const kS = inLogo ? 26 - 20 * logoK : 26, kD = inLogo ? 7.2 - 4.7 * logoK : 7.2;
        VX[i] += (-kS * OX[i] - kD * VX[i]) * dt; VY[i] += (-kS * OY[i] - kD * VY[i]) * dt;
        OX[i] += VX[i] * dt; OY[i] += VY[i] * dt;
        if (Math.abs(OX[i]) + Math.abs(OY[i]) < 0.02 && Math.abs(VX[i]) + Math.abs(VY[i]) < 0.05) { OX[i] = OY[i] = VX[i] = VY[i] = 0; }
        else { x += OX[i]; y += OY[i]; }
      }

      X[i] = x; Y[i] = y; S[i] = s; A[i] = a > 1 ? 1 : a; M[i] = mix; L[i] = layer;
    }

    if (introPhase && (brkProgress >= 1 || (skipK >= 0 && skipK > 0.9))) { introDone = true; intro.done = true; }
  }

  /* Freeze every particle where it is and ease it into the cloud. If nothing has
     been drawn yet (the module arrived late) there is nowhere to ease from:
     start in the cloud and let the canvas fade in. */
  function freezeAndEase(now) {
    if (!draws) { introDone = true; if (intro) intro.done = true; return; }
    for (let i = 0; i < N; i++) { FX[i] = X[i]; FY[i] = Y[i]; FA[i] = A[i]; FS[i] = S[i]; M[i] = 0; }
    skipT = now;
  }
  function sectionScene() {
    if (!sections.length) return 0;
    const probe = scrollY0 + H * 0.5;
    let sc = 0;
    for (const s of sections) if (probe >= s.top) sc = s.scene;
    return sc;
  }

  /* ---------- drawing ---------- */
  const buf = { data: null };
  function pack() {
    if (!buf.data || buf.data.length !== N * 6) buf.data = new Float32Array(N * 6);
    const d = buf.data;
    for (let i = 0, j = 0; i < drawN; i++, j += 6) { d[j] = X[i]; d[j + 1] = Y[i]; d[j + 2] = S[i]; d[j + 3] = A[i]; d[j + 4] = M[i]; d[j + 5] = L[i]; }
    return d;
  }
  function drawGL(g, res, layer, data) {
    g.viewport(0, 0, g.drawingBufferWidth, g.drawingBufferHeight);
    g.clearColor(0, 0, 0, 0); g.clear(g.COLOR_BUFFER_BIT);
    g.useProgram(res.prog);
    syncGlyph(g, res);
    g.bindBuffer(g.ARRAY_BUFFER, res.dyn);
    g.bufferSubData(g.ARRAY_BUFFER, 0, data.subarray(0, drawN * 6));
    const st = 24, a = res.a;
    g.enableVertexAttribArray(a.pos); g.vertexAttribPointer(a.pos, 2, g.FLOAT, false, st, 0);
    g.enableVertexAttribArray(a.size); g.vertexAttribPointer(a.size, 1, g.FLOAT, false, st, 8);
    g.enableVertexAttribArray(a.alpha); g.vertexAttribPointer(a.alpha, 1, g.FLOAT, false, st, 12);
    g.enableVertexAttribArray(a.mix); g.vertexAttribPointer(a.mix, 1, g.FLOAT, false, st, 16);
    g.enableVertexAttribArray(a.layer); g.vertexAttribPointer(a.layer, 1, g.FLOAT, false, st, 20);
    g.bindBuffer(g.ARRAY_BUFFER, res.stat);
    g.enableVertexAttribArray(a.tile); g.vertexAttribPointer(a.tile, 2, g.FLOAT, false, 12, 0);
    g.enableVertexAttribArray(a.tone); g.vertexAttribPointer(a.tone, 1, g.FLOAT, false, 12, 8);
    g.uniform2f(res.u.res, g.drawingBufferWidth, g.drawingBufferHeight);
    g.uniform1f(res.u.dpr, dpr);
    g.uniform1f(res.u.layer, layer);
    g.uniform1i(res.u.glyph, 0);
    g.uniform2f(res.u.glyphSize, glyph ? glyph.w : 1, glyph ? glyph.h : 1);
    g.uniform1f(res.u.tileTex, tileCSS * TILE_OVER * (glyph ? glyph.ratio : 1));
    g.activeTexture(g.TEXTURE0); g.bindTexture(g.TEXTURE_2D, res.tex);
    g.drawArrays(g.POINTS, 0, drawN);
  }
  function draw2D() {
    const c = ctx2d;
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    c.clearRect(0, 0, W, H);
    for (let i = 0; i < drawN; i++) {
      const a = A[i]; if (a < 0.01) continue;
      c.globalAlpha = a;
      if (M[i] > 0.5 && glyph) {
        const t = tileCSS * TILE_OVER * glyph.ratio;
        c.drawImage(glyph.canvas, P.tu[i], P.tv[i], t, t, X[i] - S[i] / 2, Y[i] - S[i] / 2, S[i], S[i]);
      } else {
        c.fillStyle = P.tone[i] ? '#CDB88A' : '#ECEEF1';
        const s = S[i] < 1 ? 1 : S[i] * 0.7;
        c.fillRect(X[i] - s / 2, Y[i] - s / 2, s, s);
      }
    }
    c.globalAlpha = 1;
  }

  function frame(now) {
    frameId = 0;
    if (disposed || paused || hidden || (gl && !R)) return;   // (gl && !R): context lost, wait for restore
    const t0 = performance.now();
    if (intro && !introDone && intro.t0 == null) {
      if (gl) { gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT); }
      frameId = requestAnimationFrame(frame); return;
    }
    step(now);
    draws++;
    if (gl && R) {
      const d = pack();
      drawGL(gl, R, 0, d);
      if (glFront && RF) drawGL(glFront, RF, 1, d);
    } else if (ctx2d) draw2D();
    // adapt: judge by what the viewer gets (frame interval against the display's
    // own refresh) as well as by our CPU time, so GPU-bound drops count too
    frameCost = frameCost * 0.95 + (performance.now() - t0) * 0.05;
    if (lastNow) {
      const iv = now - lastNow;
      // the display's period: 10th percentile of the last 240 intervals. One stray
      // short frame can't pin it low, and a device capped at 30 fps reads as 30 fps;
      // sustained overload trips degrade() long before the window fills with slow frames
      // only frames that keep up may teach us the period; slow frames never do
      if (iv > 4 && iv < 60 && !(ivEMA > refresh * 1.45)) { ring[ringI++ % 240] = iv; if (ringI % 60 === 0) { const sorted = ring.slice(0, Math.min(ringI, 240)).sort((a, b) => a - b); refresh = sorted[Math.floor(sorted.length * 0.1)]; } }
      ivEMA = ivEMA ? ivEMA * 0.94 + Math.min(iv, 100) * 0.06 : iv;
    }
    lastNow = now;
    const behind = ivEMA > refresh * 1.45 || frameCost > refresh * 0.55;
    if (behind && introDone && !paused) { if (++slow > 120) degrade(); } else slow = Math.max(0, slow - 2);
    if (still && introDone) return;          // motion paused: one static frame is enough
    frameId = requestAnimationFrame(frame);
  }
  function degrade() {
    slow = 0; frameCost = 0; ivEMA = 0;
    if (drawN > 1200) { drawN = Math.max(1200, Math.round(drawN * 0.7)); return; }
    if (cfg.dpr > 1) { cfg = { ...cfg, dpr: 1 }; size(); }
  }
  function run() {
    if (gl && !R) return;              // context lost: wait for restore
    if (!frameId && !disposed && !paused && !hidden) { last = 0; lastNow = 0; ivEMA = 0; frameId = requestAnimationFrame(frame); }
  }

  /* ---------- lifecycle ---------- */
  function fallback2D() {
    // a canvas that ever produced a WebGL context can never give a 2D one: swap in a fresh element
    if (gl) { freeGL(gl, R); gl = null; R = null; const fresh = back.cloneNode(false); back.replaceWith(fresh); back = fresh; size(); }
    ctx2d = back.getContext('2d');
    if (!ctx2d) throw new Error('No canvas renderer');
    drawN = N = Math.min(N, 1200);
  }
  function init() {
    size();
    if (!P) alloc(cfg.n);
    drawN = N;
    let b = null;
    try { b = initGL(back); } catch (e) { b = null; if (back.getContext('webgl2') || back.getContext('webgl')) gl = back.getContext('webgl2') || back.getContext('webgl'); }
    if (b) {
      gl = b.g; R = b.res; uploadStatic(gl, R);
      if (cfg.front && front) {
        try {
          const fr = initGL(front);
          if (fr) { glFront = fr.g; RF = fr.res; uploadStatic(glFront, RF); front.hidden = false; }
        } catch (e) { glFront = null; RF = null; }
      }
    } else fallback2D();
    if (cfg.forms) (window.requestIdleCallback || setTimeout)(() => { if (!disposed) sampleLogo(); });
  }

  listen(back, 'webglcontextlost', e => { e.preventDefault(); cancelAnimationFrame(frameId); frameId = 0; R = null; if (intro && !introDone) api.finishNow(); if (formOn) { formOn = false; onForm && onForm(false); } onRenderer && onRenderer('lost'); }, { passive: false });
  listen(back, 'webglcontextrestored', () => { try { R = buildGL(gl); uploadStatic(gl, R); R.glyphStamp = -1; onRenderer && onRenderer('webgl'); run(); } catch (e) { destroy(); onRenderer && onRenderer('none'); } });
  if (front) {
    listen(front, 'webglcontextlost', e => { e.preventDefault(); RF = null; }, { passive: false });
    listen(front, 'webglcontextrestored', () => { try { RF = buildGL(glFront); uploadStatic(glFront, RF); RF.glyphStamp = -1; } catch (e) { RF = null; } });
  }
  listen(window, 'pointermove', e => {
    if (e.pointerType === 'touch') return;
    const dx = e.clientX - ptr.tx, dy = e.clientY - ptr.ty;
    if (!ptr.has) { ptr.x = e.clientX; ptr.y = e.clientY; }
    ptr.tx = e.clientX; ptr.ty = e.clientY; ptr.has = true;
    ptr.energy = Math.min(1, ptr.energy + Math.min(1, Math.hypot(dx, dy) / 40));
  });
  listen(document, 'pointerleave', () => { ptr.has = false; });
  listen(document, 'visibilitychange', () => { hidden = document.hidden; if (!hidden) run(); });
  let rzT = 0, lastW = innerWidth, lastH = innerHeight;
  listen(window, 'resize', () => {
    clearTimeout(rzT);
    rzT = setTimeout(() => {
      if (disposed) return;
      // phones resize on every address-bar move; ignore small height-only changes
      if (introDone && innerWidth === lastW && Math.abs(innerHeight - lastH) < 160 && matchMedia('(pointer: coarse)').matches) return;
      lastW = innerWidth; lastH = innerHeight;
      size();
      if (intro && !introDone && intro.t0 != null) {
        const it = (performance.now() - intro.t0) / 1000;
        if (it < intro.T.brk) { if (glyph) rasterName(); }   // the name moved: sample it where it is now
        else api.skip();                                       // mid-break: finish cleanly instead of flying from stale spots
      }
      if (still) frame(performance.now());   // frame() carries the lost-context guard; never step() around it
    }, 150);
  });

  function destroy() {
    disposed = true; abort.abort(); cancelAnimationFrame(frameId); clearTimeout(rzT);
    freeGL(gl, R); freeGL(glFront, RF);
    for (const g of [gl, glFront]) { try { g && g.getExtension('WEBGL_lose_context')?.loseContext(); } catch (e) { /* ignore */ } }
    gl = glFront = null; R = RF = null; ctx2d = null;
    P = null; X = Y = S = A = M = L = null; glyph = null;
  }

  init();
  // the listeners above were bound to the original canvas; a 2D swap needs none of them
  const api = {
    get renderer() { return gl ? 'webgl' : ctx2d ? '2d' : 'none'; },
    get tilesReady() { return !!glyph && (!!R || !!ctx2d); },
    get forms() { return !!cfg.forms; },
    fontsChanged() {
      if (!intro || introDone || intro.t0 == null || !glyph) return;
      if ((performance.now() - intro.t0) / 1000 < intro.T.brk) rasterName();
    },
    /* the entrance has been skipped: freeze where everything is and ease it home */
    skip(now = performance.now()) {
      if (introDone || !intro || intro.t0 == null) return;
      const it = (now - intro.t0) / 1000;
      if (it >= intro.T.brk) { if (brkSkipAt < 0) { brkSkipAt = it; brkSkipProg = brkProgress; } return; }
      freezeAndEase(now);
    },
    finishNow() { introDone = true; if (intro) intro.done = true; },
    setSections(list, mark, axisX) { sections = list; markBox = mark; if (axisX != null) lineX = axisX; },
    setPaused(v) { paused = v; if (!v) run(); },
    setStill(v) { still = v; if (!v) run(); else if (!frameId) frame(performance.now()); },
    start() { run(); },
    destroy,
    // debug reads for the tests: how many shaped particles are drawn within r of a point
    // this frame, how many are pushed off their spot and how far (90th percentile), and
    // where the Experience motes are
    probe(x, y, r) {
      if (!P) return null;
      let near = 0, shaped = 0; const off = [];
      for (let i = 0; i < drawN; i++) {
        if (!P.form[i]) continue;
        shaped++;
        const dx = X[i] - x, dy = Y[i] - y;
        if (dx * dx + dy * dy < r * r && A[i] > 0.05) near++;
        const o = Math.hypot(OX[i], OY[i]); if (o > 6) off.push(o);
      }
      off.sort((a, b) => a - b);
      return { near, shaped, displaced: off.length, p90: off.length ? Math.round(off[Math.floor(off.length * 0.9)]) : 0 };
    },
    // hold the scene blend at s (null lets it follow the scroll again), so a test can
    // measure the pointer in the middle of a transition that normally lasts a second
    holdScene(s) { heldScene = s == null ? null : +s; },
    motes() {
      if (!P) return [];
      const out = [];
      for (let i = 0; i < drawN; i++) if (P.form[i] && P.r3[i] < MOTES) out.push([+X[i].toFixed(1), +Y[i].toFixed(1), +A[i].toFixed(2), +S[i].toFixed(2)]);
      return out;
    },
    inspect() {
      // meanAlpha is what the section shapes actually add up to on screen this frame;
      // the smoothness check sweeps a section boundary and watches it for a step
      let sum = 0; for (let i = 0; i < drawN; i++) sum += A[i];
      return { N, drawN, T, tileCSS, dpr, renderer: api.renderer, introDone, sceneS, sceneTarget, meanAlpha: drawN ? +(sum / drawN).toFixed(5) : 0, sceneFade: Array.from(sceneFade), frameCost: +frameCost.toFixed(2), front: !!RF, formOn, paused, still, draws, glyphX: glyph ? glyph.ox : null, glyphY: glyph ? glyph.oy : null, glyphW: glyph ? glyph.gw : null };
    }
  };
  onRenderer && onRenderer(api.renderer);
  return api;
}
