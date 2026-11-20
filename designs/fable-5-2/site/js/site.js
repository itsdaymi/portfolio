/* site.js — puts the projects on the page. the forest is in forest.js. */
(() => {
  'use strict';

  const list = document.getElementById('project-list');
  const projects = Array.isArray(window.PROJECTS) ? window.PROJECTS : [];

  const el = (tag, text, cls) => {
    const node = document.createElement(tag);
    if (text != null) node.textContent = text;
    if (cls) node.className = cls;
    return node;
  };

  if (list) {
    projects.forEach((p, i) => {
      const item = el('li', null, 'project');
      item.dataset.clearing = 'grow';
      item.style.setProperty('--i', i);

      const title = el('h3');
      if (p.nameLang) title.lang = p.nameLang; // (so that a screen reader says it as the word it is)
      if (p.url) {
        const link = el('a', p.name);
        link.href = p.url;
        title.append(link);
      } else {
        title.textContent = p.name;
      }

      const meta = [p.lang, p.year].filter(Boolean).join(', ');
      item.append(title, el('p', p.blurb));
      if (meta) item.append(el('p', meta, 'meta'));
      list.append(item);
    });
  }

  // a double click selects the nearest word, however far off it is: out in
  // the trees that picked up some paragraph nearby. only a double click that
  // lands on text selects anything.
  document.addEventListener('mousedown', (e) => {
    if (e.detail < 2 || e.button !== 0) return;
    const walker = document.createTreeWalker(e.target, NodeFilter.SHOW_TEXT);
    const range = document.createRange();
    for (let node = e.target.nodeType === 3 ? e.target : walker.nextNode(); node; node = walker.nextNode()) {
      if (!node.data.trim()) continue;
      range.selectNodeContents(node);
      for (const r of range.getClientRects()) {
        if (e.clientX >= r.left - 6 && e.clientX <= r.right + 6 && e.clientY >= r.top - 4 && e.clientY <= r.bottom + 4) return;
      }
    }
    e.preventDefault();
  });

  const year = document.querySelector('[data-year]');
  if (year) year.textContent = new Date().getFullYear();
})();
