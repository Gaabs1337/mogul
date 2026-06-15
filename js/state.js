/*
 * MOGUL — state.js
 * Default state, localStorage save/load, schema migration, export/import.
 * defaultState() & sanitize() are pure (Node-testable); save/load guard for
 * a missing localStorage.
 */
(function (root, factory) {
  'use strict';
  var data = (typeof module !== 'undefined' && module.exports)
    ? require('./data')
    : root.MOGUL.data;
  var api = factory(data);
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.MOGUL = root.MOGUL || {};
  root.MOGUL.state = api;
})(typeof window !== 'undefined' ? window : globalThis, function (data) {
  'use strict';

  var SCHEMA_VERSION = 1;
  var SAVE_KEY = 'mogul.save.v1';
  var BUSINESSES = data.BUSINESSES;
  var CONFIG = data.CONFIG;

  function now() { return Date.now(); }

  function defaultState() {
    var businesses = {};
    for (var i = 0; i < BUSINESSES.length; i++) {
      var id = BUSINESSES[i].id;
      businesses[id] = {
        owned: CONFIG.startingOwned[id] || 0,
        progress: 0,
        running: false,
        manager: false
      };
    }
    return {
      v: SCHEMA_VERSION,
      cash: CONFIG.startingCash,
      earnedRun: 0,
      earnedAll: 0,
      businesses: businesses,
      upgrades: {},
      board: {},
      achievements: {},
      dynastyPerks: {},
      investors: 0,
      investorsSpent: 0,
      investorsAllTime: 0,
      legacy: 0,
      legacySpent: 0,
      ipos: 0,
      dynasties: 0,
      taps: 0,
      eventsCaught: 0,
      // R&D / Innovations (non-resetting parallel track)
      insight: 0,
      insightTotal: 0,
      innovations: {},
      boostsUsed: 0,
      // Eras + win-state
      eraSeen: 0,
      pinnacle: false,
      // transient buffs/timers (never trusted from disk)
      combo: 0,
      lastTapAt: 0,
      eventBoomUntil: 0,
      eventFrenzyUntil: 0,
      boostSurgeUntil: 0,
      boostCd: {},
      nextEventAt: 0,
      createdAt: now(),
      lastSaveAt: now(),
      settings: {
        sound: false,
        reduceMotion: false,
        notation: 'standard',
        buyAmount: 1,        // 1 | 10 | 100 | 'max'
        autoBuyer: false     // toggle (only effective once unlocked)
      }
    };
  }

  function num(v, fallback) {
    var n = typeof v === 'number' ? v : parseFloat(v);
    if (!isFinite(n) || Number.isNaN(n)) return fallback;
    return n;
  }

  // Merge a loaded blob onto a fresh default so new schema fields always exist
  // and corrupt/NaN values are repaired. Robust to partial / old saves.
  function sanitize(loaded) {
    var d = defaultState();
    if (!loaded || typeof loaded !== 'object') return d;

    d.cash = Math.max(0, num(loaded.cash, 0));
    d.earnedRun = Math.max(0, num(loaded.earnedRun, 0));
    d.earnedAll = Math.max(0, num(loaded.earnedAll, 0));
    d.investors = Math.max(0, Math.floor(num(loaded.investors, 0)));
    d.investorsSpent = Math.max(0, Math.floor(num(loaded.investorsSpent, 0)));
    d.investorsAllTime = Math.max(d.investors, Math.floor(num(loaded.investorsAllTime, d.investors)));
    d.legacy = Math.max(0, Math.floor(num(loaded.legacy, 0)));
    d.legacySpent = Math.max(0, Math.floor(num(loaded.legacySpent, 0)));
    d.ipos = Math.max(0, Math.floor(num(loaded.ipos, 0)));
    d.dynasties = Math.max(0, Math.floor(num(loaded.dynasties, 0)));
    d.taps = Math.max(0, Math.floor(num(loaded.taps, 0)));
    d.eventsCaught = Math.max(0, Math.floor(num(loaded.eventsCaught, 0)));
    d.insight = Math.max(0, num(loaded.insight, 0));
    d.insightTotal = Math.max(d.insight, num(loaded.insightTotal, d.insight));
    d.boostsUsed = Math.max(0, Math.floor(num(loaded.boostsUsed, 0)));
    d.eraSeen = Math.max(0, Math.min(data.ERAS.length - 1, Math.floor(num(loaded.eraSeen, 0))));
    d.pinnacle = !!loaded.pinnacle;
    d.createdAt = num(loaded.createdAt, d.createdAt);
    d.lastSaveAt = num(loaded.lastSaveAt, d.lastSaveAt);

    // never trust live combo/event/boost timers from disk
    d.combo = 0; d.lastTapAt = 0;
    d.eventBoomUntil = 0; d.eventFrenzyUntil = 0; d.nextEventAt = 0;
    d.boostSurgeUntil = 0; d.boostCd = {};

    if (loaded.businesses) {
      for (var i = 0; i < BUSINESSES.length; i++) {
        var id = BUSINESSES[i].id;
        var lb = loaded.businesses[id];
        if (lb) {
          d.businesses[id].owned = Math.max(0, Math.floor(num(lb.owned, d.businesses[id].owned)));
          var p = num(lb.progress, 0);
          d.businesses[id].progress = (p >= 0 && p < 1) ? p : 0;
          d.businesses[id].manager = !!lb.manager;
          d.businesses[id].running = !!lb.running;
        }
      }
    }

    copyFlags(d.upgrades, loaded.upgrades);
    copyFlags(d.board, loaded.board);
    copyFlags(d.achievements, loaded.achievements);
    copyFlags(d.dynastyPerks, loaded.dynastyPerks);
    copyFlags(d.innovations, loaded.innovations);

    if (loaded.settings && typeof loaded.settings === 'object') {
      d.settings.sound = !!loaded.settings.sound;
      d.settings.reduceMotion = !!loaded.settings.reduceMotion;
      d.settings.notation = loaded.settings.notation === 'scientific' ? 'scientific' : 'standard';
      var ba = loaded.settings.buyAmount;
      d.settings.buyAmount = (ba === 1 || ba === 10 || ba === 100 || ba === 'max') ? ba : 1;
      d.settings.autoBuyer = !!loaded.settings.autoBuyer;
    }
    return d;
  }

  function copyFlags(target, src) {
    if (!src || typeof src !== 'object') return;
    for (var k in src) if (src[k]) target[k] = true;
  }

  // ---- persistence (browser) ----
  function hasStorage() {
    try { return typeof localStorage !== 'undefined' && localStorage !== null; }
    catch (e) { return false; }
  }

  function save(state) {
    if (!hasStorage()) return false;
    try {
      state.lastSaveAt = now();
      localStorage.setItem(SAVE_KEY, JSON.stringify(state));
      return true;
    } catch (e) { return false; }
  }

  function load() {
    if (!hasStorage()) return null;
    try {
      var raw = localStorage.getItem(SAVE_KEY);
      if (!raw) return null;
      var parsed = JSON.parse(raw);
      return sanitize(parsed);
    } catch (e) { return null; }
  }

  function wipe() {
    if (!hasStorage()) return;
    try { localStorage.removeItem(SAVE_KEY); } catch (e) {}
  }

  // ---- export / import (portable, cross-runtime base64) ----
  function b64encode(str) {
    if (typeof btoa !== 'undefined') return btoa(unescape(encodeURIComponent(str)));
    return Buffer.from(str, 'utf8').toString('base64');
  }
  function b64decode(b64) {
    if (typeof atob !== 'undefined') return decodeURIComponent(escape(atob(b64)));
    return Buffer.from(b64, 'base64').toString('utf8');
  }

  function exportSave(state) {
    return b64encode(JSON.stringify(state));
  }
  function importSave(code) {
    var json = b64decode(String(code).trim());
    var parsed = JSON.parse(json);
    return sanitize(parsed);
  }

  return {
    SCHEMA_VERSION: SCHEMA_VERSION,
    SAVE_KEY: SAVE_KEY,
    now: now,
    defaultState: defaultState,
    sanitize: sanitize,
    save: save,
    load: load,
    wipe: wipe,
    exportSave: exportSave,
    importSave: importSave
  };
});
