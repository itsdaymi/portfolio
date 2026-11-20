/* f-hoehenlinien: a procedural map sheet of the black forest edge, with daymi on it. */
(() => {
  'use strict';

  /* ---------- data: the project list. add a project here and it gets a place on the sheet. ---------- */
  const PROJECTS = [
    { name: 'daystack',   desc: 'my agent skills. editable copies, installed via skills.sh.',                  year: 2026, tags: ['skills', 'cli'],      link: 'https://github.com/itsdaymi/daystack' },
    { name: 'ledger',     desc: 'a small double-entry bookkeeping cli. plain text in, balance sheet out.',      year: 2026, tags: ['cli', 'finance'],     link: '#' },
    { name: 'pinboard',   desc: 'a self-hosted bookmark thing with full-text search. because every other one died.', year: 2025, tags: ['web', 'selfhosted'], link: '#' },
    { name: 'tiles',      desc: "a tiling window manager for people who don't want to configure one.",         year: 2025, tags: ['desktop', 'rust'],    link: '#' },
    { name: 'nachtlicht', desc: 'a tiny status page that turns red when things break.',                        year: 2024, tags: ['web', 'ops'],         link: '#' },
    { name: 'kettle',     desc: 'a build tool that only does the three things i use.',                         year: 2024, tags: ['cli', 'tooling'],     link: '#' },
  ];

  /* the first tag decides the map symbol. unknown tags become a waypoint. */
  const TAG_SYMBOL = { cli: 'huette', web: 'turm', desktop: 'gipfel', skills: 'lichtung' };
  const SYMBOLS = {
    huette:   { de: 'hütte',     svg: '<rect x="4.5" y="4.5" width="7" height="7" fill="currentColor"/>' },
    turm:     { de: 'turm',      svg: '<circle cx="8" cy="11" r="3" fill="none" stroke="currentColor" stroke-width="1.3"/><path d="M8 8V2.2h4.2L8 4.6" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/>' },
    gipfel:   { de: 'gipfel',    svg: '<path d="M8 2.6l5.6 10.8H2.4z" fill="currentColor"/>' },
    lichtung: { de: 'lichtung',  svg: '<circle cx="8" cy="8" r="5.2" fill="none" stroke="currentColor" stroke-width="1.3" stroke-dasharray="2.4 2.1"/>' },
    wegpunkt: { de: 'wegpunkt',  svg: '<circle cx="8" cy="8" r="4.2" fill="none" stroke="currentColor" stroke-width="1.3"/>' },
    aussicht: { de: 'aussichtspunkt', svg: '<path d="M2.6 12.2a5.4 5.4 0 0 1 10.8 0z" fill="currentColor"/><path d="M8 5.6V2M4.4 6.6L2.2 3.8M11.6 6.6l2.2-2.8" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/>' },
    home:     { de: 'home',      svg: '<circle cx="8" cy="8" r="3.6" fill="#B4301F"/><circle cx="8" cy="8" r="5.6" fill="none" stroke="#B4301F" stroke-width="1"/>' },
  };
  const symbolOf = p => TAG_SYMBOL[p.tags[0]] || 'wegpunkt';
  const symSvg = key => `<svg class="sym" viewBox="0 0 16 16" aria-hidden="true">${SYMBOLS[key].svg}</svg>`;

  /* ---------- helpers ---------- */
  const $ = (s, el = document) => el.querySelector(s);
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const ss = (a, b, t) => { t = clamp((t - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
  const r1 = v => Math.round(v * 10) / 10;
  const params = new URLSearchParams(location.search);
  const DEBUG = params.has('debug');
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const cssScroll = CSS.supports('animation-timeline: scroll()');

  function hashStr(s) {
    let h = 2166136261;
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
    h ^= h >>> 15; h = Math.imul(h, 2246822519); h ^= h >>> 13;
    return (h >>> 0) / 4294967296;
  }

  /* value noise on an integer lattice, smooth interpolation */
  function makeNoise(seed) {
    const lat = (ix, iy) => {
      let h = Math.imul(ix, 374761393) ^ Math.imul(iy, 668265263) ^ seed;
      h = Math.imul(h ^ (h >>> 13), 1274126177);
      h ^= h >>> 16;
      return (h >>> 0) / 4294967296;
    };
    return (x, y) => {
      const ix = Math.floor(x), iy = Math.floor(y);
      const fx = x - ix, fy = y - iy;
      const u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy);
      const a = lat(ix, iy), b = lat(ix + 1, iy), c = lat(ix, iy + 1), d = lat(ix + 1, iy + 1);
      return (a + (b - a) * u) * (1 - v) + (c + (d - c) * u) * v;
    };
  }

  /* ---------- the terrain: rhine plain west, fault edge, ridges east, the kinzig cutting through ---------- */
  function makeTerrain(L) {
    const { W, H, hx, hy } = L;
    const n = makeNoise(0x5eed);
    const lamx = Math.max(0.62 * W, 520), lamy = Math.max(0.26 * W, 240), lamp = Math.max(0.45 * W, 420);
    const fbm = (x, y, oct, lam) => {
      let s = 0, a = 0.5, f = 1, norm = 0;
      for (let i = 0; i < oct; i++) { s += a * n(x * f / lam + i * 7.3, y * f / lam + i * 3.1); norm += a; a *= 0.5; f *= 2; }
      return s / norm;
    };
    /* creases: sharp maxima become valley floors, so the ridges between them stay rounded. stretched east-west. */
    const crease = (x, y) => {
      let s = 0, a = 0.62, f = 1, norm = 0;
      for (let i = 0; i < 3; i++) {
        s += a * (1 - Math.abs(2 * n(x * f / lamx + 11.7 + i * 5.1, y * f / lamy + 19.3 + i * 2.7) - 1));
        norm += a; a *= 0.42; f *= 2;
      }
      return s / norm;
    };
    /* the river: east to west, past the south side of home, meandering once it reaches the plain */
    const riverY = x => {
      const u = x / W;
      let y = hy + 0.22 * H + 0.045 * H * Math.sin(u * Math.PI * 2.1 + 0.6);
      y += 0.05 * H * (n(x / 130 + 3.3, 7.1) - 0.5) * (1 - ss(0.28, 0.46, u));
      return y;
    };
    const riverW = x => { const u = x / W; return 0.05 * H + 0.11 * H * (1 - ss(0.3, 0.95, u)); };
    const elev = (x, y) => {
      const u = x / W;
      let e = 148 + 14 * ss(0.05, 0.42, u) + 8 * fbm(x + 400, y, 2, lamp);
      const edge = ss(0.39, 0.71, u);
      const far = ss(0.68, 1.06, u);
      if (edge > 0 || far > 0) {
        const relief = (440 * edge + 280 * far) * (0.32 + 0.68 * (1 - crease(x, y))) + 36 * edge * fbm(x + 900, y + 300, 2, lamy * 0.5);
        const dy = (y - riverY(x)) / riverW(x);
        e += relief * (1 - 0.86 * Math.exp(-dy * dy));
      }
      return e;
    };
    return { elev, riverY };
  }

  /* ---------- marching squares with closed rings (grid padded below every level) ---------- */
  const CASES = [null, [[2, 3]], [[1, 2]], [[1, 3]], [[0, 1]], null, [[0, 2]], [[0, 3]],
    [[3, 0]], [[2, 0]], null, [[1, 0]], [[3, 1]], [[2, 1]], [[3, 2]], null];

  function traceContours(elev, W, SH, cs, levels) {
    const nx = Math.ceil(W / cs) + 1, ny = Math.ceil(SH / cs) + 1;
    const NX = nx + 2, NY = ny + 2;
    const F = new Float32Array(NX * NY).fill(-1000);
    for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) F[(j + 1) * NX + i + 1] = elev(i * cs, j * cs);

    const nL = levels.length, l0 = levels[0], dl = levels[1] - levels[0];
    const buckets = levels.map(() => ({ from: [], to: [], px: [], py: [] }));
    const hKey = (I, J) => ((J * NX) + I) * 2, vKey = (I, J) => ((J * NX) + I) * 2 + 1;

    for (let J = 0; J < NY - 1; J++) {
      const Y0 = (J - 1) * cs;
      for (let I = 0; I < NX - 1; I++) {
        const tl = F[J * NX + I], tr = F[J * NX + I + 1], bl = F[(J + 1) * NX + I], br = F[(J + 1) * NX + I + 1];
        const mn = Math.min(tl, tr, bl, br), mx = Math.max(tl, tr, bl, br);
        if (mx <= l0) continue;
        const k0 = Math.max(0, Math.ceil((mn - l0) / dl));
        const k1 = Math.min(nL - 1, Math.ceil((mx - l0) / dl) - 1);
        if (k1 < k0) continue;
        const X0 = (I - 1) * cs;
        for (let k = k0; k <= k1; k++) {
          const L = levels[k];
          const c = (tl > L ? 8 : 0) | (tr > L ? 4 : 0) | (br > L ? 2 : 0) | (bl > L ? 1 : 0);
          if (c === 0 || c === 15) continue;
          let segs = CASES[c];
          if (!segs) {
            const centre = (tl + tr + bl + br) / 4 > L;
            segs = c === 5 ? (centre ? [[0, 3], [2, 1]] : [[0, 1], [2, 3]])
                           : (centre ? [[1, 0], [3, 2]] : [[3, 0], [1, 2]]);
          }
          const b = buckets[k];
          for (let s = 0; s < segs.length; s++) {
            const e0 = segs[s][0], e1 = segs[s][1];
            let px, py, key0;
            if (e0 === 0)      { px = X0 + cs * (L - tl) / (tr - tl); py = Y0;      key0 = hKey(I, J); }
            else if (e0 === 1) { px = X0 + cs; py = Y0 + cs * (L - tr) / (br - tr); key0 = vKey(I + 1, J); }
            else if (e0 === 2) { px = X0 + cs * (L - bl) / (br - bl); py = Y0 + cs; key0 = hKey(I, J + 1); }
            else               { px = X0; py = Y0 + cs * (L - tl) / (bl - tl);      key0 = vKey(I, J); }
            const key1 = e1 === 0 ? hKey(I, J) : e1 === 1 ? vKey(I + 1, J) : e1 === 2 ? hKey(I, J + 1) : vKey(I, J);
            b.from.push(key0); b.to.push(key1); b.px.push(px); b.py.push(py);
          }
        }
      }
    }

    /* chain segments into rings: each edge key starts exactly one segment */
    const out = [];
    for (let k = 0; k < nL; k++) {
      const b = buckets[k], n = b.from.length;
      if (!n) { out.push([]); continue; }
      const map = new Map();
      for (let s = 0; s < n; s++) map.set(b.from[s], s);
      const seen = new Uint8Array(n);
      const rings = [];
      for (let s0 = 0; s0 < n; s0++) {
        if (seen[s0]) continue;
        const ring = [];
        let s = s0, guard = 0, lx = 1e9, ly = 1e9;
        while (!seen[s]) {
          seen[s] = 1;
          const x = b.px[s], y = b.py[s];
          if (Math.abs(x - lx) + Math.abs(y - ly) > 1.2) { ring.push(x, y); lx = x; ly = y; }
          const nxt = map.get(b.to[s]);
          if (nxt === undefined || ++guard > n) break;
          s = nxt;
        }
        if (ring.length >= 6) rings.push(ring);
      }
      out.push(rings);
    }
    return out;
  }

  /* ring (flat [x,y,...]) → smooth closed path through midpoints, starting nearest to (hx, hy).
     the curve is flattened here as well, so lengths and offsets match what the browser measures. */
  function ringToPath(r, hx, hy, keepFlat) {
    const n = r.length / 2;
    let best = 0, bd = Infinity, ymin = Infinity;
    for (let i = 0; i < n; i++) {
      const x = r[2 * i], y = r[2 * i + 1];
      const d = (x - hx) * (x - hx) + (y - hy) * (y - hy);
      if (d < bd) { bd = d; best = i; }
      if (y < ymin) ymin = y;
    }
    const P = (i) => { const k = ((i + best) % n + n) % n; return [r[2 * k], r[2 * k + 1]]; };
    const a = P(0), b = P(1);
    let sx = (a[0] + b[0]) / 2, sy = (a[1] + b[1]) / 2;
    let d = 'M' + r1(sx) + ' ' + r1(sy);
    const flat = keepFlat ? [sx, sy] : null, cum = keepFlat ? [0] : null;
    let len = 0, px = sx, py = sy;
    const SUB = 5;
    for (let i = 1; i <= n; i++) {
      const c = P(i), nx = P(i + 1);
      const ex = (c[0] + nx[0]) / 2, ey = (c[1] + nx[1]) / 2;
      d += 'Q' + r1(c[0]) + ' ' + r1(c[1]) + ' ' + r1(ex) + ' ' + r1(ey);
      for (let k = 1; k <= SUB; k++) {
        const t = k / SUB, mt = 1 - t;
        const qx = mt * mt * sx + 2 * mt * t * c[0] + t * t * ex;
        const qy = mt * mt * sy + 2 * mt * t * c[1] + t * t * ey;
        len += Math.hypot(qx - px, qy - py); px = qx; py = qy;
        if (keepFlat) { flat.push(qx, qy); cum.push(len); }
      }
      sx = ex; sy = ey;
    }
    return { d: d + 'Z', len, dist: Math.sqrt(bd), ymin, flat, cum };
  }

  /* point and local direction on a flattened curve at arc length s */
  function flatAt(flat, cum, s) {
    let lo = 0, hi = cum.length - 1;
    while (lo < hi - 1) { const mid = (lo + hi) >> 1; if (cum[mid] <= s) lo = mid; else hi = mid; }
    const seg = cum[hi] - cum[lo] || 1, t = (s - cum[lo]) / seg;
    return {
      x: flat[2 * lo] + (flat[2 * hi] - flat[2 * lo]) * t,
      y: flat[2 * lo + 1] + (flat[2 * hi + 1] - flat[2 * lo + 1]) * t,
      dx: flat[2 * hi] - flat[2 * lo], dy: flat[2 * hi + 1] - flat[2 * lo + 1],
    };
  }

  function splinePath(pts) {
    let d = 'M' + r1(pts[0][0]) + ' ' + r1(pts[0][1]);
    for (let i = 0; i < pts.length - 1; i++) {
      const p0 = pts[Math.max(0, i - 1)], p1 = pts[i], p2 = pts[i + 1], p3 = pts[Math.min(pts.length - 1, i + 2)];
      const c1 = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6];
      const c2 = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6];
      d += 'C' + r1(c1[0]) + ' ' + r1(c1[1]) + ' ' + r1(c2[0]) + ' ' + r1(c2[1]) + ' ' + r1(p2[0]) + ' ' + r1(p2[1]);
    }
    return d;
  }

  /* ---------- layout of the sheet ---------- */
  const sheet = $('.sheet'), hero = $('.hero'), homeSym = $('.home-sym');
  const placesSection = $('.places-section'), placesList = $('#places'), legend = $('#legend');
  const legendKeys = $('#legend-keys'), legendCards = $('#legend-cards'), legendIdle = $('.legend-idle');
  const aboutSection = $('.about'), exitsSection = $('.exits'), you = $('#you');
  const hProjects = $('#h-projects'), hAbout = $('#h-about'), hLinks = $('#h-links');
  const vp = $('.vp'), vpSym = $('.vp-sym'), vpH = $('.vp-h');

  function measure() {
    const W = document.documentElement.clientWidth;
    const H = clamp(window.innerHeight, 620, 1000);
    const narrow = W < 720;
    return { W, H, narrow, pxPerKm: W / 18 };
  }

  let state = null;

  function build(animate) {
    const t0 = performance.now();
    const L = measure();
    const { W, H, narrow } = L;

    /* hero block, then measure where the home symbol landed */
    const hx0 = narrow ? 0.085 * W : 0.27 * W;
    const hy0 = narrow ? 0.30 * H : 0.37 * H;
    hero.style.setProperty('--x', hx0 + 'px');
    hero.style.setProperty('--y', hy0 + 'px');
    const sr = homeSym.getBoundingClientRect();
    const hx = sr.left + sr.width / 2 + window.scrollX;
    const hy = sr.top + sr.height / 2 + window.scrollY;
    L.hx = hx; L.hy = hy;
    const heroBox = hero.getBoundingClientRect();
    const heroRect = { x0: heroBox.left - 30, y0: heroBox.top + window.scrollY - 40, x1: heroBox.right + 30, y1: heroBox.bottom + window.scrollY + 40 };

    const terrain = makeTerrain(L);

    /* project places: rings by year around home, bearings fan east and south into the hills */
    const years = [...new Set(PROJECTS.map(p => p.year))].sort((a, b) => b - a);
    const r0 = 0.56 * H, dr = 0.46 * H;
    const xmin = narrow ? 0.1 * W : 0.08 * W, xmax = narrow ? 0.9 * W : 0.93 * W;
    const places = [];
    years.forEach((yr, k) => {
      const members = PROJECTS.filter(p => p.year === yr);
      const r = r0 + k * dr;
      const smax = clamp((xmax - hx) / r, -1, 1), smin = clamp((xmin - hx) / r, -1, 1);
      let bmin = 180 - Math.asin(smax) * 180 / Math.PI;
      let bmax = 180 + Math.asin(-smin) * 180 / Math.PI;
      bmin = Math.max(bmin, narrow ? 112 : 92);
      bmax = Math.min(bmax, narrow ? 178 : 168);
      const slot = (bmax - bmin) / members.length;
      members.forEach((p, i) => {
        const b = bmin + slot * (i + 0.5) + (hashStr(p.name) - 0.5) * slot * 0.55;
        const rr = r * (1 + (hashStr(p.name + 'r') - 0.5) * 0.16);
        const x = hx + rr * Math.sin(b * Math.PI / 180);
        const y = hy - rr * Math.cos(b * Math.PI / 180);
        places.push({ p, x, y, bearing: b, r: rr, sym: symbolOf(p) });
      });
    });
    /* push overlapping labels apart (vertically), keep them off the hero and inside the sheet */
    const labelW = pl => 30 + pl.p.name.length * 8.2 + 30;
    const box = pl => {
      pl.flip = pl.x > (narrow ? 0.5 : 0.62) * W;
      const w = labelW(pl);
      return pl.flip ? { x0: pl.x - w, x1: pl.x + 10, y0: pl.y - 12, y1: pl.y + 12 }
                     : { x0: pl.x - 10, x1: pl.x + w, y0: pl.y - 12, y1: pl.y + 12 };
    };
    for (let it = 0; it < 14; it++) {
      let moved = false;
      for (const pl of places) {
        const b = box(pl);
        if (b.x1 > heroRect.x0 && b.x0 < heroRect.x1 && b.y1 > heroRect.y0 && b.y0 < heroRect.y1) { pl.y += 14; moved = true; }
        if (b.x0 < 8) { pl.x += 8 - b.x0; moved = true; }
        if (b.x1 > W - 8) { pl.x -= b.x1 - (W - 8); moved = true; }
      }
      for (let i = 0; i < places.length; i++) for (let j = i + 1; j < places.length; j++) {
        const a = box(places[i]), b = box(places[j]);
        const ox = Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0) + 10;
        const oy = Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0) + 10;
        if (ox > 0 && oy > 0) {
          const dir = places[i].y <= places[j].y ? 1 : -1;
          places[i].y -= dir * oy / 2; places[j].y += dir * oy / 2; moved = true;
        }
      }
      if (!moved) break;
    }
    places.forEach(pl => {
      pl.flip = pl.x > (narrow ? 0.5 : 0.62) * W;
      pl.h = Math.round(terrain.elev(pl.x, pl.y));
      pl.dist = Math.hypot(pl.x - hx, pl.y - hy);
      pl.ang = Math.atan2(pl.y - hy, pl.x - hx) * 180 / Math.PI;
      pl.bearingShown = Math.round(((Math.atan2(pl.x - hx, -(pl.y - hy)) * 180 / Math.PI) + 360) % 360);
    });

    /* the rest of the sheet. the places region starts below the first screen so the legend never covers the hero. */
    const regionTop = hy + 0.95 * H;
    const regionBottom = Math.max(...places.map(p => p.y)) + 0.28 * H;
    const vy = regionBottom + (narrow ? 0.34 : 0.42) * H, vx = narrow ? 0.74 * W : 0.70 * W;
    const aboutTop = vy - 0.3 * H, aboutH = 0.62 * H;
    const exitsTop = aboutTop + aboutH + (narrow ? 0.08 : 0.12) * H, exitsH = narrow ? 0.34 * H : 0.36 * H;
    const mapBottom = exitsTop + exitsH;
    const SH = Math.ceil(mapBottom);
    sheet.style.height = SH + 'px';

    /* the area name sits beside the route, never under it: left of it on desktop, right of it on phones */
    hProjects.style.setProperty('--x', (narrow ? 0.5 * W : hx - 0.02 * W) + 'px');
    hProjects.style.setProperty('--y', (narrow ? hy + 0.2 * H : hy + 0.58 * r0) - regionTop + 'px');
    placesSection.style.setProperty('--y', regionTop + 'px');
    placesSection.style.setProperty('--h', (regionBottom - regionTop) + 'px');

    aboutSection.style.setProperty('--y', aboutTop + 'px');
    aboutSection.style.setProperty('--h', aboutH + 'px');
    const tx = narrow ? 0.07 * W : 0.27 * W;
    const ty = narrow ? (vy - aboutTop) + 40 : (vy - aboutTop) - 36;
    hAbout.style.setProperty('--x', tx + 'px');
    hAbout.style.setProperty('--y', (narrow ? (vy - aboutTop) - 14 : ty - 58) + 'px');
    const aboutText = $('.about-text');
    aboutText.style.setProperty('--tx', tx + 'px');
    aboutText.style.setProperty('--ty', ty + 'px');
    aboutText.style.width = narrow ? (W - 2 * tx) + 'px' : Math.min(34 * 17, vx - tx - 70) + 'px';
    vp.style.setProperty('--vx', vx + 'px');
    vp.style.setProperty('--vy', (vy - aboutTop) + 'px');
    vp.classList.toggle('flip', narrow);
    vpSym.innerHTML = symSvg('aussicht');
    vpH.textContent = Math.round(terrain.elev(vx, vy));

    exitsSection.style.setProperty('--y', exitsTop + 'px');
    exitsSection.style.setProperty('--h', exitsH + 'px');
    hLinks.style.setProperty('--x', (narrow ? 0.07 * W : 0.2 * W - 30) + 'px');
    hLinks.style.setProperty('--y', (exitsH - (narrow ? 118 : 150)) + 'px');

    /* route: home → between the markers of each ring → the viewpoint → off the lower edge */
    /* leave home straight down, past the left edge of the name, then bend east under the bio line */
    const way = [[hx, hy], [hx - 4, hy + 0.17 * H]];
    years.forEach(yr => {
      const ms = places.filter(pl => pl.p.year === yr).sort((a, b) => a.x - b.x);
      const my = ms.reduce((t, pl) => t + pl.y, 0) / ms.length;
      let wx;
      if (ms.length >= 2) { const i = Math.floor(ms.length / 2); wx = (ms[i - 1].x + ms[i].x) / 2; }
      else wx = ms[0].x + (ms[0].flip ? -1 : 1) * 0.11 * W;
      way.push([clamp(wx, 0.1 * W, 0.9 * W), my]);
    });
    way.push([clamp(hx + (narrow ? 0.3 : 0.24) * W, 0.15 * W, 0.6 * W), regionBottom + 0.1 * H]);
    way.push([vx, vy]);
    way.push([vx - (narrow ? 0.2 : 0.14) * W, vy + 0.3 * H]);
    way.push([0.5 * W, exitsTop + 0.2 * H]);
    way.push([0.5 * W, mapBottom + 12]);
    const routeD = splinePath(way);

    /* contours */
    const cs = narrow ? 6 : clamp(W / 160, 7, 10);
    const interval = narrow ? 40 : 20;
    const levels = [];
    for (let l = 160; l <= 1100; l += interval) levels.push(l);
    const rings = traceContours(terrain.elev, W, SH, cs, levels);
    const t1 = performance.now();

    const forestLevel = levels.find(l => l >= 260);
    const near = v => v < H + 160;
    const Dmax = Math.hypot(W, H) * 1.05;
    let contourHtml = '', forestD = '';
    let nPaths = 0, nPts = 0;
    const indexRings = [];
    rings.forEach((lv, k) => {
      const level = levels[k];
      const index = level % (interval * 5) === 0;
      lv.forEach(r => {
        const ring = ringToPath(r, hx, hy, index);
        if (ring.len < 6) return;
        nPaths++; nPts += r.length / 2;
        if (level === forestLevel) forestD += ring.d;
        const cls = 'c' + (index ? ' ci' : '') + (near(ring.ymin) && animate ? ' near' : '');
        const style = near(ring.ymin) && animate ? ` style="--len:${Math.ceil(ring.len)}px;--delay:${Math.round(ring.dist / Dmax * 320)}ms"` : '';
        contourHtml += `<path class="${cls}" id="c${nPaths}" data-h="${level}" d="${ring.d}"${style}/>`;
        if (index) indexRings.push({ id: 'c' + nPaths, level, ring });
      });
    });

    /* river: a smooth line along the valley floor, its name where it runs flattest in the hills */
    const rp = [];
    for (let x = -24; x <= W + 24; x += narrow ? 6 : 9) rp.push([x, terrain.riverY(x)]);
    let riverD = 'M' + r1(rp[0][0]) + ' ' + r1(rp[0][1]);
    const rflat = [rp[0][0], rp[0][1]], rcum = [0];
    let riverLen = 0, rpx = rp[0][0], rpy = rp[0][1], rsx = rp[0][0], rsy = rp[0][1];
    for (let i = 1; i < rp.length - 1; i++) {
      const c = rp[i], ex = (rp[i][0] + rp[i + 1][0]) / 2, ey = (rp[i][1] + rp[i + 1][1]) / 2;
      riverD += 'Q' + r1(c[0]) + ' ' + r1(c[1]) + ' ' + r1(ex) + ' ' + r1(ey);
      for (let k = 1; k <= 4; k++) {
        const t = k / 4, mt = 1 - t;
        const qx = mt * mt * rsx + 2 * mt * t * c[0] + t * t * ex, qy = mt * mt * rsy + 2 * mt * t * c[1] + t * t * ey;
        riverLen += Math.hypot(qx - rpx, qy - rpy); rpx = qx; rpy = qy; rflat.push(qx, qy); rcum.push(riverLen);
      }
      rsx = ex; rsy = ey;
    }
    let riverLabelAt = 0.78 * riverLen, flattest = Infinity;
    for (let f = narrow ? 0.58 : 0.62; f <= 0.9; f += 0.02) {
      const a = flatAt(rflat, rcum, f * riverLen - 30), b = flatAt(rflat, rcum, f * riverLen + 30);
      const slope = Math.abs(b.y - a.y) / Math.max(1, b.x - a.x);
      const m = flatAt(rflat, rcum, f * riverLen);
      if (places.some(pl => Math.hypot(pl.x - m.x, pl.y - m.y) < 150)) continue;
      if (slope < flattest) { flattest = slope; riverLabelAt = f * riverLen; }
    }

    const svg = `<svg class="map${animate ? ' is-drawing' : ''}" width="${W}" height="${SH}" viewBox="0 0 ${W} ${SH}" aria-hidden="true" focusable="false">
<path class="forest" d="${forestD}"/>
<g class="contours">${contourHtml}</g>
<g class="heights"></g>
<path class="river" id="river" d="${riverD}" style="--len:${Math.ceil(riverLen)}px"/>
<text class="rn halo" dy="-7"><textPath href="#river" startOffset="${riverLabelAt.toFixed(1)}">kinzig</textPath></text><text class="rn" dy="-7"><textPath href="#river" startOffset="${riverLabelAt.toFixed(1)}">kinzig</textPath></text>
<path class="route" id="route" d="${routeD}"/>
</svg>`;

    const old = $('.map', sheet);
    if (old) old.remove();
    sheet.insertAdjacentHTML('afterbegin', svg);
    const map = $('.map', sheet);
    const t2 = performance.now();

    placeHeights(map, indexRings, L, SH, heroRect);
    const t3 = performance.now();

    /* route length, position marker */
    const route = $('#route', map);
    const routeLen = route.getTotalLength();
    route.style.setProperty('--len', Math.ceil(routeLen) + 'px');
    you.style.offsetPath = `path("${routeD}")`;

    renderPlaces(places, L, regionTop);

    /* scale bar: a round number of km that is 60–170 px wide */
    const km = [1, 2, 5, 10].find(k => k * L.pxPerKm >= 60) || 10;
    $('#scalebar').style.setProperty('--w', km * L.pxPerKm + 'px');
    $('#scalebar-label').textContent = km + ' km';

    state = { L, routeLen, route, map };
    sheet.classList.toggle('scroll-css', cssScroll && !reduced);
    sheet.classList.toggle('no-wait', !animate);
    sheet.classList.add('is-ready');
    if (animate && params.has('t')) {
      /* dev: freeze the load moment at t seconds (?t=0.4) */
      const at = parseFloat(params.get('t')) * 1000;
      const timed = a => !(window.ScrollTimeline && a.timeline instanceof ScrollTimeline);
      requestAnimationFrame(() => {
        const all = [map, hero, placesSection, aboutSection, exitsSection].flatMap(el => el.getAnimations({ subtree: el === map }));
        all.filter(timed).forEach(a => { a.pause(); a.currentTime = at; });
      });
    } else if (animate) setTimeout(() => map.classList.remove('is-drawing'), 1050);
    if (DEBUG) console.log(`sheet ${W}×${SH}, cells ${cs}px, ${nPaths} rings, ${nPts} points. field+trace ${(t1 - t0).toFixed(0)} ms, svg insert ${(t2 - t1).toFixed(0)} ms, heights ${(t3 - t2).toFixed(0)} ms, total ${(performance.now() - t0).toFixed(0)} ms`);
  }

  /* heights on index contours, where the line reads left to right, runs straight, and nothing else is there */
  function placeHeights(map, indexRings, L, SH, heroRect) {
    const { W } = L;
    const group = $('.heights', map);
    const placed = [];
    let html = '';
    for (const { id, level, ring } of indexRings) {
      const { len, flat, cum } = ring;
      if (len < 240) continue;
      const want = clamp(Math.round(len / 1500), 1, 4);
      let got = 0;
      for (const f of [0.5, 0.2, 0.8, 0.35, 0.65, 0.08, 0.92, 0.27, 0.73]) {
        if (got >= want) break;
        const o = f * len;
        if (o < 24 || o > len - 24) continue;
        let ok = true, prev = null;
        for (let s = o - 16; s <= o + 16; s += 4) {
          const q = flatAt(flat, cum, s);
          const ang = Math.atan2(q.dy, q.dx) * 180 / Math.PI;
          if (Math.abs(ang) > 62 || (prev !== null && Math.abs(ang - prev) > 34)) { ok = false; break; }
          prev = ang;
        }
        if (!ok) continue;
        const a = flatAt(flat, cum, o);
        if (a.x < 30 || a.x > W - 30 || a.y < 70 || a.y > SH - 30) continue;
        if (a.x > heroRect.x0 && a.x < heroRect.x1 && a.y > heroRect.y0 && a.y < heroRect.y1) continue;
        if (placed.some(q => Math.hypot(q[0] - a.x, q[1] - a.y) < 150)) continue;
        placed.push([a.x, a.y]); got++;
        html += `<text class="ch halo"><textPath href="#${id}" startOffset="${o.toFixed(1)}">${level}</textPath></text><text class="ch"><textPath href="#${id}" startOffset="${o.toFixed(1)}">${level}</textPath></text>`;
      }
    }
    group.innerHTML = html;
  }

  /* ---------- places, legend, cards ---------- */
  let openId = null, hoverId = null, hideTimer = 0;

  function fmtKm(px, L) { const km = px / L.pxPerKm; return (km < 10 ? km.toFixed(1) : Math.round(km)) + ' km'; }

  function renderPlaces(places, L, regionTop) {
    const { hx, hy } = L;
    placesList.innerHTML = places.map(pl => {
      const id = pl.p.name.replace(/[^a-z0-9]+/gi, '-');
      const style = `--mx:${r1(pl.x)}px;--my:${r1(pl.y - regionTop)}px;--hx:${r1(hx)}px;--hy:${r1(hy - regionTop)}px;--len:${r1(pl.dist)}px;--ang:${r1(pl.ang)}deg`;
      return `<li class="place${pl.flip ? ' flip' : ''}" data-id="${id}" style="${style}">
  <button type="button" class="marker" aria-expanded="false" aria-controls="card-${id}" aria-describedby="desc-${id}">${symSvg(pl.sym)}<span class="txt"><span class="nm">${pl.p.name}</span> <span class="ht" aria-hidden="true">${pl.h}</span></span></button>
  <span class="bearing" aria-hidden="true"></span>
  <p class="sr-only" id="desc-${id}">${SYMBOLS[pl.sym].de}, ${pl.h} m, ${fmtKm(pl.dist, L)} from home. ${pl.p.desc} ${pl.p.year}, ${pl.p.tags.join(', ')}.</p>
</li>`;
    }).join('');

    legendCards.innerHTML = places.map(pl => {
      const id = pl.p.name.replace(/[^a-z0-9]+/gi, '-');
      const link = pl.p.link && pl.p.link !== '#'
        ? `<a class="card-link" href="${pl.p.link}">${/github\.com/.test(pl.p.link) ? 'github' : 'open'}</a>`
        : `<span class="card-nolink">no link yet</span>`;
      return `<div class="card" id="card-${id}" data-id="${id}" hidden>
  <h3>${pl.p.name}</h3>
  <p class="card-pos">${SYMBOLS[pl.sym].de}, ${pl.h} m. ${fmtKm(pl.dist, L)} from home, bearing ${pl.bearingShown}°.</p>
  <p class="card-desc">${pl.p.desc}</p>
  <p class="card-meta"><span>${pl.p.year}</span><span>${pl.p.tags.join(', ')}</span>${link}</p>
</div>`;
    }).join('');

    /* legend keys: only the symbols that are on this sheet */
    const used = new Map();
    places.forEach(pl => {
      const tags = used.get(pl.sym) || new Set();
      tags.add(pl.p.tags[0]); used.set(pl.sym, tags);
    });
    let keys = '';
    for (const [sym, tags] of used) keys += `<dt>${symSvg(sym)}${SYMBOLS[sym].de}</dt><dd>${[...tags].join(', ')}</dd>`;
    keys += `<dt>${symSvg('home')}home</dt><dd>daymi</dd>`;
    legendKeys.innerHTML = keys;
    if (legendIdle && 'open' in legendIdle) legendIdle.open = !L.narrow;

    setActive(null);
  }

  function setActive(id) {
    const shown = id || openId;
    if (shown) legend.dataset.active = shown; else delete legend.dataset.active;
    legendCards.querySelectorAll('.card').forEach(c => { c.hidden = c.dataset.id !== shown; });
    placesList.querySelectorAll('.place').forEach(li => {
      li.classList.toggle('is-active', li.dataset.id === shown);
      $('.marker', li).setAttribute('aria-expanded', li.dataset.id === openId ? 'true' : 'false');
    });
  }

  placesList.addEventListener('mouseover', e => {
    const li = e.target.closest('.place'); if (!li) return;
    clearTimeout(hideTimer); hoverId = li.dataset.id; setActive(hoverId);
  });
  placesList.addEventListener('mouseout', e => {
    const li = e.target.closest('.place'); if (!li) return;
    if (li.contains(e.relatedTarget)) return;
    hoverId = null;
    hideTimer = setTimeout(() => { if (!legend.matches(':hover')) setActive(null); }, 240);
  });
  legend.addEventListener('mouseleave', () => { if (!openId && !hoverId) setActive(null); });
  placesList.addEventListener('focusin', e => {
    const li = e.target.closest('.place'); if (li) setActive(li.dataset.id);
  });
  placesList.addEventListener('focusout', e => {
    if (e.relatedTarget && (legend.contains(e.relatedTarget) || placesList.contains(e.relatedTarget))) return;
    setActive(null);
  });
  placesList.addEventListener('click', e => {
    const li = e.target.closest('.place'); if (!li) return;
    openId = openId === li.dataset.id ? null : li.dataset.id;
    setActive(li.dataset.id);
  });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && (openId || legend.dataset.active)) { openId = null; setActive(null); }
  });
  document.addEventListener('click', e => {
    if (!openId) return;
    if (e.target.closest('.place') || e.target.closest('.legend')) return;
    openId = null; setActive(null);
  });

  /* ---------- email copy ---------- */
  const copyBtn = $('#copy');
  copyBtn.addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(copyBtn.dataset.mail); } catch (err) { /* clipboard blocked: the address is right there */ }
    copyBtn.textContent = 'copied';
    copyBtn.classList.add('is-done');
    setTimeout(() => { copyBtn.textContent = 'copy'; copyBtn.classList.remove('is-done'); }, 1600);
  });

  /* ---------- scroll fallback for browsers without scroll-driven animations ---------- */
  let ticking = false;
  function onScrollFallback() {
    if (ticking || !state) return;
    ticking = true;
    requestAnimationFrame(() => {
      ticking = false;
      const max = document.documentElement.scrollHeight - window.innerHeight;
      const p = max > 0 ? clamp(window.scrollY / max, 0, 1) : 0;
      state.route.style.strokeDashoffset = (state.routeLen * (1 - p)) + 'px';
      you.style.offsetDistance = (p * 100) + '%';
    });
  }
  if (!cssScroll && !reduced) addEventListener('scroll', onScrollFallback, { passive: true });
  if (reduced) you.hidden = true;

  /* ---------- boot ---------- */
  let lastW = 0, lastH = 0, resizeTimer = 0;
  function boot() {
    lastW = innerWidth; lastH = innerHeight;
    build(!reduced);
    if (!cssScroll) onScrollFallback();
    if (params.has('scroll')) {
      const f = clamp(parseFloat(params.get('scroll')) || 0, 0, 1);
      requestAnimationFrame(() => {
        window.scrollTo(0, f * (document.documentElement.scrollHeight - window.innerHeight));
        if (!cssScroll) onScrollFallback();
      });
    }
  }
  addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      if (Math.abs(innerWidth - lastW) > 40 || Math.abs(innerHeight - lastH) > 180) {
        lastW = innerWidth; lastH = innerHeight;
        openId = null;
        build(false);
        if (!cssScroll) onScrollFallback();
      }
    }, 180);
  });

  const fontsReady = document.fonts && document.fonts.ready ? document.fonts.ready : Promise.resolve();
  Promise.race([fontsReady, new Promise(res => setTimeout(res, 1800))]).then(boot);
})();
