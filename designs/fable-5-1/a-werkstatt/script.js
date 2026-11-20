/* daymi.dev, direction a: werkstatt. no dependencies. */
(function () {
  'use strict';

  /* ------------------------------------------------------------------ */
  /* the parts list. add a project here; the table renders itself.       */
  /* ------------------------------------------------------------------ */

  var PROJECTS = [
    {
      name: 'daystack',
      description: 'my agent skills. editable copies, installed via skills.sh.',
      year: 2026,
      tags: ['skills', 'cli'],
      link: 'https://github.com/itsdaymi/daystack'
    },
    {
      name: 'ledger',
      description: 'a small double-entry bookkeeping cli. plain text in, balance sheet out.',
      year: 2026,
      tags: ['cli', 'finance'],
      link: '#'
    },
    {
      name: 'pinboard',
      description: 'a self-hosted bookmark thing with full-text search. because every other one died.',
      year: 2025,
      tags: ['web', 'selfhosted'],
      link: '#'
    },
    {
      name: 'tiles',
      description: "a tiling window manager for people who don't want to configure one.",
      year: 2025,
      tags: ['desktop', 'rust'],
      link: '#'
    },
    {
      name: 'nachtlicht',
      description: 'a tiny status page that turns red when things break.',
      year: 2024,
      tags: ['web', 'ops'],
      link: '#'
    },
    {
      name: 'kettle',
      description: 'a build tool that only does the three things i use.',
      year: 2024,
      tags: ['cli', 'tooling'],
      link: '#'
    }
  ];

  /* ------------------------------------------------------------------ */
  /* parts list table                                                     */
  /* ------------------------------------------------------------------ */

  function linkLabel(url) {
    try {
      var host = new URL(url, location.href).hostname.replace(/^www\./, '');
      if (host === 'github.com') return 'github';
      return host;
    } catch (e) {
      return 'link';
    }
  }

  function renderProjects() {
    var body = document.getElementById('bom-body');
    if (!body) return;
    body.textContent = '';

    PROJECTS.forEach(function (p, idx) {
      var tr = document.createElement('tr');

      function cell(cls, content) {
        var td = document.createElement('td');
        td.className = cls;
        if (typeof content === 'string') td.textContent = content;
        else td.appendChild(content);
        tr.appendChild(td);
        return td;
      }

      cell('c-pos', String(idx + 1));

      var name = document.createElement('span');
      name.textContent = p.name;
      cell('c-part', name);

      cell('c-desc', p.description);
      cell('c-mat', p.tags.join(', '));
      cell('c-year', String(p.year));

      if (p.link && p.link !== '#') {
        var a = document.createElement('a');
        a.href = p.link;
        a.textContent = linkLabel(p.link);
        if (/^https?:/i.test(p.link)) a.rel = 'noopener';
        cell('c-link', a);
      } else {
        cell('c-link', '');
      }

      body.appendChild(tr);
    });

    var count = document.getElementById('parts-count');
    if (count) count.textContent = String(PROJECTS.length);
  }

  /* ------------------------------------------------------------------ */
  /* the exploded view                                                    */
  /* ------------------------------------------------------------------ */

  var SVGNS = 'http://www.w3.org/2000/svg';
  var FS = 320;
  var FAMILY = '"Barlow Condensed", "Arial Narrow", sans-serif';
  var FONT = '800 ' + FS + 'px ' + FAMILY;

  var svg = document.getElementById('exploded');
  var drawing = document.getElementById('drawing');
  var reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  var narrow = window.matchMedia('(max-width: 900px)');

  var parts = svg ? Array.prototype.slice.call(svg.querySelectorAll('.part')) : [];
  var glyphs = parts.map(function (p) { return p.querySelector('.glyph'); });
  var letters = glyphs.map(function (g) { return g.textContent; });
  var legendItems = Array.prototype.slice.call(document.querySelectorAll('#legend li'));
  var balloons = [];
  var animated = false;
  var lastWidth = 0;

  function el(tag, attrs, parent) {
    var node = document.createElementNS(SVGNS, tag);
    for (var k in attrs) {
      if (Object.prototype.hasOwnProperty.call(attrs, k)) node.setAttribute(k, attrs[k]);
    }
    if (parent) parent.appendChild(node);
    return node;
  }

  function fmt(v) {
    return (Math.round(v * 10) / 10).toFixed(1);
  }

  function clearGroup(id) {
    var g = document.getElementById(id);
    if (g) g.textContent = '';
    return g;
  }

  var measureCtx = null;

  function measure(ch) {
    if (!measureCtx) measureCtx = document.createElement('canvas').getContext('2d');
    measureCtx.font = FONT;
    var m = measureCtx.measureText(ch);
    var hasInk = typeof m.actualBoundingBoxLeft === 'number';
    return {
      adv: m.width,
      left: hasInk ? m.actualBoundingBoxLeft : 0,
      right: hasInk ? m.actualBoundingBoxRight : m.width,
      asc: hasInk ? m.actualBoundingBoxAscent : FS * 0.7,
      desc: hasInk ? m.actualBoundingBoxDescent : 0
    };
  }

  /* a small raster of the glyph so leaders can stop at the real outline */
  function rasterize(ch, m) {
    var S = 0.25;
    var w = Math.ceil((m.left + m.right) * S) + 6;
    var h = Math.ceil((m.asc + m.desc) * S) + 6;
    var c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    var x = c.getContext('2d');
    x.font = '800 ' + (FS * S) + 'px ' + FAMILY;
    x.fillStyle = '#000';
    x.fillText(ch, m.left * S + 3, m.asc * S + 3);
    var data = x.getImageData(0, 0, w, h).data;
    return function inked(gx, gy) {
      var px = Math.round(gx * S + 3);
      var py = Math.round(gy * S + 3);
      if (px < 0 || py < 0 || px >= w || py >= h) return false;
      return data[(py * w + px) * 4 + 3] > 90;
    };
  }

  function options() {
    var wide = !narrow.matches;
    var width = drawing ? drawing.clientWidth || 800 : 800;
    return {
      angle: wide ? 22 : 48,
      gap: wide ? 0.26 : 0.1,
      dims: wide,
      over: wide ? 0.5 : 0.28,
      reach: wide ? 0.2 : 0.16,
      ui: wide ? Math.min(1.7, Math.max(1, 820 / width)) : 2.3
    };
  }

  function layout(opt) {
    if (!svg || !parts.length) return;

    var ms = letters.map(measure);
    var theta = opt.angle * Math.PI / 180;
    var u = { x: Math.cos(theta), y: -Math.sin(theta) };
    var n = { x: Math.sin(theta), y: Math.cos(theta) };
    var gap = FS * opt.gap;
    var ui = opt.ui;

    /* exploded positions: every centre sits on one axis, horizontal clearance = gap */
    var centres = [];
    var cx = 0;
    var cy = 0;
    ms.forEach(function (m, i) {
      if (i > 0) {
        var prev = ms[i - 1];
        var dx = (prev.left + prev.right) / 2 + gap + (m.left + m.right) / 2;
        var t = dx / u.x;
        cx += t * u.x;
        cy += t * u.y;
      }
      centres.push({ x: cx, y: cy });
    });

    var pos = ms.map(function (m, i) {
      var w = m.left + m.right;
      var h = m.asc + m.desc;
      return { x: centres[i].x - w / 2 + m.left, y: centres[i].y - h / 2 + m.asc };
    });

    var boxes = ms.map(function (m, i) {
      return { x0: pos[i].x - m.left, x1: pos[i].x + m.right, y0: pos[i].y - m.asc, y1: pos[i].y + m.desc };
    });

    /* assembled word, centred on the middle part, for the load motion */
    var track = FS * 0.02;
    var ax = 0;
    var asm = ms.map(function (m) {
      var p = { x: ax, y: 0 };
      ax += m.adv + track;
      return p;
    });
    var asmX0 = asm[0].x - ms[0].left;
    var asmX1 = asm[ms.length - 1].x + ms[ms.length - 1].right;
    var asmY0 = Math.min.apply(null, ms.map(function (m) { return -m.asc; }));
    var asmY1 = Math.max.apply(null, ms.map(function (m) { return m.desc; }));
    var mid = centres[Math.floor(ms.length / 2)];
    var shiftX = mid.x - (asmX0 + asmX1) / 2;
    var shiftY = mid.y - (asmY0 + asmY1) / 2;

    parts.forEach(function (part, i) {
      var g = glyphs[i];
      g.setAttribute('x', fmt(pos[i].x));
      g.setAttribute('y', fmt(pos[i].y));
      g.setAttribute('font-size', FS);
      part.style.setProperty('--ax', fmt(asm[i].x + shiftX - pos[i].x) + 'px');
      part.style.setProperty('--ay', fmt(asm[i].y + shiftY - pos[i].y) + 'px');

      /* hover: pull the part straight out of the stack, perpendicular to the axis */
      var pull = FS * 0.1;
      part.style.setProperty('--hx', fmt(-n.x * pull) + 'px');
      part.style.setProperty('--hy', fmt(-n.y * pull) + 'px');

      var old = part.querySelector('.hit');
      if (old) old.parentNode.removeChild(old);
      var padHit = FS * 0.05;
      var hit = el('rect', {
        'class': 'hit',
        x: fmt(boxes[i].x0 - padHit),
        y: fmt(boxes[i].y0 - padHit),
        width: fmt(boxes[i].x1 - boxes[i].x0 + padHit * 2),
        height: fmt(boxes[i].y1 - boxes[i].y0 + padHit * 2)
      });
      part.insertBefore(hit, g);
    });

    /* hatch spacing follows the ui scale so it stays a hatch on phones */
    var pattern = document.getElementById('hatch');
    if (pattern) {
      var step = 11 * (0.6 + ui * 0.4);
      pattern.setAttribute('width', fmt(step));
      pattern.setAttribute('height', fmt(step));
      var hl = pattern.querySelector('line');
      hl.setAttribute('y2', fmt(step));
      hl.setAttribute('stroke-width', fmt(1.4 * (0.7 + ui * 0.3)));
    }

    var extents = {
      x0: Math.min.apply(null, boxes.map(function (b) { return b.x0; })),
      x1: Math.max.apply(null, boxes.map(function (b) { return b.x1; })),
      y0: Math.min.apply(null, boxes.map(function (b) { return b.y0; })),
      y1: Math.max.apply(null, boxes.map(function (b) { return b.y1; }))
    };

    function grow(x, y) {
      if (x < extents.x0) extents.x0 = x;
      if (x > extents.x1) extents.x1 = x;
      if (y < extents.y0) extents.y0 = y;
      if (y > extents.y1) extents.y1 = y;
    }

    /* the explosion axis, dash-dot, through every centre */
    var gAxis = clearGroup('chrome-axis');
    var first = centres[0];
    var last = centres[centres.length - 1];
    var over = FS * opt.over;
    var a0 = { x: first.x - u.x * over, y: first.y - u.y * over };
    var a1 = { x: last.x + u.x * over, y: last.y + u.y * over };
    el('line', {
      'class': 'axis',
      x1: fmt(a0.x), y1: fmt(a0.y), x2: fmt(a1.x), y2: fmt(a1.y),
      'stroke-width': fmt(1.25 * ui),
      'stroke-dasharray': [28 * ui, 8 * ui, 5 * ui, 8 * ui].map(fmt).join(' ')
    }, gAxis);
    grow(a0.x, a0.y);
    grow(a1.x, a1.y);

    /* dimensions, desktop only */
    var gDims = clearGroup('chrome-dims');
    var dimText = 22 * ui;
    var sw = 1.25 * ui;
    var clear = 6;
    var beyond = 12;

    function dimH(xa, xb, y, label, i) {
      el('line', { 'class': 'dim', x1: fmt(xa), y1: fmt(y), x2: fmt(xb), y2: fmt(y), 'stroke-width': fmt(sw), 'marker-start': 'url(#arrow-dim)', 'marker-end': 'url(#arrow-dim)' }, gDims);
      var t = el('text', { 'class': 'dim-text', x: fmt((xa + xb) / 2), y: fmt(y - 7 * ui), 'font-size': fmt(dimText) }, gDims);
      t.textContent = label;
      grow(xa, y - dimText - 12 * ui);
      grow(xb, y);
    }

    function ext(x1, y1, x2, y2) {
      el('line', { 'class': 'ext', x1: fmt(x1), y1: fmt(y1), x2: fmt(x2), y2: fmt(y2), 'stroke-width': fmt(1 * ui) }, gDims);
      grow(x1, y1);
      grow(x2, y2);
    }

    if (opt.dims) {
      /* clearance between parts: equal everywhere, so dimensioned once, as a draftsman would */
      var A = boxes[0];
      var B = boxes[1];
      var yd = Math.min(A.y0, B.y0) - FS * 0.13;
      ext(A.x1, A.y0 - clear, A.x1, yd - beyond);
      ext(B.x0, B.y0 - clear, B.x0, yd - beyond);
      dimH(A.x1, B.x0, yd, (boxes.length - 1) + '× ' + Math.round(B.x0 - A.x1));

      /* overall length, with the one tolerance */
      var top = extents.y0;
      var yo = top - FS * 0.2;
      var L = boxes[0];
      var R = boxes[boxes.length - 1];
      ext(L.x0, L.y0 - clear, L.x0, yo - beyond);
      ext(R.x1, R.y0 - clear, R.x1, yo - beyond);
      dimH(L.x0, R.x1, yo, Math.round(R.x1 - L.x0) + ' ±0.1');
    }

    /* balloons on a line parallel to the axis, leaders ending on the outline */
    var gBall = clearGroup('chrome-balloons');
    balloons = [];
    var r = 27 * ui;
    var reach = 0;
    ms.forEach(function (m) {
      var w = m.left + m.right;
      var h = m.asc + m.desc;
      reach = Math.max(reach, (w / 2) * Math.abs(n.x) + (h / 2) * Math.abs(n.y));
    });
    var R = reach + FS * opt.reach + r;

    ms.forEach(function (m, i) {
      var c = centres[i];
      var b = { x: c.x + n.x * R, y: c.y + n.y * R };
      var inked = rasterize(letters[i], m);
      var box = boxes[i];

      /* walk from the balloon towards the centre until the glyph is hit */
      var dirx = c.x - b.x;
      var diry = c.y - b.y;
      var len = Math.sqrt(dirx * dirx + diry * diry);
      dirx /= len;
      diry /= len;
      var end = null;
      for (var s = r; s < len; s += 2) {
        var px = b.x + dirx * s;
        var py = b.y + diry * s;
        if (px < box.x0 || px > box.x1 || py < box.y0 || py > box.y1) continue;
        if (inked(px - box.x0, py - box.y0)) {
          end = { x: px - dirx * 2, y: py - diry * 2 };
          break;
        }
      }
      if (!end) end = { x: c.x, y: c.y };

      var g = el('g', { 'class': 'balloon', 'data-i': String(i) }, gBall);
      el('line', {
        'class': 'leader',
        x1: fmt(b.x + dirx * r), y1: fmt(b.y + diry * r),
        x2: fmt(end.x), y2: fmt(end.y),
        'stroke-width': fmt(sw)
      }, g);
      el('circle', { cx: fmt(b.x), cy: fmt(b.y), r: fmt(r), 'stroke-width': fmt(1.75 * ui) }, g);
      var t = el('text', { x: fmt(b.x), y: fmt(b.y), 'font-size': fmt(23 * ui) }, g);
      t.textContent = String(i + 1);
      balloons.push(g);
      grow(b.x - r, b.y - r);
      grow(b.x + r, b.y + r);
    });

    var pad = FS * 0.06;
    svg.setAttribute('viewBox', [
      fmt(extents.x0 - pad),
      fmt(extents.y0 - pad),
      fmt(extents.x1 - extents.x0 + pad * 2),
      fmt(extents.y1 - extents.y0 + pad * 2)
    ].join(' '));

    bindBalloons();
  }

  /* ------------------------------------------------------------------ */
  /* interaction: hover, focus, press                                     */
  /* ------------------------------------------------------------------ */

  function isPressed(i) {
    return parts[i].getAttribute('aria-pressed') === 'true';
  }

  function setActive(i, on) {
    parts[i].classList.toggle('is-out', on);
    if (balloons[i]) balloons[i].classList.toggle('is-active', on);
    if (legendItems[i]) legendItems[i].classList.toggle('is-active', on);
  }

  function release(i) {
    if (!isPressed(i)) setActive(i, false);
  }

  function toggle(i) {
    var next = !isPressed(i);
    parts[i].setAttribute('aria-pressed', String(next));
    setActive(i, next);
  }

  function clearAll() {
    parts.forEach(function (p, i) {
      p.setAttribute('aria-pressed', 'false');
      setActive(i, false);
    });
  }

  function bindBalloons() {
    balloons.forEach(function (g, i) {
      g.addEventListener('pointerenter', function () { setActive(i, true); });
      g.addEventListener('pointerleave', function () { release(i); });
    });
  }

  function bindParts() {
    parts.forEach(function (p, i) {
      p.addEventListener('pointerenter', function () { setActive(i, true); });
      p.addEventListener('pointerleave', function () { release(i); });
      p.addEventListener('focus', function () { setActive(i, true); });
      p.addEventListener('blur', function () { release(i); });
      p.addEventListener('click', function () { toggle(i); });
      p.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          toggle(i);
        } else if (e.key === 'Escape') {
          clearAll();
        }
      });
    });

    legendItems.forEach(function (li, i) {
      li.addEventListener('pointerenter', function () { setActive(i, true); });
      li.addEventListener('pointerleave', function () { release(i); });
    });
  }

  /* ------------------------------------------------------------------ */
  /* the one motion: the word comes apart                                 */
  /* ------------------------------------------------------------------ */

  function reveal() {
    if (!svg || !drawing) return;
    if (animated || reduceMotion.matches) {
      svg.classList.remove('is-assembled');
      drawing.classList.add('is-ready');
      animated = true;
      return;
    }
    animated = true;
    svg.classList.add('is-assembled');
    drawing.classList.add('is-ready');
    requestAnimationFrame(function () {
      requestAnimationFrame(function () {
        svg.classList.remove('is-assembled');
      });
    });
  }

  /* ------------------------------------------------------------------ */
  /* copy the address                                                     */
  /* ------------------------------------------------------------------ */

  function bindCopy() {
    var btn = document.querySelector('.copy');
    var status = document.querySelector('.copy-status');
    if (!btn) return;
    var timer = null;

    btn.addEventListener('click', function () {
      var text = btn.getAttribute('data-copy') || '';

      function done(ok) {
        if (status) status.textContent = ok ? 'copied' : 'could not copy';
        btn.classList.toggle('is-done', ok);
        clearTimeout(timer);
        timer = setTimeout(function () {
          if (status) status.textContent = '';
          btn.classList.remove('is-done');
        }, 2200);
      }

      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(function () { done(true); }, function () { done(false); });
      } else {
        done(false);
      }
    });
  }

  /* ------------------------------------------------------------------ */
  /* boot                                                                 */
  /* ------------------------------------------------------------------ */

  function relayout() {
    layout(options());
  }

  function start() {
    renderProjects();
    bindCopy();
    bindParts();

    var ready = Promise.resolve();
    if (document.fonts && document.fonts.load) {
      ready = Promise.race([
        document.fonts.load('800 ' + FS + 'px "Barlow Condensed"').catch(function () {}),
        new Promise(function (resolve) { setTimeout(resolve, 2500); })
      ]);
    }

    ready.then(function () {
      relayout();
      lastWidth = drawing ? drawing.clientWidth : 0;
      reveal();

      if (document.fonts && document.fonts.addEventListener) {
        document.fonts.addEventListener('loadingdone', relayout);
      }

      if (narrow.addEventListener) narrow.addEventListener('change', relayout);
      else if (narrow.addListener) narrow.addListener(relayout);

      var timer = null;
      window.addEventListener('resize', function () {
        clearTimeout(timer);
        timer = setTimeout(function () {
          var w = drawing ? drawing.clientWidth : 0;
          if (!lastWidth || Math.abs(w - lastWidth) / lastWidth > 0.12) {
            lastWidth = w;
            relayout();
          }
        }, 150);
      });
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();
