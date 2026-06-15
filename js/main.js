/*
 * MOGUL — main.js
 * Bootstrap, requestAnimationFrame loop, action handling, autosave, offline
 * earnings, market events, auto-buyer. Owns the single source of truth: `state`.
 */
(function (root) {
  'use strict';
  var F = root.MOGUL.format, D = root.MOGUL.data, G = root.MOGUL.game, S = root.MOGUL.state, A = root.MOGUL.audio, UI = root.MOGUL.ui;

  var state = null;
  var derived = null;
  var lastSimPerf = 0;   // performance.now() at last sim step (for dt)
  var lastWall = 0;      // wall clock at last sim step (rAF liveness probe)
  var lastRender = 0;
  var lastSave = 0;      // all throttles use wall time so both drivers agree
  var lastAchCheck = 0;
  var lastAutoBuy = 0;
  var nextEventAt = 0;
  var nextDecisionAt = 0;
  var lastMarketTick = 0;
  var lastAutoInnov = 0;
  var lastAutoIPO = 0;
  var lastAutoChal = 0;
  var offlineResult = null;
  var rndAnnounced = false;
  var marketAnnounced = false;

  function now() { return Date.now(); }

  function boot() {
    var loaded = S.load();
    state = loaded || S.defaultState();

    // offline earnings
    var elapsed = (now() - (state.lastSaveAt || now())) / 1000;
    derived = G.derive(state, now());
    if (elapsed > 30 && derived.managedIncomePerSec > 0) {
      offlineResult = G.applyOffline(state, elapsed, derived);
      derived = G.derive(state, now());
    }

    rndAnnounced = G.innovationsUnlocked(state); // don't re-announce on every load

    // settings -> environment
    A.setEnabled(state.settings.sound);
    document.body.classList.toggle('reduce-motion', state.settings.reduceMotion);
    if (prefersReducedMotion() && !state.settings.reduceMotion) {
      // honor OS preference unless user explicitly turned it off later
      document.body.classList.add('reduce-motion');
    }

    var controller = {
      getState: function () { return state; },
      getDerived: function () { return derived; },
      now: now,
      onAction: onAction
    };
    if (root.MOGUL.skyline) root.MOGUL.skyline.init(controller); // before UI.init (buildEmpire attaches the skyline)
    UI.init(controller);
    window.addEventListener('resize', function () { if (root.MOGUL.skyline) root.MOGUL.skyline.resize(); });
    // Dev/test hooks only on localhost — production ships clean (no cheat surface).
    if (location.hostname === 'localhost' || location.hostname === '127.0.0.1' || location.hostname === '') {
      root.MOGUL.dev = {
        getState: function () { return state; },
        getDerived: function () { return derived; },
        forceEvent: function () { nextEventAt = now(); }
      };
    }

    if (offlineResult && offlineResult.cash > 0) UI.offlineModal(offlineResult);
    else if (!loaded) setTimeout(function () { UI.toast('Tap the gold total — or a business — to earn your first cash 💰', 'gold'); }, 900);

    // hustle (fast taps via pointerdown)
    var hustle = document.getElementById('hustle');
    hustle.addEventListener('pointerdown', onHustle, { passive: true });

    // persistence on background / close (iOS kills tabs)
    document.addEventListener('visibilitychange', function () { if (document.hidden) saveNow(); });
    window.addEventListener('pagehide', saveNow);
    window.addEventListener('blur', saveNow);

    var t0 = now();
    nextEventAt = t0 + rand(D.CONFIG.eventMinGap, D.CONFIG.eventMaxGap) * 1000;
    nextDecisionAt = t0 + rand(D.CONFIG.decisionMinGap, D.CONFIG.decisionMaxGap) * 1000;
    lastSimPerf = perf();
    lastWall = t0; lastSave = t0; lastAchCheck = t0; lastAutoBuy = t0;
    requestAnimationFrame(renderLoop);   // smooth visuals (paused when hidden)
    setInterval(backupTick, 1000);       // keeps the sim alive if rAF is throttled
    registerSW();
  }

  function perf() { return (root.performance && performance.now) ? performance.now() : Date.now(); }
  function prefersReducedMotion() {
    try { return window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) { return false; }
  }
  function rand(a, b) { return a + Math.random() * (b - a); }

  // ---------------------------------------------------------------------------
  // The simulation is decoupled from rendering. rAF drives smooth visuals when
  // the page is visible; a 1s setInterval keeps the sim ticking if rAF is
  // throttled (e.g. backgrounded). Long absences are handled by offline earnings.
  function simStep(dt) {
    if (dt < 0) dt = 0;
    var t = now();
    lastSimPerf = perf();
    lastWall = t;

    derived = G.derive(state, t);
    G.produce(state, dt, derived);

    if (t - lastAchCheck > 1000) {
      lastAchCheck = t;
      var unlocked = G.checkAchievements(state);
      if (unlocked.length) {
        unlocked.forEach(function (a) { UI.toast('🏆 ' + a.name + '  (+' + Math.round((a.bonus - 1) * 100) + '%)', 'gold'); });
        A.play('milestone');
        flashDot('dot-trophies');
        if (currentTabIs('trophies')) UI.invalidate('trophies');
      }
      // phase-shift beats
      var newEra = G.checkEra(state);
      if (newEra) { A.play('ipo'); UI.flash(); UI.goldRain(40); UI.eraModal(newEra); }
      else if (G.checkPinnacle(state)) { A.play('ipo'); UI.flash(); UI.goldRain(120); UI.pinnacleModal(); }
      // R&D unlock moment
      if (!rndAnnounced && G.innovationsUnlocked(state)) {
        rndAnnounced = true;
        UI.toast('💡 R&D unlocked — your managers now generate Insight.', 'gold');
        flashDot('dot-rnd');
      }
      // challenge resolution
      var chalRes = G.checkChallenge(state, t);
      if (chalRes) {
        derived = G.derive(state, t);
        if (chalRes.status === 'completed') { A.play('ipo'); G.checkAchievements(state); celebrate(chalRes.def.icon, 'Challenge complete!'); UI.challengeResultModal(chalRes.def, true); }
        else { A.play('error'); UI.challengeResultModal(chalRes.def, false); }
        if (currentTabIs('empire')) UI.invalidate('empire');
        if (currentTabIs('board')) UI.invalidate('board');
      }
    }

    // boardroom decisions (periodic strategic choices)
    if (t >= nextDecisionAt) {
      var eligible = (state.ipos >= 1 || G.innovationsUnlocked(state)) && !state.activeChallenge && !isModalOpen() && !document.hidden;
      if (eligible) {
        UI.decisionModal(G.pickDecision());
        nextDecisionAt = t + rand(D.CONFIG.decisionMinGap, D.CONFIG.decisionMaxGap) * 1000;
      } else {
        nextDecisionAt = t + 20000; // retry soon when conditions clear
      }
    }

    if (t >= nextEventAt && !document.querySelector('.event-token')) {
      UI.spawnEventToken(pickEvent(), function () {});
      var gap = rand(D.CONFIG.eventMinGap, D.CONFIG.eventMaxGap) * (derived.board.eventFreq || 1) * (derived.innov.eventFreqMult || 1);
      nextEventAt = t + gap * 1000;
    }

    if ((derived.board.autoBuyer || derived.syn.autoBuyer) && state.settings.autoBuyer && t - lastAutoBuy > D.CONFIG.autoBuyInterval * 1000) {
      lastAutoBuy = t;
      autoBuy();
    }

    // The Market — tick prices; announce unlock; auto-trade (Syndicate)
    if (G.marketUnlocked(state)) {
      if (!marketAnnounced) { marketAnnounced = true; UI.toast('📈 The Market is open — buy low, sell high.', 'gold'); flashDot('dot-market'); }
      if (t - lastMarketTick > D.CONFIG.marketTickSec * 1000) {
        lastMarketTick = t;
        var mevt = G.marketTick(state);
        if (mevt) UI.toast(mevt.kind === 'crash' ? '📉 Market crash!' : '📈 Market rally!', mevt.kind === 'rally' ? 'gold' : '');
        if (derived.syn.autoTrade) autoTrade();
      }
    }

    // Syndicate automation
    if (derived.syn.autoInnovate && t - lastAutoInnov > 2000) { lastAutoInnov = t; autoInnovate(); }
    if (derived.syn.autoIPO && t - lastAutoIPO > 5000) { lastAutoIPO = t; autoIPO_maybe(); }
    if (derived.syn.autoChallenge && !state.activeChallenge && t - lastAutoChal > 8000) { lastAutoChal = t; autoChallenge(); }

    if (t - lastSave > 10000) { lastSave = t; saveNow(); }
  }

  function renderLoop() {
    var p = perf();
    var dt = (p - lastSimPerf) / 1000;
    simStep(dt);
    if (p - lastRender > 66) { lastRender = p; UI.render(false); }
    requestAnimationFrame(renderLoop);
  }

  function backupTick() {
    // Only act if rAF hasn't run recently (hidden/throttled tab).
    var gap = (now() - lastWall) / 1000;
    if (gap > 1.5) simStep(gap);
  }

  function saveNow() { if (state) S.save(state); }
  function currentTabIs(name) { var pnl = document.querySelector('.tab-panel[data-panel="' + name + '"]'); return pnl && !pnl.hidden; }
  function isModalOpen() { try { return UI.modalRoot().classList.contains('open'); } catch (e) { return false; } }
  function flashDot(id) { var d = document.getElementById(id); if (d) d.hidden = false; }

  // ---------------------------------------------------------------------------
  var lastHustleTap = 0;
  function onHustle(e) {
    var tn = now();
    if (tn - lastHustleTap < D.CONFIG.tapCooldownMs) return; // click cooldown (caps auto-clickers)
    lastHustleTap = tn;
    A.unlock();
    derived = G.derive(state, tn);
    var res = G.tap(state, derived, tn);
    UI.hustleFx(res.value);
    A.play('tap');
  }

  // ---------------------------------------------------------------------------
  function onAction(action, p) {
    switch (action) {
      case 'run': {
        if (G.runBusiness(state, p.id)) A.play('tap');
        break;
      }
      case 'buy': {
        var amount = state.settings.buyAmount;
        var res = G.buyBusiness(state, p.id, amount);
        if (res.bought > 0) {
          A.play('buy');
          buttonFloat(p.el, '+' + F.scaled(res.bought));
        } else { A.play('error'); }
        break;
      }
      case 'manager': {
        if (G.hireManager(state, p.id)) { A.play('manager'); UI.toast('👔 Manager hired — ' + (G.BIZ_BY_ID[p.id] ? G.BIZ_BY_ID[p.id].name : '') + ' now runs itself.'); }
        else A.play('error');
        break;
      }
      case 'upgrade': {
        if (G.buyUpgrade(state, p.id)) { A.play('upgrade'); UI.invalidate('upgrades'); }
        else A.play('error');
        break;
      }
      case 'board': {
        if (G.buyBoard(state, p.id)) { A.play('upgrade'); UI.invalidate('board'); }
        else A.play('error');
        break;
      }
      case 'perk': {
        if (G.buyDynastyPerk(state, p.id)) { A.play('upgrade'); UI.invalidate('board'); }
        else A.play('error');
        break;
      }
      case 'innovate': {
        if (G.buyInnovation(state, p.id)) {
          A.play('milestone');
          derived = G.derive(state, now());
          var n = G.INNOV_BY_ID[p.id];
          UI.toast('💡 ' + (n ? n.name : 'Innovation') + ' unlocked!', 'gold');
          UI.invalidate('rnd');
        } else A.play('error');
        break;
      }
      case 'boost': {
        var r = G.activateBoost(state, p.id, now(), derived);
        if (r) {
          A.play('event');
          if (r.kind === 'surge') { UI.toast('⚡ Surge! Profit ×' + D.CONFIG.boostSurgeMult + ' for ' + r.dur + 's', 'gold'); UI.burst(window.innerWidth / 2, window.innerHeight * 0.45, 18, '#f3c969'); }
          else if (r.kind === 'injection') { UI.toast('💉 Cash Injection! +' + F.money(r.amount), 'gold'); buttonFloat(p.el, '+' + F.money(r.amount)); }
        } else A.play('error');
        break;
      }
      case 'buyamount': {
        var a = p.amount === 'max' ? 'max' : parseInt(p.amount, 10);
        state.settings.buyAmount = a;
        break;
      }
      case 'enterchal': {
        if (G.enterChallenge(state, p.id, now())) {
          derived = G.derive(state, now());
          A.play('manager');
          var cd = G.CHALLENGE_BY_ID[p.id];
          UI.toast('🎯 Challenge started: ' + (cd ? cd.name : ''), 'gold');
          UI.switchTab('empire', true);
        } else A.play('error');
        break;
      }
      case 'abandonchal': {
        UI.confirmModal({
          emoji: '🏳️', title: 'Abandon Challenge?', body: 'Your empire is restored to a normal run. No reward — but no loss either.',
          confirm: 'Abandon', cancel: 'Keep going',
          onConfirm: function () { G.abandonChallenge(state); derived = G.derive(state, now()); UI.switchTab('empire', true); }
        });
        break;
      }
      case 'decision': {
        var res = G.applyDecision(state, p.id, parseInt(p.el.getAttribute('data-opt'), 10), derived, now());
        UI.closeModal();
        if (res) {
          A.play('event');
          if (res.cash) UI.toast('💵 +' + F.money(res.cash), 'gold');
          else if (res.insight) UI.toast('💡 +' + F.scaled(res.insight) + ' Insight', 'gold');
          else if (res.surge) UI.toast('⚡ Surge for ' + res.surge + 's!', 'gold');
          else if (res.frenzy) UI.toast('🏎️ Frenzy for ' + res.frenzy + 's!', 'gold');
        }
        break;
      }
      case 'buyasset': {
        var frac = UI.getMarketFrac();
        var amt = state.cash * frac;
        var r = G.buyAsset(state, p.id, amt);
        if (r) { A.play('buy'); } else A.play('error');
        break;
      }
      case 'sellasset': {
        var s = G.sellAsset(state, p.id, 'all');
        if (s) { A.play('manager'); buttonFloat(p.el, (s.gain >= 0 ? '+' : '−') + F.money(Math.abs(s.gain))); } else A.play('error');
        break;
      }
      case 'marketfrac': { UI.setMarketFrac(parseFloat(p.amount)); break; }
      case 'syndicate': doSyndicate(); break;
      case 'directive': {
        if (G.buyDirective(state, p.id)) { A.play('upgrade'); derived = G.derive(state, now()); UI.invalidate('board'); UI.invalidate('settings'); }
        else A.play('error');
        break;
      }
      case 'nameempire': {
        UI.promptModal({
          title: 'Name your empire', body: 'What shall history call it?', placeholder: 'e.g. Aurum Holdings',
          value: state.empireName || '', confirm: 'Save', selectAll: true,
          onConfirm: function (val) { state.empireName = S.sanitizeName ? S.sanitizeName(val) : String(val || '').slice(0, 22); UI.invalidate('settings'); saveNow(); }
        });
        break;
      }
      case 'ipo': doIPO(); break;
      case 'dynasty': doDynasty(); break;
      case 'set': onSetting(p.key, p.val); break;
      case 'export': onExport(); break;
      case 'import': onImport(); break;
      case 'reset': onReset(); break;
      case 'eventcatch': onEventCatch(p); break;
      case 'closemodal': UI.closeModal(); break;
      case 'modal-confirm': {
        var fn = UI.modalRoot()._confirm; UI.closeModal(); if (fn) fn();
        break;
      }
      case 'modal-prompt-ok': {
        var ok = UI.modalRoot()._promptOk; var val = UI.getModalInput(); UI.closeModal(); if (ok) ok(val);
        break;
      }
    }
  }

  function buttonFloat(elm, text) {
    if (!elm) return;
    var r = elm.getBoundingClientRect();
    UI.floater(r.left + r.width / 2, r.top, text, 'small');
  }

  // ---------------------------------------------------------------------------
  function doIPO() {
    var pending = G.pendingInvestors(state, derived);
    if (pending < D.CONFIG.ipoMinInvestors) { A.play('error'); UI.toast('Grow your empire more before going public.'); return; }
    UI.confirmModal({
      emoji: '😇',
      title: 'Go Public?',
      body: 'Sell your empire and reset all businesses & cash. You gain <b>+' + F.scaled(pending) + ' Investors</b> for a permanent profit boost.',
      confirm: 'Go Public', cancel: 'Not yet',
      onConfirm: function () {
        var gain = G.doIPO(state, derived);
        derived = G.derive(state, now());
        A.play('ipo');
        celebrate('😇', 'IPO complete! +' + F.scaled(gain) + ' Investors');
        G.checkAchievements(state);
        UI.refresh();
        saveNow();
      }
    });
  }

  function doDynasty() {
    if (!G.canDynasty(state)) { A.play('error'); UI.toast('Not enough investors for a Dynasty yet.'); return; }
    var pending = G.pendingLegacy(state);
    UI.confirmModal({
      emoji: '👑',
      title: 'Found a Dynasty?',
      body: 'A deep reset: lose investors, board upgrades and cash upgrades, but gain <b>+' + F.scaled(pending) + ' Legacy</b> — a permanent, powerful multiplier that persists forever.',
      confirm: 'Found Dynasty', cancel: 'Not yet',
      onConfirm: function () {
        var gain = G.doDynasty(state);
        derived = G.derive(state, now());
        A.play('ipo');
        celebrate('👑', 'Dynasty founded! +' + F.scaled(gain) + ' Legacy');
        G.checkAchievements(state);
        UI.refresh();
        saveNow();
      }
    });
  }

  function doSyndicate() {
    if (!G.canSyndicate(state)) { A.play('error'); UI.toast('Not enough Legacy for a Syndicate yet.'); return; }
    var pending = G.pendingInfluence(state);
    UI.confirmModal({
      emoji: '🕴️',
      title: 'Form a Syndicate?',
      body: 'The deepest reset: dissolve investors, the board, cash upgrades and Legacy. You keep R&D, Challenges and achievements, and gain <b>+' + F.scaled(pending) + ' Influence</b> to spend on automation Directives.',
      confirm: 'Form Syndicate', cancel: 'Not yet',
      onConfirm: function () {
        var gain = G.doSyndicate(state);
        derived = G.derive(state, now());
        A.play('ipo');
        celebrate('🕴️', 'Syndicate formed! +' + F.scaled(gain) + ' Influence');
        G.checkAchievements(state);
        UI.refresh();
        saveNow();
      }
    });
  }

  function celebrate(emoji, msg) {
    UI.toast(emoji + ' ' + msg, 'gold');
    var cx = window.innerWidth / 2, cy = window.innerHeight * 0.4;
    UI.flash();
    UI.burst(cx, cy, 30, '#f3c969');
    UI.burst(cx, cy, 22, '#86f7bd');
    UI.goldRain(54);
  }

  // ---------------------------------------------------------------------------
  function onSetting(key, val) {
    if (key === 'sound') { state.settings.sound = val === '1'; A.setEnabled(state.settings.sound); if (state.settings.sound) A.play('upgrade'); }
    else if (key === 'reduceMotion') { state.settings.reduceMotion = val === '1'; document.body.classList.toggle('reduce-motion', state.settings.reduceMotion); }
    else if (key === 'notation') { state.settings.notation = val === 'scientific' ? 'scientific' : 'standard'; UI.setSciFromState(); }
    else if (key === 'autoBuyer') { state.settings.autoBuyer = val === '1'; }
    else if (key === 'affordableOnly') { state.settings.affordableOnly = val === '1'; }
    UI.invalidate('settings');
    saveNow();
  }

  function onExport() {
    UI.promptModal({ title: 'Export save', body: 'Copy this code somewhere safe. Paste it into Import on any device.', value: S.exportSave(state), selectAll: true });
  }

  function onImport() {
    UI.promptModal({
      title: 'Import save', body: 'Paste a previously exported code. This replaces your current game.',
      placeholder: 'Paste code…', confirm: 'Import',
      onConfirm: function (code) {
        try {
          var loaded = S.importSave(code);
          if (!loaded) throw new Error('bad');
          state = loaded;
          derived = G.derive(state, now());
          A.setEnabled(state.settings.sound);
          document.body.classList.toggle('reduce-motion', state.settings.reduceMotion);
          UI.setSciFromState();
          UI.switchTab('empire', true);
          saveNow();
          UI.toast('✓ Save imported.', 'gold');
        } catch (e) { UI.toast('✗ Invalid save code.'); }
      }
    });
  }

  function onReset() {
    UI.confirmModal({
      emoji: '♻️', title: 'Hard reset?', body: 'This permanently deletes ALL progress and starts a brand-new empire. This cannot be undone.',
      confirm: 'Erase everything', cancel: 'Keep my empire',
      onConfirm: function () {
        state = S.defaultState();
        S.wipe();
        derived = G.derive(state, now());
        UI.switchTab('empire', true);
        saveNow();
        UI.toast('New empire started.');
      }
    });
  }

  // ---------------------------------------------------------------------------
  function pickEvent() {
    var total = 0; D.EVENT_TYPES.forEach(function (e) { total += e.weight; });
    var r = Math.random() * total;
    for (var i = 0; i < D.EVENT_TYPES.length; i++) { r -= D.EVENT_TYPES[i].weight; if (r <= 0) return D.EVENT_TYPES[i]; }
    return D.EVENT_TYPES[0];
  }

  function onEventCatch(p) {
    var tokenEl = p.el && p.el.closest ? p.el.closest('.event-token') : null;
    var caught = UI.catchToken(tokenEl);
    if (!caught) return;
    state.eventsCaught = (state.eventsCaught || 0) + 1;
    var ev = caught.ev;
    var reward = derived.board.eventReward || 1;
    A.play('event');
    if (ev.kind === 'boom') {
      state.eventBoomUntil = now() + D.CONFIG.eventBoomDur * 1000;
      UI.toast('🚀 Market Boom! Profit ×' + D.CONFIG.eventBoomMult + ' for ' + D.CONFIG.eventBoomDur + 's', 'gold');
    } else if (ev.kind === 'frenzy') {
      state.eventFrenzyUntil = now() + D.CONFIG.eventFrenzyDur * 1000;
      UI.toast('⚡ Buying Frenzy! Speed ×' + D.CONFIG.eventFrenzyMult + ' for ' + D.CONFIG.eventFrenzyDur + 's', 'gold');
    } else if (ev.kind === 'windfall') {
      var base = Math.max(derived.managedIncomePerSec, derived.potentialIncomePerSec * 0.5);
      var amount = Math.max(D.CONFIG.eventWindfallFlatMin, base * D.CONFIG.eventWindfallSeconds) * reward;
      G.creditEarnings(state, amount);
      UI.floater(caught.x, caught.y, '+' + F.money(amount), 'gold');
      UI.toast('💵 Cash Windfall! +' + F.money(amount), 'gold');
    } else if (ev.kind === 'investorTip') {
      var g = Math.max(1, Math.round((state.investors || 0) * 0.03));
      state.investors += g; state.investorsAllTime += g;
      UI.toast('😇 Investor Tip! +' + F.scaled(g) + ' Investors', 'gold');
    }
    // Market Intelligence innovation: Opportunities also grant Insight
    var insGain = (derived.innov && derived.innov.eventInsight) ? derived.innov.eventInsight : 0;
    if (insGain > 0 && G.innovationsUnlocked(state)) {
      state.insight = (state.insight || 0) + insGain;
      state.insightTotal = (state.insightTotal || 0) + insGain;
      UI.floater(caught.x, caught.y + 26, '+' + F.scaled(insGain) + ' 💡', 'small');
    }
    saveNow();
  }

  // ---------------------------------------------------------------------------
  function autoBuy() {
    // hire affordable managers (cheapest first)
    var byMgr = D.BUSINESSES.slice().sort(function (a, b) { return a.managerCost - b.managerCost; });
    for (var i = 0; i < byMgr.length; i++) if (G.canManage(state, byMgr[i].id)) G.hireManager(state, byMgr[i].id);
    // buy best marginal-ratio units, bounded
    var revealed = G.revealedBusinesses(state);
    for (var n = 0; n < 40; n++) {
      var best = null, bestRatio = 0;
      for (i = 0; i < revealed.length; i++) {
        var b = revealed[i];
        var owned = state.businesses[b.id].owned;
        var cost = G.unitCost(b, owned);
        if (cost > state.cash) continue;
        var after = (b.baseRevenue * (owned + 1) * G.milestoneProfit(owned + 1)) / Math.max(D.CONFIG.minCycleTime, b.baseTime / G.milestoneSpeed(owned + 1));
        var before = (b.baseRevenue * owned * G.milestoneProfit(owned)) / Math.max(D.CONFIG.minCycleTime, b.baseTime / G.milestoneSpeed(owned));
        var ratio = (after - before) / cost;
        if (ratio > bestRatio) { bestRatio = ratio; best = b; }
      }
      if (!best) break;
      G.buyBusiness(state, best.id, 1);
    }
  }

  // Syndicate automations
  function autoTrade() {
    var assets = state.market && state.market.assets;
    if (!assets) return;
    for (var i = 0; i < D.MARKET_ASSETS.length; i++) {
      var a = D.MARKET_ASSETS[i], as = assets[a.id];
      if (!as) continue;
      if (as.price < a.baseline * 0.85 && state.cash > 1) G.buyAsset(state, a.id, state.cash * 0.05);
      else if (as.shares > 0 && as.price > a.baseline * 1.15) G.sellAsset(state, a.id, 1);
    }
  }
  function autoInnovate() {
    var best = null;
    for (var i = 0; i < D.INNOVATIONS.length; i++) {
      var n = D.INNOVATIONS[i];
      if (!state.innovations[n.id] && G.isInnovationUnlocked(state, n) && (state.insight || 0) >= n.cost) {
        if (!best || n.cost < best.cost) best = n;
      }
    }
    if (best) { G.buyInnovation(state, best.id); derived = G.derive(state, now()); }
  }
  function autoIPO_maybe() {
    var d = G.derive(state, now());
    var pend = G.pendingInvestors(state, d);
    if (pend >= Math.max(2, (state.investors || 0) * 0.5)) { G.doIPO(state, d); derived = G.derive(state, now()); }
  }
  function autoChallenge() {
    for (var i = 0; i < D.CHALLENGES.length; i++) {
      var c = D.CHALLENGES[i];
      if (!(state.completedChallenges && state.completedChallenges[c.id])) {
        state.completedChallenges = state.completedChallenges || {};
        state.completedChallenges[c.id] = true;
        derived = G.derive(state, now());
        G.checkAchievements(state);
        UI.toast('⚔️ Auto-won: ' + c.name + ' — ' + c.rewardDesc, 'gold');
        return;
      }
    }
  }

  // ---------------------------------------------------------------------------
  function registerSW() {
    // Skip on localhost so iterative dev always loads fresh files. Active in production.
    var host = location.hostname;
    if (host === 'localhost' || host === '127.0.0.1' || host === '') return;
    if ('serviceWorker' in navigator) {
      window.addEventListener('load', function () {
        navigator.serviceWorker.register('sw.js').catch(function () { /* offline still works via cache-on-next-load */ });
      });
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})(typeof window !== 'undefined' ? window : this);
