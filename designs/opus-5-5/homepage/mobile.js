// the page is a hanging mobile.
//
// every piece of content is a weight on a string. arms are stiff wires that
// hang from a single point, and that point is always the centre of mass of
// whatever hangs below. so the layout is not styled into place: the pieces
// get an x position and a mass, and the wires fall out of the balance.
//
// the same tree is then handed to a small position-based physics solver, so
// the page can be pushed, pulled and blown around and still find level.
(() => {
  'use strict';

  const root = document.getElementById('mobile');
  if (!root) return;

  const html = document.documentElement;
  const svg = root.querySelector('.wires');
  const NS = 'http://www.w3.org/2000/svg';
  const wideMq = matchMedia('(min-width: 960px)');
  const calmMq = matchMedia('(prefers-reduced-motion: reduce)');

  const G = 2400; // gravity, px/s²
  const MU = 0.25; // mass of a bare wire end
  const AIR = 0.55; // air drag, 1/s
  const SUBSTEP = 1 / 600;
  const HOOK = 8; // gap between a piece and the hook under it
  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
  // a piece's mass, from its data-mass attribute
  const heavy = (el, fallback = 10) => +el.dataset.mass || fallback;

  // ---------- content ----------

  const list = document.getElementById('project-list');
  for (const p of window.PROJECTS || []) {
    const weight = clamp(+p.weight || 400, 200, 900);
    const li = document.createElement('li');
    li.className = 'project';
    li.dataset.mass = weight / 100;
    const h = document.createElement('h3');
    h.style.fontWeight = weight;
    const a = document.createElement('a');
    a.href = p.url;
    a.textContent = p.name;
    h.append(a);
    const blurb = document.createElement('p');
    blurb.textContent = p.blurb;
    const year = document.createElement('p');
    year.className = 'year';
    year.textContent = p.year;
    li.append(h, blurb, year);
    list.append(li);
  }

  const mark = root.querySelector('.mark');
  const nav = root.querySelector('.links');
  const linkEls = [...nav.querySelectorAll('li')];
  const projEls = [...list.children];
  const aboutEls = [...root.querySelectorAll('.about p')];
  const blaze = root.querySelector('.blaze');
  for (const a of root.querySelectorAll('a')) a.draggable = false;

  // ---------- the tree ----------
  // a leaf is { el, x, top, w, h, mass, child? }, an arm is { a, b, y }.

  const isArm = (n) => 'a' in n;
  const massOf = (n) =>
    (n.M ??= isArm(n) ? massOf(n.a) + massOf(n.b) + 2 * MU : n.mass + (n.child ? massOf(n.child) : 0));
  // where a node has to be held from for it to hang level
  const comOf = (n) =>
    (n.C ??= isArm(n)
      ? ((massOf(n.a) + MU) * comOf(n.a) + (massOf(n.b) + MU) * comOf(n.b)) / massOf(n)
      : n.x);

  const arm = (a, b, y = 0) => ({ a, b, y });

  // an arm is a shallow arc. its hanging point sits on the arc, above the
  // line between its ends, which is what makes it settle instead of flip.
  function shape(n) {
    if (n.span) return n;
    if (comOf(n.a) > comOf(n.b)) [n.a, n.b] = [n.b, n.a];
    n.xa = comOf(n.a);
    n.xb = comOf(n.b);
    n.span = Math.max(1, n.xb - n.xa);
    n.t = clamp((comOf(n) - n.xa) / n.span, 0.02, 0.98);
    n.sag = clamp(n.span * 0.075, 5, 44);
    n.rise = 4 * n.t * (1 - n.t) * n.sag;
    return n;
  }

  let rects = [];
  const place = (n) => {
    rects.push({ l: n.x - n.w / 2, r: n.x + n.w / 2, t: n.top, b: n.top + n.h });
    return n;
  };
  // lowest edge of anything already placed between two x positions
  const floorUnder = (l, r) => rects.reduce((y, q) => (q.r > l && q.l < r ? Math.max(y, q.b) : y), 0);
  const size = (el) => ({ w: el.offsetWidth, h: el.offsetHeight });
  const leaf = (el, x, top, mass) => place({ el, x, top, mass, ...size(el) });

  // a title never wraps. if a column is too narrow for one, the title shrinks.
  function fitTitles() {
    for (const li of projEls) {
      const h = li.firstElementChild;
      h.style.fontSize = '';
      const over = h.scrollWidth / h.clientWidth;
      if (over > 1) h.style.fontSize = (parseFloat(getComputedStyle(h).fontSize) / over) * 0.985 + 'px';
    }
  }

  // ---------- layout: wide ----------
  // the wordmark on one end of the top arm, the rest of the page on the other.

  function layWide(W) {
    const I = Math.min(W - 80, 1200);
    const x0 = (W - I) / 2;
    const mid = x0 + I / 2;
    const n = projEls.length;
    const nl = Math.ceil(n / 2);
    const k = Math.max(nl, n - nl, 1);
    const half = I / 2 - 34;
    const bw = k > 1 ? (half / (k - 1) - 12) / (0.5 + 1 / (k - 1)) : half;
    root.style.setProperty('--bw', Math.floor(Math.min(250, bw)) + 'px');
    fitTitles();
    root.style.setProperty('--aw', Math.floor(Math.min(390, I / 2 - 150)) + 'px');

    const y0 = 96;
    const mk = leaf(mark, x0 + mark.offsetWidth / 2, y0 + 138, heavy(mark, 36));

    // links, top right: a small cascade
    const a1y = y0 + 64;
    const lcy = a1y + 62;
    const drops = [74, 96, 52];
    const last = linkEls.length - 1;
    let edge = x0 + I;
    const lxs = [];
    for (let i = last; i >= 0; i--) {
      const w = linkEls[i].offsetWidth;
      lxs[i] = edge - w / 2;
      edge -= w + 40;
    }
    let lc = null;
    for (let i = last; i >= 0; i--) {
      const armY = lcy + Math.min(i, Math.max(last - 1, 0)) * 46;
      const lf = leaf(linkEls[i], lxs[i], armY + drops[i % 3], 1.6);
      lc = lc ? arm(lf, lc, lcy + i * 46) : lf;
    }

    // projects: two clusters either side of a clear channel down the middle
    const spread = (els, l, r) =>
      els.map((el, i) => {
        const w0 = els[0].offsetWidth / 2;
        const w1 = els[els.length - 1].offsetWidth / 2;
        return els.length === 1 ? (l + r) / 2 : l + w0 + ((r - w1 - l - w0) * i) / (els.length - 1);
      });
    const cluster = (els, xs, y) => {
      const end = els.length - 1;
      const lv = els.map((el, j) => {
        const armY = y + Math.min(j, Math.max(end - 1, 0)) * 70;
        const w = el.offsetWidth;
        const clear = floorUnder(xs[j] - w / 2 - 14, xs[j] + w / 2 + 14) + 26;
        return leaf(el, xs[j], Math.max(armY + [86, 64, 108][j % 3], clear), heavy(el));
      });
      let node = lv[end];
      for (let j = end - 1; j >= 0; j--) node = arm(lv[j], node, y + j * 70);
      return node;
    };

    const a2y = mk.top + mk.h + 150;
    const a2by = a2y + 64;
    const heroFloor = floorUnder(x0, x0 + I);
    const pl = projEls.slice(0, nl);
    const pr = projEls.slice(nl);
    const PL = pl.length ? cluster(pl, spread(pl, x0, mid - 34), a2y + 76) : null;
    const PR = pr.length ? cluster(pr, spread(pr, mid + 34, x0 + I), a2by + 76) : null;

    // about, and the red diamond that keeps the lot of it level: its mass is
    // whatever puts this last arm's hanging point in the middle channel.
    // paragraphs alternate between a column left of the channel and one right
    // of it; within a column each hangs from the one above.
    const a3y = Math.max(floorUnder(x0, x0 + I), heroFloor + 200) + 124;
    const bx = x0 + I - 44;
    const column = (els, x, top) => {
      const col = els.map((e) => {
        const lf = leaf(e, x, top, heavy(e));
        top += lf.h + HOOK + 22;
        return lf;
      });
      col.forEach((lf, i) => (lf.child = col[i + 1]));
      return col[0];
    };
    const widest = (els) => Math.max(0, ...els.map((e) => e.offsetWidth));
    const heft = (els) => els.reduce((m, e) => m + heavy(e), 0);
    const ls = aboutEls.filter((_, i) => i % 2 === 0);
    const rs = aboutEls.filter((_, i) => i % 2 === 1);
    let node;
    if (!ls.length) {
      node = leaf(blaze, mid, a3y, 1);
    } else {
      const wl = widest(ls);
      const wr = widest(rs);
      const ml = heft(ls);
      const mr = heft(rs);
      const lever = bx - mid;
      let xl = mid - 70 - wl / 2;
      let xr = Math.min(mid + 96, bx - 46 - wr) + wr / 2;
      // the diamond has to end up with a little mass of its own. if the
      // paragraphs alone tip the arm the wrong way, move them until they do not.
      const short = () => mr * (xr - mid) + 0.5 * lever - ml * (mid - xl);
      if (short() > 0) xl = Math.max(x0 + wl / 2, xl - short() / ml);
      if (short() > 0 && mr) xr = Math.max(mid + 40 + wr / 2, xr - short() / mr);
      const left = column(ls, xl, a3y + 92);
      const right = rs.length ? column(rs, xr, a3y + 74 + 58) : null;
      const bz = leaf(blaze, bx, a3y + (right ? 74 + 122 : 150), clamp((ml * (mid - xl) - mr * (xr - mid)) / lever, 0.4, 12));
      node = arm(left, right ? arm(right, bz, a3y + 74) : bz, a3y);
    }
    if (PR) node = arm(node, PR, a2by);
    if (PL) node = arm(PL, node, a2y);
    node = arm(node, lc, a1y);
    node = arm(mk, node, y0);
    return { node, height: floorUnder(x0, x0 + I) + 120 };
  }

  // ---------- layout: narrow ----------
  // the wordmark hangs straight from the ceiling and the rest hangs from it,
  // one piece per arm, alternating sides.

  function layNarrow(W) {
    const I = Math.min(W - 32, 520);
    const x0 = (W - I) / 2;
    const mid = x0 + I / 2;
    root.style.setProperty('--aw', Math.floor(Math.min(I - 64, 400)) + 'px');

    // x positions and masses first: they decide where every wire has to go
    const plan = (bw) => {
      root.style.setProperty('--bw', Math.floor(bw) + 'px');
      fitTitles();
      const seq = [nav, ...projEls].map((el, i) => {
        const s = size(el);
        return {
          el,
          ...s,
          x: i % 2 === 0 ? x0 + I - s.w / 2 : x0 + s.w / 2,
          top: 0,
          mass: el === nav ? 1.6 * linkEls.length : heavy(el),
        };
      });
      // the about paragraphs hang in one column, each from the one above
      const col = aboutEls.map((el) => ({ el, ...size(el), top: 0, mass: heavy(el) }));
      const cx = x0 + Math.max(0, ...col.map((c) => c.w)) / 2;
      col.forEach((c, i) => {
        c.x = cx;
        c.child = col[i + 1];
      });
      const bz = { el: blaze, ...size(blaze), top: 0, x: col.length ? x0 + I - 24 : mid };
      const heft = col.reduce((m, c) => m + c.mass, 0);
      bz.mass = col.length ? clamp((heft * (mid - cx)) / (bz.x - mid), 0.4, 12) : 1;
      const tail = col.length ? arm(col[0], bz) : null;
      const arms = [];
      let chain = tail || bz;
      for (let i = seq.length - 1; i >= 0; i--) {
        const rest = chain;
        chain = arm(seq[i], rest);
        arms.unshift({ a: chain, lf: seq[i], rest });
      }
      const spine = arms.map((o) => comOf(o.rest));
      const room = Math.min(Math.min(...spine) - x0, x0 + I - Math.max(...spine)) - 12;
      return { arms, chain, tail, col, bz, room };
    };
    const first = Math.min(I * 0.43, 230);
    let pl = plan(first);
    if (pl.room < first) pl = plan(Math.max(96, pl.room));
    const { arms, chain, tail, col, bz } = pl;

    const mk = place({ el: mark, ...size(mark), x: comOf(chain), top: 92, mass: heavy(mark, 36), child: chain });
    let prev = mk.top + mk.h + HOOK + 14;
    arms.forEach(({ a, lf, rest }, j) => {
      shape(a);
      const rx = comOf(rest);
      const l = Math.min(lf.x - lf.w / 2, rx) - 10;
      const r = Math.max(lf.x + lf.w / 2, rx) + 10;
      a.y = Math.max(prev + a.rise + 22, prev + 46, floorUnder(l, r) + 16 + a.sag, floorUnder(rx - 12, rx + 12) + 14);
      lf.top = a.y + 50 + (j % 3) * 16;
      place(lf);
      prev = a.y;
    });
    if (tail) {
      shape(tail);
      tail.y = Math.max(prev + tail.rise + 22, prev + 46, floorUnder(x0, x0 + I) + 28 + tail.sag);
      let top = tail.y + 64;
      for (const c of col) {
        c.top = top;
        top += c.h + HOOK + 22;
        place(c);
      }
      bz.top = tail.y + 40;
    } else {
      bz.top = Math.max(prev + 70, floorUnder(mid - 30, mid + 30) + 30);
    }
    place(bz);
    return { node: mk, height: floorUnder(x0, x0 + I) + 84 };
  }

  // ---------- from tree to particles ----------
  // a point is either a particle, or a spot rigidly attached to two particles:
  // a·Pi + b·Pj + k·perp(Pj − Pi). that covers the hanging point of an arm
  // and the hook under a piece that carries more pieces.

  const real = (i) => ({ i, j: i, a: 1, b: 0, k: 0 });
  const tmpA = { x: 0, y: 0 };
  const tmpB = { x: 0, y: 0 };

  function at(P, d, out) {
    if (d.i === d.j) {
      out.x = P.x[d.i];
      out.y = P.y[d.i];
      return out;
    }
    const dx = P.x[d.j] - P.x[d.i];
    const dy = P.y[d.j] - P.y[d.i];
    out.x = d.a * P.x[d.i] + d.b * P.x[d.j] + d.k * dy;
    out.y = d.a * P.y[d.i] + d.b * P.y[d.j] - d.k * dx;
    return out;
  }

  function assemble(node) {
    const P = { x: [], y: [], px: [], py: [], vx: [], vy: [], im: [], ax: [] };
    const add = (x, y, m) => {
      P.x.push(x);
      P.y.push(y);
      P.px.push(x);
      P.py.push(y);
      P.vx.push(0);
      P.vy.push(0);
      P.ax.push(0);
      P.im.push(m ? 1 / m : 0);
      return P.x.length - 1;
    };
    const cons = [];
    const arms = [];
    const strings = [];
    const leaves = [];

    const walk = (n, from, ay) => {
      if (isArm(n)) {
        shape(n);
        const iA = add(n.xa, n.y, MU);
        const iB = add(n.xb, n.y, MU);
        const piv = { i: iA, j: iB, a: 1 - n.t, b: n.t, k: n.rise / n.span };
        cons.push({ p: real(iA), q: real(iB), len: n.span });
        cons.push({ p: from, q: piv, len: n.y - n.rise - ay });
        strings.push({ p: from, q: piv });
        arms.push({ iA, iB, sag: n.sag });
        walk(n.a, real(iA), n.y);
        walk(n.b, real(iB), n.y);
      } else {
        const L = n.top - ay;
        const R = L + n.h / 2;
        const i = add(n.x, n.top + n.h / 2, n.mass);
        cons.push({ p: from, q: real(i), len: R });
        leaves.push({ el: n.el, from, i, L, w: n.w, h: n.h, rx: n.x, ry: n.top + n.h / 2, m: n.mass, ph: leaves.length * 2.399 });
        if (n.child) {
          // the hook sits on the line from where this piece hangs, through its
          // middle, to just under it
          const r = (L + n.h + HOOK) / R;
          walk(n.child, { i: from.i, j: i, a: 1 - r, b: r, k: 0 }, n.top + n.h + HOOK);
        }
      }
    };
    const anchor = add(comOf(node), 0, 0);
    walk(node, real(anchor), 0);
    return { P, cons, arms, strings, leaves };
  }

  // ---------- solver ----------

  function solve(P, c) {
    at(P, c.p, tmpA);
    at(P, c.q, tmpB);
    let nx = tmpB.x - tmpA.x;
    let ny = tmpB.y - tmpA.y;
    const d = Math.hypot(nx, ny) || 1e-6;
    nx /= d;
    ny /= d;
    const p = c.p;
    const q = c.q;
    const im = P.im;
    const wp = p.i === p.j ? im[p.i] : im[p.i] * (p.a * p.a + p.k * p.k) + im[p.j] * (p.b * p.b + p.k * p.k);
    const wq = q.i === q.j ? im[q.i] : im[q.i] * (q.a * q.a + q.k * q.k) + im[q.j] * (q.b * q.b + q.k * q.k);
    const sum = wp + wq;
    if (!sum) return;
    const lam = -(d - c.len) / sum;
    push(P, p, -lam, nx, ny);
    push(P, q, lam, nx, ny);
  }

  function push(P, d, lam, nx, ny) {
    const wi = P.im[d.i] * lam;
    if (d.i === d.j) {
      P.x[d.i] += wi * nx;
      P.y[d.i] += wi * ny;
      return;
    }
    const wj = P.im[d.j] * lam;
    P.x[d.i] += wi * (d.a * nx + d.k * ny);
    P.y[d.i] += wi * (-d.k * nx + d.a * ny);
    P.x[d.j] += wj * (d.b * nx - d.k * ny);
    P.y[d.j] += wj * (d.k * nx + d.b * ny);
  }

  let S = null; // the live mobile
  let pull = null; // the piece being dragged, if any

  function step(dt) {
    const { P, cons } = S;
    const n = clamp(Math.round(dt / SUBSTEP), 1, 20);
    const h = dt / n;
    const keep = Math.max(0, 1 - AIR * h);
    const count = P.x.length;
    for (let s = 0; s < n; s++) {
      for (let i = 0; i < count; i++) {
        if (!P.im[i]) continue;
        P.vx[i] = (P.vx[i] + P.ax[i] * h) * keep;
        P.vy[i] = (P.vy[i] + G * h) * keep;
        P.px[i] = P.x[i];
        P.py[i] = P.y[i];
        P.x[i] += P.vx[i] * h;
        P.y[i] += P.vy[i] * h;
      }
      if (pull && pull.on) {
        const i = pull.lf.i;
        P.x[i] += (pull.tx - P.x[i]) * 0.14;
        P.y[i] += (pull.ty - P.y[i]) * 0.14;
      }
      for (let it = 0; it < 4; it++) for (let c = 0; c < cons.length; c++) solve(P, cons[c]);
      for (let i = 0; i < count; i++) {
        if (!P.im[i]) continue;
        P.vx[i] = (P.x[i] - P.px[i]) / h;
        P.vy[i] = (P.y[i] - P.py[i]) / h;
      }
    }
  }

  // ---------- drawing ----------

  const f = (v) => v.toFixed(2);

  function draw() {
    const { P, arms, strings, leaves } = S;
    for (const a of arms) {
      const ax = P.x[a.iA];
      const ay = P.y[a.iA];
      const bx = P.x[a.iB];
      const by = P.y[a.iB];
      const dx = bx - ax;
      const dy = by - ay;
      const len = Math.hypot(dx, dy) || 1;
      const cx = (ax + bx) / 2 + (dy / len) * 2 * a.sag;
      const cy = (ay + by) / 2 - (dx / len) * 2 * a.sag;
      a.path.setAttribute('d', `M${f(ax)} ${f(ay)}Q${f(cx)} ${f(cy)} ${f(bx)} ${f(by)}`);
      a.ra.setAttribute('cx', f(ax));
      a.ra.setAttribute('cy', f(ay));
      a.rb.setAttribute('cx', f(bx));
      a.rb.setAttribute('cy', f(by));
    }
    for (const s of strings) {
      at(P, s.p, tmpA);
      at(P, s.q, tmpB);
      s.line.setAttribute('x1', f(tmpA.x));
      s.line.setAttribute('y1', f(tmpA.y));
      s.line.setAttribute('x2', f(tmpB.x));
      s.line.setAttribute('y2', f(tmpB.y));
      s.knot.setAttribute('cx', f(tmpB.x));
      s.knot.setAttribute('cy', f(tmpB.y));
    }
    for (const l of leaves) {
      at(P, l.from, tmpA);
      let dx = P.x[l.i] - tmpA.x;
      let dy = P.y[l.i] - tmpA.y;
      const d = Math.hypot(dx, dy) || 1;
      dx /= d;
      dy /= d;
      const ex = tmpA.x + dx * l.L;
      const ey = tmpA.y + dy * l.L;
      l.line.setAttribute('x1', f(tmpA.x));
      l.line.setAttribute('y1', f(tmpA.y));
      l.line.setAttribute('x2', f(ex));
      l.line.setAttribute('y2', f(ey));
      l.knot.setAttribute('cx', f(ex));
      l.knot.setAttribute('cy', f(ey));
      const rot = Math.atan2(-dx, dy);
      // hanging dead straight, a piece sits on whole pixels so its text stays crisp
      l.el.style.transform =
        Math.abs(rot) < 1e-4
          ? `translate(${Math.round(tmpA.x - l.w / 2)}px,${Math.round(tmpA.y + l.L)}px)`
          : `translate(${f(tmpA.x)}px,${f(tmpA.y)}px) rotate(${rot.toFixed(5)}rad) translate(${f(-l.w / 2)}px,${f(l.L)}px)`;
    }
  }

  const el = (name, cls) => {
    const e = document.createElementNS(NS, name);
    e.setAttribute('class', cls);
    return e;
  };

  // ---------- build ----------

  function build() {
    pull = null;
    html.classList.remove('pulling');
    for (const e of root.querySelectorAll('[data-hung]')) {
      e.removeAttribute('data-hung');
      e.style.transform = '';
    }
    const wide = wideMq.matches;
    const hang = wide ? [mark, ...linkEls, ...projEls, ...aboutEls, blaze] : [mark, nav, ...projEls, ...aboutEls, blaze];
    for (const e of hang) e.setAttribute('data-hung', '');
    html.classList.add('hung');

    rects = [];
    const W = root.clientWidth;
    const { node, height } = wide ? layWide(W) : layNarrow(W);
    S = assemble(node);
    S.width = W;
    root.style.height = Math.ceil(height) + 'px';

    svg.replaceChildren();
    svg.setAttribute('viewBox', `0 0 ${W} ${Math.ceil(height)}`);
    const strings = el('g', 'strings');
    const armsG = el('g', 'arms');
    const knots = el('g', 'knots');
    svg.append(strings, armsG, knots);
    // wire ends are small loops. where an arm is held from, a knot.
    const ring = (cls = 'ring', r = 2.6) => {
      const c = el('circle', cls);
      c.setAttribute('r', r);
      knots.append(c);
      return c;
    };
    for (const s of [...S.strings, ...S.leaves]) {
      s.line = el('line', 'string');
      strings.append(s.line);
      s.knot = s.el ? ring() : ring('knot', 2);
    }
    for (const a of S.arms) {
      a.path = el('path', 'arm');
      armsG.append(a.path);
      a.ra = ring();
      a.rb = ring();
    }
    draw();
  }

  // ---------- weather ----------

  let clock = 0;
  let gust = 0; // decaying push from the left, used once when the page is hung

  function weather() {
    const { P, leaves } = S;
    const swell = 0.55 + 0.45 * Math.sin(clock * 0.17);
    for (const l of leaves) {
      const light = 1 / Math.pow(l.m, 0.35);
      const air = 0.6 * Math.sin(clock * 0.9 + l.ph) + 0.4 * Math.sin(clock * 2.3 + 1.7 * l.ph);
      P.ax[l.i] = 26 * swell * air * light + gust * light;
    }
    gust *= 0.9;
  }

  // ---------- loop ----------

  let raf = 0;
  let then = 0;

  function frame(now) {
    raf = requestAnimationFrame(frame);
    const dt = Math.min(0.034, (now - then) / 1000);
    then = now;
    if (dt <= 0) return;
    clock += dt;
    weather();
    step(dt);
    draw();
  }

  function run() {
    cancelAnimationFrame(raf);
    raf = 0;
    if (calmMq.matches || document.hidden || !S) return;
    then = performance.now();
    raf = requestAnimationFrame(frame);
  }

  // ---------- hands ----------

  const px = (e) => e.pageX - root.offsetLeft;
  const py = (e) => e.pageY - root.offsetTop;
  let hushClick = false;

  root.addEventListener('pointerdown', (e) => {
    if (!S || !raf || e.button !== 0) return;
    const hit = e.target.closest('[data-hung]');
    const lf = hit && S.leaves.find((l) => l.el === hit);
    if (!lf) return;
    pull = { lf, id: e.pointerId, sx: px(e), sy: py(e), ox: px(e) - S.P.x[lf.i], oy: py(e) - S.P.y[lf.i], on: false, tx: 0, ty: 0 };
  });

  let mx = 0;
  let my = 0;
  let mt = 0;

  window.addEventListener('pointermove', (e) => {
    if (!S || !raf) return;
    const x = px(e);
    const y = py(e);
    if (pull && e.pointerId === pull.id) {
      if (!pull.on && Math.hypot(x - pull.sx, y - pull.sy) > 5) {
        pull.on = true;
        html.classList.add('pulling');
        try {
          root.setPointerCapture(pull.id);
        } catch {}
      }
      if (pull.on) {
        // the hand is on a rubber band, so nothing can be yanked off the page
        const dx = x - pull.ox - pull.lf.rx;
        const dy = y - pull.oy - pull.lf.ry;
        const d = Math.hypot(dx, dy) || 1;
        const reach = 190 * (1 - Math.exp(-d / 190));
        pull.tx = pull.lf.rx + (dx / d) * reach;
        pull.ty = pull.lf.ry + (dy / d) * reach;
      }
      return;
    }
    if (e.pointerType !== 'mouse') return;
    // a moving cursor drags a little air along with it
    const now = e.timeStamp;
    const dt = (now - mt) / 1000;
    if (dt > 0 && dt < 0.1) {
      const vx = clamp((x - mx) / dt, -1800, 1800);
      const vy = clamp((y - my) / dt, -1800, 1800);
      const { P, leaves } = S;
      for (const l of leaves) {
        const d = Math.hypot(P.x[l.i] - x, P.y[l.i] - y) - Math.min(l.w, l.h) / 2;
        if (d > 150) continue;
        const near = d <= 0 ? 1 : (1 - d / 150) ** 2;
        const grip = (1 - Math.exp((-4.5 * dt) / Math.sqrt(l.m))) * near;
        P.vx[l.i] += (vx - P.vx[l.i]) * grip;
        P.vy[l.i] += (vy - P.vy[l.i]) * grip * 0.3;
      }
    }
    mx = x;
    my = y;
    mt = now;
  });

  const letGo = (e) => {
    if (!pull || e.pointerId !== pull.id) return;
    if (pull.on) {
      hushClick = true;
      setTimeout(() => (hushClick = false), 60);
      html.classList.remove('pulling');
    }
    pull = null;
  };
  window.addEventListener('pointerup', letGo);
  window.addEventListener('pointercancel', letGo);
  root.addEventListener(
    'click',
    (e) => {
      if (!hushClick) return;
      e.preventDefault();
      e.stopPropagation();
    },
    true
  );

  // scrolling stirs the air, within reason
  let lastScroll = window.scrollY;
  let lastStir = 0;
  let budget = 120;
  window.addEventListener(
    'scroll',
    () => {
      const dy = window.scrollY - lastScroll;
      lastScroll = window.scrollY;
      if (!S || !raf) return;
      const now = performance.now();
      budget = Math.min(120, budget + (now - lastStir) * 0.12);
      lastStir = now;
      const use = Math.min(Math.abs(dy), budget);
      budget -= use;
      const { P, leaves } = S;
      for (const l of leaves) P.vx[l.i] += (Math.sign(dy) * use * 0.5 * Math.sin(l.ph * 3.1)) / Math.sqrt(l.m);
    },
    { passive: true }
  );

  // ---------- life cycle ----------

  let hungOnce = false;
  let builtWidth = 0;
  let builtMark = 0;

  function hangUp() {
    build();
    builtWidth = root.clientWidth;
    builtMark = mark.offsetWidth;
    if (!hungOnce && !calmMq.matches) {
      // the one staged moment: it has just been hung, and is still settling
      const push = wideMq.matches ? 1 : 0.45;
      gust = 520 * push;
      for (const l of S.leaves) S.P.vx[l.i] = 0.05 * push * Math.sqrt(G * (l.L + l.h / 2));
    }
    hungOnce = true;
    run();
  }

  let resizeTimer = 0;
  new ResizeObserver(() => {
    if (!hungOnce || root.clientWidth === builtWidth) return;
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(hangUp, 120);
  }).observe(html);

  calmMq.addEventListener('change', hangUp);
  document.addEventListener('visibilitychange', run);

  const fonts = document.fonts;
  const ready = fonts
    ? Promise.all([fonts.load('900 1em "Hepta Slab"'), fonts.load('400 1em "Hepta Slab"')]).then(() => fonts.ready)
    : Promise.resolve();
  Promise.race([ready, new Promise((r) => setTimeout(r, 2500))]).then(hangUp, hangUp);
  // if the font only arrives after that, everything was measured wrong: hang it again
  if (fonts) {
    fonts.addEventListener('loadingdone', () => {
      if (hungOnce && mark.offsetWidth !== builtMark) hangUp();
    });
  }

  // ---------- for tinkering in the console ----------
  // mobile.audit() lists any wire that crosses a piece it should not.

  const hits = (x1, y1, x2, y2, q) => {
    // segment against rectangle, liang-barsky
    let t0 = 0;
    let t1 = 1;
    const dx = x2 - x1;
    const dy = y2 - y1;
    for (const [p, v] of [[-dx, x1 - q.l], [dx, q.r - x1], [-dy, y1 - q.t], [dy, q.b - y1]]) {
      if (p === 0) {
        if (v < 0) return false;
      } else {
        const t = v / p;
        if (p < 0) t0 = Math.max(t0, t);
        else t1 = Math.min(t1, t);
        if (t0 > t1) return false;
      }
    }
    return true;
  };

  window.mobile = {
    get state() {
      return S;
    },
    step,
    draw,
    audit(pad = 6) {
      const { P, arms, strings, leaves } = S;
      const name = (l) => (l.el.querySelector('h1, h3, a') || l.el).textContent.trim().slice(0, 14) || l.el.className;
      const boxes = leaves.map((l) => ({ l: l.rx - l.w / 2 - pad, r: l.rx + l.w / 2 + pad, t: l.ry - l.h / 2 - pad, b: l.ry + l.h / 2 + pad, n: name(l) }));
      const out = [];
      const test = (what, x1, y1, x2, y2) => {
        for (const q of boxes) if (hits(x1, y1, x2, y2, q)) out.push(`${what} crosses ${q.n}`);
      };
      for (const a of arms) {
        const mx2 = (P.x[a.iA] + P.x[a.iB]) / 2;
        const top = P.y[a.iA] - a.sag;
        test('arm', P.x[a.iA], P.y[a.iA], mx2, top);
        test('arm', mx2, top, P.x[a.iB], P.y[a.iB]);
      }
      for (const s of strings) {
        const a = at(P, s.p, { x: 0, y: 0 });
        const b = at(P, s.q, { x: 0, y: 0 });
        // a string that starts at a hook starts just under the piece that carries it
        test('string', a.x, a.y + (s.p.i === s.p.j ? 0 : pad + 2), b.x, b.y);
      }
      for (let i = 0; i < boxes.length; i++)
        for (let j = i + 1; j < boxes.length; j++) {
          const a = boxes[i];
          const b = boxes[j];
          if (a.l < b.r - pad && b.l < a.r - pad && a.t < b.b - pad && b.t < a.b - pad) out.push(`${a.n} overlaps ${b.n}`);
        }
      return out;
    },
  };
})();
