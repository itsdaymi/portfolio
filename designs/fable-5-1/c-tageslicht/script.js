/* tageslicht — the page is lit by the sky over stuttgart.
   everything below is derived from the sun's real position (NOAA) for 48.78°N 9.18°E.
   runs in the browser; also loadable in node for verification (no DOM access until the end). */
(function () {
  'use strict';

  var LAT = 48.78, LON = 9.18, TZ = 'Europe/Berlin';
  var MAX_ELEV = 65; // highest the sun gets over stuttgart (june, ~64.7°)

  /* ---------------------------------------------------------------- content */

  var PROJECTS = [
    { name: 'daystack', desc: 'my agent skills. editable copies, installed via skills.sh.', year: 2026, tags: ['skills', 'cli'], link: 'https://github.com/itsdaymi/daystack' },
    { name: 'ledger', desc: 'a small double-entry bookkeeping cli. plain text in, balance sheet out.', year: 2026, tags: ['cli', 'finance'], link: '#' },
    { name: 'pinboard', desc: 'a self-hosted bookmark thing with full-text search. because every other one died.', year: 2025, tags: ['web', 'selfhosted'], link: '#' },
    { name: 'tiles', desc: "a tiling window manager for people who don't want to configure one.", year: 2025, tags: ['desktop', 'rust'], link: '#' },
    { name: 'nachtlicht', desc: 'a tiny status page that turns red when things break.', year: 2024, tags: ['web', 'ops'], link: '#' },
    { name: 'kettle', desc: 'a build tool that only does the three things i use.', year: 2024, tags: ['cli', 'tooling'], link: '#' }
  ];

  // what daymi is probably doing, by stuttgart clock (not by sun: sleep is a clock thing)
  function lineFor(minutes, weekend) {
    var h = minutes / 60;
    if (h < 5.5) return 'daymi is probably asleep. or not.';
    if (h < 9) return 'daymi is probably awake by now.';
    if (h < 18) return weekend ? 'daymi is probably building stuff anyway.' : 'daymi is probably building stuff.';
    if (h < 22) return 'daymi is probably done for today. probably.';
    return 'daymi should probably be asleep.';
  }

  /* ---------------------------------------------------------------- keyframes
     side: which way the text goes. 'light' = light bg, dark text. */

  var KEYS = {
    deepNight: { side: 'dark',  top: '#090B10', bottom: '#12161F', fg: '#D8DBE2', muted: '#8B929F', accent: '#C5CEDF', disc: '#E9EBF0' },
    night:     { side: 'dark',  top: '#0E121B', bottom: '#1B2030', fg: '#DADCE3', muted: '#8F96A4', accent: '#C9D1E2', disc: '#E9EBF0' },
    dawn:      { side: 'dark',  top: '#2A2E3C', bottom: '#4E454C', fg: '#EDE6E6', muted: '#BDB4B8', accent: '#E6B9AE', disc: '#F2D9C9' },
    morning:   { side: 'light', top: '#D9DEE6', bottom: '#F1EEEC', fg: '#22242B', muted: '#585D69', accent: '#8E4E47', disc: '#FFF5E8' },
    noon:      { side: 'light', top: '#CFD9E6', bottom: '#F4F5F6', fg: '#1B1F27', muted: '#545B68', accent: '#3F5878', disc: '#FFFFFF' },
    golden:    { side: 'light', top: '#E2DFDC', bottom: '#F9F0E2', fg: '#2B241C', muted: '#60543F', accent: '#7F470B', disc: '#FFD193' },
    dusk:      { side: 'dark',  top: '#2B2C3A', bottom: '#4F4652', fg: '#E8E2E6', muted: '#C4BBC2', accent: '#E0B4B0', disc: '#E9C6B4' }
  };
  var FLIP_Y = 0.179;     // bg luminance where black and white both reach 4.58:1
  var FLAT_BAND = 0.10;   // gradient collapses to flat within ±this of the flip
  var TARGET = 4.55;      // guard target (hard floor is 4.5)

  /* ---------------------------------------------------------------- color math */

  function hexToRgb(h) {
    h = h.replace('#', '');
    return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
  }
  function rgbToHex(c) {
    return '#' + c.map(function (v) { v = Math.max(0, Math.min(255, Math.round(v))); return (v < 16 ? '0' : '') + v.toString(16); }).join('').toUpperCase();
  }
  function toLin(v) { v /= 255; return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }
  function fromLin(v) { v = Math.max(0, Math.min(1, v)); return v <= 0.0031308 ? v * 12.92 : 1.055 * Math.pow(v, 1 / 2.4) - 0.055; }
  function luminance(rgb) { return 0.2126 * toLin(rgb[0]) + 0.7152 * toLin(rgb[1]) + 0.0722 * toLin(rgb[2]); }
  function contrast(y1, y2) { var a = Math.max(y1, y2) + 0.05, b = Math.min(y1, y2) + 0.05; return a / b; }
  function rgbToLab(rgb) {
    var r = toLin(rgb[0]), g = toLin(rgb[1]), b = toLin(rgb[2]);
    var l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
    var m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
    var s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
    return [0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s,
            1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s,
            0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s];
  }
  function labToRgb(lab) {
    var l = lab[0] + 0.3963377774 * lab[1] + 0.2158037573 * lab[2];
    var m = lab[0] - 0.1055613458 * lab[1] - 0.0638541728 * lab[2];
    var s = lab[0] - 0.0894841775 * lab[1] - 1.2914855480 * lab[2];
    l = l * l * l; m = m * m * m; s = s * s * s;
    return [
      fromLin(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s) * 255,
      fromLin(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s) * 255,
      fromLin(-0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s) * 255
    ];
  }
  function lerp(a, b, t) { return a + (b - a) * t; }
  function mixLab(a, b, t) { return [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)]; }
  function hexLab(h) { return rgbToLab(hexToRgb(h)); }

  // push a text color's lightness away from the bg until it clears TARGET against both stops
  function guard(lab, stopYs, side) {
    function worst(rgb) { var y = luminance(rgb), w = 99; for (var i = 0; i < stopYs.length; i++) w = Math.min(w, contrast(y, stopYs[i])); return w; }
    var rgb = labToRgb(lab);
    if (worst(rgb) >= TARGET) return rgb;
    var lo = lab[0], hi = side === 'light' ? 0 : 1;
    var end = labToRgb([hi, lab[1], lab[2]]);
    if (worst(end) < TARGET) { end = side === 'light' ? [0, 0, 0] : [255, 255, 255]; if (worst(end) < TARGET) return end; }
    var best = end;
    for (var i = 0; i < 20; i++) {
      var mid = (lo + hi) / 2, c = labToRgb([mid, lab[1], lab[2]]);
      if (worst(c) >= TARGET) { hi = mid; best = c; } else { lo = mid; }
    }
    return best;
  }

  /* ---------------------------------------------------------------- astronomy (NOAA) */

  var rad = function (d) { return d * Math.PI / 180; }, deg = function (r) { return r * 180 / Math.PI; };
  function julianDay(ms) { return ms / 86400000 + 2440587.5; }

  function solarParams(ms) {
    var T = (julianDay(ms) - 2451545) / 36525;
    var L0 = (280.46646 + T * (36000.76983 + 0.0003032 * T)) % 360; if (L0 < 0) L0 += 360;
    var M = 357.52911 + T * (35999.05029 - 0.0001537 * T);
    var e = 0.016708634 - T * (0.000042037 + 0.0000001267 * T);
    var Mr = rad(M);
    var C = Math.sin(Mr) * (1.914602 - T * (0.004817 + 0.000014 * T)) + Math.sin(2 * Mr) * (0.019993 - 0.000101 * T) + Math.sin(3 * Mr) * 0.000289;
    var omega = rad(125.04 - 1934.136 * T);
    var lambda = rad(L0 + C - 0.00569 - 0.00478 * Math.sin(omega));
    var eps0 = 23 + (26 + (21.448 - T * (46.815 + T * (0.00059 - T * 0.001813))) / 60) / 60;
    var eps = rad(eps0 + 0.00256 * Math.cos(omega));
    var decl = Math.asin(Math.sin(eps) * Math.sin(lambda));
    var y = Math.tan(eps / 2); y *= y;
    var L0r = rad(L0);
    var eot = 4 * deg(y * Math.sin(2 * L0r) - 2 * e * Math.sin(Mr) + 4 * e * y * Math.sin(Mr) * Math.cos(2 * L0r) - 0.5 * y * y * Math.sin(4 * L0r) - 1.25 * e * e * Math.sin(2 * Mr));
    return { decl: decl, eot: eot };
  }

  // elevation (true + apparent, refraction-corrected) and azimuth of the sun at an instant
  function sunAt(ms) {
    var p = solarParams(ms);
    var utcMin = (((ms % 86400000) + 86400000) % 86400000) / 60000;
    var tst = (utcMin + p.eot + 4 * LON) % 1440; if (tst < 0) tst += 1440;
    var ha = tst / 4 < 0 ? tst / 4 + 180 : tst / 4 - 180;
    var phi = rad(LAT), har = rad(ha);
    var cosZ = Math.sin(phi) * Math.sin(p.decl) + Math.cos(phi) * Math.cos(p.decl) * Math.cos(har);
    var z = Math.acos(Math.max(-1, Math.min(1, cosZ)));
    var elev = 90 - deg(z);
    var denom = Math.cos(phi) * Math.sin(z);
    var azc = denom === 0 ? 0 : deg(Math.acos(Math.max(-1, Math.min(1, (Math.sin(phi) * Math.cos(z) - Math.sin(p.decl)) / denom))));
    var az = ha > 0 ? (azc + 180) % 360 : (540 - azc) % 360;
    var ref = 0;
    if (elev <= 85) {
      var te = Math.tan(rad(elev));
      if (elev > 5) ref = 58.1 / te - 0.07 / Math.pow(te, 3) + 0.000086 / Math.pow(te, 5);
      else if (elev > -0.575) ref = 1735 + elev * (-518.2 + elev * (103.4 + elev * (-12.79 + elev * 0.711)));
      else ref = -20.772 / te;
      ref /= 3600;
    }
    return { elev: elev, apparent: elev + ref, az: az };
  }

  function moonAt(ms) {
    var P = 29.530588853;
    var age = (julianDay(ms) - 2451550.26) % P; if (age < 0) age += P;
    var frac = (1 - Math.cos(2 * Math.PI * age / P)) / 2;
    var names = ['new', 'waxing crescent', 'first quarter', 'waxing gibbous', 'full', 'waning gibbous', 'last quarter', 'waning crescent'];
    return { age: age, frac: frac, waxing: age < P / 2, name: names[Math.round(age / P * 8) % 8] };
  }

  // lit part of the moon as an svg path, radius r, centered on 0,0. northern hemisphere: waxing is lit on the right.
  function moonPath(r, frac, waxing) {
    var k = 1 - 2 * frac, rx = Math.abs(k) * r;
    var outer = waxing ? 1 : 0;
    var term = frac < 0.5 ? (waxing ? 0 : 1) : (waxing ? 1 : 0);
    return 'M0,' + (-r) + ' A' + r + ',' + r + ' 0 0 ' + outer + ' 0,' + r + ' A' + rx.toFixed(2) + ',' + r + ' 0 0 ' + term + ' 0,' + (-r) + ' Z';
  }

  /* ---------------------------------------------------------------- stuttgart clock */

  var dtf = new Intl.DateTimeFormat('en-GB', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', weekday: 'short', hourCycle: 'h23' });
  function berlin(ms) {
    var parts = dtf.formatToParts(new Date(ms)), p = {};
    for (var i = 0; i < parts.length; i++) p[parts[i].type] = parts[i].value;
    return { y: +p.year, mo: +p.month, d: +p.day, H: +p.hour % 24, M: +p.minute, S: +p.second, wd: p.weekday };
  }
  function berlinOffset(ms) {
    var b = berlin(ms);
    return Math.round((Date.UTC(b.y, b.mo - 1, b.d, b.H, b.M, b.S) - Math.floor(ms / 1000) * 1000) / 60000);
  }
  // the instant for a stuttgart wall-clock minute of a given date
  function berlinInstant(y, mo, d, minutes) {
    var naive = Date.UTC(y, mo - 1, d, 0, minutes);
    var off = berlinOffset(naive - 60 * 60000);
    return naive - off * 60000;
  }

  // the day's solar events as stuttgart minutes-of-day
  function dayEvents(y, mo, d) {
    var noon = berlinInstant(y, mo, d, 720), off = berlinOffset(noon);
    var p = solarParams(noon), phi = rad(LAT);
    function ha(zen) {
      var c = Math.cos(rad(zen)) / (Math.cos(phi) * Math.cos(p.decl)) - Math.tan(phi) * Math.tan(p.decl);
      return Math.abs(c) > 1 ? null : deg(Math.acos(c));
    }
    var noonUTC = 720 - 4 * LON - p.eot;
    function ev(h, sign) { return h == null ? null : noonUTC - sign * 4 * h + off; }
    var h0 = ha(90.833), h6 = ha(96), h12 = ha(102);
    var sn = noonUTC + off;
    return {
      solarNoon: sn, solarMidnight: (sn - 720 + 1440) % 1440,
      sunrise: ev(h0, 1), sunset: ev(h0, -1),
      civilDawn: ev(h6, 1), civilDusk: ev(h6, -1),
      nauticalDawn: ev(h12, 1), nauticalDusk: ev(h12, -1)
    };
  }

  function anchorsFor(ev) {
    var sr = ev.sunrise == null ? 480 : ev.sunrise, ss = ev.sunset == null ? 1080 : ev.sunset;
    var a = [
      ['deepNight', ev.solarMidnight],
      ['night', ev.nauticalDawn == null ? sr - 75 : ev.nauticalDawn],
      ['dawn', ev.civilDawn == null ? sr - 35 : ev.civilDawn],
      ['morning', sr + 45],
      ['noon', ev.solarNoon],
      ['golden', ss - 30],
      ['dusk', ev.civilDusk == null ? ss + 35 : ev.civilDusk],
      ['night', ev.nauticalDusk == null ? ss + 75 : ev.nauticalDusk]
    ];
    a.sort(function (p, q) { return p[1] - q[1]; });
    return a;
  }

  function segmentAt(anchors, m) {
    var n = anchors.length;
    for (var i = 0; i < n; i++) {
      var a = anchors[i], b = anchors[(i + 1) % n], am = a[1], bm = b[1], mm = m;
      if (bm <= am) bm += 1440;
      if (mm < am) mm += 1440;
      if (mm >= am && mm < bm) return { a: a[0], b: b[0], t: (mm - am) / (bm - am) };
    }
    return { a: anchors[0][0], b: anchors[0][0], t: 0 };
  }

  /* ---------------------------------------------------------------- the palette at a moment */

  function paletteFor(seg) {
    var A = KEYS[seg.a], B = KEYS[seg.b], t = seg.t;
    var top = mixLab(hexLab(A.top), hexLab(B.top), t);
    var bottom = mixLab(hexLab(A.bottom), hexLab(B.bottom), t);
    var mean = mixLab(top, bottom, 0.5);
    var yMean = luminance(labToRgb(mean));
    var amp = Math.min(1, Math.abs(yMean - FLIP_Y) / FLAT_BAND);
    top = mixLab(mean, top, amp); bottom = mixLab(mean, bottom, amp);
    var side = yMean >= FLIP_Y ? 'light' : 'dark';
    var topRgb = labToRgb(top), bottomRgb = labToRgb(bottom);
    var stopYs = [luminance(topRgb), luminance(bottomRgb)];
    function pick(key) {
      if (A.side === B.side) return mixLab(hexLab(A[key]), hexLab(B[key]), t);
      return hexLab((A.side === side ? A : B)[key]);
    }
    var fg = guard(pick('fg'), stopYs, side), muted = guard(pick('muted'), stopYs, side), accent = guard(pick('accent'), stopYs, side);
    var disc = labToRgb(mixLab(hexLab(A.disc), hexLab(B.disc), t));
    var worst = 99;
    [fg, muted, accent].forEach(function (c) { var y = luminance(c); stopYs.forEach(function (s) { worst = Math.min(worst, contrast(y, s)); }); });
    return {
      top: rgbToHex(topRgb), bottom: rgbToHex(bottomRgb), fg: rgbToHex(fg), muted: rgbToHex(muted), accent: rgbToHex(accent), disc: rgbToHex(disc),
      side: side, yMean: yMean, worst: worst, seg: seg
    };
  }

  // everything the page needs for one stuttgart instant
  function stateAt(ms, dateOverride) {
    var b = berlin(ms);
    var y = dateOverride ? dateOverride.y : b.y, mo = dateOverride ? dateOverride.mo : b.mo, d = dateOverride ? dateOverride.d : b.d;
    var minutes = b.H * 60 + b.M;
    var ev = dayEvents(y, mo, d);
    var anchors = anchorsFor(ev);
    var pal = paletteFor(segmentAt(anchors, minutes));
    var sun = sunAt(ms), moon = moonAt(ms);
    return { ms: ms, minutes: minutes, berlin: b, events: ev, anchors: anchors, palette: pal, sun: sun, moon: moon,
             weekend: b.wd === 'Sat' || b.wd === 'Sun' };
  }

  var api = { sunAt: sunAt, moonAt: moonAt, moonPath: moonPath, dayEvents: dayEvents, anchorsFor: anchorsFor, segmentAt: segmentAt,
              paletteFor: paletteFor, stateAt: stateAt, berlin: berlin, berlinInstant: berlinInstant, KEYS: KEYS, luminance: luminance,
              contrast: contrast, hexToRgb: hexToRgb, lineFor: lineFor, PROJECTS: PROJECTS };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof document === 'undefined') return;
  window.tageslicht = api;

  /* ================================================================ DOM */

  var root = document.documentElement;
  var reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var canAnimate = !reduce && typeof CSS !== 'undefined' && CSS.registerProperty;
  var $ = function (s) { return document.querySelector(s); };

  var params = new URLSearchParams(location.search);
  var dateOverride = null;
  if (params.get('d')) { var dm = /^(\d{4})-(\d{2})-(\d{2})$/.exec(params.get('d')); if (dm) dateOverride = { y: +dm[1], mo: +dm[2], d: +dm[3] }; }
  var scrubMinutes = null;
  if (params.get('t')) { var tm = /^(\d{1,2}):(\d{2})$/.exec(params.get('t')); if (tm) scrubMinutes = Math.min(1439, (+tm[1]) * 60 + (+tm[2])); }

  var el = {
    time: $('#live-time'), when: $('#live-when'), what: $('#live-what'),
    scrub: $('#scrub'), arcDay: $('#arc-day'), arcNight: $('#arc-night'), horizon: $('#horizon'), dot: $('#dot'), ring: $('#dot-ring'),
    readout: $('#readout'), hint: $('#hint'), now: $('#now'),
    moonLit: $('#moon-lit'), favicon: $('#favicon'), theme: $('#theme-color'),
    projects: $('#projects'), year: $('#year'), copy: $('#copy'), status: $('#status')
  };

  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function hhmm(min) { return pad(Math.floor(min / 60) % 24) + ':' + pad(min % 60); }

  // the instant to show: live, or a scrubbed stuttgart minute of the (possibly overridden) day
  function currentInstant() {
    var now = Date.now();
    var b = berlin(now);
    var y = dateOverride ? dateOverride.y : b.y, mo = dateOverride ? dateOverride.mo : b.mo, d = dateOverride ? dateOverride.d : b.d;
    if (scrubMinutes == null && !dateOverride) return now;
    var m = scrubMinutes == null ? b.H * 60 + b.M : scrubMinutes;
    return berlinInstant(y, mo, d, m) + (scrubMinutes == null ? b.S * 1000 : 0);
  }

  var hintUsed = false;
  var lastSide = null;

  function render(ms, opts) {
    opts = opts || {};
    var s = stateAt(ms, dateOverride);
    var p = s.palette;
    var scrubbed = scrubMinutes != null;

    // palette → css. a side flip (dark↔light text) must not ease, or the text passes through grey.
    var flip = lastSide != null && lastSide !== p.side;
    lastSide = p.side;
    var ms_ = (opts.instant || flip || !canAnimate) ? '0ms' : (opts.duration || '2000ms');
    root.style.setProperty('--tint-ms', ms_);
    root.style.setProperty('--bg-top', p.top);
    root.style.setProperty('--bg-bottom', p.bottom);
    root.style.setProperty('--fg', p.fg);
    root.style.setProperty('--muted', p.muted);
    root.style.setProperty('--accent', p.accent);
    root.style.setProperty('--disc', p.disc);
    root.dataset.side = p.side;

    // sun and moon discs. the moon rides the anti-solar arc (where a full moon would be); its phase is real.
    var sun = s.sun;
    var sunX = Math.max(0, Math.min(1, (sun.az - 90) / 180));
    var sunE = Math.max(-0.35, Math.min(1, sun.elev / MAX_ELEV));
    var sunA = Math.max(0, Math.min(1, (sun.elev + 5) / 6));
    var maz = (sun.az + 180) % 360;
    var moonX = Math.max(0, Math.min(1, (maz - 90) / 180));
    var moonE = Math.max(-0.35, Math.min(1, -sun.elev / MAX_ELEV));
    var moonA = Math.max(0, Math.min(1, (-3 - sun.elev) / 5));
    root.style.setProperty('--sun-x', sunX.toFixed(4));
    root.style.setProperty('--sun-e', sunE.toFixed(4));
    root.style.setProperty('--sun-a', sunA.toFixed(3));
    root.style.setProperty('--moon-x', moonX.toFixed(4));
    root.style.setProperty('--moon-e', moonE.toFixed(4));
    root.style.setProperty('--moon-a', moonA.toFixed(3));
    el.moonLit.setAttribute('d', moonPath(8, s.moon.frac, s.moon.waxing));

    // words
    var t = hhmm(s.minutes);
    el.time.textContent = t;
    el.time.setAttribute('datetime', t);
    el.when.firstChild.nodeValue = scrubbed ? 'at ' : "it's ";
    el.when.lastChild.nodeValue = scrubbed ? ' in stuttgart,' : ' in stuttgart.';
    el.what.textContent = lineFor(s.minutes, s.weekend);

    var e = Math.round(sun.apparent), read;
    if (Math.abs(sun.apparent) < 0.5) read = 'sun on the horizon';
    else read = 'sun ' + Math.abs(e) + '° ' + (e > 0 ? 'above' : 'below') + ' the horizon';
    if (sun.elev < -6) read += '. ' + s.moon.name + ' moon';
    el.readout.textContent = read + '.';

    // scrubber
    if (!opts.fromInput) el.scrub.value = s.minutes;
    el.scrub.setAttribute('aria-valuetext', t + ' in stuttgart, ' + read);
    var dx = s.minutes, dy = 60 - sun.elev * (48 / MAX_ELEV);
    el.dot.setAttribute('d', 'M' + dx + ',' + dy.toFixed(2) + 'h0');
    el.ring.setAttribute('d', 'M' + dx + ',' + dy.toFixed(2) + 'h0');
    root.classList.toggle('is-scrubbed', scrubbed);
    el.now.hidden = !scrubbed;
    el.hint.hidden = scrubbed || hintUsed;

    // favicon + theme-color follow the sky
    el.theme.setAttribute('content', p.top);
    var icon = "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'><rect width='64' height='64' rx='16' fill='" + p.top + "'/>";
    if (sun.elev > -4) icon += "<circle cx='32' cy='32' r='12' fill='" + (p.side === 'light' ? p.accent : p.disc) + "'/>";
    else icon += "<g transform='translate(32 32)'><circle r='12' fill='" + p.bottom + "'/><path d='" + moonPath(12, s.moon.frac, s.moon.waxing) + "' fill='" + p.disc + "'/></g>";
    icon += '</svg>';
    el.favicon.setAttribute('href', 'data:image/svg+xml,' + encodeURIComponent(icon));
    return s;
  }

  // today's sun curve for the scrubber, split at the horizon
  function drawArc(ms) {
    var b = berlin(ms);
    var y = dateOverride ? dateOverride.y : b.y, mo = dateOverride ? dateOverride.mo : b.mo, d = dateOverride ? dateOverride.d : b.d;
    var pts = [];
    for (var m = 0; m <= 1440; m += 10) pts.push([m, sunAt(berlinInstant(y, mo, d, m)).elev]);
    var day = '', night = '', prev = null;
    function Y(e) { return (60 - e * (48 / MAX_ELEV)).toFixed(2); }
    function add(above, cmd, x, e) { var s = cmd + x + ',' + Y(e); if (above) day += s; else night += s; }
    for (var i = 0; i < pts.length; i++) {
      var x = pts[i][0], e = pts[i][1], above = e >= 0;
      if (prev === null) add(above, 'M', x, e);
      else if (prev[2] !== above) { // crossed the horizon: end one path there, start the other
        var f = (0 - prev[1]) / (e - prev[1]), cx = +(prev[0] + (x - prev[0]) * f).toFixed(1);
        add(prev[2], 'L', cx, 0);
        add(above, 'M', cx, 0);
        add(above, 'L', x, e);
      } else add(above, 'L', x, e);
      prev = [x, e, above];
    }
    el.arcDay.setAttribute('d', day);
    el.arcNight.setAttribute('d', night);
  }

  /* ---------------------------------------------------------------- projects */

  var frag = document.createDocumentFragment();
  PROJECTS.forEach(function (pr) {
    var li = document.createElement('li'); li.className = 'project';
    var h = document.createElement('h3'), a = document.createElement('a');
    a.href = pr.link; a.textContent = pr.name;
    if (/^https?:/.test(pr.link)) { a.rel = 'noopener'; }
    h.appendChild(a);
    var p = document.createElement('p'); p.textContent = pr.desc;
    var meta = document.createElement('p'); meta.className = 'meta';
    var yr = document.createElement('span'); yr.textContent = pr.year;
    var tg = document.createElement('span'); tg.textContent = pr.tags.join(', ');
    meta.appendChild(yr); meta.appendChild(tg);
    li.appendChild(h); li.appendChild(p); li.appendChild(meta);
    frag.appendChild(li);
  });
  el.projects.appendChild(frag);
  el.year.textContent = berlin(Date.now()).y;

  /* ---------------------------------------------------------------- interaction */

  el.scrub.addEventListener('input', function () {
    scrubMinutes = +el.scrub.value;
    hintUsed = true;
    render(currentInstant(), { instant: true, fromInput: true });
  });
  el.now.addEventListener('click', function () {
    scrubMinutes = null;
    render(currentInstant(), { duration: '900ms' });
    el.scrub.focus({ preventScroll: true });
  });

  el.copy.addEventListener('click', function () {
    var addr = 'daniel@daymi.dev';
    function done() { el.copy.textContent = 'copied'; el.status.textContent = 'copied ' + addr; setTimeout(function () { el.copy.textContent = 'copy'; el.status.textContent = ''; }, 2400); }
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(addr).then(done, function () { location.href = 'mailto:' + addr; });
    else location.href = 'mailto:' + addr;
  });

  /* ---------------------------------------------------------------- clock */

  var tickTimer = null;
  function schedule() {
    clearTimeout(tickTimer);
    var wait = 60000 - (Date.now() % 60000) + 80;
    tickTimer = setTimeout(function () { if (scrubMinutes == null) render(currentInstant()); schedule(); }, wait);
  }
  document.addEventListener('visibilitychange', function () { if (!document.hidden && scrubMinutes == null) { render(currentInstant()); schedule(); } });

  /* ---------------------------------------------------------------- first light */

  drawArc(currentInstant());
  if (canAnimate && scrubMinutes == null) {
    // the sky settles from flat to its gradient, once.
    var s0 = stateAt(currentInstant(), dateOverride).palette;
    var A = hexLab(s0.top), B = hexLab(s0.bottom), flat = rgbToHex(labToRgb(mixLab(A, B, 0.5)));
    root.style.setProperty('--tint-ms', '0ms');
    root.style.setProperty('--bg-top', flat);
    root.style.setProperty('--bg-bottom', flat);
    root.style.setProperty('--sun-a', '0'); root.style.setProperty('--moon-a', '0');
    void getComputedStyle(root).getPropertyValue('--bg-top');
    requestAnimationFrame(function () { requestAnimationFrame(function () { render(currentInstant(), { duration: '900ms' }); }); });
  } else {
    render(currentInstant(), { instant: true });
  }
  schedule();

  // the name arrives when its font does (or after 700 ms, whichever first)
  var shown = false;
  function showName() { if (shown) return; shown = true; root.classList.remove('is-loading'); }
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(showName);
  setTimeout(showName, 700);
})();
