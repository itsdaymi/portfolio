/* d-nebel — the walk.
   1. projects (data-driven) become stations at successive depths.
   2. fir layers and fog sheets are generated (no image files).
   3. --walk is animated by the browser's scroll timeline where supported, by this script elsewhere.
   4. keyboard focus walks you to the station; nav links walk you there smoothly. */
(() => {
  'use strict';

  // ---------- data ----------
  const projects = [
    { name: 'daystack',   desc: 'my agent skills. editable copies, installed via skills.sh.',                      year: 2026, tags: ['skills', 'cli'],      link: 'https://github.com/itsdaymi/daystack' },
    { name: 'ledger',     desc: 'a small double-entry bookkeeping cli. plain text in, balance sheet out.',          year: 2026, tags: ['cli', 'finance'],     link: '#' },
    { name: 'pinboard',   desc: 'a self-hosted bookmark thing with full-text search. because every other one died.', year: 2025, tags: ['web', 'selfhosted'],  link: '#' },
    { name: 'tiles',      desc: "a tiling window manager for people who don't want to configure one.",             year: 2025, tags: ['desktop', 'rust'],    link: '#' },
    { name: 'nachtlicht', desc: 'a tiny status page that turns red when things break.',                             year: 2024, tags: ['web', 'ops'],         link: '#' },
    { name: 'kettle',     desc: 'a build tool that only does the three things i use.',                              year: 2024, tags: ['cli', 'tooling'],     link: '#' },
  ];

  const root = document.documentElement;
  const body = document.body;
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const native = CSS.supports('animation-timeline: scroll()');

  // ---------- stations ----------
  const FIRST = 1.6;                 // depth of the first project, in screens
  const CLEAR_GAP = 1.7;             // from the last project to the clearing
  const gap = Math.min(1, Math.max(0.7, 8 / projects.length));
  const dys = [0, 6, -5, 3, -2, 7];  // small vertical wander so the eye moves like it does between trees

  const list = document.getElementById('project-list');
  const frag = document.createDocumentFragment();
  projects.forEach((p, i) => {
    const li = document.createElement('li');
    li.className = 'station proj ' + (i % 2 ? 'r' : 'l');
    li.style.setProperty('--at', (FIRST + i * gap).toFixed(3));
    li.style.setProperty('--dy', dys[i % dys.length]);
    li.style.zIndex = 50 - i;

    const h3 = document.createElement('h3');
    if (p.link && p.link !== '#') {
      const a = document.createElement('a');
      a.href = p.link;
      a.textContent = p.name;
      h3.append(a);
    } else {
      h3.textContent = p.name;
    }
    const desc = document.createElement('p');
    desc.className = 'desc';
    desc.textContent = p.desc;
    const meta = document.createElement('p');
    meta.className = 'meta';
    const year = document.createElement('span');
    year.textContent = p.year;
    const tags = document.createElement('span');
    tags.textContent = p.tags.join(', ');
    meta.append(year, tags);
    li.append(h3, desc, meta);
    frag.append(li);
  });
  list.append(frag);

  const last = FIRST + (projects.length - 1) * gap;
  const clearing = last + CLEAR_GAP;
  body.style.setProperty('--total', clearing.toFixed(3));
  for (const el of document.querySelectorAll('.about, .links, .foot')) {
    el.style.setProperty('--at', clearing.toFixed(3));
  }

  const stations = [...document.querySelectorAll('.station')];
  const depthOf = el => parseFloat(el.style.getPropertyValue('--at')) || 0;
  const targets = { projects: FIRST, about: clearing, links: clearing };

  // ---------- the valley ----------
  const scene = document.getElementById('scene');
  const FIRS = 5, FOGS = 3;
  for (let k = 0; k < FIRS; k++) {
    const layer = document.createElement('div');
    layer.className = 'layer firs';
    layer.style.setProperty('--k', k);
    layer.innerHTML = firSVG(1013 + k * 97, k);
    scene.append(layer);
  }
  for (let k = 0; k < FOGS; k++) {
    const layer = document.createElement('div');
    layer.className = 'layer fog';
    layer.style.setProperty('--k', k);
    const c = document.createElement('canvas');
    c.width = 384; c.height = 160;
    layer.append(c);
    scene.append(layer);
    paintFog(c, 7 + k * 13);
  }

  // small deterministic PRNG so every visit grows the same forest
  function mulberry32(a) {
    return () => {
      a |= 0; a = a + 0x6D2B79F5 | 0;
      let t = Math.imul(a ^ a >>> 15, 1 | a);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }

  // one fir layer: a stand of spruce (pointed) with the odd old silver fir (flat crown),
  // on both sides of a path gap, bases on the layer's bottom edge
  function firSVG(seed, k) {
    // the layer is four viewports wide (see .scene .firs), so a far, shrunken layer still reaches the edges
    const rnd = mulberry32(seed);
    const W = 6400, H = 900, MID = W / 2, GAP = 80 + k * 6;
    const d = [];
    for (const side of [-1, 1]) {
      let x = GAP + 10 + rnd() * 50;
      while (x < MID - 40) {
        const h = 220 + rnd() * 460;
        const w = h * (0.09 + rnd() * 0.06);
        const tiers = 9 + Math.floor(rnd() * 7);
        const flat = rnd() < 0.08;
        d.push(tree(MID + side * x, H + 10 + rnd() * 30, h, w, tiers, flat, rnd));
        x += w * 1.2 + rnd() * w * 2.2;
      }
    }
    return '<svg viewBox="0 0 ' + W + ' ' + H + '" preserveAspectRatio="xMidYMax slice" focusable="false"><path d="' + d.join(' ') + '"/></svg>';
  }

  // a narrow cone with a sawtooth edge: each tier starts close to the trunk and droops outward
  function tree(cx, base, h, w, tiers, flat, rnd) {
    const top = base - h;
    const tipW = flat ? w * 0.26 : w * 0.05;
    const right = [], left = [];
    const step = h / tiers;
    for (let i = 1; i <= tiers; i++) {
      const t = i / tiers;
      const y = top + h * t;
      const ww = tipW + (w - tipW) * Math.pow(t, 1.1);
      const inner = flat ? 0.72 : 0.66;
      const droop = step * (flat ? 0.12 : 0.28 + rnd() * 0.2);
      const jx = () => (rnd() - 0.5) * ww * 0.14;
      right.push([cx + ww * inner + jx(), y - step * 0.6]);
      right.push([cx + ww + jx(), y - step * 0.25 + droop]);
      left.push([cx - ww * inner + jx(), y - step * 0.6]);
      left.push([cx - ww + jx(), y - step * 0.25 + droop]);
    }
    const pts = [[cx - tipW * 0.5, top], [cx + tipW * 0.5, top], ...right, [cx + w * 0.07, base + 6], [cx - w * 0.07, base + 6], ...left.reverse()];
    return 'M' + pts.map(p => p[0].toFixed(0) + ' ' + p[1].toFixed(0)).join('L') + 'Z';
  }

  // fog: feTurbulence rendered exactly once into a small canvas, then only moved and faded
  function paintFog(c, seed) {
    const w = c.width, h = c.height;
    const ctx = c.getContext('2d');
    const svg =
      '<svg xmlns="http://www.w3.org/2000/svg" width="' + w + '" height="' + h + '">' +
      '<filter id="f" x="0" y="0" width="100%" height="100%" color-interpolation-filters="sRGB">' +
      '<feTurbulence type="fractalNoise" baseFrequency="0.0045 0.011" numOctaves="3" seed="' + seed + '" stitchTiles="stitch"/>' +
      '<feColorMatrix values="0 0 0 0 0.863  0 0 0 0 0.902  0 0 0 0 0.878  2.2 0 0 0 -0.85"/>' +
      '</filter><rect width="' + w + '" height="' + h + '" filter="url(#f)"/></svg>';
    const img = new Image();
    img.onload = () => {
      ctx.drawImage(img, 0, 0, w, h);
      feather(ctx, w, h);
    };
    img.onerror = () => {
      const rnd = mulberry32(seed);
      for (let i = 0; i < 28; i++) {
        const x = rnd() * w, y = rnd() * h, r = (0.1 + rnd() * 0.22) * w;
        const g = ctx.createRadialGradient(x, y, 0, x, y, r);
        g.addColorStop(0, 'rgba(220,230,224,.32)');
        g.addColorStop(1, 'rgba(220,230,224,0)');
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, w, h);
      }
      feather(ctx, w, h);
    };
    img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
  }
  // elliptical fade to the canvas edges, so a sheet never shows as a rectangle
  function feather(ctx, w, h) {
    ctx.globalCompositeOperation = 'destination-in';
    ctx.save();
    ctx.translate(w / 2, h / 2);
    ctx.scale(1, h / w);
    const g = ctx.createRadialGradient(0, 0, w * 0.08, 0, 0, w * 0.5);
    g.addColorStop(0, 'rgba(0,0,0,1)');
    g.addColorStop(0.55, 'rgba(0,0,0,.75)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(-w / 2, -w / 2, w, w);
    ctx.restore();
    ctx.globalCompositeOperation = 'source-over';
  }

  // ---------- scroll = distance ----------
  const maxScroll = () => Math.max(1, root.scrollHeight - innerHeight);
  const walkNow = () => Math.min(1, Math.max(0, scrollY / maxScroll()));
  const scrollToDepth = (at, smooth) => {
    scrollTo({ top: (at / clearing) * maxScroll(), behavior: smooth ? 'smooth' : 'auto' });
  };

  let ticking = false;
  function onScroll() {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(update);
  }
  function update() {
    ticking = false;
    if (reduced) return;
    const w = walkNow();
    if (!native) body.style.setProperty('--walk', w.toFixed(5));
    const cam = w * clearing;
    for (const el of stations) {
      const d = depthOf(el) - cam;
      el.classList.toggle('far', d > 1.1 || d < -0.5);
    }
  }
  if (!reduced) {
    addEventListener('scroll', onScroll, { passive: true });
    addEventListener('resize', onScroll);
    update();
  }

  // tabbing to something far away walks you to it
  if (!reduced) {
    document.addEventListener('focusin', e => {
      const st = e.target.closest('.station');
      if (!st) return;
      const at = depthOf(st);
      if (Math.abs(at - walkNow() * clearing) > 0.2) scrollToDepth(at, false);
    });
  }

  // nav: in motion mode the anchors are depths
  for (const a of document.querySelectorAll('[data-go]')) {
    a.addEventListener('click', e => {
      if (reduced) return;
      e.preventDefault();
      scrollToDepth(targets[a.dataset.go], true);
    });
  }

  // ---------- email copy ----------
  const btn = document.querySelector('.copy');
  if (btn) {
    let t;
    btn.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(btn.dataset.copy);
        btn.textContent = 'copied';
      } catch {
        btn.textContent = 'select it';
      }
      clearTimeout(t);
      t = setTimeout(() => { btn.textContent = 'copy'; }, 1800);
    });
  }

  // ---------- arrival ----------
  // the name resolves once the face is here (or after 1.2s, whichever comes first)
  const ready = () => root.classList.add('ready');
  if (document.fonts && document.fonts.ready) {
    Promise.race([document.fonts.ready, new Promise(r => setTimeout(r, 1200))]).then(ready, ready);
  } else {
    ready();
  }

  // deep links and the dev override (?scroll=0.4 puts you 40% along the path)
  const q = new URLSearchParams(location.search).get('scroll');
  const hash = location.hash.replace('#', '');
  if (!reduced && (q !== null || targets[hash] !== undefined)) {
    requestAnimationFrame(() => requestAnimationFrame(() => {
      if (q !== null) scrollTo(0, Math.min(1, Math.max(0, parseFloat(q) || 0)) * maxScroll());
      else scrollToDepth(targets[hash], false);
      update();
    }));
  }
})();
