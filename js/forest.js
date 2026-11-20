/* forest.js — the black forest, from above.

   the page is laid out as ordinary html. this file plants a fir in every free
   spot of the document, leaves a clearing around anything marked
   [data-clearing], cuts the wordmark out of the trees, and runs a trail
   through all of it. trees are drawn as instanced quads in webgl; everything
   that moves (camera, wind, clearings opening) is a uniform, so nothing is
   recomputed per tree while you scroll. */

(() => {
  'use strict';

  const root = document.documentElement;
  const canvas = document.getElementById('forest');
  const mark = document.querySelector('.wordmark svg');
  if (!canvas || !mark) return;

  // the page works without any of this: the name is drawn in ink by default,
  // and only gives way to the forest once .forest-on is set further down.
  // with forced colors the text takes the system palette; a painted forest
  // behind it would no longer be guaranteed to contrast, so leave it out.
  // the same goes for a machine with no real gpu, where a software renderer
  // takes about a second a frame: failIfMajorPerformanceCaveat asks the
  // browser to refuse that (and software(), further down, checks by name).
  const gl = matchMedia('(forced-colors: active)').matches
    ? null
    : canvas.getContext('webgl2', { alpha: true, antialias: false, depth: false, stencil: false, failIfMajorPerformanceCaveat: true });
  if (!gl) {
    root.classList.add('plain'); // (the stylesheet lays the page out a little differently without a forest)
    return;
  }

  // there is going to be a forest: the copy may refer to it. (set before
  // anything is measured, so the text does not move afterwards.)
  root.classList.add('has-forest');

  const STRIDE = 12; // floats per tree: x y | size height seed clear | dynId dynDist strokeDist strokeT | trust dynId2*1024+dynDist2
  const BYTES = STRIDE * 4;
  const MAX_DYN = 16;
  const MAX_GUST = 10;
  const FLOOR = 1.25; // how far the shade under a fir reaches, in tree spacings
  const NAME_BAND = 4; // how much forest is kept standing about the name, in tree spacings
  const EDGE_ROLL = 2; // how much further the edge of the forest swells in and out than the rim of a clearing does, in two columns (in one: 3.2 times. there the screen is hardly wider than one swell, and with less the edge is a straight line)
  const BUDGET = 120; // how long a painting of the forest may take, in ms, to be worth showing
  const EASY = 34; // ...and how long it may take for the forest to move at full resolution: two frames

  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  const scheme = matchMedia('(prefers-color-scheme: dark)');

  /* ------------------------------------------------------------ shaders */

  const VERT = `#version 300 es
  precision highp float;
  precision highp int;
  layout(location=0) in vec2 aCorner;
  layout(location=1) in vec2 aPos;
  layout(location=2) in vec4 aTree;
  layout(location=3) in vec4 aExtra;
  layout(location=4) in vec2 aFloor;

  uniform vec2 uView;
  uniform float uTop;
  uniform float uDpr;
  uniform vec2 uNadir;
  uniform float uLean;
  uniform float uMaxLean;
  uniform float uTime;
  uniform float uReveal;
  uniform float uGrowIn;
  uniform vec3 uOrigin;
  uniform float uEdge;
  uniform float uGrowPx;
  uniform float uGrow[${MAX_DYN}];
  uniform vec2 uCenter[${MAX_DYN}];
  uniform vec4 uGust[${MAX_GUST}];
  uniform vec2 uGustP[${MAX_GUST}];
  uniform vec2 uSun;
  uniform float uFloor;
  uniform float uWind;
  uniform float uDeep;
  uniform vec2 uTilt;
  uniform int uPass;

  out vec2 vUV;
  out vec4 vInfo;

  // smooth noise, for the patches of lighter and darker canopy
  float cell(vec2 p) {
    p = fract(p * vec2(0.1031, 0.1030));
    p += dot(p, p.yx + 33.33);
    return fract((p.x + p.y) * p.x);
  }
  float shade(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(cell(i), cell(i + vec2(1.0, 0.0)), f.x), mix(cell(i + vec2(0.0, 1.0)), cell(i + vec2(1.0, 1.0)), f.x), f.y);
  }

  void main() {
    float size = aTree.x, h = aTree.y, seed = aTree.z;

    // how far this tree stands from the nearest open ground. the wordmark
    // is open from the start; the trail opens along its length (uReveal).
    float c = aTree.w;
    float open = smoothstep(aExtra.w, aExtra.w + 0.04, uReveal);
    c = min(c, mix(1.0e4, aExtra.z, open));

    vec2 wind = vec2(0.0);
    float opening = 0.0; // how far open the clearing this fir gives way to is, 0 to 1
    int id = int(aExtra.x + 0.5) - 1;
    if (id >= 0) {
      float g = uGrow[id];
      opening = clamp(g, 0.0, 1.0);
      c = min(c, aExtra.y - g * uGrowPx);
      vec2 d = aPos - uCenter[id];
      float fall = 1.0 - smoothstep(0.0, uGrowPx * 4.0, aExtra.y);
      wind += normalize(d + 0.001) * g * fall * uGrowPx * 0.32;
    }
    float s = smoothstep(-0.4 * uEdge, 0.6 * uEdge, c);

    // the forest comes up from the middle of the screen, once: a wave moving
    // outwards, with every fir a little behind it by an amount of its own.
    // the front is narrow enough to be seen as one: bare ground ahead of
    // it, forest behind, and only a band of half-grown firs between.
    // what was off the screen when it began is simply there, however far
    // off: nobody saw it come up, and a scroll in the first second must not
    // find bare ground. (uOrigin.z is half the screen's diagonal, so nothing
    // past it was on the screen. where the two meet, each fir draws the
    // line in a slightly different place, so there is no line to see.)
    float away = distance(aPos, uOrigin.xy) / uOrigin.z;
    float there = smoothstep(1.04, 1.26, away + (fract(seed * 13.7) - 0.5) * 0.08);
    float front = uGrowIn * 6.2 - away * 5.0;
    float wave = mix(front, 10.0, there);
    float gi = clamp(wave - seed * 0.12, 0.0, 1.0);
    float gb = gi - 1.0;
    float grown = 1.0 + 2.2 * gb * gb * gb + 1.2 * gb * gb;
    s *= grown;

    // gusts and ripples: each one is the impulse response of a damped spring,
    // so the canopy swings and settles without any per-tree state
    for (int i = 0; i < ${MAX_GUST}; i++) {
      if (uWind < 0.5) break; // (nothing is blowing)
      vec4 g = uGust[i];
      vec2 p = uGustP[i];
      float age = uTime - p.x;
      if (age < 0.0 || age > 3.5) continue;
      vec2 d = aPos - g.xy;
      float dist = length(d);
      if (p.y > 0.0) {
        float a = age - dist / 900.0;
        if (a > 0.0) wind += g.zw * exp(-dist * dist / (p.y * p.y)) * exp(-2.4 * a) * sin(a * (7.5 + seed * 4.0));
      } else {
        float a = age - dist / 620.0;
        if (a > 0.0) wind += (d / max(dist, 1.0)) * g.z * exp(dist / p.y) * exp(-3.0 * a) * sin(a * (8.0 + seed * 2.0));
      }
    }
    wind *= h * s;

    // perspective: firs lean away from the point straight below the camera.
    // while the forest holds still that point may not follow the scroll, so
    // across the page they lean as ever and down it they all lean alike.
    vec2 off = vec2(aPos.x - uNadir.x, mix(aPos.y - uNadir.y, uTilt.y, uTilt.x));
    vec2 persp = off * uLean * h;
    float pl = length(persp);
    // (it levels off with distance, gently. on a big screen the firs out at
    // the edges would otherwise all lie over the same way, like a combed field.)
    persp *= uMaxLean * (1.0 - exp(-pl / uMaxLean)) / max(pl, 0.001);
    // no two firs stand quite alike: each has a slight lean of its own as
    // well. (all leaning the same way, they comb the canopy into stripes.)
    // not at a rim, though: the firs that draw the edge of a letter or a
    // clearing stand straight, so that the edge stays where it was put.
    persp += (vec2(fract(seed * 91.7), fract(seed * 57.3)) - 0.5) * uMaxLean * 1.3 * smoothstep(uEdge * 1.5, uEdge * 6.0, c);
    persp *= s;

    float r = size * s;
    vec2 pos;
    if (uPass == 0) {
      // shadows lie on the ground: they follow the wind, not the camera
      vec2 tip = uSun * (r * h * 2.3) + wind * 0.8;
      float len = length(tip);
      vec2 dir = tip / max(len, 0.001);
      vec2 nrm = vec2(-dir.y, dir.x);
      float rs = r * 0.8;
      vec2 loc = vec2(mix(-rs - 1.0, len + 1.0, aCorner.x * 0.5 + 0.5), aCorner.y * (rs + 1.0));
      pos = aPos + dir * loc.x + nrm * loc.y;
      vUV = loc;
      vInfo = vec4(seed, 1.0, len, rs);
    } else if (uPass == 1) {
      // the ground under the canopy is in shade
      // ...but never further out than the firs that stand at the rim
      // (c says how far it is to open ground, but where a rim has a sharp
      // bite in it c overstates that. aFloor.x is how much of it to believe.)
      // (and while that clearing is opening, c is taken for a little less
      // again. it is not a true distance: where a rim has a bite in it, the
      // firs behind the bite are told they stand further in than they do.
      // that does no harm until the rim comes to them.)
      float far = (c - opening * uFloor * 1.2) * aFloor.x;
      // a fir only gives way to the clearing nearest to it. if the one on its
      // other side opens towards it, it may be left standing near a rim that
      // c knows nothing about. aFloor.y says which clearing that would be,
      // and how far off its rim is: the patch keeps behind that rim as well,
      // wherever it has got to. (the two are packed into the one number.)
      int other = int(aFloor.y / 1024.0) - 1;
      if (other >= 0) far = min(far, (mod(aFloor.y, 1024.0) - uGrow[other] * uGrowPx) * aFloor.x);
      // (deep in the forest it reaches a little further: the grid the firs
      // stand on is bent, and here and there that opens a gap between them)
      float reach = uFloor * (1.0 + uDeep * smoothstep(uFloor * 2.2, uFloor * 3.4, far));
      float rr = min(reach, max(r * 0.6, far - uFloor * 0.7));
      // ...nor, while the forest is still coming up, ahead of the firs: it
      // waits until every fir around this one is most of the way up, or the
      // front of the wave would be a row of dark discs
      // (the same along the line where the forest that was there from the
      // start meets the forest that is coming up: the firs on that line
      // wait for the front too)
      rr = mix(r * 0.6, rr, there > 0.999 ? 1.0 : clamp((front - 0.9) * 2.5, 0.0, 1.0));
      pos = aPos + aCorner * (rr + 1.0);
      vUV = aCorner * (rr + 1.0) / max(rr, 0.001);
      // (x: how near the rim this fir stands, which is where its patch of
      // floor can show. z, w: a direction of its own to turn the patch by.)
      vInfo = vec4(1.0 - smoothstep(uFloor * 1.3, uFloor * 2.6, far), rr * uDpr, cos(seed * 40.0), sin(seed * 40.0));
    } else {
      float f = uPass == 2 ? 0.0 : (uPass == 3 ? 0.52 : 1.0);
      float k = uPass == 2 ? 1.0 : (uPass == 3 ? 0.7 : 0.4);
      float rr = r * k;
      pos = aPos + (persp + wind) * f + aCorner * (rr + 1.0);
      vUV = aCorner * (rr + 1.0) / max(rr, 0.001);
      // stands of older and younger firs: the canopy is lighter in some
      // places and darker in others, in patches a dozen trees across
      float tone = shade(aPos / (uFloor * 15.0)) * 0.65 + shade(aPos / (uFloor * 5.0) + 40.0) * 0.35;
      vInfo = vec4(seed, rr * uDpr, tone, 0.0);
    }
    if (s < 0.12) pos = vec2(-9999.0); // (a fir that small is a speck on the open ground)
    gl_Position = vec4(pos.x / uView.x * 2.0 - 1.0, 1.0 - (pos.y - uTop) / uView.y * 2.0, 0.0, 1.0);
  }`;

  const FRAG = `#version 300 es
  precision highp float;
  precision highp int;
  in vec2 vUV;
  in vec4 vInfo;
  uniform int uPass;
  uniform float uDpr;
  uniform vec3 uShade;
  uniform float uVeil;
  uniform vec3 uGround;
  uniform vec3 uFir[3];
  uniform vec3 uFirLit[3];
  uniform vec3 uTip;
  out vec4 o;

  void main() {
    if (uPass == 0) {
      // a fir's shadow: wide at the foot, running out to a point
      float t = clamp(vUV.x / max(vInfo.z, 0.001), 0.0, 1.0);
      float d = length(vUV - vec2(t * vInfo.z, 0.0)) - mix(vInfo.w, vInfo.w * 0.08, t);
      float a = clamp(0.5 - d * uDpr, 0.0, 1.0) * uVeil;
      o = vec4(uShade * a, a);
      return;
    }
    float seed = vInfo.x;
    float rad = length(vUV);
    if (uPass == 1) {
      // the ground in the shade of the canopy. deep in the forest it is a
      // plain disc, wide enough that no snow shows between the crowns. it
      // reaches a little further than the crown above it, though, so at a
      // rim, where it can be seen, it has to read as undergrowth: eight
      // ragged points, turned differently under every fir.
      // (cos 8t, worked out from cos t.)
      vec2 dir = vUV / max(rad, 0.001);
      float ct = dir.x * vInfo.z - dir.y * vInfo.w;
      float c4 = 8.0 * ct * ct * (ct * ct - 1.0) + 1.0;
      float edge = 1.0 - vInfo.x * 0.3 * (1.0 - c4 * c4);
      float a = clamp(0.5 - (rad - edge) * vInfo.y, 0.0, 1.0);
      o = vec4(uGround * a, a);
      return;
    }
    // one tier of branches seen from above: a ring of spikes
    float ang = atan(vUV.y, vUV.x);
    float n = 7.0 + floor(seed * 4.0);
    float k = 0.5 + 0.5 * cos(ang * n + seed * 60.0 + float(uPass) * 1.7);
    float a = clamp(0.5 - (rad - (1.0 - (0.3 + 0.2 * fract(seed * 7.3)) * k)) * vInfo.y, 0.0, 1.0);
    if (a <= 0.0) discard;
    int i = uPass - 2;
    float lit = dot(vUV / max(rad, 0.001), vec2(-0.86, -0.5));
    vec3 col = mix(uFir[i], uFirLit[i], smoothstep(-0.3, 1.0, lit));
    col *= (0.9 + 0.2 * fract(seed * 9.37)) * (0.72 + 0.56 * vInfo.z);
    if (uPass == 4) col = mix(uTip, col, smoothstep(0.0, 0.3, rad));
    o = vec4(col * a, a);
  }`;

  let prog = null;
  let U = {};
  let quadBuf = null;
  let treeBuf = null;

  let live = false; // program linked and in use: safe to draw

  // compiling and linking the shaders can take a tenth of a second or more.
  // this only starts it; the promise settles once the program is ready. where
  // the browser can compile off the main thread that wait costs nothing, and
  // either way the forest gets planted in the meantime.
  function buildProgram() {
    const shader = (type, src) => {
      const sh = gl.createShader(type);
      gl.shaderSource(sh, src);
      gl.compileShader(sh);
      return sh;
    };
    const vs = shader(gl.VERTEX_SHADER, VERT);
    const fs = shader(gl.FRAGMENT_SHADER, FRAG);
    prog = gl.createProgram();
    gl.attachShader(prog, vs);
    gl.attachShader(prog, fs);
    gl.linkProgram(prog);

    const parallel = gl.getExtension('KHR_parallel_shader_compile');
    return new Promise((resolve, reject) => {
      const finish = () => {
        if (gl.getProgramParameter(prog, gl.LINK_STATUS)) resolve();
        else reject(new Error(gl.getProgramInfoLog(prog) || gl.getShaderInfoLog(vs) || gl.getShaderInfoLog(fs) || 'the forest shaders did not link'));
      };
      const poll = () => {
        if (gl.isContextLost()) reject(new Error('webgl context lost'));
        else if (gl.getProgramParameter(prog, parallel.COMPLETION_STATUS_KHR)) finish();
        else requestAnimationFrame(poll);
      };
      // without the extension asking for the status blocks until the work is
      // done, so ask in a later task, after the planting
      if (parallel) poll();
      else setTimeout(finish, 0);
    });
  }

  // not every browser refuses a software renderer when asked to, so go by its
  // name as well. asking for the name waits until the context is fully set
  // up, which is why this is left until the forest is starting anyway.
  function software() {
    let renderer = String(gl.getParameter(gl.RENDERER) || '');
    if (!renderer || /webkit|mozilla/i.test(renderer)) {
      const info = gl.getExtension('WEBGL_debug_renderer_info');
      if (info) renderer = String(gl.getParameter(info.UNMASKED_RENDERER_WEBGL) || '');
    }
    return /swiftshader|llvmpipe|softpipe|software|basic render|\bwarp\b/i.test(renderer);
  }

  function useProgram() {
    gl.useProgram(prog);
    U = {};
    const count = gl.getProgramParameter(prog, gl.ACTIVE_UNIFORMS);
    for (let i = 0; i < count; i++) {
      const name = gl.getActiveUniform(prog, i).name.replace(/\[0\]$/, '');
      U[name] = gl.getUniformLocation(prog, name);
    }
    live = true;
  }

  // buffers and state that do not depend on the program
  function initGL() {
    quadBuf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, quadBuf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

    treeBuf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, treeBuf);
    for (let loc = 1; loc <= 4; loc++) {
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribDivisor(loc, 1);
    }

    gl.disable(gl.DEPTH_TEST);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
  }

  /* ------------------------------------------------------------- helpers */

  const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

  // 0 below a, 1 above b, eased in between
  const ease = (a, b, v) => {
    const t = clamp((v - a) / (b - a), 0, 1);
    return t * t * (3 - 2 * t);
  };

  function hash(i, j, k) {
    let n = Math.imul(i, 374761393) + Math.imul(j, 668265263) + Math.imul(k, 974711);
    n = Math.imul(n ^ (n >>> 13), 1274126177);
    n ^= n >>> 16;
    return (n >>> 0) / 4294967296;
  }

  function vnoise(x, y) {
    const xi = Math.floor(x);
    const yi = Math.floor(y);
    const xf = x - xi;
    const yf = y - yi;
    const u = xf * xf * (3 - 2 * xf);
    const v = yf * yf * (3 - 2 * yf);
    const a = hash(xi, yi, 7);
    const b = hash(xi + 1, yi, 7);
    const c = hash(xi, yi + 1, 7);
    const d = hash(xi + 1, yi + 1, 7);
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
  }

  // custom properties as [r, g, b] each. the values go through a 2d canvas, so
  // they can be written any way css allows: hex, rgb(), a named colour, oklch()...
  const swatch = document.createElement('canvas').getContext('2d', { willReadFrequently: true });
  function cssColors(names) {
    const style = getComputedStyle(root);
    swatch.clearRect(0, 0, names.length, 1);
    names.forEach((name, i) => {
      swatch.fillStyle = style.getPropertyValue(name).trim();
      swatch.fillRect(i, 0, 1, 1);
    });
    const px = swatch.getImageData(0, 0, names.length, 1).data;
    return names.map((_, i) => [px[i * 4] / 255, px[i * 4 + 1] / 255, px[i * 4 + 2] / 255]);
  }

  const mix3 = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

  // catmull-rom through pts, sampled every `step` px
  function spline(pts, step) {
    const out = [];
    for (let i = 0; i < pts.length - 1; i++) {
      const p0 = pts[Math.max(0, i - 1)];
      const p1 = pts[i];
      const p2 = pts[i + 1];
      const p3 = pts[Math.min(pts.length - 1, i + 2)];
      const n = Math.max(2, Math.ceil(Math.hypot(p2[0] - p1[0], p2[1] - p1[1]) / step));
      for (let k = 0; k < n; k++) {
        const t = k / n;
        const t2 = t * t;
        const t3 = t2 * t;
        out.push([
          0.5 * (2 * p1[0] + (p2[0] - p0[0]) * t + (2 * p0[0] - 5 * p1[0] + 4 * p2[0] - p3[0]) * t2 + (3 * p1[0] - p0[0] - 3 * p2[0] + p3[0]) * t3),
          0.5 * (2 * p1[1] + (p2[1] - p0[1]) * t + (2 * p0[1] - 5 * p1[1] + 4 * p2[1] - p3[1]) * t2 + (3 * p1[1] - p0[1] - 3 * p2[1] + p3[1]) * t3),
        ]);
      }
    }
    out.push(pts[pts.length - 1]);
    return out;
  }

  /* -------------------------------------------------------------- layout */

  // everything below is in page coordinates (css px from the top of the document)
  let W = 0;
  let VH = 0;
  let docH = 0;
  let sp = 13; // tree spacing
  let pad = 50; // clearing margin around content
  let edge = 18; // width of the young growth at a clearing's rim
  let growPx = 24; // how far a clearing opens under the pointer
  let oneColumn = false; // the page is laid out in one column (the stylesheet's breakpoint)
  const TRAIL = 1.1; // wordmark segments are numbered 0..1 along the name, the trail from here on
  let segs = []; // wordmark + trail: [x1, y1, x2, y2, halfWidth, t1, t2, rough]
  let rects = [];
  let treeline = 1e9;
  let straggle = 0;
  let maxT = 1;
  let hedge = 60; // how wide a strip of forest is left between two clearings
  let nameLines = []; // the strokes of the wordmark, as lines of page points
  let nameHalf = 10; // half the width they are cut to
  const growIndex = new Map(); // element -> which of the opening clearings it is
  const centers = new Float32Array(MAX_DYN * 2);

  let trees = new Float32Array(0);
  let rows = 0;

  // the wordmark's strokes as polylines, in the svg's own units. read from the
  // dom once: asking an svg path for points is slow, and they never change.
  let strokes = null;
  function readStrokes(paths) {
    const STEP = 16; // svg units: fine enough for these curves at any size
    let total = 0;
    const list = paths.map((p) => {
      const len = p.getTotalLength();
      const a = p.getPointAtLength(0);
      const b = p.getPointAtLength(len);
      // a straight stroke is exactly as long as the gap between its ends
      const n = Math.hypot(b.x - a.x, b.y - a.y) > len - 0.01 ? 1 : Math.ceil(len / STEP);
      const pts = [[a.x, a.y]];
      for (let k = 1; k < n; k++) {
        const q = p.getPointAtLength((len * k) / n);
        pts.push([q.x, q.y]);
      }
      pts.push([b.x, b.y]);
      total += len;
      return { pts, len, exit: p.hasAttribute('data-exit') };
    });
    return { list, total };
  }

  // how far a point is from a box (0 inside it)
  const boxGap = (x, y, x0, y0, x1, y1) => Math.hypot(Math.max(x0 - x, 0, x - x1), Math.max(y0 - y, 0, y - y1));

  function measure() {
    const sx = window.scrollX;
    const sy = window.scrollY;
    W = root.clientWidth;
    VH = window.innerHeight;
    docH = Math.ceil(document.body.getBoundingClientRect().height);

    // the wordmark, as short straight segments
    const ctm = mark.getScreenCTM();
    const unit = Math.hypot(ctm.a, ctm.b); // css px per svg unit
    const paths = Array.from(mark.querySelectorAll('path'));
    const half = ((parseFloat(getComputedStyle(mark).getPropertyValue('--stroke')) || 34) * unit) / 2;
    const toPage = (p) => [ctm.a * p[0] + ctm.c * p[1] + ctm.e + sx, ctm.b * p[0] + ctm.d * p[1] + ctm.f + sy];

    // firs are sized from the wordmark, so the letters are always about three
    // and a half trees wide: a phone simply sees the forest from higher up
    sp = clamp((half * 2) / 3.5, 4.4, 14);
    pad = parseFloat(getComputedStyle(canvas.parentNode).paddingLeft) || 48; // --clearing, resolved to px
    edge = sp * 0.6;
    growPx = pad * 0.5;

    if (!strokes) strokes = readStrokes(paths);
    nameLines = strokes.list.map((s) => s.pts.map(toPage));
    nameHalf = half;
    segs = [];
    let acc = 0;
    let exit = null;
    let exitDir = [0, 1];
    const name = [1e9, 1e9, -1e9, -1e9]; // the box the wordmark fills
    const letters = [1e9, 1e9, -1e9, -1e9]; // ...and the one its letters do, without the tail of the y that hangs below them
    for (const s of strokes.list) {
      const n = s.pts.length - 1;
      let prev = toPage(s.pts[0]);
      for (let k = 1; k <= n; k++) {
        const cur = toPage(s.pts[k]);
        segs.push([prev[0], prev[1], cur[0], cur[1], half, (acc + (s.len * (k - 1)) / n) / strokes.total, (acc + (s.len * k) / n) / strokes.total, 0]);
        for (const box of s.exit ? [name] : [name, letters]) {
          box[0] = Math.min(box[0], prev[0], cur[0]);
          box[1] = Math.min(box[1], prev[1], cur[1]);
          box[2] = Math.max(box[2], prev[0], cur[0]);
          box[3] = Math.max(box[3], prev[1], cur[1]);
        }
        if (k === n && s.exit) {
          const d = Math.hypot(cur[0] - prev[0], cur[1] - prev[1]) || 1;
          exit = cur;
          exitDir = [(cur[0] - prev[0]) / d, (cur[1] - prev[1]) / d];
        }
        prev = cur;
      }
      acc += s.len;
    }

    // how wide a strip of forest is left between two clearings, how far the
    // noise moves a rim in or out, and how far a clearing as drawn here keeps
    // from the sides of the screen: there is to be forest down both of them.
    hedge = Math.max(sp * 6, pad * 0.9);
    const amp = pad * (sp < 8 ? 0.4 : 0.55);
    const keep = hedge / 2 + amp;

    oneColumn = matchMedia('(max-width: 70rem)').matches;
    // (one column or two, and whether that column is laid out as on a phone:
    // the stylesheet's breakpoints, asked of the stylesheet. they are in rem
    // and count the scrollbar; the width of the page in px says neither.)
    const column = oneColumn; // (the same thing, by the name it has in here)
    const phone = matchMedia('(max-width: 36rem)').matches;
    const rem = parseFloat(getComputedStyle(root).fontSize) || 16;

    // clearings: one around every [data-clearing]
    let projects = 0; // how many of them have been projects so far
    rects = [];
    growIndex.clear();
    treeline = docH + 1e4;
    straggle = 0;
    document.querySelectorAll('[data-clearing]').forEach((el) => {
      const b = el.getBoundingClientRect();
      const kind = el.dataset.clearing;
      const x = b.left + sx;
      const y = b.top + sy;
      if (kind === 'edge') {
        // the forest ends here; the footer stands on open ground
        const open = parseFloat(getComputedStyle(el).paddingTop) || 0;
        treeline = y + open * 0.42;
        straggle = open * 0.58 * 0.6;
        return;
      }
      // the body of a clearing is a superellipse around the text. a clearing
      // drawn tight and square to its text reads as a card, so each is turned
      // a little off the horizontal, is longer than it needs to be, and has
      // its text somewhere along it rather than in the middle. each gets its
      // own turn, length and roundness; plant() then roughs the outline up.
      const k = rects.length;
      const sign = kind === 'sign';
      const room = pad * (sign ? 0.42 : 0.62);
      const r = { tx: x + b.width / 2, ty: y + b.height / 2, tw: b.width / 2, th: b.height / 2, id: -1, nz: sign ? 0.4 : 1, lobes: [] };

      // how low it may be: its text and the room around it, and a little
      // over. on a wide screen a clearing is a meadow with something in it.
      // on a narrow one, where the text takes most of the width, the same
      // generosity gives a tall round card with a lot of padding, so there
      // it is kept close.
      // (...and in two columns, where every clearing is a meadow, the second
      // of every three projects is kept close as well: six meadows of a size,
      // one after another, and the forest between them is hedges. a small
      // clearing among them has forest round it, and makes the others big.)
      const close = !column && kind === 'grow' && projects % 3 === 1;
      // (...and of those, every other one may keep a slight turn. two of
      // them exactly alike are the same clearing twice.)
      const spare = Math.floor(projects / 3) % 2 ? 0.4 : 0.95;
      if (kind === 'grow') projects++;
      const snug = close ? 1 : clamp((1100 - W) / 300, 0, 1);
      const easy = 1.2 + 0.3 * hash(k, 7, 77);
      const low = (r.th + room) * (sign ? 1.2 : easy + (1 + 0.1 * hash(k, 7, 77) - easy) * snug);
      // its text sits off its middle towards the nearer side of the screen,
      // so that the clearing runs on into the page, where there is room
      // (the glade under the name is the exception where it stands to the
      // right of the tail of the y: it runs on away from the tail, which
      // comes down beside it. towards it, its corner opened into the foot
      // of the tail, and the y lost its end. where it stands to the left of
      // the tail, see `past`, below.)
      const fromTail = kind === 'glade' && exit && r.tx - r.tw > exit[0] ? 1 : 0;
      // (one of the small islands on a phone, which the stylesheet sets
      // aside with a measure of 11rem. the one it sets aside with 12rem is
      // deliberately not one: it is drawn as any other clearing, wider and
      // lower, so that the three are not alike. everything else on a phone
      // has a wider measure still. if those measures change in
      // css/style.css, 11.5rem here has to go on standing between them.)
      const island = phone && !sign && r.tw * 2 < rem * 11.5;
      const inward = fromTail || (Math.abs(r.tx - W / 2) < W * 0.06 ? (hash(k, 12, 77) < 0.5 ? -1 : 1) : r.tx < W / 2 ? 1 : -1);

      // one way of drawing it: how round (2 is an ellipse, 4 nearly a box),
      // how far turned, how much longer than its text, whether the text sits
      // off its middle, and how loosely it is drawn around the text
      const shape = (pow, turn, long, off, loose) => {
        const cos = Math.cos(turn);
        const sin = Math.sin(turn);
        const base = (r.tw + room) * loose;
        const a = base * (1 + long);
        const along = off * inward * (0.7 + 0.3 * hash(k, 9, 77)) * base * long;
        // (in one of the small islands on a phone the text sits a little above
        // the middle or a little below it: each of them the same oval with
        // its text in the middle, they are one shape three times.)
        const across = sign ? 0 : island ? (hash(k, 11, 77) < 0.5 ? -1 : 1) * room * (0.3 + 0.25 * hash(k, 14, 77)) : !turn ? 0 : (hash(k, 11, 77) - 0.5) * room * 0.5;
        const cx = r.tx + along * cos - across * sin;
        const cy = r.ty + along * sin + across * cos;
        // as low as it can be and still go round the corners of the text.
        // (the nearer an end of it is to a corner, the taller that makes it.
        // too near, and no height will do.)
        let b = low;
        let holds = true;
        for (let q = 0; q < 4; q++) {
          const qx = r.tx + (q & 1 ? 1 : -1) * (r.tw + room * 0.45) - cx;
          const qy = r.ty + (q & 2 ? 1 : -1) * (r.th + room * 0.45) - cy;
          const u = Math.abs(qx * cos + qy * sin) / a;
          const v = Math.abs(qy * cos - qx * sin);
          if (u > 0.96) holds = false;
          else b = Math.max(b, v / Math.pow(1 - Math.pow(u, pow), 1 / pow));
        }
        // how far it then reaches into the forest that is to stand at the
        // sides of the screen, and about the name
        const reach = a * Math.abs(cos) + b * Math.abs(sin);
        const rise = a * Math.abs(sin) + b * Math.abs(cos);
        const clear = half + sp * NAME_BAND + amp;
        const beside = cx + reach > letters[0] - clear && cx - reach < letters[2] + clear;
        const into = !beside ? 0 : cy > (letters[1] + letters[3]) / 2 ? letters[3] + clear - (cy - rise) : cy + rise - (letters[1] - clear);
        // ...and, where the bio stands to the left of the tail of the y,
        // past the line the trail comes down from it: the trail goes
        // straight by, and should not have to step aside at the foot of the
        // y to do so.
        const past = kind === 'glade' && exit && r.tx + r.tw < exit[0] ? cx + reach - (exit[0] - half - hedge * 0.7 - amp) : 0;
        // ...and, where it stands to the right of the tail, how near it
        // comes to the foot of the tail and to where the trail sets off
        // from it: there are to be some rows of firs between, whatever the
        // rim's noise takes of them. (measured from its middle, along the
        // line to each of the two. the clearing lies lower than the foot,
        // so its left end may well be further left than the tail is.)
        let foot = 0;
        if (fromTail) {
          const off = (px, py) => {
            const ox = px - cx;
            const oy = py - cy;
            const u = Math.abs(ox * cos + oy * sin) / a;
            const v = Math.abs(oy * cos - ox * sin) / b;
            return Math.hypot(ox, oy) * (1 - 1 / Math.pow(Math.pow(u, pow) + Math.pow(v, pow), 1 / pow));
          };
          foot = Math.max(half + sp * 3.5 + amp - off(exit[0], exit[1]), sp * 4.5 + amp - off(exit[0] + exitDir[0] * unit * 40, exit[1] + exitDir[1] * unit * 40));
        }
        const over = Math.max(0, keep - (cx - reach), cx + reach - (W - keep), into, past, foot);
        // ...and how much taller than suits its text it has had to be made
        // (one of the small islands on a phone may be a good deal taller than
        // that: it has forest all round it, and comes out round. anywhere
        // else a clearing that tall is a great deal of bare ground with a
        // little text in it.)
        // (in two columns that is measured on the page as well, where a long
        // clearing that is turned stands taller than it is: one drawn close
        // has next to none of that to spare, so that it really is small, and
        // the others not so much that they are mostly bare ground. not the
        // glade under the name, which is as it is.)
        const stands = column || kind === 'glade' ? 0 : rise - low - room * (close ? spare : 1.6);
        const tall = holds ? Math.max(0, b - low - room * (island ? 2.2 : close ? spare : 0.9), stands) : 1e4;
        return { pow, cos, sin, a, b, cx, cy, cost: over * 2 + tall };
      };

      // the way it would like to be drawn, and then ways that take less and
      // less room at the sides: turned less, shorter, its text in the
      // middle, drawn closer; then all but square to the screen and as wide
      // as the sides allow, which is as low as that roundness gets; and only
      // then squarer. the first that leaves the forest standing, at the sides of
      // the screen and about the name, without being much taller than suits
      // its text, is the one. (if none does, the text is too big for that,
      // as it is when it has been enlarged a lot, and the one that comes
      // nearest is as good as it gets. plantBand() then sees to it that the
      // name and the sides keep their forest all the same.)
      const pow = 2 + 0.5 * Math.floor(3 * hash(k, 3, 77)); // 2, 2.5 or 3
      const turn = (hash(k, 4, 77) - 0.5) * 0.52; // up to 15 degrees either way
      // (some are a good deal longer than their text, most are not. a phone
      // has no room for that at all.)
      const h5 = hash(k, 5, 77);
      const long = sp < 8 ? 0 : (h5 < 0.45 ? 0.04 + 0.1 * h5 : 0.16 + 0.33 * (h5 - 0.45)) * (close ? 0.35 : 1);
      const slack = close ? 1.05 : 1.16; // how loosely it is drawn round its text, at its loosest
      // (square to the screen, with its text in the middle: this wide)
      const wide = clamp(Math.min(r.tx - keep, W - keep - r.tx), (r.tw + room * 0.45) / 0.9, (r.tw + room) * 1.16) / (r.tw + room);
      const ways = sign
        ? [[2.5, 0, 0, 0, 1.16]]
        : [
            [pow, turn, long, 1, slack],
            [pow, turn * 0.5, long, 1, Math.min(slack, 1.12)],
            [pow, turn * 0.5, long * 0.5, 1, Math.min(slack, 1.08)],
            [pow, turn, 0, 0, slack],
            [pow, turn * 0.5, 0, 0, Math.min(slack, 1.08)],
            ...[2, 2.5, 3, 4].filter((p) => p >= pow).flatMap((p) => [
              [p, turn * 0.35, 0, 0, wide * 0.95], // (still a little turned, if there is room for that)
              [p, 0, 0, 0, wide],
            ]),
          ];
      let drawn = null;
      for (const way of ways) {
        const tried = shape(...way);
        if (!drawn || tried.cost < drawn.cost) drawn = tried;
        if (!tried.cost) break;
      }
      Object.assign(r, drawn);
      r.less = LESS[r.pow];
      r.room = room;
      r.glade = kind === 'glade'; // off the trail: the path passes it by, where it can
      r.close = close;
      if (kind === 'grow' && growIndex.size < MAX_DYN) {
        r.id = growIndex.size;
        centers[r.id * 2] = r.cx;
        centers[r.id * 2 + 1] = r.cy;
        growIndex.set(el, r.id);
      }
      rects.push(r);
    });

    // each clearing also gets a bay or two: a broad bulge off its rim, in a
    // direction of its own. a bay is shrunk, or dropped, where it would run
    // into a neighbour, the name, or the forest at the sides of the screen.
    rects.forEach((r, k) => {
      // (in one column a clearing has the trail coming in at the top and
      // going out at the bottom. two bays and that neck make a speech
      // balloon of it: so one at most there, and on its upper side.)
      // (and one that is drawn close has none: small and plain among the
      // meadows, it is another kind of clearing, not the same one again.)
      const bays = r.nz < 1 || r.close ? 0 : column ? 1 : 1 + (hash(k, 13, 77) < 0.6 ? 1 : 0);
      for (let l = 0; l < bays; l++) {
        const ang = (column ? 1.1 + 0.8 * hash(k, 20 + l, 77) : hash(k, 20 + l, 77) * 2) * Math.PI;
        const ex = Math.cos(ang);
        const ey = Math.sin(ang);
        // how far the rim is from the centre in that direction
        const eu = Math.abs(ex * r.cos + ey * r.sin) / r.a;
        const ev = Math.abs(ey * r.cos - ex * r.sin) / r.b;
        const rim = Math.pow(Math.pow(eu, r.pow) + Math.pow(ev, r.pow), -1 / r.pow);
        // (broad, set mostly inside the rim, and small beside the clearing it
        // is on: a shoulder, not a bump. on a low clearing a bay as big as
        // the clearing is tall makes a cloud of it.)
        let rad = Math.min(pad * (1.1 + 1.0 * hash(k, 30 + l, 77)), r.b * 0.62);
        const lx = r.cx + ex * (rim - rad * 0.3);
        const ly = r.cy + ey * (rim - rad * 0.3);
        let free = boxGap(lx, ly, name[0] - half, name[1] - half, name[2] + half, name[3] + half);
        rects.forEach((q) => {
          if (q === r) return;
          const m = q.room + amp;
          free = Math.min(free, boxGap(lx, ly, q.tx - q.tw - m, q.ty - q.th - m, q.tx + q.tw + m, q.ty + q.th + m));
        });
        free = Math.min(free, lx - keep + hedge, W - keep - lx + hedge);
        rad = Math.min(rad, free - hedge, treeline - ly - hedge * 2);
        if (rad > pad * 0.8) r.lobes.push([lx, ly, rad]);
      }
      // the box all of it fits in
      const hx = r.a * Math.abs(r.cos) + r.b * Math.abs(r.sin);
      const hy = r.a * Math.abs(r.sin) + r.b * Math.abs(r.cos);
      r.x0 = Math.min(r.cx - hx, r.tx - r.tw - pad);
      r.x1 = Math.max(r.cx + hx, r.tx + r.tw + pad);
      r.y0 = Math.min(r.cy - hy, r.ty - r.th - pad);
      r.y1 = Math.max(r.cy + hy, r.ty + r.th + pad);
      for (const [lx, ly, rad] of r.lobes) {
        r.x0 = Math.min(r.x0, lx - rad);
        r.x1 = Math.max(r.x1, lx + rad);
        r.y0 = Math.min(r.y0, ly - rad);
        r.y1 = Math.max(r.y1, ly + rad);
      }
    });

    // the trail: leaves the wordmark where the y ends, passes through the
    // clearings in reading order (but not a glade: that one it goes by), and
    // walks out of the forest at the bottom. it keeps to the middle of the
    // page and clips each clearing at the end nearest to it. aimed at their
    // centres it would zigzag from one to the next, and the paths between
    // them would look like the edges of a graph.
    maxT = TRAIL;
    //
    // in one column the clearings stand one above the other. a trail that
    // went through every one of them would be a string of beads: in at the
    // top, out at the bottom, ten times over. so there it goes through some
    // and past others. a project's clearing that has room beside it is left
    // off the trail, and the trail goes by on that side: in the forest, with
    // a strip of it standing between the two, as it goes by the glade under
    // the name. on a phone the stylesheet sets some of them to one side,
    // with a narrower measure, for exactly this. on anything wider it is
    // only done where the trail is passing that way anyway: going round a
    // clearing to get by it would make a moat of the trail.
    const strip = hedge * 0.7 + amp * 0.5; // the least forest between the trail and what it goes by
    const stops = [];
    let wentBy = false; // the last project's clearing was one the trail went by
    rects.forEach((r, k) => {
      if (r.glade) {
        // the glade under the name is off the trail. on a wide screen it
        // stands well to the right of the tail of the y, and the trail
        // leaves the other way. on anything narrower the trail comes
        // straight down from the tail, and goes by the glade if the
        // stylesheet has set the glade clear of that line, to the left of
        // it (which it does wherever there is room to: not on a phone,
        // where the name fills the screen from side to side and whatever
        // stands under it stands under the tail as well. there the trail
        // goes through).
        if (exit && (column || r.tx + r.tw < exit[0])) {
          const right = exit[0] > r.cx;
          const x = right ? Math.max(exit[0], r.x1 + strip) : Math.min(exit[0], r.x0 - strip);
          const beside = right ? W - r.x1 : r.x0;
          if (beside >= strip * 2 + 8 && Math.abs(x - exit[0]) < Math.min(W * 0.12, 90)) {
            const mid = (r.y0 + r.y1) / 2;
            const rise = (r.y1 - r.y0) / 2;
            stops.push([x, mid - rise * 0.8], [x, mid + rise * 0.8]);
          }
        }
        return;
      }
      const last = wentBy;
      wentBy = false;
      // (the last clearing on the page is one it may go by as well, whatever
      // is in it: the trail then leaves the forest past it, and not through
      // one more clearing in at the top and out at the bottom.)
      const end = k === rects.length - 1;
      if (column && (r.id >= 0 || end)) {
        // (r.x0 to r.x1, r.y0 to r.y1: the box all of it fits in, bays included)
        const left = r.x0;
        const right = W - r.x1;
        const room = Math.max(left, right);
        const off = Math.min(room / 2, hedge * 2);
        const x = left > right ? r.x0 - off : r.x1 + off;
        const from = stops.length ? stops[stops.length - 1][0] : exit ? exit[0] : W / 2;
        // (on anything wider than a phone: never two running, either. through one, by the next.)
        const near = Math.abs(x - from) < (end ? Math.min(W * 0.45, 380) : Math.min(W * 0.38, 300));
        if (room >= strip * 2 + 8 && (phone || (!last && near && (end || hash(k, 19, 77) < 0.8)))) {
          const mid = (r.y0 + r.y1) / 2;
          const rise = (r.y1 - r.y0) / 2;
          stops.push([x, mid - rise * 0.8], [x, mid + rise * 0.8]);
          wentBy = true;
          return;
        }
      }
      // (...and to one side of that or the other, so that it wanders. where
      // the clearings stand one above the other, a path down the middle of
      // them all is a string with beads on it.)
      const swing = (hash(k, 16, 77) < 0.5 ? -1 : 1) * r.a * (0.24 + 0.2 * hash(k, 18, 77));
      const along = clamp((W / 2 - r.cx) * r.cos + swing, -r.a * 0.62, r.a * 0.62) + (hash(k, 15, 77) - 0.5) * r.a * 0.1;
      const across = (hash(k, 17, 77) - 0.5) * r.b * 0.5;
      stops.push([r.cx + along * r.cos - across * r.sin, r.cy + along * r.sin + across * r.cos]);
    });
    if (exit && stops.length) {
      const anchors = stops;
      const pts = [exit, [exit[0] + exitDir[0] * unit * 40, exit[1] + exitDir[1] * unit * 40]];
      let prev = pts[1];
      const last = anchors[anchors.length - 1];
      // (out of the forest: a little to the left of where it last was, or,
      // if it has just gone by the last clearing, a little towards the
      // middle of the page from there, where there is more forest to cross)
      anchors.push([wentBy ? last[0] + Math.sign(W / 2 - last[0]) * W * 0.06 : last[0] - W * 0.12, treeline + 80]);
      anchors.forEach((a, ai) => {
        const dx = a[0] - prev[0];
        const dy = a[1] - prev[1];
        const d = Math.hypot(dx, dy) || 1;
        const n = Math.floor(d / 260);
        for (let k = 1; k <= n; k++) {
          const t = k / (n + 1);
          const off = (hash(k, ai, 9) - 0.5) * Math.min(110, d * 0.24);
          pts.push([prev[0] + dx * t - (dy / d) * off, prev[1] + dy * t + (dx / d) * off]);
        }
        pts.push(a);
        prev = a;
      });
      const line = spline(pts, 6);
      // a path through a forest is never straight for long
      // (by the width of the page as much as by the size of the firs: on a
      // phone, where they are small, it would otherwise be a straight crack)
      const sway = clamp(Math.max(sp * 1.5, W * 0.04), 8, 19);
      for (let i = 1, walked = 0; i < line.length - 1; i++) {
        const a = line[i - 1];
        const b = line[i + 1];
        const d = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
        walked += d / 2;
        const off = (vnoise(walked / 95 + 13.7, 0.5) - 0.5) * 2 * sway * Math.min(1, walked / 90);
        line[i] = [line[i][0] - ((b[1] - a[1]) / d) * off, line[i][1] + ((b[0] - a[0]) / d) * off];
      }
      const trailHalf = clamp(sp * 0.42, 3, 5.5);
      let run = 0;
      for (let i = 1; i < line.length; i++) {
        const a = line[i - 1];
        const b = line[i];
        const d = Math.hypot(b[0] - a[0], b[1] - a[1]);
        segs.push([a[0], a[1], b[0], b[1], trailHalf, TRAIL + run / 1500, TRAIL + (run + d) / 1500, 1]);
        run += d;
      }
      maxT = TRAIL + run / 1500;
    }
  }

  let planted = '';
  function signature() {
    let sig = `${W}|${docH}|${sp.toFixed(2)}|${pad}|${Math.round(treeline)}`;
    for (const r of rects) sig += `|${Math.round(r.tx)},${Math.round(r.ty)},${Math.round(r.tw)},${Math.round(r.th)}`;
    const s = segs[0];
    return s ? `${sig}|${Math.round(s[0])},${Math.round(s[1])},${s[4].toFixed(1)}` : sig;
  }

  // smooth noise over the whole page, read from a small grid of random values
  // that is filled once per planting: four lookups a sample, no hashing
  function lattice(cell, seed) {
    const w = Math.ceil(W / cell) + 5;
    const h = Math.ceil(docH / cell) + 5;
    const v = new Float32Array(w * h);
    for (let k = 0; k < v.length; k++) v[k] = hash(k % w, Math.floor(k / w), seed);
    return (x, y) => {
      const fx = x / cell + 1;
      const fy = y / cell + 1;
      const xi = Math.floor(fx);
      const yi = Math.floor(fy);
      const tx = fx - xi;
      const ty = fy - yi;
      const u = tx * tx * (3 - 2 * tx);
      const s = ty * ty * (3 - 2 * ty);
      const o = yi * w + xi;
      return v[o] + (v[o + 1] - v[o]) * u + (v[o + w] - v[o]) * s + (v[o] - v[o + 1] - v[o + w] + v[o + w + 1]) * u * s;
    };
  }

  // how far a point is from the text of a clearing (negative: inside its box)
  function textGap(r, x, y) {
    const qx = Math.abs(x - r.tx) - r.tw;
    const qy = Math.abs(y - r.ty) - r.th;
    return qx > 0 || qy > 0 ? Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) : Math.max(qx, qy);
  }

  // how far a point is outside the outline of a clearing (negative: inside
  // it), before the noise roughens that outline
  function outline(r, x, y, blend) {
    // the body: first-order distance to the superellipse
    // |u/a|^p + |v/b|^p = 1, where u runs along the clearing and v across
    const ox = x - r.cx;
    const oy = y - r.cy;
    const px = Math.abs(ox * r.cos + oy * r.sin) / r.a;
    const py = Math.abs(oy * r.cos - ox * r.sin) / r.b;
    const pxn = r.less(px);
    const pyn = r.less(py);
    const F = pxn * px + pyn * py;
    let d = -Math.min(r.a, r.b);
    if (F > 1e-6) {
      const root = Math.pow(F, 1 / r.pow);
      d = ((root - 1) * F) / (root * Math.hypot(pxn / r.a, pyn / r.b));
    }
    // its bays, run into it smoothly
    for (let l = 0; l < r.lobes.length; l++) {
      const lobe = r.lobes[l];
      const e = Math.hypot(x - lobe[0], y - lobe[1]) - lobe[2];
      const h = Math.max(blend - Math.abs(d - e), 0) / blend;
      d = Math.min(d, e) - h * h * blend * 0.25;
    }
    return d;
  }

  // points spaced `step` apart along the outline that lies `d` to either side
  // of each of `lines`, round ends included: where a row of firs would stand
  // if it were planted along the edge of a stroke that wide
  function alongside(lines, d, step) {
    const out = [];
    // spread points evenly round a closed loop
    const spread = (pts) => {
      const at = [0];
      for (let k = 0; k < pts.length; k++) {
        const a = pts[k];
        const b = pts[(k + 1) % pts.length];
        at.push(at[k] + Math.hypot(b[0] - a[0], b[1] - a[1]));
      }
      const all = at[pts.length];
      const n = Math.max(3, Math.round(all / step));
      for (let m = 0, k = 0; m < n; m++) {
        const want = ((m + 0.5 + (hash(m, n, 31) - 0.5) * 0.45) / n) * all; // (not quite evenly)
        while (at[k + 1] < want) k++;
        const a = pts[k];
        const b = pts[(k + 1) % pts.length];
        const t = (want - at[k]) / (at[k + 1] - at[k] || 1);
        out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
      }
    };
    for (const pts of lines) {
      const last = pts.length - 1;
      const closed = last > 1 && Math.hypot(pts[0][0] - pts[last][0], pts[0][1] - pts[last][1]) < 0.5;
      const n = closed ? last : last + 1;
      const left = [];
      const right = [];
      const turn = []; // which way "left" points at each point
      for (let k = 0; k < n; k++) {
        const a = closed ? pts[(k - 1 + n) % n] : pts[Math.max(0, k - 1)];
        const b = closed ? pts[(k + 1) % n] : pts[Math.min(last, k + 1)];
        const len = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
        const nx = -(b[1] - a[1]) / len;
        const ny = (b[0] - a[0]) / len;
        left.push([pts[k][0] + nx * d, pts[k][1] + ny * d]);
        right.push([pts[k][0] - nx * d, pts[k][1] - ny * d]);
        turn.push(Math.atan2(ny, nx));
      }
      if (closed) {
        // a ring: an outline outside it and another inside
        spread(left);
        spread(right);
        continue;
      }
      // a stroke with two ends: up one side, round the far end, back down the
      // other side, round the near end
      const round = (p, from) => {
        const pieces = Math.max(2, Math.ceil((Math.PI * d) / step));
        const arc = [];
        for (let k = 1; k < pieces; k++) {
          const a = from - (Math.PI * k) / pieces;
          arc.push([p[0] + Math.cos(a) * d, p[1] + Math.sin(a) * d]);
        }
        return arc;
      };
      spread([...left, ...round(pts[last], turn[last]), ...right.reverse(), ...round(pts[0], turn[0] + Math.PI)]);
    }
    return out;
  }

  // the sharper part of the edge noise: now and then a bite into the forest,
  // or a tongue of forest out of it, and nothing in between
  const nipOf = (q) => (q > 0.5 ? Math.max(q - 0.72, 0) : -Math.max(0.28 - q, 0));

  // v ^ (p - 1) for the exponents a clearing can have, without Math.pow
  const LESS = {
    2: (v) => v,
    2.5: (v) => v * Math.sqrt(v),
    3: (v) => v * v,
    4: (v) => v * v * v,
  };

  /* the forest is planted in horizontal bands a few hundred pixels tall. the
     bands under the canvas are planted straight away; the rest follow one at
     a time while the browser is idle, nearest first, so a long page does not
     hold up the first frame. every band has a fixed slot in `trees` and in
     the gpu buffer; counts[] says how many firs it holds (-1: not planted). */

  const BAND = 240; // css px, rounded to a whole number of rows
  const SPARE = 2; // rows and columns planted beyond each edge of the page
  let cols = 0;
  let bandRows = 1;
  let bandH = BAND;
  let room = 0; // how many firs a band has room for
  let slot = 0; // floats per band
  let counts = new Int32Array(0);
  let standing = 0;
  let ground = null; // what plantBand needs to know about the page
  let stands = []; // groups of firs left standing out in the open: [x, y, radius]
  let rims = []; // per band: the firs planted in rows along the edges of the name, [x, y, sd]
  let idle = 0;
  const countEl = document.querySelector('[data-trees]'); // the footer's line about firs
  const noCount = countEl ? countEl.textContent : '';

  // lay the page out for planting. no fir is placed here.
  function plant() {
    cols = Math.ceil(W / sp) + 1 + 2 * SPARE;
    rows = Math.ceil(docH / sp) + 1 + 2 * SPARE;
    bandRows = Math.max(1, Math.round(BAND / sp));
    bandH = bandRows * sp;
    const bands = Math.ceil(rows / bandRows);
    counts = new Int32Array(bands).fill(-1);
    standing = 0;
    farOff(); // (the rough copy of the forest is of the old one)

    // bucket the stroke segments so each fir only looks at the few near it
    const B = 64;
    const bw = Math.ceil(W / B) + 6;
    const buckets = new Map();
    const reachS = Math.max(edge + 6, sp * (NAME_BAND + 0.2));
    segs.forEach((s, idx) => {
      const r = s[4] + reachS;
      const bx0 = Math.floor((Math.min(s[0], s[2]) - r) / B);
      const bx1 = Math.floor((Math.max(s[0], s[2]) + r) / B);
      const by0 = Math.floor((Math.min(s[1], s[3]) - r) / B);
      const by1 = Math.floor((Math.max(s[1], s[3]) + r) / B);
      for (let by = by0; by <= by1; by++) {
        for (let bx = bx0; bx <= bx1; bx++) {
          const key = by * bw + bx + 2;
          let list = buckets.get(key);
          if (!list) buckets.set(key, (list = []));
          list.push(idx);
        }
      }
    });

    const amp = pad * (sp < 8 ? 0.4 : 0.55); // how far the noise pushes a clearing's rim in or out
    const reach = edge + amp * 1.1 + growPx * 4.5;
    const safe = sp * 1.7 + 4; // the text keeps at least this much open ground
    const blend = pad * 0.9; // how softly a bay runs into the body of its clearing
    const lonely = safe + sp * 5 + pad * 0.25; // a fir left standing in a clearing keeps this far from the text
    const high = sp < 8; // seen from high up, as a phone sees it: there a fir on its own is a speck of dust
    const broad = lattice(300, 21);
    const fine = lattice(110, 22);
    const bite = lattice(Math.max(56, sp * 6), 24);
    ground = {
      B,
      bw,
      buckets,
      amp,
      reach,
      safe,
      blend,
      lonely,
      high,
      lone: 0.22 * Math.min(1, (sp * sp) / 120), // stragglers per area, not per fir
      gone: -edge * 0.5, // a fir this far into open ground is not planted at all
      nearEdge: treeline - amp * 3.2 - reach,
      verge: hedge * 0.5, // how much forest stands at the sides of the screen, come what may
      bend: sp * 2.2, // how far the planting grid is pulled out of true
      bendX: lattice(sp * 8, 26),
      bendY: lattice(sp * 8, 27),
      broad,
      fine,
      bite,
      stand: lattice(420, 23),
    };

    // where a point lies: how far from the rim of the nearest open ground
    // (negative: out in the open), how far from the nearest text, and whether
    // that open ground is the land past the treeline. (plantBand works the
    // same thing out for every fir, with more bookkeeping.)
    const lie = (x, y) => {
      const roll = ((broad(x, y) - 0.5) + (fine(x, y) - 0.5) * 0.6) * amp;
      const nz = roll + nipOf(bite(x, y)) * 3.2 * amp;
      let at = 1e4;
      let gap = 1e4;
      for (const r of rects) {
        const t = textGap(r, x, y);
        gap = Math.min(gap, t);
        at = Math.min(at, outline(r, x, y, blend) + nz * r.nz, t - safe);
      }
      const dEdge = treeline - y + roll * (oneColumn ? 3.2 : EDGE_ROLL);
      return dEdge < at ? [dEdge, gap, true] : [at, gap, false];
    };

    // stands: small groups of firs left out in the open, in a clearing, well
    // clear of its text and its rim. each is a rough disc about a point of
    // its own and is all there or not there at all: one that does not fit
    // where it falls is left out whole, never trimmed to a fir or two.
    stands = [];
    const each = sp * 9; // one candidate to a square this size
    const bar = 0.78; // and this share of them is passed over
    // (none at all where the forest is seen from high up, as on a phone or a
    // small tablet: there a stand is a smudge beside the text)
    for (let gy = 0; sp >= 10 && gy * each < docH; gy++) {
      for (let gx = 0; gx * each < W; gx++) {
        const v = hash(gx, gy, 25);
        if (v < bar) continue;
        const x = (gx + 0.2 + 0.6 * hash(gx, gy, 28)) * each;
        const y = (gy + 0.2 + 0.6 * hash(gx, gy, 29)) * each;
        const size = sp * (1.7 + (1.5 * (v - bar)) / (1 - bar));
        const [at, gap, past] = lie(x, y);
        if (!past && at < -(size + sp * 2.5) && gap > lonely * 1.1 + size) stands.push([x, y, size]);
      }
    }

    // the name is not left to chance. whether a letter comes out clean would
    // otherwise depend on where firs happen to fall, and at a phone's scale a
    // letter is only a few firs wide. so along every edge of every stroke a
    // row of firs is planted, evenly spaced, just outside the cut: the edge
    // of each letter is a line of trees, wherever the name is on the page and
    // however small. more rows stand behind the first, so that no ground
    // shows through between it and the forest. (the forest itself is kept
    // back to make the room.)
    rims = Array.from({ length: bands }, () => []);
    // how far a point is from the nearest cut of the name, and from the trail
    const toCuts = (x, y) => {
      const near = buckets.get(Math.floor(y / B) * bw + Math.floor(x / B) + 2);
      let name = 1e4;
      let trail = 1e4;
      for (let k = 0; near && k < near.length; k++) {
        const g = segs[near[k]];
        const vx = g[2] - g[0];
        const vy = g[3] - g[1];
        const t = clamp(((x - g[0]) * vx + (y - g[1]) * vy) / (vx * vx + vy * vy || 1), 0, 1);
        const d = Math.hypot(x - g[0] - t * vx, y - g[1] - t * vy) - g[4];
        if (g[7]) trail = Math.min(trail, d);
        else name = Math.min(name, d);
      }
      return [name, trail];
    };
    // a row `out` from the edge, its firs `step` apart. none of them where it
    // would stand in or right beside another stroke's cut, in the trail, or
    // out in a clearing. `shade` says how the shade under a fir of the row is
    // to be drawn (see sd in plantBand): the front row has next to none, the
    // one behind as much as stops short of the cut. and where the trail sets
    // off from the foot of the y, the rows give way to it as the forest does,
    // or they would close it off.
    const row = (out, step, clear, shade) => {
      for (const [x, y] of alongside(nameLines, nameHalf + out, step)) {
        const [name, trail] = toCuts(x, y);
        if (name < clear || trail < sp * 0.3 || lie(x, y)[1] < safe + sp) continue; // (only text makes them give way)
        rims[clamp(Math.floor((y / sp + SPARE) / bandRows), 0, bands - 1)].push([x, y, Math.min(shade(name), trail - sp * 0.2)]);
      }
    };
    row(sp * 0.5, sp * 0.85, sp * 0.3, () => sp * 0.8);
    row(sp * 1.3, sp * 0.9, sp * 0.55, (gap) => gap + sp * (FLOOR * 0.7 - 0.3));
    // (and a third, far enough back to have all its shade: between them the
    // three leave no gap for the ground to show through near the name)
    row(sp * 2.15, sp * 0.95, sp * 1.6, () => sp * 2.6);

    // room for all of it: a band holds at most one fir to a square of the
    // grid, and whichever firs of those rows fall in it on top of that
    room = cols * bandRows + rims.reduce((most, firs) => Math.max(most, firs.length), 0);
    slot = room * STRIDE;
    if (trees.length < bands * slot) trees = new Float32Array(bands * slot);
    gl.bindBuffer(gl.ARRAY_BUFFER, treeBuf);
    gl.bufferData(gl.ARRAY_BUFFER, bands * slot * 4, gl.DYNAMIC_DRAW);

    // what the forest was planted around; if this changes, it is planted again
    planted = signature();
    later();
  }

  // plant one band. this runs once for every spot a fir could stand (tens of
  // thousands on a long page), so it avoids work wherever it can.
  function plantBand(b) {
    const { B, bw, buckets, amp, reach, safe, blend, lonely, lone, high, gone, nearEdge, verge, bend, bendX, bendY, broad, fine, bite, stand } = ground;
    const base = b * slot;
    const end = Math.min(rows, (b + 1) * bandRows);
    let n = 0;

    // the stands that reach into this band, and whether a point is in one
    // (their edges are a little uneven, by the same noise that bends the grid)
    const from = (b * bandRows - SPARE - 3) * sp;
    const to = (end - SPARE + 3) * sp;
    const here = stands.filter((st) => st[1] + st[2] * 1.3 > from && st[1] - st[2] * 1.3 < to);
    const inStand = (x, y) => {
      for (let k = 0; k < here.length; k++) {
        const st = here[k];
        const size = st[2] * (0.75 + 0.5 * bendX(x, y));
        if ((x - st[0]) * (x - st[0]) + (y - st[1]) * (y - st[1]) < size * size) return true;
      }
      return false;
    };

    for (let j = b * bandRows; j < end; j++) {
      cells: for (let i = 0; i < cols; i++) {
        // firs are counted on a grid, each one somewhere in its own square.
        // then the whole grid is pulled out of true, gently and differently
        // everywhere, so that neither its rows nor its even spacing show.
        const gx = (i - SPARE + 0.1 + 0.8 * hash(i, j, 1)) * sp;
        const gy = (j - SPARE + 0.1 + 0.8 * hash(i, j, 2)) * sp;
        const x = gx + (bendX(gx, gy) - 0.5) * bend;
        const y = gy + (bendY(gx, gy) - 0.5) * bend;
        const near = buckets.get(Math.floor(y / B) * bw + Math.floor(x / B) + 2);

        // most firs stand deep in the forest, nowhere near an edge: for those
        // there is nothing to work out, and the edge noise is never sampled
        let open = near !== undefined || y > nearEdge;
        for (let k = 0; !open && k < rects.length; k++) {
          const r = rects[k];
          open = x > r.x0 - reach && x < r.x1 + reach && y > r.y0 - reach && y < r.y1 + reach;
        }
        // the edge noise: two slow swells, and now and then a sharper bite
        // into the forest or a tongue of forest out of it. (a steady ripple
        // would scallop every rim like a cloud.)
        let nz = 0;
        let roll = 0;
        let trust = 1; // how far c can be taken for a real distance (see the shader)
        if (open) {
          const q = bite(x, y);
          const nip = nipOf(q);
          roll = ((broad(x, y) - 0.5) + (fine(x, y) - 0.5) * 0.6) * amp;
          nz = roll + nip * 3.2 * amp;
          // on the flank of a bite c changes several times as fast as the
          // ground goes by, so there it is worth that much less
          if (nip !== 0) trust = 1 / (1 + 3.2 * amp * Math.hypot(bite(x + 3, y) - q, bite(x, y + 3) - q) / 3);
        }

        // the trail, and the name
        let sd = 1e4; // how far outside a cut this fir stands, as the shader is to see it
        let st = 0; // and how far along the name-and-trail that cut is
        let off = 1e4; // how far it really is from the edge of the name
        let offT = 0;
        if (near) {
          for (let k = 0; k < near.length; k++) {
            const s = segs[near[k]];
            const vx = s[2] - s[0];
            const vy = s[3] - s[1];
            let t = ((x - s[0]) * vx + (y - s[1]) * vy) / (vx * vx + vy * vy || 1);
            t = t < 0 ? 0 : t > 1 ? 1 : t;
            const d = Math.hypot(x - s[0] - t * vx, y - s[1] - t * vy) - s[4];
            if (!s[7]) {
              if (d < off) {
                off = d;
                offT = s[5] + (s[6] - s[5]) * t;
              }
            } else if (d - sp * 0.2 + nz * 0.05 < sd) {
              // (firs are kept a little back from the trail, so that their
              // crowns do not close it up again)
              sd = d - sp * 0.2 + nz * 0.05;
              st = s[5] + (s[6] - s[5]) * t;
            }
          }
        }

        // signed distance to the nearest open ground (negative: out in it),
        // and to the next nearest that is some other clearing's
        let d1 = 1e4;
        let d2 = 1e4;
        let n1 = 0; // (which clearings those are, if they open under the pointer: number plus one)
        let n2 = 0;
        let dynId = 0; // the nearest clearing that opens under the pointer, and how far
        let dynD = 1e4;
        let dynId2 = 0; // the next nearest
        let dynD2 = 1e4;
        let gap = 1e4; // to the nearest text
        for (let k = 0; open && k < rects.length; k++) {
          const r = rects[k];
          if (x < r.x0 - reach || x > r.x1 + reach || y < r.y0 - reach || y > r.y1 + reach) continue;
          // whatever the outline does, the text itself always stays in the
          // open. that is also the cheap test, so it goes first.
          const t = textGap(r, x, y);
          if (t - safe < gone) continue cells;
          if (t < gap) gap = t;
          const d = Math.min(outline(r, x, y, blend) + nz * r.nz, t - safe);
          if (d < d1) {
            d2 = d1;
            n2 = n1;
            d1 = d;
            n1 = r.id + 1;
          } else if (d < d2) {
            d2 = d;
            n2 = r.id + 1;
          }
          if (r.id >= 0) {
            if (d < dynD) {
              dynD2 = dynD;
              dynId2 = dynId;
              dynD = d;
              dynId = r.id + 1;
            } else if (d < dynD2) {
              dynD2 = d;
              dynId2 = r.id + 1;
            }
          }
        }

        // the open ground past the treeline counts as one more clearing
        const dEdge = treeline - y + roll * (oneColumn ? 3.2 : EDGE_ROLL);
        const past = dEdge < d1;
        if (past) {
          d2 = d1;
          n2 = n1;
          d1 = dEdge;
          n1 = 0;
        } else if (dEdge < d2) {
          d2 = dEdge;
          n2 = 0;
        }

        // no two clearings run into each other: along the line midway between
        // their rims a strip of forest is left standing, wherever the rims
        // wander, a little wider in some places than in others. the trail still
        // gets through, since it is cut separately. (the text comes first.)
        // (not on the far side of it from the last clearing in two columns,
        // though: where the edge of the forest is nearer than the clearing,
        // the edge is left as it is everywhere else, thinning out raggedly.
        // firmed up and pushed out by a strip kept for the clearing behind
        // it, it read as a shelf with a flat front, on a screen wide enough
        // for it to be seen from end to end.)
        let c = d1;
        if (d2 - d1 < hedge * 1.7 && (oneColumn || !past)) {
          const across = hedge * (0.75 + 0.9 * stand(x, y)); // how wide the strip is here
          const kept = (across - (d2 - d1)) / 2;
          if (kept > c) {
            c = Math.min(kept, gap - safe);
            // when a clearing beside it opens under the pointer, the strip
            // gives way on that side only, and never to less than a row or
            // two on that side of its middle. the two clearings do not meet,
            // and what is left between them is still forest: not a line of
            // firs with the ground showing through. so every fir in the strip
            // is told how far it is to the strip's edge on that side with
            // the clearing there fully open, and to its edge on the other
            // side with the other one open: it stands, and keeps its patch
            // of floor, by those. (where the strip is only just a strip, the
            // two rims being nearly its width apart as it is, it gives way
            // as any rim does, so that the one runs smoothly into the other.)
            const firm = clamp((kept - d1) / (sp * 2), 0, 1);
            const give = growPx + (clamp(across / 2 - sp * 1.6, 0, growPx) - growPx) * firm;
            const toOwn = c - give + growPx;
            const toOther = across - c - give + growPx;
            if (dynId && dynId === n1) dynD = toOwn;
            else if (dynId && dynId === n2) dynD = toOther;
            if (dynId2 && dynId2 === n2) dynD2 = toOther;
          }
        }

        // and forest is left standing down both sides of the screen, however
        // a rim wanders and however wide a clearing has to be: a narrow strip
        // of it at the least, wider in some places than in others, that never
        // gives way. (the text comes first here too. and not past the
        // treeline, where the ground is meant to be open right across.)
        const side = Math.min(x, W - x);
        if (!past && side < verge * 1.7) {
          const kept = verge * (0.45 + 0.7 * fine(x, y) + 0.5 * bite(x, y)) - side;
          if (kept > c) {
            c = Math.min(kept, gap - safe);
            // (it does not give way to a clearing that opens towards it. its
            // patch of floor does, though: that keeps behind the rim.)
            if (dynId) {
              dynId2 = dynId;
              dynD2 = dynD;
            }
            dynId = 0;
            dynD = 1e4;
          }
        }

        // the name keeps a band of forest about it in the same way: no
        // clearing gets in among the letters, however big its text has made
        // it. (only text itself comes before that.)
        if (off < sp * NAME_BAND && sp * NAME_BAND - off > c) {
          c = Math.min(sp * NAME_BAND - off, gap - safe);
          if (dynId) {
            dynId2 = dynId;
            dynD2 = dynD;
          }
          dynId = 0;
          dynD = 1e4;
        }

        if (c < gone) {
          // open ground. a fir stands here as one of a stand, or not at all:
          // except on a big screen, where now and then one is left on its own
          // in a clearing (well away from the text and the rim), and a few
          // stragglers stand out past the treeline, thinning with distance.
          // (seen from as high up as a phone is, a fir on its own is a speck.)
          if (!inStand(x, y)) {
            if (high) continue;
            if (past) {
              if (dEdge < -straggle || hash(i, j, 6) > lone * Math.exp(dEdge / (straggle * 0.4))) continue;
            } else if (hash(i, j, 12) > 0.004 * ease(lonely, lonely + sp * 5, gap) * ease(sp * 2.5, sp * 6, -c)) continue;
          }
          c = edge * (0.4 + 0.6 * hash(i, j, 8));
          dynId = 0;
          dynD = 1e4;
        }

        // nothing is planted in the name's cut, or where the row along its
        // edge stands. behind that row the forest starts at once and at full
        // size, since the row is what draws the edge: but the shade under
        // these firs has to stop short of the cut, behind the row. (the
        // shader draws it in as far as sd says; so sd is set to say that.)
        if (off < sp * 0.55) continue;
        // nor in a sliver of ground between the trail and a rim that is close
        // by: the few firs with room to stand there would all be saplings,
        // and read as litter
        if (sd < sp * 1.3 && c < sp * 1.6) continue;
        if (off + sp * (FLOOR * 0.7 - 0.3) < sd) {
          sd = off + sp * (FLOOR * 0.7 - 0.3);
          st = offT;
        }

        const o = base + n * STRIDE;
        trees[o] = x;
        trees[o + 1] = y;
        // (most firs are slight, a few are big and old. near the name they
        // are all slight, and none is so broad that it reaches past the row.)
        const girth = hash(i, j, 3);
        const old = off < 1e4 ? 0.06 : 0.22 * girth * girth;
        trees[o + 2] = Math.min(off + sp * 0.05, sp * (0.43 + (0.27 + old) * girth) * (0.76 + 0.46 * stand(x, y)));
        trees[o + 3] = 0.6 + 0.8 * hash(i, j, 4);
        trees[o + 4] = hash(i, j, 10);
        trees[o + 5] = c;
        trees[o + 6] = dynD < growPx * 4.5 + edge ? dynId : 0;
        trees[o + 7] = dynD;
        trees[o + 8] = sd;
        trees[o + 9] = st;
        trees[o + 10] = trust;
        trees[o + 11] = dynD2 < growPx * 1.5 + sp * 5 ? dynId2 * 1024 + clamp(dynD2, 0, 1023) : 0;
        n++;
        if (c > 0 && sd > 0) standing++;
      }
    }

    // the rows along the edges of the name: firs of middling size, each a
    // little out of line and of a height of its own (in a row of equals the
    // shadows fall across the letters like the teeth of a saw).
    // plant() made room for every one of them. if that sum is ever wrong,
    // say so: firs left out without a word are how a letter loses its edge.
    const row = rims[b];
    if (n + row.length > room) console.error(`forest: band ${b} has room for ${room} firs and needs ${n + row.length}`);
    for (let k = 0; k < row.length && n < room; k++) {
      const x = row[k][0];
      const y = row[k][1];
      const i = Math.round(x * 8);
      const j = Math.round(y * 8);
      const o = base + n * STRIDE;
      trees[o] = x + (hash(i, j, 1) - 0.5) * sp * 0.3;
      trees[o + 1] = y + (hash(i, j, 2) - 0.5) * sp * 0.3;
      trees[o + 2] = sp * (0.47 + 0.2 * hash(i, j, 3));
      trees[o + 3] = 0.4 + 0.55 * hash(i, j, 4); // (short ones: their shadows fall across the letters)
      trees[o + 4] = hash(i, j, 10);
      trees[o + 5] = 1e4; // nowhere near a clearing
      trees[o + 6] = 0;
      trees[o + 7] = 1e4;
      trees[o + 8] = row[k][2];
      trees[o + 9] = 0;
      trees[o + 10] = 1;
      trees[o + 11] = 0;
      n++;
      standing++;
    }

    counts[b] = n;
    hitch = true;
    // (a band with no firs in it has nothing to send. asked to send none, the
    // gpu is sent everything from there to the end of the array instead,
    // which after a resize may be more than its buffer holds.)
    if (n > 0) {
      gl.bindBuffer(gl.ARRAY_BUFFER, treeBuf);
      gl.bufferSubData(gl.ARRAY_BUFFER, base * 4, trees, base, n * STRIDE);
    }
  }

  // plant one more band while nothing else is going on: whichever unplanted
  // one is nearest the screen. once none are left, the footer gets its count.
  function plantMore() {
    idle = 0;
    if (lost || dead || !ground) return;
    const here = (window.scrollY + VH / 2) / bandH - 0.5;
    let next = -1;
    for (let b = 0; b < counts.length; b++) {
      if (counts[b] < 0 && (next < 0 || Math.abs(b - here) < Math.abs(next - here))) next = b;
    }
    if (next < 0) {
      const count = String(standing).replace(/\B(?=(\d{3})+$)/g, ',');
      if (countEl) countEl.textContent = `${count} firs on this page. none were harmed.`;
      farSoon(60);
      return;
    }
    plantBand(next);
    if (next * bandH < top + CH + bandH && (next + 1) * bandH > top - bandH) paint(); // it may be under the canvas: show it
    later();
  }

  function later() {
    if (idle) return;
    idle = window.requestIdleCallback ? requestIdleCallback(plantMore, { timeout: 500 }) : setTimeout(plantMore, 50);
  }

  /* -------------------------------------------------------------- canvas */

  // the canvas is a window onto the forest, a bit taller than the screen. it
  // sits in the document and scrolls with it, so the trees can never slip
  // against the text; it only gets moved when you near its edge.
  let dpr = 1;
  let quality = 1; // drops if this machine cannot keep up
  let fitW = 0;
  let tallest = 0;
  let M = 0;
  let CH = 0;
  let top = -1e9;

  function fit() {
    // sized from the tallest the window has been at this width: a phone's
    // toolbars sliding in and out change its height all the time, and must
    // not have the canvas thrown away and painted again each time
    if (W !== fitW) {
      fitW = W;
      tallest = 0;
    }
    tallest = Math.max(tallest, VH);
    M = Math.round(Math.min(tallest * 0.5, 520));
    CH = tallest + 2 * M;
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    const px = W * CH * dpr * dpr;
    if (px > 1e7) dpr = Math.max(1, dpr * Math.sqrt(1e7 / px));
    dpr *= quality;
    const w = Math.round(W * dpr);
    const h = Math.round(CH * dpr);
    if (canvas.width === w && canvas.height === h) return false;
    canvas.width = w;
    canvas.height = h;
    canvas.style.width = `${W}px`;
    canvas.style.height = `${CH}px`;
    top = -1e9;
    return true;
  }

  // the bands the canvas lies over (first and last), and those of them that
  // can be seen right now (first and last)
  function bands() {
    const reachY = sp * 8;
    const last = counts.length - 1;
    const b0 = clamp(Math.floor((top - reachY) / bandH), 0, last);
    const b1 = clamp(Math.floor((top + CH + reachY) / bandH), 0, last);
    const sy = window.scrollY;
    return [b0, b1, clamp(Math.floor((sy - VH * 0.2) / bandH), b0, b1), clamp(Math.floor((sy + VH * 1.2) / bandH), b0, b1)];
  }

  // any band on screen that the idle planting has not reached is planted on
  // the spot; the ones in the canvas's margins can wait their turn.
  function cover() {
    const [b0, b1, v0, v1] = bands();
    for (let b = v0; b <= v1; b++) if (counts[b] < 0) plantBand(b);
    return [b0, b1];
  }

  // returns true if the canvas had to be moved, which leaves it needing
  // paint. `jump` is how far the page scrolled since the last frame: the
  // canvas keeps three frames of that in hand in the direction of travel, and
  // when it is moved most of its spare height goes that way. (the last jump
  // itself, not a smoothed speed: that would still point the old way for a
  // moment when the scroll turns round.)
  function place(jump = 0) {
    const sy = window.scrollY;
    const above = sy - top;
    const below = top + CH - (sy + VH);
    const ahead = Math.min(M * 1.3, M * 0.3 + Math.abs(jump) * 3);
    if (above >= (jump < 0 ? ahead : M * 0.2) && below >= (jump > 0 ? ahead : M * 0.2)) return false;
    top = Math.round((sy - M + clamp(jump * 5, -M * 0.75, M * 0.75)) * dpr) / dpr;
    canvas.style.transform = `translate3d(0,${top}px,0)`;
    clipFar();
    return true;
  }

  /* ---------------------------------------------------------- far forest */

  // the canvas only covers the part of the page around the screen, and the
  // page is scrolled by the browser without waiting for this script. a hard
  // enough scroll can outrun the canvas for a frame or two, and where it has
  // not got to yet there would be bare ground with a ruler-straight edge.
  // so the rest of the page has a rough copy of the forest lying on it: all
  // of it, painted once at low resolution, and shown only where the canvas
  // is not. for the frame or two it is ever seen, in motion, it will do.
  //
  // it is there twice, each in a box of its own: one box is cut off where
  // the canvas begins, the other starts where the canvas ends. (not one copy
  // with a hole cut in it. where the hole is changes on every frame of a
  // hard scroll, and a shape cut out of a picture has to be painted again
  // each time, which now and then came a frame late: a bare band after all.
  // a box that is cut off shorter or longer needs nothing painted.)
  const far = document.createElement('canvas');
  const farLow = document.createElement('canvas');
  const farUp = document.createElement('div');
  const farDown = document.createElement('div');
  [[farUp, far], [farDown, farLow]].forEach(([box, copy]) => {
    box.style.cssText = 'position:absolute;left:0;top:0;width:100%;height:0;overflow:hidden';
    copy.hidden = true;
    box.append(copy);
  });
  canvas.before(farUp, farDown);
  const farCtx = far.getContext('2d');
  let farTimer = 0;

  function farOff() {
    far.hidden = farLow.hidden = true;
  }

  // show it everywhere but under the canvas
  function clipFar() {
    if (far.hidden) return;
    const a = clamp(top + 1, 0, docH);
    const b = clamp(top + CH - 1, 0, docH);
    farUp.style.height = `${a}px`;
    farDown.style.transform = `translate3d(0,${b}px,0)`;
    farDown.style.height = `${docH - b}px`;
    farLow.style.transform = `translate3d(0,${-b}px,0)`;
  }

  // paint it: the canvas is pointed at one stretch of the page after
  // another, and each is copied down smaller. it needs the forest to be
  // running and all of it planted; whichever of those comes last asks. (it
  // does not wait for the opening to be over: it is a copy of the forest as
  // it will stand, and a hard scroll in the first second or two wants it as
  // much as any other.)
  function paintFar() {
    farTimer = 0;
    if (!live || lost || dead || !counts.length || counts.some((n) => n < 0)) return;
    hitch = true; // (the next frame is late on this account, not the gpu's)
    const k = Math.min(1, Math.sqrt(1.4e6 / (W * docH)));
    far.width = Math.round(W * k);
    far.height = Math.round(docH * k);
    far.style.width = `${W}px`;
    far.style.height = `${docH}px`;
    const here = top;
    for (top = 0; top < docH; top += CH) {
      draw(true);
      farCtx.drawImage(canvas, 0, 0, canvas.width, canvas.height, 0, top * k, W * k, CH * k);
    }
    top = here;
    draw(); // (and the canvas is put back as it was, before the browser shows it)
    farLow.width = far.width;
    farLow.height = far.height;
    farLow.style.width = far.style.width;
    farLow.style.height = far.style.height;
    farLow.getContext('2d').drawImage(far, 0, 0);
    far.hidden = farLow.hidden = false;
    clipFar();
  }

  // ask for it to be painted, or painted again, once things have settled
  function farSoon(wait = 400) {
    farOff();
    clearTimeout(farTimer);
    farTimer = setTimeout(paintFar, wait);
  }

  /* -------------------------------------------------------------- motion */

  const VEIL = 0.32; // how opaque a shadow is
  let colors = null;
  const cam = { x: 0, y: 0, vx: 0, vy: 0 };
  const pointer = { x: 0, y: 0, inside: false, lx: 0, ly: 0, lt: 0, gustAt: 0 };
  const grow = Array.from({ length: MAX_DYN }, () => ({ x: 0, v: 0, to: 0 }));
  const growU = new Float32Array(MAX_DYN);
  const shut = new Float32Array(MAX_DYN); // every clearing closed
  const gusts = new Float32Array(MAX_GUST * 4);
  const gustP = new Float32Array(MAX_GUST * 2).fill(-100);
  let gustI = 0;
  let lastGust = -100;

  const t0 = performance.now();
  const seconds = () => (performance.now() - t0) / 1000;

  const SETTLED = 1e6; // past the end of the opening, wherever a tree stands
  const NAME_ONLY = 1.06; // uReveal with the whole wordmark open and none of the trail
  let introAt = -1; // when the opening began (-1: it is not running)
  let introLast = 0; // when it was last moved on
  let introT = 0; // how far into it we are, in seconds of its own time
  let reveal = NAME_ONLY;
  let growIn = 0;
  let origin = [0, 0, 1];

  let running = false; // a frame is scheduled
  let dirty = false; // the canvas needs painting
  let lastFrame = 0;
  let lastScroll = 0;
  let scrollVel = 0;
  let lost = false; // the webgl context is gone (it may come back)
  let chained = false; // the last frame asked for another: the gap between them is a frame time
  let hitch = false; // a band was planted since the last frame: that gap says nothing about the gpu
  let slow = 0; // smoothed frame time while something is moving
  let late = 0; // very slow frames in a row
  let eased = 0; // when quality was last lowered
  let tooSlow = false; // this machine cannot animate the forest
  let shown = false; // the page has been handed over to the forest (html.forest-on)
  let heavy = 0; // paintings of a still forest in a row that stalled
  let probes = 3; // paintings of a still forest that are still to be timed
  let dead = false; // the forest has been given up on

  // how often this screen shows a new frame, taken from the first few frames
  // of the visit. a phone that is saving power may only show thirty a second,
  // and that must not be taken for the forest being slow.
  let beat = 1 / 60;
  const paces = new Float32Array(12).fill(1); // the gaps between the last dozen frames
  let paced = 0;

  // note the gap between two frames. the beat is the third shortest of the
  // last dozen: what this screen can do, give or take a stray frame. (one
  // quick frame on a screen that is otherwise held to thirty a second must
  // not set the bar.) after the first dozen it only ever comes down, since a
  // forest that is slow would otherwise set its own bar.
  function pace(gap) {
    paces[paced++ % 12] = gap;
    if (paced < 12) return;
    let a = 1;
    let b = 1;
    let c = 1;
    for (let k = 0; k < 12; k++) {
      const g = paces[k];
      if (g < a) {
        c = b;
        b = a;
        a = g;
      } else if (g < b) {
        c = b;
        b = g;
      } else if (g < c) {
        c = g;
      }
    }
    if (paced === 12) beat = clamp(c, 1 / 240, 1 / 20);
    else if (c < beat) beat = Math.max(c, 1 / 240);
  }
  (() => {
    let last = 0;
    let left = 13;
    const tick = (t) => {
      if (last) pace((t - last) / 1000);
      last = t;
      if (--left) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  })();

  // hand the page over to the forest: the canvas shows, and the name's ink
  // goes. not before a painting of it has been timed and found quick enough
  // (see start() and show()): a machine that cannot draw the forest never
  // sees it come and go again.
  function unveil() {
    if (shown) return;
    shown = true;
    root.classList.add('forest-on');
  }

  // no motion at all: either the visitor asked for that, or the gpu cannot
  // keep up. the forest is then one still picture, painted only when the
  // canvas is moved or the layout changes, so scrolling it costs nothing.
  const holdStill = () => reduced.matches || tooSlow;

  // how far along itself the trail is by the time it has passed a given
  // height on the page
  function trailBy(y) {
    let t = TRAIL;
    for (const g of segs) if (g[7] && g[6] > t && Math.min(g[1], g[3]) < y) t = g[6];
    return t;
  }

  // skip to the end of the opening
  function settle() {
    introAt = -1;
    reveal = SETTLED;
    growIn = SETTLED;
    dirty = true;
  }

  // drop every gust and ripple in flight
  function calm() {
    gustP.fill(-100);
    lastGust = -100;
    dirty = true;
  }

  function readColors() {
    const [snow, shade, ground, tip, ...fir] = cssColors(['--snow', '--shade', '--fir-floor', '--fir-tip', '--fir-0', '--fir-1', '--fir-2']);
    colors = {
      // a shadow is a veil, not a colour: it darkens whatever ground it falls
      // on, the lit ground of the name included. --shade says what it should
      // come to on plain snow, and this is the tint that gets it there.
      shade: shade.map((v, i) => clamp((v - snow[i] * (1 - VEIL)) / VEIL, 0, 1)),
      ground,
      tip,
      fir: new Float32Array(fir.flat()),
      lit: new Float32Array(fir.map((c) => mix3(c, tip, 0.38)).flat()),
    };
  }

  function gust(x, y, dx, dy, radius) {
    const i = gustI++ % MAX_GUST;
    gusts.set([x, y, dx, dy], i * 4);
    gustP.set([seconds(), radius], i * 2);
    lastGust = seconds();
    wake();
  }

  // one damped spring, advanced by dt in small fixed steps
  function step(s, to, k, c, dt) {
    const n = Math.max(1, Math.ceil(dt / 0.004));
    const h = dt / n;
    for (let i = 0; i < n; i++) {
      s.v += (-k * (s.x - to) - c * s.v) * h;
      s.x += s.v * h;
    }
  }

  // paint the canvas. `plain` is for the rough copy: the forest as it stands
  // at rest, whatever is going on in it just now.
  function draw(plain = false) {
    if (!live) return;
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.clearColor(0, 0, 0, 0); // open ground is simply the page showing through
    gl.clear(gl.COLOR_BUFFER_BIT);
    if (!counts.length) return;
    const [b0, b1] = cover();

    gl.uniform2f(U.uView, W, CH);
    gl.uniform1f(U.uTop, top);
    gl.uniform1f(U.uDpr, dpr);
    gl.uniform2f(U.uNadir, W / 2 + (plain ? 0 : cam.x), window.scrollY + VH / 2 + cam.y);
    gl.uniform1f(U.uLean, sp * 0.0011);
    gl.uniform2f(U.uTilt, plain || holdStill() ? 1 : 0, 280);
    gl.uniform1f(U.uMaxLean, sp * 0.55);
    gl.uniform1f(U.uTime, seconds());
    gl.uniform1f(U.uWind, !plain && seconds() - lastGust < 3.6 ? 1 : 0);
    gl.uniform1f(U.uReveal, plain ? SETTLED : reveal);
    gl.uniform1f(U.uGrowIn, plain ? SETTLED : growIn);
    gl.uniform3f(U.uOrigin, origin[0], origin[1], origin[2]);
    gl.uniform1f(U.uEdge, edge);
    gl.uniform1f(U.uGrowPx, growPx);
    gl.uniform1fv(U.uGrow, plain ? shut : growU);
    gl.uniform2fv(U.uCenter, centers);
    gl.uniform4fv(U.uGust, gusts);
    gl.uniform2fv(U.uGustP, gustP);
    gl.uniform2f(U.uSun, 0.86, 0.5);
    gl.uniform3fv(U.uShade, colors.shade);
    gl.uniform1f(U.uVeil, VEIL);
    gl.uniform3fv(U.uGround, colors.ground);
    gl.uniform1f(U.uFloor, sp * FLOOR);
    gl.uniform1f(U.uDeep, sp < 8 ? 0 : 0.22); // (seen from high up such a gap is too small to see)
    gl.uniform3fv(U.uFir, colors.fir);
    gl.uniform3fv(U.uFirLit, colors.lit);
    gl.uniform3fv(U.uTip, colors.tip);

    // shadows, forest floor, then the three tiers of each fir; each of
    // those over every band in view before the next one starts
    gl.bindBuffer(gl.ARRAY_BUFFER, treeBuf);
    for (let pass = 0; pass < 5; pass++) {
      // where shadows overlap they must not add up: keep the darkest
      gl.blendEquation(pass ? gl.FUNC_ADD : gl.MAX);
      gl.uniform1i(U.uPass, pass);
      for (let b = b0; b <= b1; b++) {
        if (counts[b] <= 0) continue;
        const at = b * slot * 4;
        gl.vertexAttribPointer(1, 2, gl.FLOAT, false, BYTES, at);
        gl.vertexAttribPointer(2, 4, gl.FLOAT, false, BYTES, at + 8);
        gl.vertexAttribPointer(3, 4, gl.FLOAT, false, BYTES, at + 24);
        gl.vertexAttribPointer(4, 2, gl.FLOAT, false, BYTES, at + 40);
        gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, counts[b]);
      }
    }
  }

  // one frame. frames are only requested while something is changing: when
  // the page is at rest, nothing runs.
  function frame(now) {
    running = false;
    if (lost || !live) return;
    const gap = (now - lastFrame) / 1000; // since the previous frame, however long that took
    const fresh = !chained; // nothing was moving before this: the first frame after a rest
    if (chained) pace(gap);
    const dt = clamp(gap, 0.001, 0.05);
    lastFrame = now;
    const sy = window.scrollY;
    const jump = sy - lastScroll; // how far the page has scrolled since the last frame
    let busy = false;

    if (holdStill()) {
      cam.x = cam.y = cam.vx = cam.vy = 0;
      scrollVel = 0;
      for (let i = 0; i < MAX_DYN; i++) {
        const g = grow[i];
        if (g.x !== g.to) dirty = true; // a clearing opens or closes at once
        g.x = g.to;
        g.v = 0;
        growU[i] = g.x;
      }
    } else {
      dirty = true; // whatever asked for this frame, something is moving

      // scrolling: the camera has some mass, so it trails the page and settles
      const v = fresh ? 0 : (sy - lastScroll) / dt;
      if (sy !== lastScroll) busy = true;
      scrollVel += (v - scrollVel) * Math.min(1, dt * 10);
      if (Math.abs(scrollVel) < 1) scrollVel = 0;
      else busy = true;

      const tx = pointer.inside ? (pointer.x - W / 2) * 0.4 : 0;
      const ty = (pointer.inside ? (pointer.y - VH / 2) * 0.4 : 0) + clamp(scrollVel * 0.16, -360, 360);
      const sx = { x: cam.x, v: cam.vx };
      const syy = { x: cam.y, v: cam.vy };
      step(sx, tx, 70, 13, dt);
      step(syy, ty, 70, 13, dt);
      cam.x = sx.x;
      cam.vx = sx.v;
      cam.y = syy.x;
      cam.vy = syy.v;
      if (Math.abs(cam.x - tx) + Math.abs(cam.y - ty) > 0.05 || Math.abs(cam.vx) + Math.abs(cam.vy) > 0.05) {
        busy = true;
      } else {
        // close enough: come to rest exactly, so the same pose always paints the same picture
        cam.x = tx;
        cam.y = ty;
        cam.vx = cam.vy = 0;
      }

      // clearings opening under the pointer
      for (let i = 0; i < MAX_DYN; i++) {
        const g = grow[i];
        if (Math.abs(g.x - g.to) > 0.0005 || Math.abs(g.v) > 0.0005) {
          step(g, g.to, 240, 19, dt);
          busy = true;
        } else {
          g.x = g.to;
          g.v = 0;
        }
        growU[i] = g.x;
      }

      // the opening: the forest comes up around the name (the stylesheet
      // fades the ink out meanwhile), then the trail sets off from the y
      if (introAt >= 0) {
        // (it keeps its own time. if the page is scrolled away while the
        // forest is still coming up, that runs four times as fast: whoever
        // went to look further down finds the forest up, the part of it
        // that was on the screen included, and the trail not far behind.)
        const hurry = Math.abs(sy + VH / 2 - origin[1]) > VH / 4 ? 4 : 1;
        introT += Math.min((now - introLast) / 1000, 0.25) * hurry;
        introLast = now;
        growIn = introT / 0.85;
        reveal = NAME_ONLY + Math.max(0, introT - 0.55) * 1.1;
        // it is over once the forest is up and the trail has got as far as
        // the canvas reaches. the rest of the trail sets off out of sight:
        // painting that, frame after frame, would be work for nothing.
        if (growIn > 1.4 && reveal > Math.min(maxT, trailBy(top + CH + sp * 8)) + 0.1) settle();
        else busy = true;
      }

      if (seconds() - lastGust < 3.6) busy = true; // by then a gust has died away to nothing

      // if frames keep arriving late, first draw fewer pixels (the canvas is
      // simply scaled up), and if that is not enough, stop animating. late
      // means: for a second or so, well under what this screen can show
      // (about 35 frames a second where it shows 60). two frames in a row
      // that take over a quarter of a second skip the half measures. a frame
      // that had a band of firs planted before it took longer for that
      // reason, and is left out of the average.
      if (busy && !fresh) {
        late = gap > 0.25 ? late + 1 : 0;
        if (!hitch) {
          const g = Math.min(gap, 0.1); // one long hiccup is not a trend
          slow += (g - slow) * (1 - Math.exp(-g / 0.5));
        }
        if (late >= 2 || (slow > Math.max(beat * 1.7, 0.024) && now - eased > 900)) {
          eased = now;
          slow = 0;
          if (late < 2 && quality > 0.5) {
            quality = Math.max(0.5, quality * 0.7);
            fit();
          } else {
            // hold still from here on, and at half resolution: what is left
            // is the odd repaint as the page scrolls, and it should be cheap
            tooSlow = true;
            quality = 0.5;
            fit();
            settle();
            calm();
            busy = false;
          }
        }
      }
    }
    lastScroll = sy;
    hitch = false;

    if (place(jump)) dirty = true;
    if (dirty) {
      dirty = false;
      if (show()) return;
    }
    chained = busy;
    if (busy) wake();
  }

  // wait until the gpu has done everything it has been asked to so far
  // (reading a pixel back does not return before that)
  const pixel = new Uint8Array(4);
  const settleGpu = () => gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);

  // paint. true means the forest had to be given up over it.
  //
  // a still forest is painted rarely and should cost next to nothing. the
  // first few paintings of one wait for the gpu, to see what a painting
  // really costs (after that it is trusted: waiting holds the page up, and
  // whoever asked for less motion should not get a hitch in the scroll for
  // it). a stall you would notice gets one more try at half the resolution; a
  // second one running, and this gpu is not up to the forest.
  function show() {
    if (!holdStill() || !probes) {
      draw();
      return false;
    }
    if (counts.length) cover(); // plant first, so that only the painting is timed
    const began = performance.now();
    draw();
    settleGpu();
    const cost = performance.now() - began;
    if (cost <= BUDGET) {
      heavy = 0;
      probes--;
      unveil();
      return false;
    }
    // (so far over that trying it smaller is not going to help, and the
    // forest has not been shown yet: it is not going to be)
    if (!shown && cost > BUDGET * 4) {
      giveUp();
      return true;
    }
    heavy++;
    if (quality > 0.5) {
      quality = 0.5;
      fit();
      paint();
      return false;
    }
    if (heavy < 2) {
      if (!shown) paint(); // (try once more before deciding)
      return false;
    }
    giveUp();
    return true;
  }

  // the page is about to be laid out differently: with the room the forest
  // takes, or without it, which is a good deal shorter. whoever is reading
  // keeps their place: the last thing to begin in the top third of the
  // screen, or above it, stays where it is. (the things around it move, as
  // the gaps between them close or open. so if the page has not been
  // scrolled since the last time, it is the same thing that is held again:
  // there and back leaves everything where it started.)
  let reading = null;
  function keepPlace(change) {
    let mark = null;
    if (reading && Math.abs(window.scrollY - reading.at) < 2) {
      mark = reading.mark;
    } else {
      const line = window.innerHeight / 3;
      for (const el of document.querySelectorAll('.hero, [data-clearing]')) {
        if (el.getBoundingClientRect().top <= line) mark = el;
      }
    }
    const was = mark ? mark.getBoundingClientRect().top : 0;
    change();
    if (mark) window.scrollBy(0, mark.getBoundingClientRect().top - was);
    reading = { mark, at: window.scrollY };
  }

  // the forest is not going to work on this machine. put the page back the
  // way it is without one, for the rest of the visit, and hand back the
  // memory it was using.
  function giveUp() {
    dead = true;
    live = false;
    shown = false;
    clearTimeout(lostTimer);
    keepPlace(() => {
      root.classList.remove('forest-on', 'has-forest');
      root.classList.add('plain');
    });
    if (countEl) countEl.textContent = noCount;
    const ext = gl.getExtension('WEBGL_lose_context');
    if (ext) ext.loseContext();
    canvas.width = canvas.height = 1;
    clearTimeout(farTimer);
    farOff();
    far.width = far.height = farLow.width = farLow.height = 1;
  }

  // ask for a frame
  function wake() {
    if (running || lost || dead) return;
    running = true;
    requestAnimationFrame(frame);
  }

  // ask for a frame that paints, even if nothing is moving
  function paint() {
    dirty = true;
    wake();
  }

  /* --------------------------------------------------------------- events */

  let pending = 0;

  // measure the page again and, if it has changed, plant the forest again
  function rebuild() {
    pending = 0;
    root.classList.remove('resizing');
    if (lost || dead) return; // if the context returns, it is all measured and planted again
    measure();
    if (signature() !== planted) plant();
    bindClearings();
    if (fit()) {
      // a resized canvas is blank: paint it again before the browser shows it
      place();
      if (show()) return;
    }
    paint();
  }

  // while the window is being dragged to another size the text moves at once
  // and the forest, planted for the old size, does not: the clearings are no
  // longer where the text is. it steps back until it has been planted again.
  // where the machine can plant it again within a frame or so, it does not
  // need to: the forest is planted again there and then, and moves with the
  // window.
  let sluggish = false;
  function stepBack() {
    if (!sluggish && !lost && !dead) {
      clearTimeout(pending);
      const began = performance.now();
      rebuild();
      sluggish = performance.now() - began > 40;
      return;
    }
    root.classList.add('resizing');
    scheduleRebuild();
  }

  function scheduleRebuild() {
    clearTimeout(pending);
    pending = setTimeout(rebuild, 120);
  }

  // a clearing marked "grow" opens a little for as long as the pointer is
  // over it or the keyboard focus is in it (either is reason enough)
  const held = new WeakMap(); // element -> { over, focus }
  function bindClearings() {
    grow.forEach((g) => {
      g.to = 0;
    });
    growIndex.forEach((i, el) => {
      let by = held.get(el);
      if (!by) {
        by = { over: false, focus: false };
        held.set(el, by);
        const set = (why, on) => {
          by[why] = on;
          const k = growIndex.get(el);
          if (k === undefined) return;
          grow[k].to = by.over || by.focus ? 1 : 0;
          wake();
        };
        el.addEventListener('pointerenter', () => set('over', true));
        el.addEventListener('pointerleave', () => set('over', false));
        // (only focus that shows a ring counts. a click puts the focus on a
        // link as well, and must not hold its clearing open once the pointer
        // has gone.)
        el.addEventListener('focusin', (e) => set('focus', e.target.matches(':focus-visible')));
        el.addEventListener('focusout', () => set('focus', false));
      }
      // (measuring the page again can give an element a different number)
      grow[i].to = by.over || by.focus ? 1 : 0;
    });
  }

  function listen(fontsWereIn) {
    window.addEventListener('scroll', wake, { passive: true });
    // (a phone's toolbars sliding in and out change the height only, and
    // move nothing on the page)
    window.addEventListener('resize', () => (root.clientWidth !== W ? stepBack() : scheduleRebuild()));

    let reported = false; // the first report is only the size we already measured
    new ResizeObserver(() => {
      if (reported) stepBack();
      reported = true;
    }).observe(document.body);

    // if the fonts arrive after the forest was planted, the text has moved
    if (!fontsWereIn) fonts.then(scheduleRebuild);

    // a quick pointer leaves a gust behind it
    window.addEventListener(
      'pointermove',
      (e) => {
        if (e.pointerType !== 'mouse' || holdStill()) return;
        const now = performance.now();
        const dt = (now - pointer.lt) / 1000;
        if (pointer.inside && dt > 0 && dt < 0.1) {
          const vx = (e.clientX - pointer.lx) / dt;
          const vy = (e.clientY - pointer.ly) / dt;
          const speed = Math.hypot(vx, vy);
          if (speed > 260 && now - pointer.gustAt > 70) {
            const push = clamp(speed / 2600, 0.18, 1) * sp * 1.5;
            gust(e.pageX, e.pageY, (vx / speed) * push, (vy / speed) * push, clamp(60 + speed * 0.03, 70, 130));
            pointer.gustAt = now;
          }
        }
        pointer.x = pointer.lx = e.clientX;
        pointer.y = pointer.ly = e.clientY;
        pointer.lt = now;
        pointer.inside = true;
        wake();
      },
      { passive: true }
    );
    root.addEventListener('pointerleave', () => {
      pointer.inside = false;
      wake();
    });

    // a click or tap anywhere that is not a link sends a ripple through the canopy
    window.addEventListener('click', (e) => {
      if (holdStill() || (e.target.closest && e.target.closest('a, button'))) return;
      gust(e.pageX, e.pageY, sp * 0.8, 0, -280);
    });

    const repaint = () => {
      readColors();
      if (reduced.matches) {
        // asked to hold still mid-motion: finish the opening, drop the wind
        settle();
        calm();
      }
      paint();
      farSoon(); // (its colours are the old ones)
    };
    scheme.addEventListener('change', repaint);
    reduced.addEventListener('change', repaint);

    // a hidden tab gets no frames; the wait is not the forest being slow
    document.addEventListener('visibilitychange', () => {
      chained = false;
      late = 0;
    });
  }

  // the first thing to find out is whether this machine has a real gpu at
  // all, and if it has, the shaders can start compiling. both happen straight
  // after the first paint, long before the fonts are in, so a page that is
  // not going to have a forest says so within a frame or two.
  let linked = null;
  function warm() {
    if (dead || linked || gl.isContextLost()) return;
    if (software()) return giveUp();
    linked = buildProgram();
    linked.catch(() => {}); // (boot() is where a failure is dealt with)
  }
  requestAnimationFrame(() => setTimeout(warm, 0));

  const turn = () => new Promise((r) => setTimeout(r, 0));

  // everything the forest needs before its first frame. resolves once the
  // shaders are linked; by then the page is measured and what is on screen
  // is planted. false means: not on this machine.
  //
  // it is several heavy steps: the first webgl calls, measuring the page,
  // laying the forest out, and planting each band. the browser gets a turn
  // after every one of them, so the page stays answerable while it happens.
  async function boot() {
    warm();
    if (dead) return false;
    initGL();
    readColors();
    await turn();
    measure();
    await turn();
    plant();
    bindClearings();
    fit();
    place();
    const [, , first, last] = bands();
    for (let b = first; b <= last; b++) {
      if (counts[b] < 0) plantBand(b);
      await turn();
    }
    await linked;
    useProgram();
    return true;
  }

  let listening = false;
  async function start(opening) {
    const fontsWereIn = fontsIn;
    try {
      if (!(await boot())) return;
    } catch (err) {
      // no forest, then. the name is still there in ink.
      console.error(err);
      if (!gl.isContextLost()) giveUp(); // (a lost context may still come back and try again)
      return;
    }

    if (opening && !holdStill()) {
      origin = [W / 2, window.scrollY + VH / 2, Math.hypot(W, VH) / 2];
      introAt = introLast = performance.now();
      introT = 0;
    } else {
      settle();
      calm();
    }
    lastScroll = window.scrollY;

    place();
    if (!opening) {
      // (it was showing before the context was lost: it has proved itself)
      draw();
      unveil();
    } else if (holdStill()) {
      // (a forest that holds still is timed by show(), on its first frame)
      draw();
      settleGpu();
    } else {
      // before the forest is shown, see what a painting of it costs this
      // gpu. the canvas is still hidden, and a hidden canvas costs nothing
      // until the gpu is made to finish it, so the pace of the first frames
      // would say nothing: the gpu is asked directly. and it is asked to
      // paint the forest fully grown, as it will stand, not as the opening
      // starts out, with nothing up yet. the first painting sets a lot up,
      // so if that one is slow there is a second go.
      const timed = () => {
        const began = performance.now();
        draw(true);
        settleGpu();
        return performance.now() - began;
      };
      let cost = timed();
      if (cost > EASY) cost = timed();
      if (cost > BUDGET * 4) {
        // no forest on this machine. (it never showed.)
        giveUp();
        return;
      }
      if (cost > BUDGET) {
        // it is not going to move on this machine. it holds still at half
        // the resolution, and show() decides whether it is shown like that.
        tooSlow = true;
        quality = 0.5;
        fit();
        settle();
        calm();
      } else {
        // quick enough: it is shown, and comes up from nothing, from now.
        // (if a painting takes more than a couple of frames, the opening
        // would find that out the hard way, dropping frames until it had
        // brought the resolution down. it starts out lower instead.)
        if (cost > EASY) {
          quality = cost > EASY * 2 ? 0.5 : 0.7;
          fit();
        }
        introAt = introLast = performance.now();
        introT = 0;
        draw();
        unveil();
      }
    }
    paint();
    farSoon(60); // (if the planting is done already. if not, that asks when it is)

    if (!listening) {
      listening = true;
      listen(fontsWereIn);
    }
  }

  // if the gpu context goes, so does the forest: the name goes back to ink
  // and the page to its wording without one, until everything has been
  // planted and painted again
  // (a context usually comes straight back. if it has not after a moment,
  // the page is laid out for having no forest, until it does.)
  let lostTimer = 0;
  canvas.addEventListener('webglcontextlost', (e) => {
    e.preventDefault();
    lost = true;
    live = false;
    linked = null;
    shown = false;
    keepPlace(() => root.classList.remove('forest-on', 'has-forest'));
    if (countEl) countEl.textContent = noCount;
    clearTimeout(lostTimer);
    lostTimer = setTimeout(() => {
      if (lost) keepPlace(() => root.classList.add('plain'));
    }, 2000);
  });
  canvas.addEventListener('webglcontextrestored', () => {
    if (dead) return;
    clearTimeout(lostTimer);
    lost = false;
    planted = '';
    keepPlace(() => {
      root.classList.remove('plain'); // (both before the page is measured again)
      root.classList.add('has-forest');
    });
    start(false);
  });

  // wait for the fonts, but not for long, so that the clearings are measured
  // around the real text
  let fontsIn = !(document.fonts && document.fonts.ready);
  const fonts = fontsIn
    ? Promise.resolve()
    : document.fonts.ready.then(() => {
        fontsIn = true;
      });
  Promise.race([fonts, new Promise((r) => setTimeout(r, 1500))]).then(() => start(true));
})();
