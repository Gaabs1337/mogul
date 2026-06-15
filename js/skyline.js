/*
 * MOGUL — skyline.js
 * A living canvas cityscape that grows with your empire and shifts with each
 * era (dawn -> day -> dusk -> deep space). Decorative, throttled, DPR-crisp,
 * and respectful of reduce-motion / hidden tabs.
 */
(function (root) {
  'use strict';
  var G = root.MOGUL.game;

  var ctrl = null;
  var canvas = null, ctx = null;
  var W = 0, H = 0, dpr = 1;
  var layout = null;       // computed building specs + stars
  var sig = '';            // layout signature (era + unit bucket)
  var running = false;
  var lastDraw = 0;
  var t0ms = 0;            // animation clock origin (set lazily; rAF time used)
  var shootAt = 0;

  // Era -> sky palette [topColor, horizonColor, bodyColor, starAlpha, bodyIsMoon]
  var SKIES = [
    ['#23304f', '#e9a981', '#ffd9a0', 0.10, false], // Street Vendor — dawn
    ['#2d4a7a', '#f1c389', '#ffe2a8', 0.10, false], // Local — morning
    ['#3f73ad', '#bcdcef', '#fff4cf', 0.05, false], // City — bright day
    ['#5b3f86', '#f0a559', '#ffd27a', 0.18, false], // National — golden hour
    ['#3f2a66', '#d06a4a', '#ffc27a', 0.30, false], // Global — dusk
    ['#2e2342', '#7e5446', '#caa37a', 0.45, true],  // Industrialist — smoggy dusk
    ['#0a0e2a', '#171a3a', '#dfe7ff', 0.85, true],  // Space — night
    ['#0a0622', '#1c0e3e', '#e7d6ff', 1.0, true]    // Cosmic — deep space
  ];

  function mulberry32(a) {
    return function () {
      a |= 0; a = a + 0x6D2B79F5 | 0;
      var t = Math.imul(a ^ a >>> 15, 1 | a);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }

  function init(controller) { ctrl = controller; }

  function reduceMotion() {
    try { return ctrl.getState().settings.reduceMotion; } catch (e) { return false; }
  }

  function nowTs() { return (root.performance && performance.now) ? performance.now() : 0; }

  function attach(el) {
    if (!ctrl || !el) return; // controller must be set first
    canvas = el;
    ctx = canvas.getContext('2d');
    layout = null; sig = '';
    resize();                 // sizes the canvas AND paints a static frame
    if (!running) { running = true; requestAnimationFrame(loop); }
  }

  // Resizes the canvas and always paints one static frame (so the city is
  // visible immediately and survives a backgrounded/throttled tab).
  function resize() {
    if (!canvas || !ctx) return;
    dpr = Math.min(2, root.devicePixelRatio || 1);
    var rect = canvas.getBoundingClientRect();
    W = Math.max(1, Math.floor(rect.width));
    H = Math.max(1, Math.floor(rect.height));
    canvas.width = Math.floor(W * dpr);
    canvas.height = Math.floor(H * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    sig = '';                 // force a layout rebuild for the new dimensions
    rebuildIfNeeded();
    draw(nowTs());
  }

  function rebuildIfNeeded() {
    var st = ctrl.getState();
    var units = G.totalUnits(st);
    var era = G.eraIndex(st);
    // bucket units logarithmically so the city only re-grows at meaningful steps
    var bucket = Math.floor(Math.log10(1 + units) * 3);
    var s = era + ':' + bucket + ':' + Math.round(W) + 'x' + Math.round(H);
    if (s === sig) return;
    sig = s;
    buildLayout(st, units, era);
  }

  function buildLayout(st, units, era) {
    var rnd = mulberry32(1234 + era * 7 + Math.floor(Math.log10(1 + units) * 3) * 31);
    var groundY = H - 6;
    var count = Math.min(46, 7 + Math.floor(Math.log10(1 + units) * 4) + era * 2);
    var buildings = [];
    var x = -4;
    var maxH = Math.min(H * 0.82, H * (0.34 + 0.07 * era) + Math.log10(1 + units) * 6);
    while (x < W + 6 && buildings.length < count) {
      var w = 16 + rnd() * 26;
      var h = (0.32 + rnd() * 0.68) * maxH;
      var depth = rnd(); // 0=back .. 1=front
      h *= (0.7 + depth * 0.5);
      var cols = Math.max(2, Math.floor(w / 9));
      var rows = Math.max(2, Math.floor(h / 12));
      var lit = [];
      for (var i = 0; i < cols * rows; i++) lit.push(rnd() < (0.32 + era * 0.05));
      buildings.push({ x: x, w: w, h: h, depth: depth, cols: cols, rows: rows, lit: lit, twk: Math.floor(rnd() * 9999) });
      x += w + 2 + rnd() * 8;
    }
    buildings.sort(function (a, b) { return a.depth - b.depth; }); // back to front
    var stars = [];
    var sc = Math.floor(60 * SKIES[era][3]);
    for (var k = 0; k < sc; k++) stars.push({ x: rnd() * W, y: rnd() * H * 0.7, r: rnd() * 1.3 + 0.2, p: rnd() });
    layout = { buildings: buildings, stars: stars, groundY: groundY, maxH: maxH, era: era, hasRocket: era >= 6 };
  }

  function loop(ts) {
    if (!running) return;
    if (!canvas || !canvas.isConnected) { running = false; return; }
    // throttle ~24fps and skip when not visible / hidden
    if (ts - lastDraw >= 41 && canvas.offsetParent !== null && !document.hidden) {
      lastDraw = ts;
      rebuildIfNeeded();
      draw(ts);
    }
    requestAnimationFrame(loop);
  }

  function draw(ts) {
    if (!ctx || !layout) return;
    var era = G.eraIndex(ctrl.getState());
    if (era !== layout.era) { sig = ''; rebuildIfNeeded(); }
    var sky = SKIES[layout.era];
    var still = reduceMotion();
    var clock = still ? 0 : ts * 0.001;

    // sky
    var g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, sky[0]);
    g.addColorStop(1, sky[1]);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);

    // stars
    for (var s = 0; s < layout.stars.length; s++) {
      var st2 = layout.stars[s];
      var tw = still ? 0.7 : 0.5 + 0.5 * Math.sin(clock * 1.5 + st2.p * 9);
      ctx.globalAlpha = (0.3 + 0.7 * tw) * sky[3] * 1.1;
      ctx.fillStyle = '#fff';
      ctx.fillRect(st2.x, st2.y, st2.r, st2.r);
    }
    ctx.globalAlpha = 1;

    // celestial body
    var bx = W * 0.8, by = H * (sky[4] ? 0.26 : 0.3);
    var br = sky[4] ? 13 : 17;
    var glow = ctx.createRadialGradient(bx, by, 0, bx, by, br * 4);
    glow.addColorStop(0, hexA(sky[2], 0.5));
    glow.addColorStop(1, hexA(sky[2], 0));
    ctx.fillStyle = glow; ctx.beginPath(); ctx.arc(bx, by, br * 4, 0, 7); ctx.fill();
    ctx.fillStyle = sky[2]; ctx.beginPath(); ctx.arc(bx, by, br, 0, 7); ctx.fill();
    if (sky[4]) { // moon crater shadow
      ctx.fillStyle = hexA(sky[0], 0.45);
      ctx.beginPath(); ctx.arc(bx + br * 0.4, by - br * 0.25, br * 0.85, 0, 7); ctx.fill();
    }

    // shooting star at space/cosmic eras
    if (!still && layout.era >= 6) {
      if (ts > shootAt) { shootAt = ts + 4000 + Math.random() * 7000; layout._shoot = { x: Math.random() * W, y: Math.random() * H * 0.4, t: ts }; }
      if (layout._shoot && ts - layout._shoot.t < 700) {
        var pr = (ts - layout._shoot.t) / 700;
        var sxx = layout._shoot.x + pr * 120, syy = layout._shoot.y + pr * 60;
        ctx.strokeStyle = hexA('#ffffff', 1 - pr); ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(sxx, syy); ctx.lineTo(sxx - 26, syy - 13); ctx.stroke();
      }
    }

    // buildings
    for (var b = 0; b < layout.buildings.length; b++) {
      var bd = layout.buildings[b];
      var by0 = layout.groundY - bd.h;
      var shade = 12 + Math.floor(bd.depth * 16);
      ctx.fillStyle = 'rgb(' + (shade) + ',' + (shade + 4) + ',' + (shade + 10) + ')';
      ctx.fillRect(bd.x, by0, bd.w, bd.h);
      // gold roof edge
      ctx.fillStyle = hexA('#e8c66a', 0.18 + bd.depth * 0.2);
      ctx.fillRect(bd.x, by0, bd.w, 1.5);
      // windows
      var pad = 3, gw = (bd.w - pad * 2) / bd.cols, gh = (bd.h - pad * 2) / bd.rows;
      var wi = 0;
      for (var c = 0; c < bd.cols; c++) for (var r = 0; r < bd.rows; r++) {
        var on = bd.lit[wi];
        if (!still && ((bd.twk + wi) % 53 === Math.floor(clock * 2) % 53)) on = !on; // occasional twinkle
        wi++;
        if (!on) continue;
        var wx = bd.x + pad + c * gw, wy = by0 + pad + r * gh;
        ctx.fillStyle = hexA('#ffd98a', 0.55 + bd.depth * 0.35);
        ctx.fillRect(wx, wy, Math.max(1.5, gw - 2.5), Math.max(1.5, gh - 2.5));
      }
    }

    // ground
    ctx.fillStyle = '#06070a';
    ctx.fillRect(0, layout.groundY, W, H - layout.groundY + 2);
  }

  function hexA(hex, a) {
    hex = hex.replace('#', '');
    if (hex.length === 3) hex = hex[0] + hex[0] + hex[1] + hex[1] + hex[2] + hex[2];
    var r = parseInt(hex.slice(0, 2), 16) || 0, g = parseInt(hex.slice(2, 4), 16) || 0, b = parseInt(hex.slice(4, 6), 16) || 0;
    return 'rgba(' + r + ',' + g + ',' + b + ',' + a + ')';
  }

  root.MOGUL.skyline = { init: init, attach: attach, resize: resize };
})(typeof window !== 'undefined' ? window : this);
