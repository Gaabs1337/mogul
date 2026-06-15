/*
 * MOGUL — skyline.js  (v2, "next level")
 * A layered, living canvas cityscape that grows with your empire and transforms
 * through every era (dawn → golden day → dusk → smog → starlit night → nebula →
 * radiant void). Parallax depth, detailed skyscrapers with antennas + blinking
 * beacons, sun/moon glow with rays, drifting clouds / aurora / nebula, shooting
 * stars, and a subtle wet-street reflection. DPR-crisp, throttled, reduce-motion
 * aware. Public API unchanged: init(controller), attach(canvas), resize().
 */
(function (root) {
  'use strict';
  var G = root.MOGUL.game;

  var ctrl = null, canvas = null, ctx = null;
  var W = 0, H = 0, dpr = 1;
  var layout = null, sig = '', running = false, lastDraw = 0, shootAt = 0;

  // Per-era visual theme.
  // [skyTop, skyBottom, horizonGlow, bodyColor, isNight, starAlpha, sunRays, clouds, aurora, nebula, ringPlanet]
  var THEMES = [
    ['#243a63', '#f0b486', '#ffd9a0', '#ffe7b0', false, 0.06, 1, 2, 0, 0, 0], // 0 dawn
    ['#2f5aa0', '#f6c98e', '#ffe6ad', '#fff0c8', false, 0.05, 1, 3, 0, 0, 0], // 1 morning
    ['#3f7fc4', '#cfe6f5', '#fff8d8', '#fffbe6', false, 0.03, 1, 3, 0, 0, 0], // 2 bright day
    ['#5e4496', '#f0a253', '#ffcf7d', '#ffd98a', false, 0.10, 1, 2, 0, 0, 0], // 3 golden hour
    ['#3e2a72', '#d56a45', '#ff9d5c', '#ffc27a', false, 0.22, 1, 1, 0, 0, 0], // 4 dusk
    ['#2c2440', '#7a5446', '#b98a5e', '#caa37a', false, 0.36, 0, 1, 0, 0, 0], // 5 smoggy dusk
    ['#0a1030', '#1a2348', '#3a5a9a', '#eef3ff', true, 0.85, 0, 0, 1, 0, 0],  // 6 night
    ['#0a0726', '#1c1244', '#4a3a8a', '#efe2ff', true, 1.0, 0, 0, 1, 0, 1],   // 7 deep night
    ['#11052e', '#3a0e5e', '#a04ad0', '#f7c8ff', true, 1.0, 0, 0, 0, 1, 1],   // 8 nebula
    ['#06040f', '#241646', '#caa3ff', '#fff2c8', true, 1.0, 0, 0, 1, 1, 1]    // 9 radiant void
  ];

  function theme(i) { return THEMES[Math.max(0, Math.min(THEMES.length - 1, i))]; }
  function nowTs() { return (root.performance && performance.now) ? performance.now() : 0; }

  function mulberry32(a) {
    return function () {
      a |= 0; a = a + 0x6D2B79F5 | 0;
      var t = Math.imul(a ^ a >>> 15, 1 | a);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }

  function init(controller) { ctrl = controller; }
  function reduceMotion() { try { return ctrl.getState().settings.reduceMotion; } catch (e) { return false; } }

  function attach(el) {
    if (!ctrl || !el) return;
    canvas = el; ctx = canvas.getContext('2d');
    layout = null; sig = '';
    resize();
    if (!running) { running = true; requestAnimationFrame(loop); }
  }

  function resize() {
    if (!canvas || !ctx) return;
    dpr = Math.min(2, root.devicePixelRatio || 1);
    var rect = canvas.getBoundingClientRect();
    W = Math.max(1, Math.floor(rect.width));
    H = Math.max(1, Math.floor(rect.height));
    canvas.width = Math.floor(W * dpr); canvas.height = Math.floor(H * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    sig = ''; rebuildIfNeeded(); draw(nowTs());
  }

  function rebuildIfNeeded() {
    var st = ctrl.getState();
    var units = G.totalUnits(st), era = G.eraIndex(st);
    var bucket = Math.floor(Math.log10(1 + units) * 3);
    var s = era + ':' + bucket + ':' + Math.round(W) + 'x' + Math.round(H);
    if (s === sig) return;
    sig = s;
    buildLayout(st, units, era);
  }

  // ---- layout ----
  function buildBuildingRow(rnd, era, units, opts) {
    // opts: { baseY, maxH, minW, maxW, count, detail(0..1), shadeBase }
    var arr = [], x = -8 - rnd() * 20;
    var i = 0;
    while (x < W + 12 && i < opts.count) {
      var w = opts.minW + rnd() * (opts.maxW - opts.minW);
      var h = (0.34 + rnd() * 0.66) * opts.maxH;
      var b = { x: x, w: w, h: h, shade: opts.shadeBase + Math.floor(rnd() * 10) };
      // setbacks for tall, detailed buildings
      b.tiers = [];
      if (opts.detail > 0.5 && h > opts.maxH * 0.6 && rnd() < 0.6) {
        var tiers = 1 + Math.floor(rnd() * 2), cw = w, ch = 0;
        for (var ti = 0; ti < tiers; ti++) { cw *= (0.62 + rnd() * 0.2); ch += h * (0.16 + rnd() * 0.12); b.tiers.push({ w: cw, h: ch }); }
      }
      // antenna + beacon on tall ones
      b.antenna = opts.detail > 0.4 && h > opts.maxH * 0.7 && rnd() < 0.7 ? (8 + rnd() * 16) : 0;
      b.beacon = b.antenna > 0 || (opts.detail > 0.6 && rnd() < 0.3);
      b.beaconPhase = rnd() * 6.28;
      // windows
      var cols = Math.max(2, Math.floor(w / (8 - opts.detail * 2)));
      var rows = Math.max(2, Math.floor(h / 11));
      var lit = new Uint8Array(cols * rows);
      var litChance = 0.30 + era * 0.045 + opts.detail * 0.06;
      for (var k = 0; k < lit.length; k++) lit[k] = rnd() < litChance ? 1 : 0;
      b.cols = cols; b.rows = rows; b.lit = lit; b.tw = Math.floor(rnd() * 9999);
      arr.push(b);
      x += w + 1 + rnd() * (4 + opts.detail * 6);
      i++;
    }
    return arr;
  }

  function buildLayout(st, units, era) {
    var rnd = mulberry32(917 + era * 13 + Math.floor(Math.log10(1 + units) * 3) * 37);
    var growth = Math.log10(1 + units); // 0..~10+
    var groundY = H - 7;
    var maxH = Math.min(H * 0.9, H * (0.30 + 0.06 * era) + growth * 6);

    var far = buildBuildingRow(rnd, era, units, { maxH: maxH * 0.55, minW: 12, maxW: 24, count: Math.min(40, 12 + Math.floor(growth * 2) + era), detail: 0.1, shadeBase: 16 });
    var mid = buildBuildingRow(rnd, era, units, { maxH: maxH * 0.78, minW: 16, maxW: 30, count: Math.min(34, 9 + Math.floor(growth * 1.6) + era), detail: 0.45, shadeBase: 11 });
    var near = buildBuildingRow(rnd, era, units, { maxH: maxH, minW: 22, maxW: 40, count: Math.min(26, 6 + Math.floor(growth * 1.3) + era), detail: 0.9, shadeBase: 7 });

    var stars = [];
    var sc = Math.floor(90 * theme(era)[5]);
    for (var k = 0; k < sc; k++) stars.push({ x: rnd() * W, y: rnd() * H * 0.72, r: rnd() * 1.4 + 0.25, p: rnd() * 6.28, far: rnd() < 0.6 });

    var clouds = [];
    var nc = theme(era)[7];
    for (var c = 0; c < nc; c++) clouds.push({ x: rnd() * W, y: H * (0.1 + rnd() * 0.28), s: 0.6 + rnd() * 0.8, v: 0.4 + rnd() * 0.5, seed: rnd() });

    var nebula = [];
    if (theme(era)[9]) for (var nb = 0; nb < 4; nb++) nebula.push({ x: rnd() * W, y: rnd() * H * 0.55, r: 50 + rnd() * 90, hue: rnd() });

    layout = {
      era: era, groundY: groundY, maxH: maxH, far: far, mid: mid, near: near,
      stars: stars, clouds: clouds, nebula: nebula,
      bodyX: W * (0.72 + rnd() * 0.16), bodyY: H * (0.2 + rnd() * 0.14), bodyR: theme(era)[4] ? 12 : 17,
      auroraSeed: rnd()
    };
  }

  // ---- loop ----
  function loop(ts) {
    if (!running) return;
    if (!canvas || !canvas.isConnected) { running = false; return; }
    if (ts - lastDraw >= 33 && canvas.offsetParent !== null && !document.hidden) {
      lastDraw = ts; rebuildIfNeeded(); draw(ts);
    }
    requestAnimationFrame(loop);
  }

  // ---- draw ----
  function draw(ts) {
    if (!ctx || !layout) return;
    var era = G.eraIndex(ctrl.getState());
    if (era !== layout.era) { sig = ''; rebuildIfNeeded(); }
    var th = theme(layout.era);
    var still = reduceMotion();
    var clk = still ? 0 : ts * 0.001;

    // sky
    var g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, th[0]); g.addColorStop(0.62, th[1]); g.addColorStop(1, shade(th[1], -18));
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);

    // horizon glow band
    var hg = ctx.createLinearGradient(0, layout.groundY - H * 0.5, 0, layout.groundY);
    hg.addColorStop(0, hexA(th[2], 0)); hg.addColorStop(1, hexA(th[2], 0.5));
    ctx.fillStyle = hg; ctx.fillRect(0, layout.groundY - H * 0.5, W, H * 0.5);

    // nebula
    for (var nb = 0; nb < layout.nebula.length; nb++) {
      var nbo = layout.nebula[nb];
      var dx = still ? 0 : Math.sin(clk * 0.1 + nbo.x) * 6;
      var col = nbo.hue < 0.5 ? '#a23ce0' : '#3c7ce0';
      var rg = ctx.createRadialGradient(nbo.x + dx, nbo.y, 0, nbo.x + dx, nbo.y, nbo.r);
      rg.addColorStop(0, hexA(col, 0.22)); rg.addColorStop(1, hexA(col, 0));
      ctx.fillStyle = rg; ctx.beginPath(); ctx.arc(nbo.x + dx, nbo.y, nbo.r, 0, 7); ctx.fill();
    }

    // aurora
    if (th[8] && !still) drawAurora(clk);

    // stars
    for (var s = 0; s < layout.stars.length; s++) {
      var st2 = layout.stars[s];
      var tw = still ? 0.7 : 0.45 + 0.55 * Math.sin(clk * 1.6 + st2.p);
      ctx.globalAlpha = (0.25 + 0.75 * tw) * th[5];
      ctx.fillStyle = '#fff';
      var dr = st2.far ? 0 : (still ? 0 : Math.sin(clk * 0.05) * 3);
      ctx.fillRect(st2.x + dr, st2.y, st2.r, st2.r);
    }
    ctx.globalAlpha = 1;

    // celestial body (glow + rays + disc)
    drawBody(th, clk, still);

    // clouds (drift)
    for (var c = 0; c < layout.clouds.length; c++) {
      var cl = layout.clouds[c];
      var cx2 = ((cl.x + (still ? 0 : clk * cl.v * 14)) % (W + 160)) - 80;
      drawCloud(cx2, cl.y, cl.s, th);
    }

    // shooting star (night/space)
    if (!still && layout.era >= 6) {
      if (ts > shootAt) { shootAt = ts + 3500 + (layout.auroraSeed * 6000); layout._shoot = { x: (layout.auroraSeed * W) % W, y: layout.bodyY * (0.4 + layout.auroraSeed), t: ts }; }
      if (layout._shoot && ts - layout._shoot.t < 650) {
        var pr = (ts - layout._shoot.t) / 650;
        var sx = layout._shoot.x + pr * 150, sy = layout._shoot.y + pr * 70;
        var gr = ctx.createLinearGradient(sx, sy, sx - 34, sy - 17);
        gr.addColorStop(0, hexA('#ffffff', 0.9 * (1 - pr))); gr.addColorStop(1, hexA('#ffffff', 0));
        ctx.strokeStyle = gr; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(sx - 34, sy - 17); ctx.stroke();
      }
    }

    // building layers (back -> front) with atmospheric haze between
    drawRow(layout.far, th, clk, still, 0.0, 0.45);
    hazeBand(th, 0.16);
    drawRow(layout.mid, th, clk, still, 0.5, 0.75);
    hazeBand(th, 0.08);
    drawRow(layout.near, th, clk, still, 1.0, 1.0);

    // ground + reflection
    var refl = (layout.era >= 4); // wet street from dusk onward
    if (refl) drawReflection(th);
    var gg = ctx.createLinearGradient(0, layout.groundY, 0, H);
    gg.addColorStop(0, refl ? hexA(th[2], 0.22) : '#06070a');
    gg.addColorStop(1, '#05060a');
    ctx.fillStyle = gg; ctx.fillRect(0, layout.groundY, W, H - layout.groundY + 2);

    // vignette
    var vg = ctx.createRadialGradient(W / 2, H * 0.5, H * 0.3, W / 2, H * 0.5, H * 0.9);
    vg.addColorStop(0, 'rgba(0,0,0,0)'); vg.addColorStop(1, 'rgba(0,0,0,0.35)');
    ctx.fillStyle = vg; ctx.fillRect(0, 0, W, H);
  }

  function drawBody(th, clk, still) {
    var bx = layout.bodyX, by = layout.bodyY, br = layout.bodyR;
    var pulse = still ? 1 : 1 + Math.sin(clk * 0.6) * 0.04;
    // outer glow
    var glow = ctx.createRadialGradient(bx, by, 0, bx, by, br * 5.5 * pulse);
    glow.addColorStop(0, hexA(th[3], 0.55)); glow.addColorStop(0.5, hexA(th[3], 0.12)); glow.addColorStop(1, hexA(th[3], 0));
    ctx.fillStyle = glow; ctx.beginPath(); ctx.arc(bx, by, br * 5.5 * pulse, 0, 7); ctx.fill();
    // sun rays (day eras)
    if (th[6] && !still) {
      ctx.save(); ctx.translate(bx, by); ctx.rotate(clk * 0.04);
      for (var r = 0; r < 12; r++) {
        ctx.rotate(Math.PI / 6);
        var rg = ctx.createLinearGradient(0, 0, 0, -br * 5);
        rg.addColorStop(0, hexA(th[3], 0.10)); rg.addColorStop(1, hexA(th[3], 0));
        ctx.fillStyle = rg; ctx.beginPath(); ctx.moveTo(-br * 0.5, 0); ctx.lineTo(br * 0.5, 0); ctx.lineTo(0, -br * 5); ctx.closePath(); ctx.fill();
      }
      ctx.restore();
    }
    // ring planet (cosmic+)
    if (th[10]) {
      ctx.strokeStyle = hexA('#d9c08a', 0.55); ctx.lineWidth = 2;
      ctx.save(); ctx.translate(bx, by); ctx.rotate(-0.5); ctx.scale(1, 0.32);
      ctx.beginPath(); ctx.arc(0, 0, br * 2.1, 0, 7); ctx.stroke(); ctx.restore();
    }
    // disc
    ctx.fillStyle = th[3]; ctx.beginPath(); ctx.arc(bx, by, br, 0, 7); ctx.fill();
    if (th[4]) { // moon crater shadow
      ctx.fillStyle = hexA(th[0], 0.5);
      ctx.beginPath(); ctx.arc(bx + br * 0.42, by - br * 0.25, br * 0.82, 0, 7); ctx.fill();
    }
  }

  function drawAurora(clk) {
    ctx.save(); ctx.globalCompositeOperation = 'screen';
    for (var a = 0; a < 2; a++) {
      var yb = H * (0.16 + a * 0.12), col = a ? '#5cf0c0' : '#7c9cff';
      ctx.beginPath();
      for (var x = 0; x <= W; x += 14) {
        var y = yb + Math.sin(x * 0.02 + clk * 0.5 + a) * 12 + Math.sin(x * 0.05 + clk) * 5;
        x ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
      }
      var lg = ctx.createLinearGradient(0, yb - 26, 0, yb + 26);
      lg.addColorStop(0, hexA(col, 0)); lg.addColorStop(0.5, hexA(col, 0.16 + 0.06 * Math.sin(clk + a))); lg.addColorStop(1, hexA(col, 0));
      ctx.lineWidth = 26; ctx.strokeStyle = lg; ctx.lineCap = 'round'; ctx.stroke();
    }
    ctx.restore();
  }

  function drawCloud(x, y, s, th) {
    ctx.fillStyle = hexA(shade(th[1], 22), 0.5);
    var w = 46 * s, h = 16 * s;
    ctx.beginPath();
    ctx.ellipse(x, y, w * 0.5, h * 0.5, 0, 0, 7);
    ctx.ellipse(x + w * 0.32, y + 2, w * 0.34, h * 0.42, 0, 0, 7);
    ctx.ellipse(x - w * 0.32, y + 2, w * 0.30, h * 0.4, 0, 0, 7);
    ctx.fill();
  }

  function hazeBand(th, alpha) {
    var y = layout.groundY - layout.maxH * 0.5;
    var hg = ctx.createLinearGradient(0, y - 30, 0, y + 40);
    hg.addColorStop(0, hexA(th[2], 0)); hg.addColorStop(1, hexA(th[2], alpha));
    ctx.fillStyle = hg; ctx.fillRect(0, y - 30, W, 70);
  }

  function drawRow(row, th, clk, still, depth, alpha) {
    for (var b = 0; b < row.length; b++) {
      var bd = row[b];
      drawBuilding(bd, th, clk, still, depth, alpha, layout.groundY);
    }
  }

  function drawBuilding(bd, th, clk, still, depth, alpha, groundY) {
    var top = groundY - bd.h;
    // facade gradient (slightly lit toward the sun side)
    var lit = 8 + Math.floor(depth * 14);
    var fg = ctx.createLinearGradient(bd.x, top, bd.x + bd.w, top);
    fg.addColorStop(0, rgb(bd.shade, bd.shade + 3, bd.shade + 9));
    fg.addColorStop(1, rgb(bd.shade + lit, bd.shade + lit + 3, bd.shade + lit + 8));
    ctx.globalAlpha = alpha; ctx.fillStyle = fg;
    ctx.fillRect(bd.x, top, bd.w, bd.h);
    // gold roof edge
    ctx.fillStyle = hexA('#e8c66a', 0.12 + depth * 0.25);
    ctx.fillRect(bd.x, top, bd.w, 1.5);
    // setbacks
    var cy = top;
    for (var t = 0; t < bd.tiers.length; t++) {
      var ti = bd.tiers[t], tx = bd.x + (bd.w - ti.w) / 2, ty = top - ti.h;
      ctx.fillStyle = rgb(bd.shade + 2, bd.shade + 5, bd.shade + 11);
      ctx.fillRect(tx, ty, ti.w, ti.h + 2);
      ctx.fillStyle = hexA('#e8c66a', 0.1 + depth * 0.2);
      ctx.fillRect(tx, ty, ti.w, 1.2);
      cy = ty;
    }
    // antenna + beacon
    if (bd.antenna) {
      var ax = bd.x + bd.w / 2;
      ctx.strokeStyle = rgb(bd.shade + 18, bd.shade + 18, bd.shade + 22); ctx.lineWidth = 1.4;
      ctx.beginPath(); ctx.moveTo(ax, cy); ctx.lineTo(ax, cy - bd.antenna); ctx.stroke();
      cy = cy - bd.antenna;
    }
    if (bd.beacon) {
      var blink = still ? 1 : (0.4 + 0.6 * (Math.sin(clk * 2.2 + bd.beaconPhase) > 0.4 ? 1 : 0.15));
      ctx.globalAlpha = alpha * blink;
      ctx.fillStyle = '#ff5a4a';
      ctx.beginPath(); ctx.arc(bd.x + bd.w / 2, cy - 1, 1.7, 0, 7); ctx.fill();
      ctx.globalAlpha = alpha;
    }
    // windows
    if (depth > 0.05) drawWindows(bd, top, depth, clk, still, alpha);
    ctx.globalAlpha = 1;
  }

  function drawWindows(bd, top, depth, clk, still, alpha) {
    var pad = 3, gw = (bd.w - pad * 2) / bd.cols, gh = (bd.h - pad * 2) / bd.rows;
    if (gw < 1.5 || gh < 2) return;
    var wi = 0, flick = still ? -1 : Math.floor(clk * 2) % 90;
    for (var c = 0; c < bd.cols; c++) for (var r = 0; r < bd.rows; r++) {
      var on = bd.lit[wi];
      if (!still && ((bd.tw + wi) % 90) === flick) on = on ? 0 : 1;
      wi++;
      if (!on) continue;
      var wx = bd.x + pad + c * gw, wy = top + pad + r * gh;
      ctx.fillStyle = hexA('#ffd98a', (0.5 + depth * 0.4) * alpha);
      ctx.fillRect(wx, wy, Math.max(1.4, gw - 2.4), Math.max(1.6, gh - 2.6));
    }
  }

  // faint flipped reflection of the near skyline on a wet ground
  function drawReflection(th) {
    ctx.save();
    ctx.globalAlpha = 0.14;
    ctx.translate(0, layout.groundY * 2);
    ctx.scale(1, -1);
    for (var b = 0; b < layout.near.length; b++) {
      var bd = layout.near[b], top = layout.groundY - bd.h;
      ctx.fillStyle = rgb(bd.shade + 6, bd.shade + 9, bd.shade + 16);
      ctx.fillRect(bd.x, top, bd.w, bd.h * 0.5);
    }
    ctx.restore();
  }

  // ---- color helpers ----
  function clamp255(v) { return v < 0 ? 0 : v > 255 ? 255 : v; }
  function rgb(r, g, b) { return 'rgb(' + clamp255(r) + ',' + clamp255(g) + ',' + clamp255(b) + ')'; }
  function shade(hex, d) {
    var c = parse(hex);
    return rgb(c[0] + d, c[1] + d, c[2] + d);
  }
  function parse(hex) {
    hex = hex.replace('#', '');
    if (hex.length === 3) hex = hex[0] + hex[0] + hex[1] + hex[1] + hex[2] + hex[2];
    return [parseInt(hex.slice(0, 2), 16) || 0, parseInt(hex.slice(2, 4), 16) || 0, parseInt(hex.slice(4, 6), 16) || 0];
  }
  function hexA(hex, a) {
    if (hex.charAt(0) === '#') { var c = parse(hex); return 'rgba(' + c[0] + ',' + c[1] + ',' + c[2] + ',' + a + ')'; }
    return hex;
  }

  root.MOGUL.skyline = { init: init, attach: attach, resize: resize };
})(typeof window !== 'undefined' ? window : this);
