/*
 * MOGUL — ui.js
 * All DOM rendering. Builds each tab once, then updates values cheaply each
 * frame. Emits user intents through controller.onAction(action, payload).
 */
(function (root) {
  'use strict';
  var F = root.MOGUL.format;
  var D = root.MOGUL.data;
  var G = root.MOGUL.game;

  var ctrl = null;       // controller from main.js
  var el = {};           // cached top-level elements
  var refs = {};         // per-tab element references
  var built = {};        // which tabs are built
  var activeTab = 'empire';
  var displayedCash = 0; // lerped header value
  var sci = false;       // notation
  var lastRevealCount = 0;

  function $(sel, ctx) { return (ctx || document).querySelector(sel); }
  function ce(tag, cls, html) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (html != null) n.innerHTML = html;
    return n;
  }
  function money(n) { return F.money(n, { sci: sci }); }
  function num(n) { return F.scaled(n, { sci: sci }); }

  // ---------------------------------------------------------------------------
  function init(controller) {
    ctrl = controller;
    el.networth = $('#networth');
    el.rate = $('#rate');
    el.combo = $('#combo');
    el.hustle = $('#hustle');
    el.metaBadges = $('#meta-badges');
    el.investorsBadge = $('#badge-investors');
    el.investorsVal = $('#investors-val');
    el.legacyBadge = $('#badge-legacy');
    el.legacyVal = $('#legacy-val');
    el.multVal = $('#mult-val');
    el.insightBadge = $('#badge-insight');
    el.insightVal = $('#insight-val');
    el.eraChip = $('#era-chip');
    el.tabRnd = $('#tab-rnd');
    el.dotBoard = $('#dot-board');
    el.dotRnd = $('#dot-rnd');
    el.dotTrophies = $('#dot-trophies');
    el.fx = $('#fx');
    el.toastRoot = $('#toast-root');
    el.modalRoot = $('#modal-root');
    el.panels = {};
    document.querySelectorAll('.tab-panel').forEach(function (p) { el.panels[p.getAttribute('data-panel')] = p; });

    // delegated clicks
    $('#app').addEventListener('click', onClick);
    el.fx.addEventListener('click', onClick);
    el.modalRoot.addEventListener('click', onClick);

    var st = ctrl.getState();
    displayedCash = st.cash;
    sci = st.settings.notation === 'scientific';

    switchTab('empire', true);
  }

  function onClick(e) {
    var t = e.target.closest('[data-action]');
    if (!t) return;
    var action = t.getAttribute('data-action');
    var id = t.getAttribute('data-id');
    if (action === 'tab') { switchTab(t.getAttribute('data-tab')); return; }
    if (action === 'noop') return;
    ctrl.onAction(action, {
      id: id,
      amount: t.getAttribute('data-amount'),
      key: t.getAttribute('data-key'),
      val: t.getAttribute('data-val'),
      el: t,
      event: e
    });
  }

  // ---------------------------------------------------------------------------
  function switchTab(name, force) {
    if (!el.panels[name]) return;
    if (name === activeTab && !force) {
      // tapping settings gear when already there: no-op
    }
    activeTab = name;
    Object.keys(el.panels).forEach(function (k) { el.panels[k].hidden = (k !== name); });
    document.querySelectorAll('.tab-btn').forEach(function (b) {
      b.classList.toggle('is-active', b.getAttribute('data-tab') === name);
    });
    built[name] = false; // always rebuild on switch so newly-unlocked content shows
    buildTab(name);
    el.panels[name].scrollTop = 0;
    render(true);
  }

  function refresh() { built[activeTab] = false; buildTab(activeTab); render(true); }
  function invalidate(name) { built[name] = false; if (name === activeTab) { buildTab(name); render(true); } }

  function buildTab(name) {
    if (built[name] && !(name === 'empire' && revealChanged())) return;
    var st = ctrl.getState();
    sci = st.settings.notation === 'scientific';
    if (name === 'empire') buildEmpire(st);
    else if (name === 'upgrades') buildUpgrades(st);
    else if (name === 'rnd') buildRnd(st);
    else if (name === 'board') buildBoard(st);
    else if (name === 'trophies') buildTrophies(st);
    else if (name === 'settings') buildSettings(st);
    built[name] = true;
  }

  function revealChanged() {
    var n = G.revealedBusinesses(ctrl.getState()).length;
    return n !== lastRevealCount;
  }

  // ---------------------------------------------------------------------------
  // EMPIRE
  // ---------------------------------------------------------------------------
  function buildEmpire(st) {
    var panel = el.panels.empire;
    panel.innerHTML = '';
    refs.biz = {};
    refs.boostBtns = {};

    // active boosts (unlocked via R&D) — kept accessible during play
    if (G.boostsUnlocked(st)) {
      var bb = ce('div', 'boost-bar');
      D.BOOSTS.forEach(function (bo) {
        var btn = ce('button', 'boost-btn');
        btn.setAttribute('data-action', 'boost');
        btn.setAttribute('data-id', bo.id);
        btn.innerHTML = '<span class="boost-ico">' + bo.icon + '</span>' +
          '<span class="boost-meta"><b>' + bo.name + '</b><i data-bcd></i></span>' +
          '<span class="boost-cool" data-bcool></span>';
        bb.appendChild(btn);
        refs.boostBtns[bo.id] = { btn: btn, cd: $('[data-bcd]', btn), cool: $('[data-bcool]', btn) };
      });
      panel.appendChild(bb);
    }

    var bar = ce('div', 'buyamount');
    [['1', '×1'], ['10', '×10'], ['100', '×100'], ['max', 'MAX']].forEach(function (a) {
      var b = ce('button', 'ba-btn' + (String(st.settings.buyAmount) === a[0] ? ' is-on' : ''), a[1]);
      b.setAttribute('data-action', 'buyamount');
      b.setAttribute('data-amount', a[0]);
      bar.appendChild(b);
    });
    panel.appendChild(bar);
    refs.buyBar = bar;

    var list = ce('div', 'biz-list');
    var revealed = G.revealedBusinesses(st);
    lastRevealCount = revealed.length;
    revealed.forEach(function (b) { list.appendChild(buildBizCard(b)); });
    panel.appendChild(list);
  }

  function buildBizCard(b) {
    var card = ce('div', 'biz');
    card.setAttribute('data-id', b.id);

    var art = ce('button', 'biz-art');
    art.setAttribute('data-action', 'run');
    art.setAttribute('data-id', b.id);
    art.innerHTML = '<span class="biz-icon">' + b.icon + '</span>' +
      '<span class="biz-owned" data-owned>0</span>' +
      '<span class="biz-artfill" data-artfill></span>';
    card.appendChild(art);

    var body = ce('div', 'biz-body');
    body.innerHTML =
      '<div class="biz-top"><span class="biz-name">' + b.name + '</span>' +
      '<span class="biz-rate" data-rate></span></div>' +
      '<div class="biz-progress"><div class="biz-fill" data-fill></div>' +
      '<span class="biz-payout" data-payout></span></div>' +
      '<div class="biz-bottom">' +
      '<button class="buy-btn" data-action="buy" data-id="' + b.id + '">' +
      '<span class="buy-qty" data-qty>×1</span><span class="buy-cost" data-cost></span>' +
      '<span class="buy-eta" data-eta></span></button>' +
      '<button class="mgr-btn" data-action="manager" data-id="' + b.id + '" data-mgr></button>' +
      '</div>';
    card.appendChild(body);

    refs.biz[b.id] = {
      root: card, art: art,
      owned: $('[data-owned]', art), artfill: $('[data-artfill]', art),
      rate: $('[data-rate]', body), fill: $('[data-fill]', body), payout: $('[data-payout]', body),
      buyBtn: $('.buy-btn', body), qty: $('[data-qty]', body), cost: $('[data-cost]', body),
      eta: $('[data-eta]', body), mgrBtn: $('[data-mgr]', body)
    };
    return card;
  }

  function updateEmpire(st, d) {
    if (revealChanged()) { buildEmpire(st); }
    // buy-amount highlight
    if (refs.buyBar) {
      refs.buyBar.querySelectorAll('.ba-btn').forEach(function (b) {
        b.classList.toggle('is-on', b.getAttribute('data-amount') === String(st.settings.buyAmount));
      });
    }
    var fr = d.franchise || 0;
    var revealed = G.revealedBusinesses(st);
    for (var i = 0; i < revealed.length; i++) {
      var b = revealed[i];
      var r = refs.biz[b.id];
      if (!r) continue;
      var bs = st.businesses[b.id];
      var effRate = bs.manager ? d.incomePerSec[b.id] : (fr > 0 ? d.incomePerSec[b.id] * fr : d.incomePerSec[b.id]);
      r.owned.textContent = num(bs.owned);
      r.rate.textContent = bs.owned > 0 ? F.rate(effRate, { sci: sci }) : '—';
      r.payout.textContent = bs.owned > 0 ? ('+' + money(d.revPerCycle[b.id])) : 'Locked';

      var autoRun = bs.manager || fr > 0;
      var pct = bs.owned > 0 ? Math.min(100, bs.progress * 100) : 0;
      r.fill.style.width = pct + '%';
      r.fill.classList.toggle('is-idle', !autoRun && !bs.running && bs.owned > 0);
      r.artfill.style.height = pct + '%';
      r.art.classList.toggle('runnable', bs.owned > 0 && !autoRun);

      // buy button
      var amount = st.settings.buyAmount;
      var qtyN, cost;
      if (amount === 'max') {
        qtyN = G.maxAffordable(b, bs.owned, st.cash);
        cost = G.bulkCost(b, bs.owned, Math.max(1, qtyN));
        r.qty.textContent = qtyN > 0 ? ('MAX ' + num(qtyN)) : 'MAX';
        cost = qtyN > 0 ? G.bulkCost(b, bs.owned, qtyN) : G.unitCost(b, bs.owned);
      } else {
        qtyN = parseInt(amount, 10);
        cost = G.bulkCost(b, bs.owned, qtyN);
        r.qty.textContent = '×' + qtyN;
      }
      r.cost.textContent = money(cost);
      var affordable = (amount === 'max') ? (qtyN > 0) : (st.cash >= cost);
      r.buyBtn.classList.toggle('cant', !affordable);

      // time-to-afford QoL
      if (!affordable && amount !== 'max') {
        var eta = G.timeToAfford(cost, st.cash, d.managedIncomePerSec);
        r.eta.textContent = (isFinite(eta) && eta > 0) ? ('~' + F.duration(eta)) : '';
      } else {
        r.eta.textContent = '';
      }

      // manager
      if (bs.manager) {
        r.mgrBtn.className = 'mgr-btn is-auto';
        r.mgrBtn.innerHTML = '<span class="auto-dot"></span>AUTO';
        r.mgrBtn.removeAttribute('data-action');
      } else if (bs.owned > 0) {
        r.mgrBtn.className = 'mgr-btn' + (st.cash >= b.managerCost ? '' : ' cant');
        r.mgrBtn.setAttribute('data-action', 'manager');
        r.mgrBtn.innerHTML = '👔 ' + money(b.managerCost);
      } else {
        r.mgrBtn.className = 'mgr-btn hidden';
        r.mgrBtn.innerHTML = '';
      }
    }

    // boost cooldowns
    if (refs.boostBtns) {
      var nowMs = ctrl.now();
      for (var bid in refs.boostBtns) {
        var ref = refs.boostBtns[bid];
        var ready = G.boostReady(st, bid, nowMs);
        var left = G.boostCooldownLeft(st, bid, nowMs);
        ref.btn.classList.toggle('cooling', !ready);
        var bo = G.BOOST_BY_ID[bid];
        ref.cd.textContent = ready ? 'Ready' : F.duration(left);
        var pct = ready ? 0 : Math.min(100, (left / bo.cd) * 100);
        ref.cool.style.width = pct + '%';
      }
    }
  }

  // ---------------------------------------------------------------------------
  // UPGRADES
  // ---------------------------------------------------------------------------
  function buildUpgrades(st) {
    var panel = el.panels.upgrades;
    panel.innerHTML = '';
    refs.up = {};

    var available = [], locked = [], owned = 0;
    D.UPGRADES.forEach(function (u) {
      if (st.upgrades[u.id]) { owned++; return; }
      if (G.isUpgradeUnlocked(st, u)) available.push(u); else locked.push(u);
    });
    // sort available by cost asc, locked by cost asc
    available.sort(function (a, b) { return a.cost - b.cost; });
    locked.sort(function (a, b) { return a.cost - b.cost; });

    panel.appendChild(sectionTitle('Upgrades', owned + ' owned'));
    if (!available.length && !locked.length) {
      panel.appendChild(ce('div', 'empty', 'All upgrades purchased. 👏'));
    }
    var grid = ce('div', 'up-grid');
    available.forEach(function (u) { grid.appendChild(buildUpgradeCard(u, false, st)); });
    locked.slice(0, 8).forEach(function (u) { grid.appendChild(buildUpgradeCard(u, true, st)); });
    panel.appendChild(grid);
  }

  function buildUpgradeCard(u, isLocked, st) {
    var card = ce('div', 'up-card' + (isLocked ? ' locked' : ''));
    var hint = '';
    if (isLocked) {
      if (u.unlock.kind === 'owned') {
        var bn = G.BIZ_BY_ID[u.unlock.target];
        hint = 'Own ' + u.unlock.value + ' ' + (bn ? bn.name : u.unlock.target);
      } else if (u.unlock.kind === 'earnedAll') hint = 'Earn ' + money(u.unlock.value) + ' total';
    }
    card.innerHTML =
      '<div class="up-ico">' + u.icon + '</div>' +
      '<div class="up-main"><div class="up-name">' + u.name + '</div>' +
      '<div class="up-desc">' + u.desc + '</div>' +
      (isLocked ? '<div class="up-hint">🔒 ' + hint + '</div>' : '') + '</div>' +
      (isLocked ? '' : '<button class="up-buy" data-action="upgrade" data-id="' + u.id + '"><span data-cost>' + money(u.cost) + '</span></button>');
    if (!isLocked) refs.up[u.id] = { buy: $('.up-buy', card) };
    return card;
  }

  function updateUpgrades(st) {
    for (var id in refs.up) {
      var u = G.UP_BY_ID[id];
      if (!u || !refs.up[id]) continue;
      refs.up[id].buy.classList.toggle('cant', st.cash < u.cost);
    }
  }

  // ---------------------------------------------------------------------------
  // R&D / INNOVATIONS
  // ---------------------------------------------------------------------------
  function buildRnd(st) {
    var panel = el.panels.rnd;
    panel.innerHTML = '';
    refs.rnd = {};
    var d = ctrl.getDerived();

    var hero = ce('div', 'insight-hero');
    hero.innerHTML =
      '<div class="ih-top"><span class="ih-ico">💡</span>' +
      '<div><div class="ih-title">Research &amp; Development</div>' +
      '<div class="ih-sub">Automated businesses generate Insight — spend it on innovations that change how your empire works.</div></div></div>' +
      '<div class="ih-stats"><div class="ih-stat"><span class="k">Insight</span><b data-insight>' + num(st.insight) + '</b></div>' +
      '<div class="ih-stat"><span class="k">Per second</span><b data-insightrate>' + F.scaled(d.insightPerSec) + '/s</b></div></div>';
    panel.appendChild(hero);
    refs.rnd.insight = $('[data-insight]', hero);
    refs.rnd.insightRate = $('[data-insightrate]', hero);

    panel.appendChild(sectionTitle('Innovations', 'change the rules'));
    var grid = ce('div', 'up-grid');
    var owned = 0;
    D.INNOVATIONS.forEach(function (n) {
      if (st.innovations[n.id]) owned++;
      grid.appendChild(buildInnovationCard(n, st));
    });
    panel.appendChild(grid);
  }

  function buildInnovationCard(n, st) {
    var ownedNode = !!st.innovations[n.id];
    var unlocked = G.isInnovationUnlocked(st, n);
    var card = ce('div', 'up-card innov-card' + (ownedNode ? ' owned' : '') + (!unlocked ? ' locked' : ''));
    var req = '';
    if (!unlocked && n.req) {
      req = '<div class="up-hint">🔒 Requires: ' + n.req.map(function (r) { return G.INNOV_BY_ID[r] ? G.INNOV_BY_ID[r].name : r; }).join(', ') + '</div>';
    }
    card.innerHTML =
      '<div class="up-ico">' + n.icon + '</div>' +
      '<div class="up-main"><div class="up-name">' + n.name + '</div>' +
      '<div class="up-desc">' + n.desc + '</div>' + req + '</div>' +
      (ownedNode ? '<div class="bn-owned">✓</div>'
        : (unlocked ? '<button class="up-buy insight-buy" data-action="innovate" data-id="' + n.id + '"><span class="bn-cost">💡 ' + num(n.cost) + '</span></button>'
          : '<div class="bn-lock">🔒</div>'));
    if (!ownedNode && unlocked) refs.rnd['n_' + n.id] = $('.insight-buy', card);
    return card;
  }

  function updateRnd(st, d) {
    if (!refs.rnd) return;
    if (refs.rnd.insight) refs.rnd.insight.textContent = num(st.insight);
    if (refs.rnd.insightRate) refs.rnd.insightRate.textContent = F.scaled(d.insightPerSec) + '/s';
    for (var key in refs.rnd) {
      if (key.indexOf('n_') !== 0) continue;
      var nid = key.slice(2);
      var n = G.INNOV_BY_ID[nid];
      if (n && refs.rnd[key]) refs.rnd[key].classList.toggle('cant', (st.insight || 0) < n.cost);
    }
  }

  // ---------------------------------------------------------------------------
  // BOARD (IPO + investor tree + Dynasty)
  // ---------------------------------------------------------------------------
  function buildBoard(st) {
    var panel = el.panels.board;
    panel.innerHTML = '';
    refs.board = {};
    var d = ctrl.getDerived();

    // IPO hero
    var pending = G.pendingInvestors(st, d);
    var hero = ce('div', 'ipo-hero');
    hero.innerHTML =
      '<div class="ipo-head"><span class="ipo-emoji">😇</span>' +
      '<div><div class="ipo-title">Go Public</div>' +
      '<div class="ipo-sub">Reset your empire for permanent Investors</div></div></div>' +
      '<div class="ipo-stats">' +
      '<div class="ipo-stat"><span class="k">You hold</span><b>' + num(st.investors) + '</b></div>' +
      '<div class="ipo-stat"><span class="k">IPO grants</span><b class="grant" data-grant>+' + num(pending) + '</b></div>' +
      '<div class="ipo-stat"><span class="k">Investor boost</span><b data-invboost>' + F.mult(d.inv) + '</b></div>' +
      '</div>' +
      '<button class="ipo-btn" data-action="ipo" data-grant>' + (pending >= D.CONFIG.ipoMinInvestors ? 'GO PUBLIC  +' + num(pending) : 'Keep growing…') + '</button>' +
      '<div class="ipo-avail">Available to spend: <b data-avail>' + num(G.boardAvailable(st)) + '</b> investors</div>';
    panel.appendChild(hero);
    refs.board.grant = $('[data-grant]', hero);
    refs.board.ipoBtn = $('.ipo-btn', hero);
    refs.board.avail = $('[data-avail]', hero);
    refs.board.invBoost = $('[data-invboost]', hero);

    // Board upgrade tree
    panel.appendChild(sectionTitle('The Boardroom', 'spend investors'));
    var grid = ce('div', 'board-grid');
    D.BOARD.forEach(function (n) {
      grid.appendChild(buildBoardNode(n, st));
    });
    panel.appendChild(grid);

    // Dynasty
    if (G.dynastyUnlocked(st)) {
      panel.appendChild(buildDynasty(st));
    } else {
      var locked = ce('div', 'dynasty-locked');
      locked.innerHTML = '👑 <b>Dynasty</b> unlocks at ' + num(D.CONFIG.dynastyUnlockInvestors) +
        ' total investors earned.<br><span class="muted">Earned so far: ' + num(st.investorsAllTime) + '</span>';
      panel.appendChild(locked);
    }
  }

  function buildBoardNode(n, st) {
    var ownedNode = !!st.board[n.id];
    var unlocked = G.isBoardUnlocked(st, n);
    var card = ce('div', 'board-node' + (ownedNode ? ' owned' : '') + (!unlocked ? ' locked' : ''));
    var reqText = '';
    if (!unlocked && n.req) {
      reqText = '<div class="bn-req">Requires: ' + n.req.map(function (r) { return G.BOARD_BY_ID[r] ? G.BOARD_BY_ID[r].name : r; }).join(', ') + '</div>';
    }
    card.innerHTML =
      '<div class="bn-ico">' + n.icon + '</div>' +
      '<div class="bn-main"><div class="bn-name">' + n.name + '</div>' +
      '<div class="bn-desc">' + n.desc + '</div>' + reqText + '</div>' +
      (ownedNode ? '<div class="bn-owned">✓</div>'
        : (unlocked ? '<button class="bn-buy" data-action="board" data-id="' + n.id + '"><span class="bn-cost">😇 ' + num(n.cost) + '</span></button>'
          : '<div class="bn-lock">🔒</div>'));
    if (!ownedNode && unlocked) refs.board['node_' + n.id] = $('.bn-buy', card);
    return card;
  }

  function buildDynasty(st) {
    var wrap = ce('div', 'dynasty');
    var pendingLeg = G.pendingLegacy(st);
    wrap.appendChild(sectionTitle('Dynasty', 'prestige II'));
    var hero = ce('div', 'dyn-hero');
    hero.innerHTML =
      '<div class="dyn-head"><span class="dyn-emoji">👑</span>' +
      '<div><div class="ipo-title">Found a Dynasty</div>' +
      '<div class="ipo-sub">Reset investors & board for permanent Legacy</div></div></div>' +
      '<div class="ipo-stats">' +
      '<div class="ipo-stat"><span class="k">Legacy</span><b>' + num(st.legacy) + '</b></div>' +
      '<div class="ipo-stat"><span class="k">Grants</span><b class="grant">+' + num(pendingLeg) + '</b></div>' +
      '<div class="ipo-stat"><span class="k">To spend</span><b>' + num(G.legacyAvailable(st)) + '</b></div>' +
      '</div>' +
      '<button class="dyn-btn" data-action="dynasty">' + (G.canDynasty(st) ? 'FOUND DYNASTY  +' + num(pendingLeg) : 'Earn more investors…') + '</button>';
    wrap.appendChild(hero);
    var grid = ce('div', 'board-grid');
    D.DYNASTY_PERKS.forEach(function (p) {
      var owned = !!st.dynastyPerks[p.id];
      var card = ce('div', 'board-node' + (owned ? ' owned' : ''));
      card.innerHTML = '<div class="bn-ico">' + p.icon + '</div><div class="bn-main"><div class="bn-name">' + p.name + '</div><div class="bn-desc">' + p.desc + '</div></div>' +
        (owned ? '<div class="bn-owned">✓</div>' : '<button class="bn-buy" data-action="perk" data-id="' + p.id + '"><span class="bn-cost">👑 ' + num(p.cost) + '</span></button>');
      grid.appendChild(card);
    });
    wrap.appendChild(grid);
    return wrap;
  }

  function updateBoard(st, d) {
    if (!refs.board) return;
    var pending = G.pendingInvestors(st, d);
    if (refs.board.grant) refs.board.grant.textContent = '+' + num(pending);
    if (refs.board.avail) refs.board.avail.textContent = num(G.boardAvailable(st));
    if (refs.board.invBoost) refs.board.invBoost.textContent = F.mult(d.inv);
    if (refs.board.ipoBtn) {
      refs.board.ipoBtn.classList.toggle('cant', pending < D.CONFIG.ipoMinInvestors);
      refs.board.ipoBtn.textContent = pending >= D.CONFIG.ipoMinInvestors ? ('GO PUBLIC  +' + num(pending)) : 'Keep growing…';
    }
    var avail = G.boardAvailable(st);
    for (var key in refs.board) {
      if (key.indexOf('node_') !== 0) continue;
      var nid = key.slice(5);
      var n = G.BOARD_BY_ID[nid];
      if (n && refs.board[key]) refs.board[key].classList.toggle('cant', avail < n.cost);
    }
  }

  // ---------------------------------------------------------------------------
  // TROPHIES (achievements + stats)
  // ---------------------------------------------------------------------------
  function buildTrophies(st) {
    var panel = el.panels.trophies;
    panel.innerHTML = '';
    var unlocked = 0;
    D.ACHIEVEMENTS.forEach(function (a) { if (st.achievements[a.id]) unlocked++; });

    panel.appendChild(sectionTitle('Trophies', unlocked + ' / ' + D.ACHIEVEMENTS.length));
    var grid = ce('div', 'ach-grid');
    D.ACHIEVEMENTS.forEach(function (a) {
      var got = !!st.achievements[a.id];
      var c = ce('div', 'ach' + (got ? ' got' : ''));
      c.innerHTML = '<div class="ach-ico">' + a.icon + '</div>' +
        '<div class="ach-name">' + a.name + '</div>' +
        '<div class="ach-desc">' + a.desc + '</div>' +
        '<div class="ach-bonus">+' + Math.round((a.bonus - 1) * 100) + '%</div>';
      grid.appendChild(c);
    });
    panel.appendChild(grid);

    panel.appendChild(sectionTitle('Statistics', ''));
    panel.appendChild(buildStats(st));
  }

  function buildStats(st) {
    var d = ctrl.getDerived();
    var totalUnits = 0, managers = 0;
    D.BUSINESSES.forEach(function (b) { totalUnits += st.businesses[b.id].owned; if (st.businesses[b.id].manager) managers++; });
    var innovCount = 0; for (var ik in st.innovations) if (st.innovations[ik]) innovCount++;
    var rows = [
      ['Era', G.currentEra(st).icon + ' ' + G.currentEra(st).name],
      ['Net worth (lifetime)', money(st.earnedAll)],
      ['Cash on hand', money(st.cash)],
      ['Income / sec', F.rate(d.managedIncomePerSec, { sci: sci })],
      ['Global profit multiplier', F.mult(d.globalProfit)],
      ['Businesses owned', num(totalUnits)],
      ['Managers hired', managers + ' / ' + D.BUSINESSES.length],
      ['Investors', num(st.investors)],
      ['IPOs completed', num(st.ipos)],
      ['Legacy', num(st.legacy)],
      ['Dynasties', num(st.dynasties)],
      ['Insight', num(st.insight) + ' (' + F.scaled(d.insightPerSec) + '/s)'],
      ['Innovations', innovCount + ' / ' + D.INNOVATIONS.length],
      ['Opportunities caught', num(st.eventsCaught)],
      ['Total taps', num(st.taps)]
    ];
    var box = ce('div', 'stats');
    rows.forEach(function (r) {
      box.appendChild(ce('div', 'stat-row', '<span>' + r[0] + '</span><b>' + r[1] + '</b>'));
    });
    return box;
  }

  // ---------------------------------------------------------------------------
  // SETTINGS
  // ---------------------------------------------------------------------------
  function buildSettings(st) {
    var panel = el.panels.settings;
    panel.innerHTML = '';
    panel.appendChild(sectionTitle('Settings', ''));

    var box = ce('div', 'settings-box');
    box.appendChild(toggleRow('Sound effects', 'sound', st.settings.sound));
    box.appendChild(toggleRow('Reduce motion', 'reduceMotion', st.settings.reduceMotion));
    box.appendChild(choiceRow('Number format', 'notation', st.settings.notation, [['standard', 'Standard'], ['scientific', 'Scientific']]));
    if (ctrl.getDerived().board.autoBuyer) {
      box.appendChild(toggleRow('Auto-Buyer (buys & hires for you)', 'autoBuyer', st.settings.autoBuyer));
    }
    panel.appendChild(box);

    panel.appendChild(sectionTitle('Save', ''));
    var save = ce('div', 'settings-box');
    save.appendChild(rowBtn('📤 Export save', 'export'));
    save.appendChild(rowBtn('📥 Import save', 'import'));
    save.appendChild(rowBtn('♻️ Hard reset', 'reset', 'danger'));
    panel.appendChild(save);

    panel.appendChild(sectionTitle('Install', ''));
    var inst = ce('div', 'settings-box');
    inst.appendChild(ce('div', 'install-tip',
      'On iPhone: tap the <b>Share</b> icon in Safari, then <b>Add to Home Screen</b> for a full-screen, offline app.'));
    panel.appendChild(inst);

    panel.appendChild(ce('div', 'version', 'MOGUL · v2.0 · made for you'));
  }

  function toggleRow(label, key, on) {
    var row = ce('div', 'setting-row');
    row.innerHTML = '<span>' + label + '</span>' +
      '<button class="switch ' + (on ? 'on' : '') + '" data-action="set" data-key="' + key + '" data-val="' + (on ? '0' : '1') + '"><i></i></button>';
    return row;
  }
  function choiceRow(label, key, cur, opts) {
    var row = ce('div', 'setting-row');
    var seg = '<div class="seg">';
    opts.forEach(function (o) {
      seg += '<button class="seg-btn ' + (cur === o[0] ? 'on' : '') + '" data-action="set" data-key="' + key + '" data-val="' + o[0] + '">' + o[1] + '</button>';
    });
    seg += '</div>';
    row.innerHTML = '<span>' + label + '</span>' + seg;
    return row;
  }
  function rowBtn(label, action, cls) {
    var b = ce('button', 'big-row-btn ' + (cls || ''), label);
    b.setAttribute('data-action', action);
    return b;
  }

  // ---------------------------------------------------------------------------
  // HEADER + FRAME RENDER
  // ---------------------------------------------------------------------------
  function render(immediate) {
    var st = ctrl.getState();
    var d = ctrl.getDerived();
    sci = st.settings.notation === 'scientific';

    // lerp net worth
    if (immediate) displayedCash = st.cash;
    else displayedCash += (st.cash - displayedCash) * 0.28;
    if (Math.abs(st.cash - displayedCash) < 0.5) displayedCash = st.cash;
    el.networth.textContent = money(displayedCash);
    var rateExtra = (d.boomActive ? ' 🚀' : '') + (d.surgeActive ? ' ⚡' : '');
    el.rate.textContent = F.rate(d.managedIncomePerSec, { sci: sci }) + rateExtra;

    // era chip
    var era = G.currentEra(st);
    el.eraChip.hidden = false;
    el.eraChip.textContent = era.icon + '  ' + era.name;

    // combo
    if (st.combo > 1 && (ctrl.now() - st.lastTapAt) < D.CONFIG.comboWindow * 1000) {
      el.combo.hidden = false;
      el.combo.textContent = '🔥 ' + F.mult(G.comboMult(st)) + ' combo';
    } else {
      el.combo.hidden = true;
    }

    // badges
    setBadge(el.investorsBadge, el.investorsVal, st.investors, st.investors > 0 || st.ipos > 0);
    setBadge(el.legacyBadge, el.legacyVal, st.legacy, st.legacy > 0 || st.dynasties > 0);
    var rndOpen = G.innovationsUnlocked(st);
    setBadge(el.insightBadge, el.insightVal, st.insight, rndOpen);
    el.multVal.textContent = F.mult(d.globalProfit);

    // reveal R&D tab once unlocked
    if (el.tabRnd) el.tabRnd.hidden = !rndOpen;

    // attention dots
    el.dotBoard.hidden = !(G.pendingInvestors(st, d) >= D.CONFIG.ipoMinInvestors);
    if (el.dotRnd) el.dotRnd.hidden = !(rndOpen && anyInnovationAffordable(st));

    // active tab values
    if (activeTab === 'empire') updateEmpire(st, d);
    else if (activeTab === 'upgrades') updateUpgrades(st);
    else if (activeTab === 'rnd') updateRnd(st, d);
    else if (activeTab === 'board') updateBoard(st, d);
  }

  function anyInnovationAffordable(st) {
    for (var i = 0; i < D.INNOVATIONS.length; i++) {
      var n = D.INNOVATIONS[i];
      if (!st.innovations[n.id] && G.isInnovationUnlocked(st, n) && (st.insight || 0) >= n.cost) return true;
    }
    return false;
  }

  function setBadge(badge, valEl, value, show) {
    badge.hidden = !show;
    if (show) valEl.textContent = num(value);
  }

  function sectionTitle(title, right) {
    return ce('div', 'section-title', '<span>' + title + '</span>' + (right ? '<span class="st-right">' + right + '</span>' : ''));
  }

  // ---------------------------------------------------------------------------
  // FX: floaters, particles, event token
  // ---------------------------------------------------------------------------
  var reduceMotion = function () { return ctrl.getState().settings.reduceMotion; };
  var activeFloaters = 0;

  function floater(x, y, text, cls) {
    if (reduceMotion() || activeFloaters > 22) return;
    var f = ce('div', 'floater ' + (cls || ''), text);
    f.style.left = x + 'px';
    f.style.top = y + 'px';
    el.fx.appendChild(f);
    activeFloaters++;
    setTimeout(function () { f.remove(); activeFloaters--; }, 1000);
  }

  function burst(x, y, n, color) {
    if (reduceMotion()) return;
    n = n || 10;
    for (var i = 0; i < n; i++) {
      var p = ce('div', 'particle');
      var ang = (Math.PI * 2 * i) / n + Math.random() * 0.6;
      var dist = 28 + Math.random() * 46;
      p.style.left = x + 'px'; p.style.top = y + 'px';
      p.style.setProperty('--dx', Math.cos(ang) * dist + 'px');
      p.style.setProperty('--dy', Math.sin(ang) * dist + 'px');
      if (color) p.style.background = color;
      el.fx.appendChild(p);
      (function (pp) { setTimeout(function () { pp.remove(); }, 720); })(p);
    }
  }

  function hustleFx(value) {
    var rect = el.hustle.getBoundingClientRect();
    var cx = rect.left + rect.width / 2 + (Math.random() * 60 - 30);
    var cy = rect.top + rect.height * 0.42;
    floater(cx, cy, '+' + money(value), 'gold');
    burst(rect.left + rect.width / 2, rect.top + rect.height * 0.5, 8);
  }

  function spawnEventToken(ev, onCatch) {
    var token = ce('button', 'event-token');
    token.setAttribute('data-action', 'eventcatch');
    token.innerHTML = '<span class="et-glow"></span><span class="et-ico">' + ev.icon + '</span>';
    var x = 12 + Math.random() * (window.innerWidth - 84);
    token.style.left = x + 'px';
    token.style.setProperty('--drift', (Math.random() * 40 - 20) + 'px');
    el.fx.appendChild(token);
    token._onCatch = onCatch;
    token._ev = ev;
    var life = D.CONFIG.eventTokenLife * 1000;
    token._timer = setTimeout(function () { token.classList.add('leaving'); setTimeout(function () { token.remove(); }, 400); }, life);
    return token;
  }

  function catchToken(tokenEl) {
    if (!tokenEl || !tokenEl._onCatch) return null;
    clearTimeout(tokenEl._timer);
    var rect = tokenEl.getBoundingClientRect();
    burst(rect.left + rect.width / 2, rect.top + rect.height / 2, 16, '#f3c969');
    var ev = tokenEl._ev;
    var cb = tokenEl._onCatch;
    tokenEl.remove();
    return { ev: ev, cb: cb, x: rect.left + rect.width / 2, y: rect.top };
  }

  // ---------------------------------------------------------------------------
  // TOASTS + MODALS
  // ---------------------------------------------------------------------------
  function toast(msg, kind) {
    // cap concurrent toasts so a burst never covers the screen
    while (el.toastRoot.children.length >= 4) el.toastRoot.removeChild(el.toastRoot.firstChild);
    var t = ce('div', 'toast ' + (kind || ''), msg);
    el.toastRoot.appendChild(t);
    requestAnimationFrame(function () { t.classList.add('show'); });
    setTimeout(function () {
      t.classList.remove('show');
      setTimeout(function () { t.remove(); }, 350);
    }, 2600);
  }

  function closeModal() {
    el.modalRoot.innerHTML = '';
    el.modalRoot.classList.remove('open');
  }

  function modal(innerHTML) {
    el.modalRoot.innerHTML = '<div class="modal-backdrop" data-action="closemodal"></div><div class="modal-card">' + innerHTML + '</div>';
    el.modalRoot.classList.add('open');
    return el.modalRoot;
  }

  function confirmModal(opts) {
    modal(
      '<div class="modal-emoji">' + (opts.emoji || '⚠️') + '</div>' +
      '<h2 class="modal-title">' + opts.title + '</h2>' +
      '<p class="modal-body">' + opts.body + '</p>' +
      '<div class="modal-actions">' +
      '<button class="btn ghost" data-action="closemodal">' + (opts.cancel || 'Cancel') + '</button>' +
      '<button class="btn primary" data-action="modal-confirm">' + (opts.confirm || 'Confirm') + '</button>' +
      '</div>'
    );
    el.modalRoot._confirm = opts.onConfirm;
  }

  function offlineModal(data) {
    var ins = (data.insight > 0) ? ('<div class="offline-insight">+' + F.scaled(data.insight) + ' 💡 Insight</div>') : '';
    modal(
      '<div class="modal-emoji">🌙</div>' +
      '<h2 class="modal-title">Welcome back, Mogul</h2>' +
      '<p class="modal-body">While you were away for <b>' + F.time(data.seconds) + '</b>' +
      (data.capped ? ' <span class="muted">(capped)</span>' : '') +
      ', your empire earned</p>' +
      '<div class="offline-amount">+' + money(data.cash) + '</div>' + ins +
      '<div class="modal-actions"><button class="btn primary wide" data-action="closemodal">Collect</button></div>'
    );
  }

  function eraModal(era) {
    modal(
      '<div class="era-modal-glow"></div>' +
      '<div class="modal-emoji big">' + era.icon + '</div>' +
      '<div class="era-kicker">A NEW ERA</div>' +
      '<h2 class="modal-title">' + era.name + '</h2>' +
      '<p class="modal-body">' + era.blurb + '</p>' +
      (era.bonus > 1 ? '<div class="era-bonus">+' + Math.round((era.bonus - 1) * 100) + '% profit, forever</div>' : '') +
      '<div class="modal-actions"><button class="btn primary wide" data-action="closemodal">Onward</button></div>'
    );
  }

  function pinnacleModal() {
    modal(
      '<div class="era-modal-glow"></div>' +
      '<div class="modal-emoji big">🌌</div>' +
      '<div class="era-kicker">THE PINNACLE</div>' +
      '<h2 class="modal-title">You built the ultimate empire</h2>' +
      '<p class="modal-body">From a single lemonade stand to a force that trades in galaxies. There\'s no higher rung — but the empire is yours to keep growing, forever.</p>' +
      '<div class="era-bonus">🏆 +50% profit — a monument to what you made</div>' +
      '<div class="modal-actions"><button class="btn primary wide" data-action="closemodal">Keep building</button></div>'
    );
  }

  function promptModal(opts) {
    modal(
      '<h2 class="modal-title">' + opts.title + '</h2>' +
      '<p class="modal-body">' + (opts.body || '') + '</p>' +
      '<textarea class="modal-input" id="modal-input" rows="4" placeholder="' + (opts.placeholder || '') + '">' + (opts.value || '') + '</textarea>' +
      '<div class="modal-actions"><button class="btn ghost" data-action="closemodal">Close</button>' +
      (opts.confirm ? '<button class="btn primary" data-action="modal-prompt-ok">' + opts.confirm + '</button>' : '') + '</div>'
    );
    el.modalRoot._promptOk = opts.onConfirm;
    if (opts.selectAll) { var ta = $('#modal-input'); if (ta) { ta.focus(); ta.select(); } }
  }

  function getModalInput() { var ta = $('#modal-input'); return ta ? ta.value : ''; }

  // expose
  root.MOGUL.ui = {
    init: init, render: render, refresh: refresh, invalidate: invalidate, switchTab: switchTab,
    toast: toast, confirmModal: confirmModal, offlineModal: offlineModal, promptModal: promptModal,
    eraModal: eraModal, pinnacleModal: pinnacleModal,
    closeModal: closeModal, getModalInput: getModalInput,
    floater: floater, burst: burst, hustleFx: hustleFx,
    spawnEventToken: spawnEventToken, catchToken: catchToken,
    modalRoot: function () { return el.modalRoot; },
    setSciFromState: function () { sci = ctrl.getState().settings.notation === 'scientific'; }
  };
})(typeof window !== 'undefined' ? window : this);
