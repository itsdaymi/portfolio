/* e-two-readers — one document, two readings.
   The data lives once (PROJECTS); the DOM is rendered once; the toggle changes a class on <html>
   and the morph moves every named element from its place in one reading to its place in the other. */

(function () {
  'use strict';

  /* ---------- the data: one array renders both readings ---------- */

  var PROJECTS = [
    { name: 'daystack',   description: 'my agent skills. editable copies, installed via skills.sh.',                       year: 2026, tags: ['skills', 'cli'],      link: 'https://github.com/itsdaymi/daystack' },
    { name: 'ledger',     description: 'a small double-entry bookkeeping cli. plain text in, balance sheet out.',           year: 2026, tags: ['cli', 'finance'],     link: '#' },
    { name: 'pinboard',   description: 'a self-hosted bookmark thing with full-text search. because every other one died.', year: 2025, tags: ['web', 'selfhosted'],  link: '#' },
    { name: 'tiles',      description: "a tiling window manager for people who don't want to configure one.",             year: 2025, tags: ['desktop', 'rust'],    link: '#' },
    { name: 'nachtlicht', description: 'a tiny status page that turns red when things break.',                             year: 2024, tags: ['web', 'ops'],         link: '#' },
    { name: 'kettle',     description: 'a build tool that only does the three things i use.',                              year: 2024, tags: ['cli', 'tooling'],     link: '#' }
  ];

  var html = document.documentElement;
  var DUR = 700;
  var EASE = 'cubic-bezier(.8, 0, .2, 1)';
  var STORE = 'daymi.reading';

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }
  function key(label, lead) {
    /* a syntax key, only shown in the agent reading, hidden from assistive tech */
    var k = el('span', 'k');
    k.setAttribute('aria-hidden', 'true');
    if (lead) k.appendChild(document.createTextNode(lead));
    var kk = el('span', 'kk', label);
    k.appendChild(kk);
    k.appendChild(document.createTextNode(' '));
    return k;
  }
  function slug(s) { return String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''); }

  /* ---------- render ---------- */

  function renderProjects() {
    var list = document.getElementById('projects');
    var frag = document.createDocumentFragment();
    PROJECTS.forEach(function (p, i) {
      var id = 'p' + i + '-' + slug(p.name);
      var li = el('li', 'project');

      var h3 = el('h3', 'p-title');
      h3.appendChild(key('name:', '- '));
      if (p.link && p.link !== '#') {
        var a = el('a', null, p.name);
        a.href = p.link;
        h3.appendChild(a);
      } else {
        h3.appendChild(document.createTextNode(p.name));
      }
      name(h3, id + '-title');

      var desc = el('p', 'p-desc');
      desc.appendChild(key('description:'));
      desc.appendChild(document.createTextNode(p.description));
      name(desc, id + '-desc');

      var meta = el('p', 'p-meta');
      var year = el('span', 'p-year');
      year.appendChild(key('year:'));
      year.appendChild(document.createTextNode(String(p.year)));
      var tags = el('span', 'p-tags');
      var tk = key('tags:');
      tk.appendChild(document.createTextNode('['));
      tags.appendChild(tk);
      tags.appendChild(document.createTextNode(p.tags.join(', ')));
      var close = el('span', 'k', ']');
      close.setAttribute('aria-hidden', 'true');
      tags.appendChild(close);
      meta.appendChild(year);
      meta.appendChild(tags);
      if (p.link && p.link !== '#') {
        var url = el('span', 'p-url ao');
        url.appendChild(key('url:'));
        url.appendChild(document.createTextNode(p.link));
        meta.appendChild(url);
      }
      name(meta, id + '-meta');

      li.appendChild(h3);
      li.appendChild(desc);
      li.appendChild(meta);
      frag.appendChild(li);
    });
    list.appendChild(frag);
  }

  function name(node, n) {
    node.dataset.vt = n;
    node.style.viewTransitionName = n;
  }

  /* ---------- state ---------- */

  var state = { current: html.classList.contains('is-agent') ? 'agent' : 'human' };
  var buttons = Array.prototype.slice.call(document.querySelectorAll('.toggle-btn'));

  function reduced() { return matchMedia('(prefers-reduced-motion: reduce)').matches; }

  function paintToggle(reading) {
    buttons.forEach(function (b) { b.setAttribute('aria-pressed', String(b.dataset.reading === reading)); });
  }

  function apply(reading) {
    html.classList.toggle('is-agent', reading === 'agent');
    html.dataset.reading = reading;
    paintToggle(reading);
    state.current = reading;
  }

  function persist(reading) {
    try { localStorage.setItem(STORE, reading); } catch (e) {}
    var want = reading === 'agent' ? '#agent' : '';
    if (location.hash !== want) {
      history.replaceState(null, '', location.pathname + location.search + want);
    }
  }

  /* keep the morph local: at the top stay at the top; further down, the topmost visible element keeps its place */
  function withAnchor(fn) {
    var y = window.scrollY;
    if (y < window.innerHeight * 0.4) { fn(); return; }
    var named = document.querySelectorAll('[data-vt]');
    var anchor = null, top = Infinity;
    for (var i = 0; i < named.length; i++) {
      var r = named[i].getBoundingClientRect();
      if (r.bottom <= 0 || r.height === 0 || named[i].dataset.vt === 'toggle') continue;
      if (r.top < top) { top = r.top; anchor = named[i]; }
    }
    fn();
    if (anchor) {
      var after = anchor.getBoundingClientRect().top;
      window.scrollBy(0, after - top);
    }
  }

  /* ---------- engine 1: view transitions (chrome, safari 18, firefox 144) ---------- */

  var vt = {
    running: null,
    run: function (from, to) {
      var self = this;
      var t = document.startViewTransition(function () { withAnchor(function () { apply(to); }); });
      var r = { t: t, from: from, to: to, target: to, anims: [] };
      this.running = r;
      t.ready.then(function () {
        r.anims = document.getAnimations().filter(function (a) {
          var pe = a.effect && a.effect.pseudoElement;
          return pe && pe.indexOf('::view-transition') === 0;
        });
        if (!r.anims.length) return;
        if (r.target === r.from) r.anims.forEach(function (a) { a.reverse(); });   /* redirected while snapshotting */
        Promise.all(r.anims.map(function (a) { return a.finished; })).then(function () {
          /* reversed: the snapshots are back at the start, so put the DOM back before the pseudo-tree goes */
          if (r.target === r.from && state.current !== r.from) apply(r.from);
        }).catch(function () {});
      }).catch(function () {});
      t.finished.then(function () {}, function () {}).then(function () {
        if (self.running === r) self.running = null;
        if (state.current !== r.target) self.run(state.current, r.target);
      });
    },
    redirect: function (next) {
      var r = this.running;
      if (r.target === next) return;
      r.target = next;
      paintToggle(next);
      if (r.anims.length) {
        r.anims.forEach(function (a) { a.reverse(); });
      }
      /* not ready yet (snapshotting) or no reachable animations: finished() above restarts toward the new target */
    }
  };

  /* ---------- engine 2: FLIP (no view transitions) ---------- */

  var flip = {
    running: null,
    named: function () { return Array.prototype.slice.call(document.querySelectorAll('[data-vt]')); },
    run: function (from, to) {
      var self = this;
      var els = this.named();
      var first = new Map();
      els.forEach(function (e) {
        first.set(e, e.getBoundingClientRect());
        e.getAnimations().forEach(function (a) { a.cancel(); });
      });
      withAnchor(function () { apply(to); });
      var anims = [];
      var vh = window.innerHeight;
      els.forEach(function (e) {
        var f = first.get(e), l = e.getBoundingClientRect();
        var seen = (f.bottom > 0 && f.top < vh) || (l.bottom > 0 && l.top < vh);
        if (!seen || !l.height || !f.height) return;
        var dx = f.left - l.left, dy = f.top - l.top;
        if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) return;
        /* no snapshots here, so no cross-fade: the element takes its new form at once and travels in, fading up on the way */
        anims.push(e.animate(
          [{ transform: 'translate(' + dx + 'px,' + dy + 'px)', opacity: 0, offset: 0 },
           { opacity: 1, offset: 0.45 },
           { transform: 'none', opacity: 1, offset: 1 }],
          { duration: DUR, easing: EASE, fill: 'both' }
        ));
      });
      var r = { from: from, to: to, target: to, anims: anims };
      this.running = r;
      Promise.all(anims.map(function (a) { return a.finished; })).then(function () {
        anims.forEach(function (a) { a.cancel(); });
        if (self.running === r) self.running = null;
      }).catch(function () {});
    },
    redirect: function (next) {
      if (this.running.target === next) return;
      this.running = null;
      this.run(state.current, next);   /* measures the in-flight rects, so it continues from where it is */
    }
  };

  var engine = ('startViewTransition' in document) ? vt : flip;

  /* ---------- the one control ---------- */

  function setReading(next, opts) {
    opts = opts || {};
    if (opts.persist !== false) persist(next);
    if (engine.running) { engine.redirect(next); return; }
    if (next === state.current) { paintToggle(next); return; }
    if (opts.animate === false || reduced() || document.visibilityState === 'hidden') { apply(next); return; }
    engine.run(state.current, next);
  }

  buttons.forEach(function (b) {
    b.addEventListener('click', function () { setReading(b.dataset.reading); });
  });

  window.addEventListener('hashchange', function () {
    if (location.hash === '#agent') setReading('agent', { persist: false });
    else if (location.hash === '#human' || location.hash === '') setReading('human', { persist: false });
  });

  /* ---------- copy ---------- */

  var copy = document.querySelector('.copy');
  if (copy) {
    copy.addEventListener('click', function () {
      var text = copy.dataset.copy;
      var done = function () {
        copy.textContent = 'copied';
        copy.classList.add('is-done');
        clearTimeout(copy._t);
        copy._t = setTimeout(function () { copy.textContent = 'copy'; copy.classList.remove('is-done'); }, 1800);
      };
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(done, function () { location.href = 'mailto:' + text; });
      } else {
        location.href = 'mailto:' + text;
      }
    });
  }

  /* ---------- boot ---------- */

  renderProjects();
  Array.prototype.forEach.call(document.querySelectorAll('[data-vt]'), function (e) {
    e.style.viewTransitionName = e.dataset.vt;
  });
  paintToggle(state.current);

  function sleep(ms) { return new Promise(function (res) { setTimeout(res, ms); }); }

  if (html.dataset.boot === 'morph') {
    /* the load moment: the document is shown for a beat, then folds into the page for people. once. */
    var fonts = (document.fonts && document.fonts.ready) ? document.fonts.ready : Promise.resolve();
    Promise.race([fonts, sleep(900)]).then(function () {
      html.classList.remove('is-booting');
      return sleep(280);
    }).then(function () {
      delete html.dataset.boot;
      if (state.current === 'agent' && location.hash !== '#agent') setReading('human', { persist: false });
    });
  } else {
    html.classList.remove('is-booting');
  }
})();
