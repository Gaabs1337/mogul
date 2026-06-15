/*
 * MOGUL — data.js
 * All game content as pure, declarative data + tunable CONFIG.
 * No DOM, no state mutation. Exported for Node tests.
 */
(function (root, factory) {
  'use strict';
  var api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.MOGUL = root.MOGUL || {};
  root.MOGUL.data = api;
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';

  // ----------------------------------------------------------------------------
  // Tunable constants. Balance is verified by tests/economy.sim.js.
  // ----------------------------------------------------------------------------
  var CONFIG = {
    startingCash: 0,
    startingOwned: { lemonade: 1 }, // own your first stand; tap to run it
    minCycleTime: 0.05,             // floor so speed multipliers never hit 0
    maxDt: 60,                      // clamp a single simulated frame (seconds)

    // --- Hustle (manual tap) ---
    hustleBase: 1,                  // flat $ per tap, early-game onboarding
    hustleIncomeFrac: 0.35,         // + this many seconds of idle income per tap
    comboWindow: 1.6,               // seconds before combo resets
    comboPerTap: 0.04,              // combo multiplier growth per tap
    comboMax: 50,                   // taps until combo caps (×3 at default)

    // --- Investors (prestige 1) ---
    // count grows ~sqrt(earnedAll) so it reaches large numbers (Dynasty stays
    // reachable), but the MULTIPLIER it grants is diminishing (~sqrt(investors))
    // so the prestige loop can't spiral into a finite-time runaway.
    investorScale: 1e9,             // investors = floor(C * (earnedAll/scale)^targetExp)
    investorC: 2,
    investorTargetExp: 0.33,        // <0.5 makes time-per-prestige INCREASE (stable arc)
    investorPerBonus: 0.08,         // multiplier = 1 + perBonus * investors^multExp
    investorMultExp: 0.5,           // diminishing returns on the investor multiplier
    ipoMinInvestors: 1,             // need at least this many pending to IPO

    // --- Offline ---
    offlineCapHours: 8,             // base cap (board can extend)
    offlineEff: 1.0,                // base efficiency for managed businesses

    // --- Events ---
    eventMinGap: 70,                // seconds
    eventMaxGap: 130,
    eventTokenLife: 13,             // seconds a token stays tappable
    eventBoomMult: 7,               // ×profit during a boom
    eventBoomDur: 30,
    eventFrenzyMult: 4,             // ×speed during a frenzy
    eventFrenzyDur: 30,
    eventWindfallSeconds: 60,       // windfall = this many seconds of income (min flat fallback)
    eventWindfallFlatMin: 50,

    // --- Dynasty (prestige 2) ---
    dynastyUnlockInvestors: 50000,  // total investors ever needed to unlock Dynasty
    dynastyScale: 50000,            // legacy = floor(sqrt(totalInvestorsAll / scale))
    legacyPerBonus: 2,              // global profit ×(1 + 2*legacy): legacy 1 -> ×3

    autoBuyInterval: 1.5            // seconds between auto-buyer purchases (when unlocked)
  };

  // ----------------------------------------------------------------------------
  // Businesses (the producers). Each unit owned adds baseRevenue to the cycle
  // payout; cost of the next unit = baseCost * costRate^owned.
  // ----------------------------------------------------------------------------
  var BUSINESSES = [
    { id: 'lemonade', name: 'Lemonade Stand',  icon: '🍋', baseCost: 4,         costRate: 1.07, baseRevenue: 1,         baseTime: 0.8,  managerCost: 1e3 },
    { id: 'coffee',   name: 'Coffee Shop',     icon: '☕', baseCost: 60,        costRate: 1.15, baseRevenue: 60,        baseTime: 3,    managerCost: 1.5e4 },
    { id: 'carwash',  name: 'Car Wash',        icon: '🚗', baseCost: 720,       costRate: 1.14, baseRevenue: 540,       baseTime: 6,    managerCost: 1e5 },
    { id: 'pizza',    name: 'Pizza Chain',     icon: '🍕', baseCost: 8640,      costRate: 1.13, baseRevenue: 4320,      baseTime: 12,   managerCost: 5e5 },
    { id: 'hotel',    name: 'Boutique Hotel',  icon: '🏨', baseCost: 103680,    costRate: 1.12, baseRevenue: 51840,     baseTime: 24,   managerCost: 2.5e6 },
    { id: 'club',     name: 'Nightclub',       icon: '🍸', baseCost: 1244160,   costRate: 1.11, baseRevenue: 622080,    baseTime: 48,   managerCost: 1.5e8 },
    { id: 'studio',   name: 'Movie Studio',    icon: '🎬', baseCost: 14929920,  costRate: 1.10, baseRevenue: 7464960,   baseTime: 96,   managerCost: 1e9 },
    { id: 'bank',     name: 'Investment Bank', icon: '🏦', baseCost: 179159040, costRate: 1.09, baseRevenue: 89579520,  baseTime: 192,  managerCost: 5e10 },
    { id: 'oil',      name: 'Oil & Energy',    icon: '🛢️', baseCost: 2.1e9,     costRate: 1.08, baseRevenue: 1.07e9,    baseTime: 384,  managerCost: 2.5e12 },
    { id: 'aero',     name: 'Aerospace',       icon: '🚀', baseCost: 2.58e10,   costRate: 1.07, baseRevenue: 1.29e10,   baseTime: 768,  managerCost: 1.25e14 }
  ];

  // Milestone schedule (per business, by units owned).
  // profit = multiply this business's payout; speed = divide its cycle time.
  var MILESTONES = [
    { at: 25,   profit: 2, speed: 2 },
    { at: 50,   profit: 2 },
    { at: 100,  profit: 2, speed: 2 },
    { at: 150,  profit: 2 },
    { at: 200,  profit: 2, speed: 2 },
    { at: 300,  profit: 2 },
    { at: 400,  profit: 2, speed: 2 },
    { at: 500,  profit: 2 },
    { at: 600,  profit: 2 },
    { at: 700,  profit: 2 },
    { at: 800,  profit: 2 },
    { at: 900,  profit: 2 },
    { at: 1000, profit: 3 }
  ];
  // Past the last milestone, every +1000 owned grants another ×2 profit (endless).
  var MILESTONE_REPEAT_STEP = 1000;
  var MILESTONE_REPEAT_PROFIT = 2;

  // ----------------------------------------------------------------------------
  // Upgrades (bought with cash). Generated for DRY-ness with stable ids.
  // effect: { kind, value, target? }
  //   kind 'bizProfit'  -> ×value to a single business (target = business id)
  //   kind 'allProfit'  -> ×value to every business
  //   kind 'allSpeed'   -> ×value speed (faster cycles) to every business
  //   kind 'tap'        -> ×value to hustle/tap value
  // unlock: { kind, value, target? }
  //   kind 'owned'      -> business `target` owned >= value
  //   kind 'earnedAll'  -> total earned ever >= value
  // ----------------------------------------------------------------------------
  function buildUpgrades() {
    var ups = [];

    // Per-business profit upgrades.
    var bizTiers = [
      { owned: 25,  mult: 2, costFactor: 60 },
      { owned: 100, mult: 2, costFactor: 7000 },
      { owned: 300, mult: 3, costFactor: 7e5 },
      { owned: 500, mult: 3, costFactor: 7e7 }
    ];
    BUSINESSES.forEach(function (b, bi) {
      bizTiers.forEach(function (tier, ti) {
        ups.push({
          id: 'b' + bi + 'u' + ti,
          name: b.name + ' ' + (ti === 0 ? 'Upgrade' : (ti === 1 ? 'Expansion' : (ti === 2 ? 'Franchise' : 'Monopoly'))),
          desc: 'Profit ×' + tier.mult + ' for ' + b.name,
          icon: b.icon,
          cost: b.baseCost * tier.costFactor,
          effect: { kind: 'bizProfit', value: tier.mult, target: b.id },
          unlock: { kind: 'owned', value: tier.owned, target: b.id }
        });
      });
    });

    // Global profit upgrades.
    var globalProfit = [
      { earned: 1e6,  cost: 2e5 },
      { earned: 1e9,  cost: 2e8 },
      { earned: 1e12, cost: 2e11 },
      { earned: 1e15, cost: 2e14 },
      { earned: 1e18, cost: 2e17 },
      { earned: 1e21, cost: 2e20 },
      { earned: 1e24, cost: 2e23 },
      { earned: 1e27, cost: 2e26 }
    ];
    globalProfit.forEach(function (g, i) {
      ups.push({
        id: 'gp' + i,
        name: 'Holding Multiplier ' + romanish(i + 1),
        desc: 'Profit ×2 for ALL businesses',
        icon: '📈',
        cost: g.cost,
        effect: { kind: 'allProfit', value: 2 },
        unlock: { kind: 'earnedAll', value: g.earned }
      });
    });

    // Global speed upgrades.
    var globalSpeed = [
      { earned: 5e6,  cost: 1e6 },
      { earned: 5e11, cost: 1e11 },
      { earned: 5e16, cost: 1e16 },
      { earned: 5e21, cost: 1e21 }
    ];
    globalSpeed.forEach(function (g, i) {
      ups.push({
        id: 'gs' + i,
        name: 'Logistics Network ' + romanish(i + 1),
        desc: 'All businesses run ×1.5 faster',
        icon: '⚡',
        cost: g.cost,
        effect: { kind: 'allSpeed', value: 1.5 },
        unlock: { kind: 'earnedAll', value: g.earned }
      });
    });

    // Tap value upgrades.
    var tapTiers = [
      { earned: 50,   cost: 40 },
      { earned: 1e4,  cost: 8e3 },
      { earned: 1e7,  cost: 8e6 },
      { earned: 1e11, cost: 8e10 }
    ];
    tapTiers.forEach(function (g, i) {
      ups.push({
        id: 'tap' + i,
        name: 'The Hustle ' + romanish(i + 1),
        desc: 'Tap value ×3',
        icon: '👆',
        cost: g.cost,
        effect: { kind: 'tap', value: 3 },
        unlock: { kind: 'earnedAll', value: g.earned }
      });
    });

    return ups;
  }

  function romanish(n) {
    var r = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI', 'XII'];
    return r[n - 1] || ('×' + n);
  }

  var UPGRADES = buildUpgrades();

  // ----------------------------------------------------------------------------
  // Board upgrades (bought with Investors). One-time nodes, some gated by reqs.
  // effect kinds applied in game.deriveBoard():
  //   investorEff(value)  -> × per-investor bonus
  //   profit(value)       -> × global profit
  //   speed(value)        -> × global speed
  //   offlineCap(value)   -> + hours to offline cap
  //   offlineEff(value)   -> set offline efficiency to value (max wins)
  //   eventFreq(value)    -> × gap between events (value<1 = more often)
  //   eventReward(value)  -> × event payouts
  //   investorGain(value) -> × investors gained per IPO
  //   keepManagers        -> managers persist through IPO
  //   autoBuyer           -> unlocks the auto-buyer
  // ----------------------------------------------------------------------------
  var BOARD = [
    { id: 'eff1', name: 'Angel Network',     desc: 'Investor bonus ×1.5', icon: '😇', cost: 8,    effect: { kind: 'investorEff', value: 1.5 } },
    { id: 'eff2', name: 'Venture Capital',   desc: 'Investor bonus ×2',   icon: '💼', cost: 60,   effect: { kind: 'investorEff', value: 2 }, req: ['eff1'] },
    { id: 'eff3', name: 'Sovereign Fund',    desc: 'Investor bonus ×3',   icon: '🏛️', cost: 500,  effect: { kind: 'investorEff', value: 3 }, req: ['eff2'] },

    { id: 'prof1', name: 'Synergy',          desc: 'All profit ×3',       icon: '🔗', cost: 15,   effect: { kind: 'profit', value: 3 } },
    { id: 'prof2', name: 'Market Dominance', desc: 'All profit ×5',       icon: '👑', cost: 200,  effect: { kind: 'profit', value: 5 }, req: ['prof1'] },
    { id: 'prof3', name: 'Empire Scale',     desc: 'All profit ×10',      icon: '🌐', cost: 2000, effect: { kind: 'profit', value: 10 }, req: ['prof2'] },

    { id: 'spd1', name: 'Lean Operations',   desc: 'All speed ×1.5',      icon: '🏃', cost: 40,   effect: { kind: 'speed', value: 1.5 } },
    { id: 'spd2', name: 'Automation Suite',  desc: 'All speed ×2',        icon: '🤖', cost: 350,  effect: { kind: 'speed', value: 2 }, req: ['spd1'] },

    { id: 'off1', name: 'Night Shift',       desc: 'Offline cap +8h',     icon: '🌙', cost: 25,   effect: { kind: 'offlineCap', value: 8 } },
    { id: 'off2', name: 'Global Offices',    desc: 'Offline cap +24h, 100% efficiency', icon: '🗺️', cost: 250, effect: { kind: 'offlineCapEff', cap: 24, eff: 1.0 }, req: ['off1'] },

    { id: 'evt1', name: 'Insider Tips',      desc: 'Opportunities appear more often', icon: '🔔', cost: 30,  effect: { kind: 'eventFreq', value: 0.7 } },
    { id: 'evt2', name: 'Power Broker',      desc: 'Opportunity rewards ×2', icon: '🎯', cost: 120, effect: { kind: 'eventReward', value: 2 }, req: ['evt1'] },

    { id: 'gain1', name: 'Roadshow',         desc: '+50% Investors per IPO', icon: '📊', cost: 150, effect: { kind: 'investorGain', value: 1.5 } },

    { id: 'keep', name: 'Career Managers',   desc: 'Managers stay hired through an IPO', icon: '🧑‍💼', cost: 80, effect: { kind: 'keepManagers' } },
    { id: 'auto', name: 'AI Acquisitions',   desc: 'Unlock the Auto-Buyer (buys for you)', icon: '🛰️', cost: 600, effect: { kind: 'autoBuyer' }, req: ['prof1'] }
  ];

  // ----------------------------------------------------------------------------
  // Dynasty perks (bought with Legacy). Simple, powerful, late-game.
  // ----------------------------------------------------------------------------
  var DYNASTY_PERKS = [
    { id: 'dyn_start', name: 'Old Money',     desc: 'Start each empire with $1,000,000', icon: '💰', cost: 1, effect: { kind: 'startCash', value: 1e6 } },
    { id: 'dyn_keep',  name: 'Family Office', desc: 'Keep all managers forever',         icon: '🏰', cost: 2, effect: { kind: 'keepManagers' } },
    { id: 'dyn_prof',  name: 'Generational Wealth', desc: 'All profit ×100',             icon: '💎', cost: 3, effect: { kind: 'profit', value: 100 } },
    { id: 'dyn_inv',   name: 'Dynasty Trust', desc: 'Investor gain ×3',                  icon: '🤝', cost: 5, effect: { kind: 'investorGain', value: 3 } }
  ];

  // ----------------------------------------------------------------------------
  // Market events (weighted random).
  // ----------------------------------------------------------------------------
  var EVENT_TYPES = [
    { id: 'boom',     label: 'Market Boom',    icon: '🚀', weight: 32, kind: 'boom' },
    { id: 'frenzy',   label: 'Buying Frenzy',  icon: '⚡', weight: 28, kind: 'frenzy' },
    { id: 'windfall', label: 'Cash Windfall',  icon: '💵', weight: 36, kind: 'windfall' },
    { id: 'tip',      label: 'Investor Tip',   icon: '😇', weight: 4,  kind: 'investorTip' }
  ];

  // ----------------------------------------------------------------------------
  // Achievements. Each test(ctx) -> bool. bonus = global profit multiplier.
  // ctx: { netWorth, cash, earnedRun, earnedAll, totalUnits, businesses,
  //        managersHired, ipos, investors, investorsAll, taps, eventsCaught,
  //        dynasties, legacy, ownedMax }
  // ----------------------------------------------------------------------------
  var ACHIEVEMENTS = [
    { id: 'first_buy', name: 'Open for Business', desc: 'Buy your first business', icon: '🏪', bonus: 1.02, test: function (c) { return c.totalUnits >= 2; } },
    { id: 'ten_units', name: 'Getting Going', desc: 'Own 10 businesses total', icon: '🏬', bonus: 1.02, test: function (c) { return c.totalUnits >= 10; } },
    { id: 'fifty_units', name: 'Local Chain', desc: 'Own 50 businesses total', icon: '🏘️', bonus: 1.03, test: function (c) { return c.totalUnits >= 50; } },
    { id: 'hundred_units', name: 'Regional Player', desc: 'Own 100 businesses total', icon: '🌆', bonus: 1.03, test: function (c) { return c.totalUnits >= 100; } },
    { id: 'thousand_units', name: 'Conglomerate', desc: 'Own 1,000 businesses total', icon: '🌇', bonus: 1.05, test: function (c) { return c.totalUnits >= 1000; } },

    { id: 'mgr1', name: 'Delegation', desc: 'Hire your first manager', icon: '🧑‍💼', bonus: 1.03, test: function (c) { return c.managersHired >= 1; } },
    { id: 'mgr_all', name: 'Hands Off', desc: 'Hire every manager', icon: '🛋️', bonus: 1.10, test: function (c) { return c.managersHired >= c.businesses.length; } },

    { id: 'nw_1k', name: 'Pocket Change', desc: 'Net worth $1K', icon: '🪙', bonus: 1.02, test: function (c) { return c.netWorth >= 1e3; } },
    { id: 'nw_1m', name: 'Millionaire', desc: 'Net worth $1M', icon: '💵', bonus: 1.03, test: function (c) { return c.netWorth >= 1e6; } },
    { id: 'nw_1b', name: 'Billionaire', desc: 'Net worth $1B', icon: '💸', bonus: 1.04, test: function (c) { return c.netWorth >= 1e9; } },
    { id: 'nw_1t', name: 'Trillionaire', desc: 'Net worth $1T', icon: '🤑', bonus: 1.05, test: function (c) { return c.netWorth >= 1e12; } },
    { id: 'nw_1qa', name: 'Beyond Money', desc: 'Net worth $1Qa', icon: '🌟', bonus: 1.06, test: function (c) { return c.netWorth >= 1e15; } },

    { id: 'aero1', name: 'To The Moon', desc: 'Own an Aerospace company', icon: '🚀', bonus: 1.05, test: function (c) { return (c.ownedMax.aero || 0) >= 1; } },
    { id: 'maxbiz', name: 'Empire Builder', desc: 'Own 100 of a single business', icon: '🏗️', bonus: 1.05, test: function (c) { return anyOwned(c, 100); } },
    { id: 'maxbiz2', name: 'Total Control', desc: 'Own 500 of a single business', icon: '🗽', bonus: 1.08, test: function (c) { return anyOwned(c, 500); } },

    { id: 'ipo1', name: 'Going Public', desc: 'Complete your first IPO', icon: '🔔', bonus: 1.05, test: function (c) { return c.ipos >= 1; } },
    { id: 'ipo5', name: 'Serial Entrepreneur', desc: 'Complete 5 IPOs', icon: '📜', bonus: 1.06, test: function (c) { return c.ipos >= 5; } },
    { id: 'ipo25', name: 'Wall Street Legend', desc: 'Complete 25 IPOs', icon: '🏆', bonus: 1.10, test: function (c) { return c.ipos >= 25; } },

    { id: 'inv10', name: 'Backed', desc: 'Have 10 Investors', icon: '😇', bonus: 1.04, test: function (c) { return c.investors >= 10; } },
    { id: 'inv100', name: 'Well Connected', desc: 'Have 100 Investors', icon: '🤝', bonus: 1.06, test: function (c) { return c.investors >= 100; } },
    { id: 'inv1k', name: 'Power Player', desc: 'Have 1,000 Investors', icon: '🏛️', bonus: 1.08, test: function (c) { return c.investors >= 1000; } },

    { id: 'tap100', name: 'Grinder', desc: 'Tap 100 times', icon: '👆', bonus: 1.02, test: function (c) { return c.taps >= 100; } },
    { id: 'tap1k', name: 'Workaholic', desc: 'Tap 1,000 times', icon: '💪', bonus: 1.03, test: function (c) { return c.taps >= 1000; } },

    { id: 'evt1', name: 'Opportunist', desc: 'Catch an Opportunity', icon: '🎯', bonus: 1.03, test: function (c) { return c.eventsCaught >= 1; } },
    { id: 'evt25', name: 'Right Place, Right Time', desc: 'Catch 25 Opportunities', icon: '🍀', bonus: 1.06, test: function (c) { return c.eventsCaught >= 25; } },

    { id: 'dyn1', name: 'Dynasty', desc: 'Found a Dynasty', icon: '👑', bonus: 1.15, test: function (c) { return c.dynasties >= 1; } },
    { id: 'legacy5', name: 'House of Mogul', desc: 'Reach 5 Legacy', icon: '🏰', bonus: 1.20, test: function (c) { return c.legacy >= 5; } }
  ];

  function anyOwned(c, n) {
    var keys = Object.keys(c.ownedMax);
    for (var i = 0; i < keys.length; i++) if (c.ownedMax[keys[i]] >= n) return true;
    return false;
  }

  return {
    CONFIG: CONFIG,
    BUSINESSES: BUSINESSES,
    MILESTONES: MILESTONES,
    MILESTONE_REPEAT_STEP: MILESTONE_REPEAT_STEP,
    MILESTONE_REPEAT_PROFIT: MILESTONE_REPEAT_PROFIT,
    UPGRADES: UPGRADES,
    BOARD: BOARD,
    DYNASTY_PERKS: DYNASTY_PERKS,
    EVENT_TYPES: EVENT_TYPES,
    ACHIEVEMENTS: ACHIEVEMENTS
  };
});
