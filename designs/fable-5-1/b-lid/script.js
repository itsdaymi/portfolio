/* daymi.dev — "Lid". Everything on the lid is a sticker; stickers are physical. */
(() => {
  'use strict';

  /* ---------- data ----------
     Add a project here. `shape` and `palette` are optional: new projects get one
     assigned by cycling through SHAPES and PALETTES. The first six land on
     art-directed slots; anything after that flows below the fold. */
  const projects = [
    { name: 'daystack',   desc: 'my agent skills. editable copies, installed via skills.sh.',                year: 2026, tags: ['skills', 'cli'],     link: 'https://github.com/itsdaymi/daystack', shape: 'hex',     palette: 'red' },
    { name: 'ledger',     desc: 'a small double-entry bookkeeping cli. plain text in, balance sheet out.',   year: 2026, tags: ['cli', 'finance'],     link: '#', shape: 'torn',    palette: 'cream' },
    { name: 'pinboard',   desc: 'a self-hosted bookmark thing with full-text search. because every other one died.', year: 2025, tags: ['web', 'selfhosted'], link: '#', shape: 'nametag', palette: 'cyan' },
    { name: 'tiles',      desc: "a tiling window manager for people who don't want to configure one.",       year: 2025, tags: ['desktop', 'rust'],    link: '#', shape: 'holo' },
    { name: 'nachtlicht', desc: 'a tiny status page that turns red when things break.',                      year: 2024, tags: ['web', 'ops'],         link: '#', shape: 'circle',  palette: 'pink' },
    { name: 'kettle',     desc: 'a build tool that only does the three things i use.',                       year: 2024, tags: ['cli', 'tooling'],     link: '#', shape: 'warning', worn: true },
  ];

  const SHAPES = ['hex', 'nametag', 'torn', 'holo', 'circle', 'warning', 'rect'];
  const PALETTES = ['red', 'cyan', 'yellow', 'mint', 'pink', 'cream'];
  const MORE_ROTATIONS = [-6, 4, -3, 7, -8, 2, 5, -5];
  const EMAIL = 'daniel@daymi.dev';
  const STORE_KEY = 'daymi.lid.v1';
  const SLOT_COUNT = 6;

  const lid = document.getElementById('lid');
  const slots = document.getElementById('sk-slots');
  const more = document.getElementById('sk-more');
  const resetBtn = document.getElementById('reset');
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  const wide = matchMedia('(min-width: 1024px)');
  const mode = () => (wide.matches ? 'wide' : 'narrow');

  /* ---------- helpers ---------- */
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const px = (el, prop) => parseFloat(el.style.getPropertyValue(prop)) || 0;

  /* ---------- project stickers ---------- */
  function face(p, shape) {
    const title = `<span class="sk-title">${esc(p.name)}</span>`;
    const year = `<span class="sk-year">${esc(p.year)}</span>`;
    switch (shape) {
      case 'nametag':
        return `<span class="tag-band" aria-hidden="true"><span class="tag-hello">HELLO</span><span class="tag-sub">my name is</span></span>
                <span class="tag-name">${esc(p.name)}</span><span class="visually-hidden">${esc(p.year)}</span>`;
      case 'warning':
        return `<span class="warn-stripe" aria-hidden="true"></span>${title}${year}<span class="warn-stripe" aria-hidden="true"></span>`;
      default:
        return title + year;
    }
  }

  function back(p, id) {
    const link = p.link && p.link !== '#'
      ? `<a class="sk-link" href="${esc(p.link)}" tabindex="-1" draggable="false">${/github\.com/.test(p.link) ? 'on github' : 'open'}</a>`
      : '';
    return `<p class="sk-desc">${esc(p.desc)}</p>
            <p class="sk-meta"><b>${esc(p.year)}</b><span>${p.tags.map(esc).join(', ')}</span></p>${link}`;
  }

  function makeProject(p, i) {
    const shape = SHAPES.includes(p.shape) ? p.shape : SHAPES[i % SHAPES.length];
    const palette = PALETTES.includes(p.palette) ? p.palette : PALETTES[i % PALETTES.length];
    const id = `sk-p-${i}`;
    const li = document.createElement('li');
    li.className = `sticker project shape-${shape} p-${palette}`;
    if (shape === 'hex' || shape === 'torn') li.classList.add('is-cut');
    if (p.worn) li.classList.add('is-worn');
    li.id = id;
    li.innerHTML = `
      <div class="sk-card">
        <button class="sk-face" type="button" aria-expanded="false" aria-controls="${id}-back">${face(p, shape)}</button>
        <div class="sk-back" id="${id}-back">${back(p, id)}</div>
      </div>`;
    if (i >= SLOT_COUNT) li.style.setProperty('--rot', `${MORE_ROTATIONS[i % MORE_ROTATIONS.length]}deg`);
    return li;
  }

  const items = projects.map(makeProject);
  slots.append(...items.slice(0, SLOT_COUNT));
  if (items.length > SLOT_COUNT) {
    more.append(...items.slice(SLOT_COUNT));
    more.hidden = false;
    lid.classList.add('lid--tall');
  }

  /* ---------- slap order (also the base z-order) ---------- */
  const order = ['sk-name', 'sk-tape', 'sk-badge', 'sk-about', 'sk-p-1', 'sk-p-0', 'sk-p-3', 'sk-p-4', 'sk-p-2', 'sk-p-5', 'sk-gh', 'sk-x', 'sk-mail']
    .map((id) => document.getElementById(id)).filter(Boolean)
    .concat(items.slice(SLOT_COUNT));
  order.forEach((el, i) => {
    el.style.setProperty('--i', i);
    el.style.setProperty('--z', 10 + i);
    el.dataset.baseZ = 10 + i;
  });
  const stickers = Array.from(document.querySelectorAll('.sticker'));
  let zTop = 10 + order.length;

  /* ---------- storage ---------- */
  const readStore = () => { try { return JSON.parse(localStorage.getItem(STORE_KEY)) || {}; } catch { return {}; } };
  const writeStore = (d) => { try { localStorage.setItem(STORE_KEY, JSON.stringify(d)); } catch { /* private mode: positions just won't persist */ } };

  function save(el) {
    const d = readStore();
    const m = mode();
    d[m] = d[m] || {};
    d[m][el.id] = { dx: Math.round(px(el, '--dx')), dy: Math.round(px(el, '--dy')), z: parseInt(el.style.getPropertyValue('--z'), 10) || 0 };
    writeStore(d);
    updateReset();
  }

  function applyStore() {
    const saved = readStore()[mode()] || {};
    stickers.forEach((el) => {
      const s = saved[el.id];
      el.style.setProperty('--dx', `${s ? s.dx : 0}px`);
      el.style.setProperty('--dy', `${s ? s.dy : 0}px`);
      el.style.setProperty('--z', s && s.z ? s.z : el.dataset.baseZ);
      if (s && s.z > zTop) zTop = s.z;
    });
    updateReset();
  }

  function updateReset() {
    const saved = readStore()[mode()] || {};
    resetBtn.hidden = !Object.values(saved).some((s) => s.dx || s.dy);
  }

  /* keep a sticker at least partly on the lid */
  function clampIntoLid(el) {
    const L = lid.getBoundingClientRect();
    const r = el.getBoundingClientRect();
    const keep = 44;
    let dx = px(el, '--dx'), dy = px(el, '--dy');
    if (r.right < L.left + keep) dx += L.left + keep - r.right;
    if (r.left > L.right - keep) dx -= r.left - (L.right - keep);
    if (r.bottom < L.top + keep) dy += L.top + keep - r.bottom;
    if (r.top > L.bottom - keep) dy -= r.top - (L.bottom - keep);
    el.style.setProperty('--dx', `${Math.round(dx)}px`);
    el.style.setProperty('--dy', `${Math.round(dy)}px`);
  }

  /* ---------- drag: mouse immediately, touch after a short hold so the page still scrolls ---------- */
  function makeDraggable(el) {
    let id = null, type = '', sx = 0, sy = 0, ox = 0, oy = 0, dragging = false, timer = 0;

    const start = () => {
      dragging = true;
      try { el.setPointerCapture(id); } catch { /* already released */ }
      el.classList.add('is-dragging');
      document.body.classList.add('is-dragging-any');
      el.style.setProperty('--z', ++zTop);
      if (type === 'touch' && navigator.vibrate) navigator.vibrate(8);
    };

    const finish = (e) => {
      if (e.pointerId !== id) return;
      clearTimeout(timer);
      const was = dragging;
      if (dragging) {
        dragging = false;
        el.classList.remove('is-dragging');
        document.body.classList.remove('is-dragging-any');
        try { el.releasePointerCapture(id); } catch { /* fine */ }
        clampIntoLid(el);
        save(el);
      }
      id = null;
      if (was) {
        el.dataset.dragged = '1';
        setTimeout(() => { delete el.dataset.dragged; }, 0);
      }
    };

    el.addEventListener('pointerdown', (e) => {
      if (id !== null || (e.pointerType === 'mouse' && e.button !== 0)) return;
      id = e.pointerId; type = e.pointerType;
      sx = e.clientX; sy = e.clientY;
      ox = px(el, '--dx'); oy = px(el, '--dy');
      dragging = false;
      if (type === 'touch') timer = setTimeout(start, 240);
    });

    el.addEventListener('pointermove', (e) => {
      if (e.pointerId !== id) return;
      const dx = e.clientX - sx, dy = e.clientY - sy;
      if (!dragging) {
        if (type === 'touch') { if (Math.hypot(dx, dy) > 10) clearTimeout(timer); return; }
        if (Math.hypot(dx, dy) < 4) return;
        start();
      }
      el.style.setProperty('--dx', `${ox + dx}px`);
      el.style.setProperty('--dy', `${oy + dy}px`);
    });

    el.addEventListener('pointerup', finish);
    el.addEventListener('pointercancel', finish);
    el.addEventListener('lostpointercapture', (e) => { if (dragging) finish(e); });
    el.addEventListener('touchmove', (e) => { if (dragging) e.preventDefault(); }, { passive: false });
    el.addEventListener('contextmenu', (e) => { if (type === 'touch' || dragging) e.preventDefault(); });
    el.addEventListener('click', (e) => {
      if (el.dataset.dragged) { e.preventDefault(); e.stopPropagation(); }
    }, true);
  }

  /* ---------- keyboard: arrows nudge the focused sticker ---------- */
  function nudge(el, e) {
    const step = e.shiftKey ? 32 : 8;
    const map = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
    const d = map[e.key];
    if (!d) return false;
    e.preventDefault();
    el.style.setProperty('--dx', `${px(el, '--dx') + d[0]}px`);
    el.style.setProperty('--dy', `${px(el, '--dy') + d[1]}px`);
    el.style.setProperty('--z', ++zTop);
    clampIntoLid(el);
    save(el);
    return true;
  }

  /* ---------- flip: a project's paper backing ---------- */
  function setOpen(el, open) {
    el.classList.toggle('is-open', open);
    const btn = el.querySelector('.sk-face');
    btn.setAttribute('aria-expanded', String(open));
    const link = el.querySelector('.sk-link');
    if (link) link.tabIndex = open ? 0 : -1;
    if (open) el.style.setProperty('--z', ++zTop);
  }
  const closeAll = (except) => items.forEach((el) => { if (el !== except && el.classList.contains('is-open')) setOpen(el, false); });

  items.forEach((el) => {
    const btn = el.querySelector('.sk-face');
    const backEl = el.querySelector('.sk-back');
    btn.addEventListener('click', () => {
      if (el.dataset.dragged) return;
      const open = !el.classList.contains('is-open');
      closeAll(el);
      setOpen(el, open);
    });
    backEl.addEventListener('click', (e) => {
      if (el.dataset.dragged || e.target.closest('a')) return;
      setOpen(el, false);
      btn.focus({ preventScroll: true });
    });
    el.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && el.classList.contains('is-open')) { setOpen(el, false); btn.focus({ preventScroll: true }); return; }
      if (e.target === btn || e.target.classList.contains('sk-link')) nudge(el, e);
    });
  });
  document.addEventListener('pointerdown', (e) => { if (!e.target.closest('.project')) closeAll(null); });

  /* ---------- links and the barcode ---------- */
  ['sk-gh', 'sk-x', 'sk-mail'].forEach((id) => {
    const el = document.getElementById(id);
    el.addEventListener('keydown', (e) => nudge(el, e));
  });

  (function drawBarcode() {
    const svg = document.getElementById('barcode');
    let x = 0;
    const bars = [];
    const bar = (w, h = 40) => { bars.push(`<rect x="${x}" y="0" width="${w}" height="${h}"/>`); x += w; };
    bar(1, 40); x += 1; bar(1, 40); x += 2;
    for (const ch of EMAIL) {
      const c = ch.charCodeAt(0);
      for (let i = 0; i < 3; i++) {
        bar(1 + ((c >> (i * 2)) & 3) % 3, 36);
        x += 1 + ((c >> (i * 2 + 1)) & 1);
      }
    }
    x += 1; bar(1, 40); x += 1; bar(1, 40);
    svg.setAttribute('viewBox', `0 0 ${x} 40`);
    svg.innerHTML = bars.join('');
  })();

  const mail = document.getElementById('sk-mail');
  const mailText = document.getElementById('mail-text');
  let copiedTimer = 0;
  mail.addEventListener('click', async () => {
    if (mail.dataset.dragged) return;
    try {
      await navigator.clipboard.writeText(EMAIL);
      mail.classList.add('is-copied');
      mailText.textContent = 'copied';
      clearTimeout(copiedTimer);
      copiedTimer = setTimeout(() => { mail.classList.remove('is-copied'); mailText.textContent = EMAIL; }, 1600);
    } catch {
      location.href = `mailto:${EMAIL}`;
    }
  });

  /* ---------- put them back ---------- */
  resetBtn.addEventListener('click', () => {
    const d = readStore();
    delete d[mode()];
    writeStore(d);
    stickers.forEach((el) => {
      el.classList.add('is-returning');
      el.style.setProperty('--dx', '0px');
      el.style.setProperty('--dy', '0px');
      el.style.setProperty('--z', el.dataset.baseZ);
      setTimeout(() => el.classList.remove('is-returning'), 700);
    });
    zTop = 10 + order.length;
    updateReset();
  });

  /* ---------- the name: fit the die-cut letters once the display font is in ---------- */
  function fitName() {
    const svg = document.querySelector('.name-svg');
    const text = svg.querySelector('.name-text');
    try {
      const b = text.getBBox();
      if (!b.width) return;
      const pad = 12;
      svg.setAttribute('viewBox', `${(b.x - pad).toFixed(1)} ${(b.y - pad).toFixed(1)} ${(b.width + pad * 2).toFixed(1)} ${(b.height + pad * 2).toFixed(1)}`);
    } catch { /* keep the default box */ }
  }
  fitName();
  if (document.fonts) {
    document.fonts.load('150px "Rubik Mono One"').then(fitName, () => {});
    document.fonts.ready.then(fitName);
  }

  /* ---------- lamp parallax and the holographic sheen (pointer only, not on touch) ---------- */
  if (matchMedia('(hover: hover) and (pointer: fine)').matches && !reduced.matches) {
    let raf = 0, nx = 0, ny = 0;
    addEventListener('pointermove', (e) => {
      nx = (e.clientX / innerWidth - .5) * 2;
      ny = (e.clientY / innerHeight - .5) * 2;
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        const root = document.documentElement.style;
        root.setProperty('--lamp-dx', `${(nx * 6).toFixed(1)}px`);
        root.setProperty('--lamp-dy', `${(ny * 4).toFixed(1)}px`);
        root.setProperty('--holo-angle', `${(20 + nx * 60 + ny * 35).toFixed(1)}deg`);
      });
    }, { passive: true });
  }

  /* ---------- wire up ---------- */
  stickers.forEach(makeDraggable);
  applyStore();
  wide.addEventListener('change', applyStore);
  let resizeTimer = 0;
  addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => stickers.forEach((el) => { if (px(el, '--dx') || px(el, '--dy')) clampIntoLid(el); }), 150);
  });
  document.getElementById('year').textContent = String(new Date().getFullYear());
})();
