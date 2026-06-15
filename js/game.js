/*
 * MOGUL — game.js
 * Pure game math + state-mutating actions. No DOM. Exported for Node tests.
 *
 * Time-dependent functions take an explicit `nowMs` so they stay deterministic
 * and testable (events/combo decay).
 */
(function (root, factory) {
  'use strict';
  var data = (typeof module !== 'undefined' && module.exports)
    ? require('./data')
    : root.MOGUL.data;
  var api = factory(data);
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.MOGUL = root.MOGUL || {};
  root.MOGUL.game = api;
})(typeof window !== 'undefined' ? window : globalThis, function (data) {
  'use strict';

  var CONFIG = data.CONFIG;
  var BUSINESSES = data.BUSINESSES;
  var MILESTONES = data.MILESTONES;
  var UPGRADES = data.UPGRADES;
  var BOARD = data.BOARD;
  var DYNASTY_PERKS = data.DYNASTY_PERKS;
  var ACHIEVEMENTS = data.ACHIEVEMENTS;
  var INNOVATIONS = data.INNOVATIONS;
  var BOOSTS = data.BOOSTS;
  var ERAS = data.ERAS;
  var CHALLENGES = data.CHALLENGES;
  var DECISIONS = data.DECISIONS;

  // Quick lookup maps.
  var BIZ_BY_ID = {};
  BUSINESSES.forEach(function (b, i) { b._index = i; BIZ_BY_ID[b.id] = b; });
  var UP_BY_ID = {};
  UPGRADES.forEach(function (u) { UP_BY_ID[u.id] = u; });
  var BOARD_BY_ID = {};
  BOARD.forEach(function (n) { BOARD_BY_ID[n.id] = n; });
  var PERK_BY_ID = {};
  DYNASTY_PERKS.forEach(function (p) { PERK_BY_ID[p.id] = p; });
  var INNOV_BY_ID = {};
  INNOVATIONS.forEach(function (n) { INNOV_BY_ID[n.id] = n; });
  var BOOST_BY_ID = {};
  BOOSTS.forEach(function (b) { BOOST_BY_ID[b.id] = b; });
  var CHALLENGE_BY_ID = {};
  CHALLENGES.forEach(function (c) { CHALLENGE_BY_ID[c.id] = c; });
  var DECISION_BY_ID = {};
  DECISIONS.forEach(function (d) { DECISION_BY_ID[d.id] = d; });

  // ---------------------------------------------------------------------------
  // Cost curves
  // ---------------------------------------------------------------------------
  function unitCost(b, owned) {
    return b.baseCost * Math.pow(b.costRate, owned);
  }

  function bulkCost(b, owned, qty) {
    if (qty <= 0) return 0;
    var r = b.costRate;
    var first = b.baseCost * Math.pow(r, owned);
    if (r === 1) return first * qty;
    return first * (Math.pow(r, qty) - 1) / (r - 1);
  }

  function maxAffordable(b, owned, cash) {
    if (cash <= 0) return 0;
    var r = b.costRate;
    var first = b.baseCost * Math.pow(r, owned);
    if (cash < first) return 0;
    var inside = 1 + (cash * (r - 1)) / first;
    var q = Math.floor(Math.log(inside) / Math.log(r));
    if (!isFinite(q) || q < 0) return 0;
    if (q > 1e7) q = 1e7; // sanity cap
    // correct any floating-point overshoot/undershoot
    while (q > 0 && bulkCost(b, owned, q) > cash) q--;
    while (bulkCost(b, owned, q + 1) <= cash) q++;
    return q;
  }

  // ---------------------------------------------------------------------------
  // Milestones (per business, by owned count)
  // ---------------------------------------------------------------------------
  function milestoneProfit(owned) {
    var m = 1;
    for (var i = 0; i < MILESTONES.length; i++) {
      if (owned >= MILESTONES[i].at && MILESTONES[i].profit) m *= MILESTONES[i].profit;
    }
    if (owned > 1000) {
      var extra = Math.floor((owned - 1000) / data.MILESTONE_REPEAT_STEP);
      if (extra > 0) m *= Math.pow(data.MILESTONE_REPEAT_PROFIT, extra);
    }
    return m;
  }

  function milestoneSpeed(owned) {
    var s = 1;
    for (var i = 0; i < MILESTONES.length; i++) {
      if (owned >= MILESTONES[i].at && MILESTONES[i].speed) s *= MILESTONES[i].speed;
    }
    return s;
  }

  // Next milestone threshold (for the progress UI), including endless repeats.
  function nextMilestone(owned) {
    for (var i = 0; i < MILESTONES.length; i++) {
      if (owned < MILESTONES[i].at) return { at: MILESTONES[i].at, profit: MILESTONES[i].profit, speed: MILESTONES[i].speed };
    }
    var step = data.MILESTONE_REPEAT_STEP;
    var nextAt = 1000 + (Math.floor((owned - 1000) / step) + 1) * step;
    return { at: nextAt, profit: data.MILESTONE_REPEAT_PROFIT };
  }

  // ---------------------------------------------------------------------------
  // Derived multipliers
  // ---------------------------------------------------------------------------
  function deriveUpgrades(state) {
    var out = { allProfit: 1, allSpeed: 1, tap: 1, biz: {} };
    for (var id in state.upgrades) {
      if (!state.upgrades[id]) continue;
      var u = UP_BY_ID[id];
      if (!u) continue;
      var e = u.effect;
      if (e.kind === 'allProfit') out.allProfit *= e.value;
      else if (e.kind === 'allSpeed') out.allSpeed *= e.value;
      else if (e.kind === 'tap') out.tap *= e.value;
      else if (e.kind === 'bizProfit') out.biz[e.target] = (out.biz[e.target] || 1) * e.value;
    }
    return out;
  }

  function deriveBoard(state) {
    var out = {
      investorEff: 1, profit: 1, speed: 1,
      offlineCapHours: CONFIG.offlineCapHours, offlineEff: CONFIG.offlineEff,
      eventFreq: 1, eventReward: 1, investorGain: 1,
      keepManagers: false, autoBuyer: false
    };
    for (var id in state.board) {
      if (!state.board[id]) continue;
      var n = BOARD_BY_ID[id];
      if (!n) continue;
      var e = n.effect;
      switch (e.kind) {
        case 'investorEff': out.investorEff *= e.value; break;
        case 'profit': out.profit *= e.value; break;
        case 'speed': out.speed *= e.value; break;
        case 'offlineCap': out.offlineCapHours += e.value; break;
        case 'offlineCapEff': out.offlineCapHours += e.cap; out.offlineEff = Math.max(out.offlineEff, e.eff); break;
        case 'eventFreq': out.eventFreq *= e.value; break;
        case 'eventReward': out.eventReward *= e.value; break;
        case 'investorGain': out.investorGain *= e.value; break;
        case 'keepManagers': out.keepManagers = true; break;
        case 'autoBuyer': out.autoBuyer = true; break;
      }
    }
    return out;
  }

  function deriveDynasty(state) {
    var out = { startCash: 0, keepManagers: false, profit: 1, investorGain: 1, legacyProfit: 1 };
    for (var id in state.dynastyPerks) {
      if (!state.dynastyPerks[id]) continue;
      var p = PERK_BY_ID[id];
      if (!p) continue;
      var e = p.effect;
      if (e.kind === 'startCash') out.startCash = Math.max(out.startCash, e.value);
      else if (e.kind === 'keepManagers') out.keepManagers = true;
      else if (e.kind === 'profit') out.profit *= e.value;
      else if (e.kind === 'investorGain') out.investorGain *= e.value;
    }
    out.legacyProfit = 1 + (state.legacy || 0) * CONFIG.legacyPerBonus;
    return out;
  }

  function achievementMult(state) {
    var m = 1;
    for (var i = 0; i < ACHIEVEMENTS.length; i++) {
      if (state.achievements[ACHIEVEMENTS[i].id]) m *= ACHIEVEMENTS[i].bonus;
    }
    return m;
  }

  function investorMult(state, boardEff) {
    var inv = state.investors || 0;
    return 1 + Math.pow(inv, CONFIG.investorMultExp) * CONFIG.investorPerBonus * boardEff;
  }

  // ---- Innovations (R&D) ----
  function deriveInnovations(state) {
    var out = {
      franchise: 0, synergy: 0, scale: 0, offlineCap: 0, offlineEff: 0,
      insightRate: 1, boosts: false, analytics: false, eventInsight: 0, eventFreqMult: 1, profit: 1
    };
    var innov = state.innovations || {};
    for (var id in innov) {
      if (!innov[id]) continue;
      var n = INNOV_BY_ID[id]; if (!n) continue;
      var e = n.effect;
      switch (e.kind) {
        case 'franchise': out.franchise = Math.max(out.franchise, e.value); break;
        case 'synergy': out.synergy += e.value; break;
        case 'scale': out.scale += e.value; break;
        case 'offline': out.offlineCap += e.cap; out.offlineEff = Math.max(out.offlineEff, e.eff); break;
        case 'insightRate': out.insightRate *= e.value; break;
        case 'boosts': out.boosts = true; break;
        case 'analytics': out.analytics = true; break;
        case 'eventInsight': out.eventInsight += e.value; out.eventFreqMult *= 0.8; break;
        case 'profit': out.profit *= e.value; break;
      }
    }
    return out;
  }

  // ---- Eras ----
  function eraIndex(state) {
    var idx = 0;
    for (var i = 0; i < ERAS.length; i++) if ((state.earnedAll || 0) >= ERAS[i].at) idx = i;
    return idx;
  }
  function eraBonus(state) {
    var m = 1, idx = eraIndex(state);
    for (var i = 0; i <= idx; i++) m *= ERAS[i].bonus;
    return m;
  }
  function currentEra(state) { return ERAS[eraIndex(state)]; }
  function nextEra(state) { var idx = eraIndex(state); return idx + 1 < ERAS.length ? ERAS[idx + 1] : null; }

  // ---- helpers ----
  function managedTypeCount(state) {
    var c = 0;
    for (var i = 0; i < BUSINESSES.length; i++) {
      var bs = state.businesses[BUSINESSES[i].id];
      if (bs && bs.manager && bs.owned > 0) c++;
    }
    return c;
  }
  function totalUnits(state) {
    var t = 0;
    for (var i = 0; i < BUSINESSES.length; i++) { var bs = state.businesses[BUSINESSES[i].id]; if (bs) t += bs.owned; }
    return t;
  }
  function insightPerSec(state, innov) {
    var managers = 0;
    for (var i = 0; i < BUSINESSES.length; i++) { var bs = state.businesses[BUSINESSES[i].id]; if (bs && bs.manager) managers++; }
    if (managers <= 0) return 0;
    var dynBonus = 1 + 0.5 * (state.dynasties || 0);
    return managers * CONFIG.insightPerManager * (innov ? innov.insightRate : 1) * dynBonus;
  }

  // ---- Challenges ----
  function deriveChallengeRewards(state) {
    var out = { profit: 1, speed: 1, insightRate: 1, tap: 1 };
    var done = state.completedChallenges || {};
    for (var i = 0; i < CHALLENGES.length; i++) {
      var c = CHALLENGES[i];
      if (!done[c.id]) continue;
      var r = c.reward;
      if (out[r.kind] != null) out[r.kind] *= r.value;
    }
    return out;
  }
  function challengesUnlocked(state) {
    return (state.ipos || 0) >= CONFIG.challengesUnlockIpos || (state.activeChallenge != null) ||
      Object.keys(state.completedChallenges || {}).length > 0;
  }
  function activeChallengeDef(state) {
    return state.activeChallenge ? CHALLENGE_BY_ID[state.activeChallenge] : null;
  }
  function activeRestriction(state) {
    var def = activeChallengeDef(state);
    return def ? def.restriction : null;
  }
  function challengesDoneCount(state) {
    var n = 0, done = state.completedChallenges || {};
    for (var k in done) if (done[k]) n++;
    return n;
  }
  function bizAllowed(state, id) {
    var restr = activeRestriction(state);
    if (restr && restr.maxBiz != null) {
      var b = BIZ_BY_ID[id];
      return !!b && b._index < restr.maxBiz;
    }
    return true;
  }

  // Full per-frame derivation. nowMs governs temporary event/boost buffs.
  function derive(state, nowMs) {
    nowMs = nowMs || 0;
    var restr = activeRestriction(state);
    var up = deriveUpgrades(state);
    if (restr && restr.noUpgrades) up = { allProfit: 1, allSpeed: 1, tap: 1, biz: {} };
    var board = deriveBoard(state);
    var dyn = deriveDynasty(state);
    var innov = deriveInnovations(state);
    if (restr && restr.noInnovations) innov = deriveInnovations({ innovations: {} });
    var chal = deriveChallengeRewards(state);
    var ach = achievementMult(state);
    var inv = investorMult(state, board.investorEff);

    var boomActive = nowMs < (state.eventBoomUntil || 0);
    var frenzyActive = nowMs < (state.eventFrenzyUntil || 0);
    var surgeActive = nowMs < (state.boostSurgeUntil || 0);

    var eIdx = eraIndex(state);
    var eraMult = eraBonus(state);
    var synergyMult = 1 + innov.synergy * managedTypeCount(state);
    var scaleMult = 1 + innov.scale * Math.log10(1 + totalUnits(state));

    var globalProfit = up.allProfit * board.profit * dyn.profit * dyn.legacyProfit * ach * inv
      * eraMult * synergyMult * scaleMult * innov.profit * chal.profit;
    if (boomActive) globalProfit *= CONFIG.eventBoomMult;
    if (surgeActive) globalProfit *= CONFIG.boostSurgeMult;
    var globalSpeed = up.allSpeed * board.speed * chal.speed;
    if (frenzyActive) globalSpeed *= CONFIG.eventFrenzyMult;

    var revPerCycle = {}, cycleTime = {}, incomePerSec = {};
    var managed = 0, potential = 0;
    var fr = (restr && restr.noManagers) ? 0 : innov.franchise; // Bootstrapped disables Franchise too
    for (var i = 0; i < BUSINESSES.length; i++) {
      var b = BUSINESSES[i];
      var bs = state.businesses[b.id];
      var owned = bs ? bs.owned : 0;
      var rev = 0, ct = b.baseTime, ips = 0;
      if (owned > 0) {
        rev = b.baseRevenue * owned * milestoneProfit(owned) * (up.biz[b.id] || 1) * globalProfit;
        ct = Math.max(CONFIG.minCycleTime, b.baseTime / (milestoneSpeed(owned) * globalSpeed));
        ips = rev / ct;
      }
      revPerCycle[b.id] = rev;
      cycleTime[b.id] = ct;
      incomePerSec[b.id] = ips;
      potential += ips;
      if (bs && bs.manager) managed += ips;
      else if (owned > 0 && fr > 0) managed += ips * fr; // franchised idle income
    }

    return {
      up: up, board: board, dyn: dyn, innov: innov, ach: ach, inv: inv, chal: chal, restr: restr,
      boomActive: boomActive, frenzyActive: frenzyActive, surgeActive: surgeActive,
      eraIndex: eIdx, eraMult: eraMult, synergyMult: synergyMult, scaleMult: scaleMult,
      globalProfit: globalProfit, globalSpeed: globalSpeed, franchise: fr,
      offlineCapHours: board.offlineCapHours + innov.offlineCap,
      offlineEff: Math.max(board.offlineEff, innov.offlineEff),
      insightPerSec: insightPerSec(state, innov) * chal.insightRate,
      revPerCycle: revPerCycle, cycleTime: cycleTime, incomePerSec: incomePerSec,
      managedIncomePerSec: managed, potentialIncomePerSec: potential
    };
  }

  // ---------------------------------------------------------------------------
  // Production (online frames). Mutates state; returns earnings + per-biz payouts.
  // ---------------------------------------------------------------------------
  function produce(state, dt, derived) {
    if (!isFinite(state.cash)) state.cash = 1e307; // self-heal a corrupt value
    if (dt <= 0) return { earned: 0, perBiz: {} };
    if (dt > CONFIG.maxDt) dt = CONFIG.maxDt;
    var earned = 0;
    var perBiz = {};
    var fr = derived.franchise || 0;
    for (var i = 0; i < BUSINESSES.length; i++) {
      var b = BUSINESSES[i];
      var bs = state.businesses[b.id];
      if (!bs || bs.owned <= 0) continue;
      var ct = derived.cycleTime[b.id];
      var rev = derived.revPerCycle[b.id];
      if (bs.manager) {
        bs.progress += dt / ct;
        if (bs.progress >= 1) {
          var cycles = Math.floor(bs.progress);
          bs.progress -= cycles;
          var pay = cycles * rev;
          earned += pay; perBiz[b.id] = (perBiz[b.id] || 0) + pay;
        }
      } else if (fr > 0) { // Franchise Model: un-managed businesses auto-run at fr
        bs.progress += dt / ct;
        if (bs.progress >= 1) {
          var fc = Math.floor(bs.progress);
          bs.progress -= fc;
          var fpay = fc * rev * fr;
          earned += fpay; perBiz[b.id] = (perBiz[b.id] || 0) + fpay;
        }
      } else if (bs.running) {
        bs.progress += dt / ct;
        if (bs.progress >= 1) {
          bs.progress = 0;
          bs.running = false;
          earned += rev; perBiz[b.id] = (perBiz[b.id] || 0) + rev;
        }
      }
    }
    if (earned > 0) creditEarnings(state, earned);
    if (derived.insightPerSec > 0) { // Insight (R&D) accrues from automation
      var gi = derived.insightPerSec * dt;
      state.insight = (state.insight || 0) + gi;
      state.insightTotal = (state.insightTotal || 0) + gi;
    }
    return { earned: earned, perBiz: perBiz };
  }

  function creditEarnings(state, amount) {
    if (!isFinite(amount) || amount <= 0) return;
    state.cash += amount;
    state.earnedRun += amount;
    state.earnedAll += amount;
    if (state.cash > 1e307) state.cash = 1e307; // clamp below float ceiling
  }

  // ---------------------------------------------------------------------------
  // Actions
  // ---------------------------------------------------------------------------
  // qty: a positive integer, or 'max'. Returns {bought, spent}.
  function buyBusiness(state, id, qty) {
    var b = BIZ_BY_ID[id];
    if (!b) return { bought: 0, spent: 0 };
    if (!bizAllowed(state, id)) return { bought: 0, spent: 0 };
    var bs = state.businesses[id];
    var n = (qty === 'max') ? maxAffordable(b, bs.owned, state.cash) : Math.floor(qty);
    if (n <= 0) return { bought: 0, spent: 0 };
    var cost = bulkCost(b, bs.owned, n);
    if (cost > state.cash) {
      n = maxAffordable(b, bs.owned, state.cash);
      if (n <= 0) return { bought: 0, spent: 0 };
      cost = bulkCost(b, bs.owned, n);
    }
    state.cash -= cost;
    bs.owned += n;
    return { bought: n, spent: cost };
  }

  function canManage(state, id) {
    var b = BIZ_BY_ID[id];
    var bs = state.businesses[id];
    var restr = activeRestriction(state);
    if (restr && restr.noManagers) return false;
    return b && bs && !bs.manager && bs.owned > 0 && state.cash >= b.managerCost;
  }

  function hireManager(state, id) {
    if (!canManage(state, id)) return false;
    var b = BIZ_BY_ID[id];
    state.cash -= b.managerCost;
    state.businesses[id].manager = true;
    return true;
  }

  // Start a manual cycle (no-op if managed or already running).
  function runBusiness(state, id) {
    var bs = state.businesses[id];
    if (!bs || bs.owned <= 0 || bs.manager || bs.running) return false;
    bs.running = true;
    return true;
  }

  function isUpgradeUnlocked(state, u) {
    var un = u.unlock;
    if (!un) return true;
    if (un.kind === 'owned') {
      var bs = state.businesses[un.target];
      return bs && bs.owned >= un.value;
    }
    if (un.kind === 'earnedAll') return state.earnedAll >= un.value;
    return true;
  }

  function buyUpgrade(state, id) {
    var u = UP_BY_ID[id];
    if (!u || state.upgrades[id]) return false;
    var restr0 = activeRestriction(state);
    if (restr0 && restr0.noUpgrades) return false;
    if (!isUpgradeUnlocked(state, u)) return false;
    if (state.cash < u.cost) return false;
    state.cash -= u.cost;
    state.upgrades[id] = true;
    return true;
  }

  function boardAvailable(state) {
    return (state.investors || 0) - (state.investorsSpent || 0);
  }

  function isBoardUnlocked(state, n) {
    if (!n.req) return true;
    for (var i = 0; i < n.req.length; i++) if (!state.board[n.req[i]]) return false;
    return true;
  }

  function buyBoard(state, id) {
    var n = BOARD_BY_ID[id];
    if (!n || state.board[id]) return false;
    if (!isBoardUnlocked(state, n)) return false;
    if (boardAvailable(state) < n.cost) return false;
    state.investorsSpent += n.cost;
    state.board[id] = true;
    return true;
  }

  function legacyAvailable(state) {
    return (state.legacy || 0) - (state.legacySpent || 0);
  }

  function buyDynastyPerk(state, id) {
    var p = PERK_BY_ID[id];
    if (!p || state.dynastyPerks[id]) return false;
    if (legacyAvailable(state) < p.cost) return false;
    state.legacySpent += p.cost;
    state.dynastyPerks[id] = true;
    return true;
  }

  // ---------------------------------------------------------------------------
  // Hustle (manual tap)
  // ---------------------------------------------------------------------------
  function comboMult(state) {
    return 1 + Math.min(state.combo || 0, CONFIG.comboMax) * CONFIG.comboPerTap;
  }

  function hustleValue(state, derived) {
    var base = CONFIG.hustleBase + derived.potentialIncomePerSec * CONFIG.hustleIncomeFrac;
    var tapMult = derived.up.tap * (derived.chal ? derived.chal.tap : 1);
    return base * tapMult * comboMult(state);
  }

  function tap(state, derived, nowMs) {
    var within = (nowMs - (state.lastTapAt || 0)) <= CONFIG.comboWindow * 1000;
    state.combo = within ? (state.combo || 0) + 1 : 1;
    state.lastTapAt = nowMs;
    var value = hustleValue(state, derived);
    creditEarnings(state, value);
    state.taps = (state.taps || 0) + 1;
    return { value: value, combo: state.combo, comboMult: comboMult(state) };
  }

  // ---------------------------------------------------------------------------
  // Prestige 1 — IPO / Investors
  // ---------------------------------------------------------------------------
  function investorTarget(state, gainMult) {
    gainMult = gainMult || 1;
    var base = Math.pow(Math.max(0, state.earnedAll) / CONFIG.investorScale, CONFIG.investorTargetExp);
    return Math.floor(CONFIG.investorC * base * gainMult);
  }

  function pendingInvestors(state, derived) {
    var gain = derived ? (derived.board.investorGain * derived.dyn.investorGain) : 1;
    return Math.max(0, investorTarget(state, gain) - (state.investors || 0));
  }

  function canIPO(state, derived) {
    return pendingInvestors(state, derived) >= CONFIG.ipoMinInvestors;
  }

  function resetEmpire(state, derived) {
    state.cash = derived.dyn.startCash || CONFIG.startingCash;
    state.earnedRun = 0;
    var keep = derived.board.keepManagers || derived.dyn.keepManagers;
    for (var i = 0; i < BUSINESSES.length; i++) {
      var id = BUSINESSES[i].id;
      var start = CONFIG.startingOwned[id] || 0;
      var bs = state.businesses[id];
      bs.owned = start;
      bs.progress = 0;
      bs.running = false;
      if (!keep) bs.manager = false;
    }
  }

  function doIPO(state, derived) {
    var gain = pendingInvestors(state, derived);
    if (gain < CONFIG.ipoMinInvestors) return 0;
    state.investors += gain;
    state.investorsAllTime += gain;
    state.ipos += 1;
    resetEmpire(state, derived);
    return gain;
  }

  // ---------------------------------------------------------------------------
  // Prestige 2 — Dynasty / Legacy
  // ---------------------------------------------------------------------------
  function dynastyUnlocked(state) {
    return (state.investorsAllTime || 0) >= CONFIG.dynastyUnlockInvestors || (state.dynasties || 0) > 0;
  }

  function legacyTarget(state) {
    return Math.floor(Math.sqrt(Math.max(0, state.investorsAllTime) / CONFIG.dynastyScale));
  }

  function pendingLegacy(state) {
    return Math.max(0, legacyTarget(state) - (state.legacy || 0));
  }

  function canDynasty(state) {
    return dynastyUnlocked(state) && pendingLegacy(state) >= 1;
  }

  function doDynasty(state) {
    if (!canDynasty(state)) return 0;
    var gain = pendingLegacy(state);
    state.legacy += gain;
    state.dynasties += 1;
    // Deep reset: investors, board, cash upgrades, businesses.
    state.investors = 0;
    state.investorsSpent = 0;
    state.board = {};
    state.upgrades = {};
    var dyn = deriveDynasty(state); // recompute with new legacy (perks persist)
    resetEmpire(state, { dyn: dyn, board: deriveBoard(state) });
    return gain;
  }

  // ---------------------------------------------------------------------------
  // Offline earnings
  // ---------------------------------------------------------------------------
  function offlineEarnings(state, seconds, derived) {
    var capHours = (derived.offlineCapHours != null) ? derived.offlineCapHours : derived.board.offlineCapHours;
    var eff = (derived.offlineEff != null) ? derived.offlineEff : derived.board.offlineEff;
    var capSec = capHours * 3600;
    var used = Math.min(Math.max(0, seconds), capSec);
    var cash = derived.managedIncomePerSec * used * eff;
    return { cash: cash, seconds: used, capped: seconds > capSec, raw: seconds };
  }

  function applyOffline(state, seconds, derived) {
    var r = offlineEarnings(state, seconds, derived);
    creditEarnings(state, r.cash);
    if (derived.insightPerSec > 0) {
      var gi = derived.insightPerSec * r.seconds;
      state.insight = (state.insight || 0) + gi;
      state.insightTotal = (state.insightTotal || 0) + gi;
      r.insight = gi;
    }
    return r;
  }

  // ---------------------------------------------------------------------------
  // Achievements
  // ---------------------------------------------------------------------------
  function buildAchievementCtx(state) {
    var units = 0, managersHired = 0, ownedMax = {};
    for (var i = 0; i < BUSINESSES.length; i++) {
      var bs = state.businesses[BUSINESSES[i].id];
      var owned = bs ? bs.owned : 0;
      units += owned;
      ownedMax[BUSINESSES[i].id] = owned;
      if (bs && bs.manager) managersHired++;
    }
    var innovCount = 0, innov = state.innovations || {};
    for (var k in innov) if (innov[k]) innovCount++;
    return {
      netWorth: state.earnedAll,
      cash: state.cash,
      earnedRun: state.earnedRun,
      earnedAll: state.earnedAll,
      totalUnits: units,
      businesses: BUSINESSES,
      managersHired: managersHired,
      ipos: state.ipos || 0,
      investors: state.investors || 0,
      investorsAll: state.investorsAllTime || 0,
      taps: state.taps || 0,
      eventsCaught: state.eventsCaught || 0,
      dynasties: state.dynasties || 0,
      legacy: state.legacy || 0,
      innovations: innovCount,
      innovationsTotal: INNOVATIONS.length,
      eraIndex: eraIndex(state),
      boostsUsed: state.boostsUsed || 0,
      pinnacle: !!state.pinnacle,
      insightTotal: state.insightTotal || 0,
      challengesDone: challengesDoneCount(state),
      challengesTotal: CHALLENGES.length,
      ownedMax: ownedMax
    };
  }

  // Returns array of newly-unlocked achievement objects.
  function checkAchievements(state) {
    var ctx = buildAchievementCtx(state);
    var unlocked = [];
    for (var i = 0; i < ACHIEVEMENTS.length; i++) {
      var a = ACHIEVEMENTS[i];
      if (state.achievements[a.id]) continue;
      var ok = false;
      try { ok = !!a.test(ctx); } catch (e) { ok = false; }
      if (ok) { state.achievements[a.id] = true; unlocked.push(a); }
    }
    return unlocked;
  }

  // ---------------------------------------------------------------------------
  // Reveal logic
  // ---------------------------------------------------------------------------
  function revealedBusinesses(state) {
    var out = [];
    var restr = activeRestriction(state);
    var cap = (restr && restr.maxBiz != null) ? restr.maxBiz : BUSINESSES.length;
    for (var i = 0; i < BUSINESSES.length && i < cap; i++) {
      var b = BUSINESSES[i];
      var bs = state.businesses[b.id];
      var prev = i > 0 ? state.businesses[BUSINESSES[i - 1].id] : null;
      var revealed = i === 0 || (bs && bs.owned > 0) || (prev && prev.owned > 0);
      if (revealed) out.push(b);
      else break; // hide everything beyond the first locked one
    }
    return out;
  }

  // ---------------------------------------------------------------------------
  // Innovations (R&D) — actions
  // ---------------------------------------------------------------------------
  function innovationsUnlocked(state) {
    if ((state.insightTotal || 0) > 0) return true;
    var innov = state.innovations || {};
    for (var k in innov) if (innov[k]) return true;
    var managers = 0;
    for (var i = 0; i < BUSINESSES.length; i++) { var bs = state.businesses[BUSINESSES[i].id]; if (bs && bs.manager) managers++; }
    return managers >= CONFIG.innovationsUnlockManagers;
  }
  function isInnovationUnlocked(state, n) {
    if (!n.req) return true;
    for (var i = 0; i < n.req.length; i++) if (!(state.innovations && state.innovations[n.req[i]])) return false;
    return true;
  }
  function buyInnovation(state, id) {
    var n = INNOV_BY_ID[id];
    if (!n) return false;
    var restr1 = activeRestriction(state);
    if (restr1 && restr1.noInnovations) return false;
    state.innovations = state.innovations || {};
    if (state.innovations[id]) return false;
    if (!isInnovationUnlocked(state, n)) return false;
    if ((state.insight || 0) < n.cost) return false;
    state.insight -= n.cost;
    state.innovations[id] = true;
    return true;
  }

  // ---------------------------------------------------------------------------
  // Active Boosts
  // ---------------------------------------------------------------------------
  function boostsUnlocked(state) { return deriveInnovations(state).boosts; }
  function boostCooldownLeft(state, id, nowMs) {
    return Math.max(0, (((state.boostCd && state.boostCd[id]) || 0) - nowMs) / 1000);
  }
  function boostReady(state, id, nowMs) {
    return nowMs >= ((state.boostCd && state.boostCd[id]) || 0);
  }
  function activateBoost(state, id, nowMs, derived) {
    var b = BOOST_BY_ID[id];
    if (!b) return null;
    if (!boostsUnlocked(state)) return null;
    if (!boostReady(state, id, nowMs)) return null;
    state.boostCd = state.boostCd || {};
    state.boostCd[id] = nowMs + b.cd * 1000;
    state.boostsUsed = (state.boostsUsed || 0) + 1;
    if (b.kind === 'surge') {
      state.boostSurgeUntil = nowMs + b.dur * 1000;
      return { kind: 'surge', dur: b.dur };
    }
    if (b.kind === 'injection') {
      var d = derived || derive(state, nowMs);
      var amount = Math.max(CONFIG.eventWindfallFlatMin, d.managedIncomePerSec * CONFIG.boostInjectionSeconds);
      creditEarnings(state, amount);
      return { kind: 'injection', amount: amount };
    }
    return { kind: b.kind };
  }

  // ---------------------------------------------------------------------------
  // Challenges — actions
  // ---------------------------------------------------------------------------
  function enterChallenge(state, id, nowMs) {
    if (state.activeChallenge) return false;
    var def = CHALLENGE_BY_ID[id];
    if (!def || !challengesUnlocked(state)) return false;
    if (state.completedChallenges && state.completedChallenges[id]) return false;
    state.activeChallenge = id;
    state.challengeStartAt = nowMs;
    var dyn = deriveDynasty(state);
    resetEmpire(state, { dyn: { startCash: dyn.startCash, keepManagers: false }, board: { keepManagers: false } });
    return true;
  }
  function abandonChallenge(state) {
    if (!state.activeChallenge) return false;
    state.activeChallenge = null;
    state.challengeStartAt = 0;
    resetEmpire(state, { dyn: deriveDynasty(state), board: deriveBoard(state) });
    return true;
  }
  function challengeTimeLeft(state, nowMs) {
    var def = activeChallengeDef(state);
    if (!def || def.restriction.timeLimit == null) return null;
    var start = state.challengeStartAt != null ? state.challengeStartAt : nowMs;
    return Math.max(0, def.restriction.timeLimit - (nowMs - start) / 1000);
  }
  // Called each tick while a challenge is active. Returns {status, def} or null.
  function checkChallenge(state, nowMs) {
    var def = activeChallengeDef(state);
    if (!def) return null;
    if ((state.earnedRun || 0) >= def.goal) {
      state.completedChallenges = state.completedChallenges || {};
      state.completedChallenges[def.id] = true;
      state.activeChallenge = null; state.challengeStartAt = 0;
      resetEmpire(state, { dyn: deriveDynasty(state), board: deriveBoard(state) });
      return { status: 'completed', def: def };
    }
    var start = state.challengeStartAt != null ? state.challengeStartAt : nowMs;
    if (def.restriction.timeLimit != null && (nowMs - start) / 1000 > def.restriction.timeLimit) {
      state.activeChallenge = null; state.challengeStartAt = 0;
      resetEmpire(state, { dyn: deriveDynasty(state), board: deriveBoard(state) });
      return { status: 'failed', def: def };
    }
    return null;
  }

  // ---------------------------------------------------------------------------
  // Boardroom Decisions
  // ---------------------------------------------------------------------------
  function pickDecision() { return DECISIONS[Math.floor(Math.random() * DECISIONS.length)]; }
  function applyDecision(state, decisionId, optionIndex, derived, nowMs) {
    var d = DECISION_BY_ID[decisionId]; if (!d) return null;
    var opt = d.options[optionIndex]; if (!opt) return null;
    var e = opt.effect, res = { label: opt.label };
    if (e.kind === 'spendSurge') { var sp = state.cash * e.pct; state.cash -= sp; state.boostSurgeUntil = nowMs + e.seconds * 1000; res.spend = sp; res.surge = e.seconds; }
    else if (e.kind === 'spendFrenzy') { var sp2 = state.cash * e.pct; state.cash -= sp2; state.eventFrenzyUntil = nowMs + e.seconds * 1000; res.spend = sp2; res.frenzy = e.seconds; }
    else if (e.kind === 'surge') { state.boostSurgeUntil = nowMs + e.seconds * 1000; res.surge = e.seconds; }
    else if (e.kind === 'frenzy') { state.eventFrenzyUntil = nowMs + e.seconds * 1000; res.frenzy = e.seconds; }
    else if (e.kind === 'windfall') { var base = Math.max(derived.managedIncomePerSec, derived.potentialIncomePerSec * 0.5); var amt = Math.max(CONFIG.eventWindfallFlatMin, base * e.seconds); creditEarnings(state, amt); res.cash = amt; }
    else if (e.kind === 'insight') {
      if (innovationsUnlocked(state)) { state.insight = (state.insight || 0) + e.mult; state.insightTotal = (state.insightTotal || 0) + e.mult; res.insight = e.mult; }
      else { var w = Math.max(CONFIG.eventWindfallFlatMin, derived.managedIncomePerSec * 120); creditEarnings(state, w); res.cash = w; }
    }
    state.decisionsMade = (state.decisionsMade || 0) + 1;
    return res;
  }

  // ---------------------------------------------------------------------------
  // Eras + Pinnacle (phase-shift / win-state)
  // ---------------------------------------------------------------------------
  function checkEra(state) {
    var idx = eraIndex(state);
    var seen = state.eraSeen || 0;
    if (idx > seen) { state.eraSeen = idx; return ERAS[idx]; }
    return null;
  }
  function checkPinnacle(state) {
    if (!state.pinnacle && (state.earnedAll || 0) >= CONFIG.pinnacleEarned) { state.pinnacle = true; return true; }
    return false;
  }

  // QoL: seconds until `cost` is affordable at the current income (0 = now, Infinity = never).
  function timeToAfford(cost, cash, incomePerSec) {
    if (cash >= cost) return 0;
    if (incomePerSec <= 0) return Infinity;
    return (cost - cash) / incomePerSec;
  }

  return {
    // lookups
    BIZ_BY_ID: BIZ_BY_ID, UP_BY_ID: UP_BY_ID, BOARD_BY_ID: BOARD_BY_ID, PERK_BY_ID: PERK_BY_ID,
    INNOV_BY_ID: INNOV_BY_ID, BOOST_BY_ID: BOOST_BY_ID,
    // costs
    unitCost: unitCost, bulkCost: bulkCost, maxAffordable: maxAffordable,
    // milestones
    milestoneProfit: milestoneProfit, milestoneSpeed: milestoneSpeed, nextMilestone: nextMilestone,
    // derive
    deriveUpgrades: deriveUpgrades, deriveBoard: deriveBoard, deriveDynasty: deriveDynasty,
    achievementMult: achievementMult, investorMult: investorMult, derive: derive,
    // production
    produce: produce, creditEarnings: creditEarnings,
    // actions
    buyBusiness: buyBusiness, canManage: canManage, hireManager: hireManager, runBusiness: runBusiness,
    isUpgradeUnlocked: isUpgradeUnlocked, buyUpgrade: buyUpgrade,
    boardAvailable: boardAvailable, isBoardUnlocked: isBoardUnlocked, buyBoard: buyBoard,
    legacyAvailable: legacyAvailable, buyDynastyPerk: buyDynastyPerk,
    // hustle
    comboMult: comboMult, hustleValue: hustleValue, tap: tap,
    // prestige
    investorTarget: investorTarget, pendingInvestors: pendingInvestors, canIPO: canIPO, doIPO: doIPO,
    dynastyUnlocked: dynastyUnlocked, legacyTarget: legacyTarget, pendingLegacy: pendingLegacy,
    canDynasty: canDynasty, doDynasty: doDynasty,
    // offline
    offlineEarnings: offlineEarnings, applyOffline: applyOffline,
    // achievements
    buildAchievementCtx: buildAchievementCtx, checkAchievements: checkAchievements,
    // reveal
    revealedBusinesses: revealedBusinesses,
    // innovations (R&D)
    deriveInnovations: deriveInnovations, innovationsUnlocked: innovationsUnlocked,
    isInnovationUnlocked: isInnovationUnlocked, buyInnovation: buyInnovation,
    insightPerSec: insightPerSec,
    // boosts
    boostsUnlocked: boostsUnlocked, boostReady: boostReady, boostCooldownLeft: boostCooldownLeft, activateBoost: activateBoost,
    // eras + pinnacle
    eraIndex: eraIndex, eraBonus: eraBonus, currentEra: currentEra, nextEra: nextEra,
    checkEra: checkEra, checkPinnacle: checkPinnacle,
    // challenges
    CHALLENGE_BY_ID: CHALLENGE_BY_ID, deriveChallengeRewards: deriveChallengeRewards,
    challengesUnlocked: challengesUnlocked, activeChallengeDef: activeChallengeDef,
    activeRestriction: activeRestriction, challengesDoneCount: challengesDoneCount,
    enterChallenge: enterChallenge, abandonChallenge: abandonChallenge,
    challengeTimeLeft: challengeTimeLeft, checkChallenge: checkChallenge,
    // decisions
    DECISION_BY_ID: DECISION_BY_ID, pickDecision: pickDecision, applyDecision: applyDecision,
    // qol
    timeToAfford: timeToAfford, totalUnits: totalUnits, managedTypeCount: managedTypeCount
  };
});
