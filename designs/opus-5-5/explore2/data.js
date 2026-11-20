// shared content for the round-two sketches. same facts as the live page.
window.DATA = {
  name: 'daymi',
  full: 'daniel kistner',
  bio: 'building stuff, i guess.',
  study: 'applied computer science at hochschule offenburg',
  work: 'working student at frei gmbh',
  does: 'builds things with ai agents, and things for them',
  links: [
    { label: 'github', href: 'https://github.com/itsdaymi' },
    { label: 'x', href: 'https://x.com/itsdaymi' },
    { label: 'daniel@daymi.dev', href: 'mailto:daniel@daymi.dev' },
  ],
  // placeholders, same as the live page
  projects: [
    { name: 'handoff', year: 2026, url: 'https://github.com/itsdaymi/handoff',
      blurb: 'lets one agent pass a half-finished task to another without losing the plot.' },
    { name: 'dry-run', year: 2026, url: 'https://github.com/itsdaymi/dry-run',
      blurb: 'a sandbox where agents rehearse shell commands before touching anything real.' },
    { name: 'tannenbaum', year: 2025, url: 'https://github.com/itsdaymi/tannenbaum',
      blurb: "draws an agent's tool calls as a tree, so you can see where it got lost." },
    { name: 'nachtschicht', year: 2025, url: 'https://github.com/itsdaymi/nachtschicht',
      blurb: 'queues agent jobs overnight and reports in the morning, like a decent colleague.' },
    { name: 'leitplanke', year: 2025, url: 'https://github.com/itsdaymi/leitplanke',
      blurb: 'permission rules for agents, written in plain text a human can check.' },
    { name: 'mensa-bot', year: 2024, url: 'https://github.com/itsdaymi/mensa-bot',
      blurb: 'posts what the offenburg cafeteria serves today. my most used project by far.' },
  ],
};
