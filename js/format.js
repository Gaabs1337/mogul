/*
 * MOGUL — format.js
 * Pure number / money / time formatting.
 * Works in the browser (attaches to window.MOGUL.format) and in Node (module.exports)
 * so the same code is unit-tested.
 *
 * Design goals:
 *  - Always 3 significant figures in the suffix range (1.23K, 12.3K, 123K).
 *  - Named suffixes through "Dc" (1e33), then algorithmic two-letter suffixes
 *    (aa, ab, ...), then graceful scientific fallback.
 *  - Optional pure-scientific notation (user setting).
 *  - NEVER returns "NaN"/"Infinity" — guarded to keep the UI clean.
 */
(function (root, factory) {
  'use strict';
  var api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.MOGUL = root.MOGUL || {};
  root.MOGUL.format = api;
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';

  // Named suffixes: index i represents 10^(3i).
  var NAMED = ['', 'K', 'M', 'B', 'T', 'Qa', 'Qi', 'Sx', 'Sp', 'Oc', 'No', 'Dc'];

  // Generate the suffix for a given tier (1 tier = 3 orders of magnitude).
  function suffixFor(tier) {
    if (tier < NAMED.length) return NAMED[tier];
    // After the named list, use double-letter suffixes: aa, ab, ... az, ba, ...
    var idx = tier - NAMED.length; // 0 -> 'aa'
    var first = Math.floor(idx / 26);
    var second = idx % 26;
    if (first > 25) {
      // Astronomically large — caller falls back to scientific instead.
      return null;
    }
    return String.fromCharCode(97 + first) + String.fromCharCode(97 + second);
  }

  // Trim a "small" number (< 1000) to a clean string: integers stay integer,
  // otherwise up to `dec` decimals with trailing zeros removed.
  function trimSmall(n, dec) {
    if (dec === undefined) dec = 2;
    if (Number.isInteger(n)) return String(n);
    var s = n.toFixed(dec);
    // strip trailing zeros and a dangling dot
    s = s.replace(/\.?0+$/, '');
    return s;
  }

  function toScientific(n, dec) {
    if (dec === undefined) dec = 2;
    // n is positive finite here
    var s = n.toExponential(dec); // "1.23e+45"
    return s.replace('e+', 'e').replace('e-', 'e-');
  }

  /**
   * Core scaled formatter (no currency symbol).
   * @param {number} n
   * @param {object} [opts] { sci:boolean }
   */
  function scaled(n, opts) {
    opts = opts || {};
    if (n === null || n === undefined || Number.isNaN(n)) return '0';
    if (!isFinite(n)) return n > 0 ? '∞' : '-∞';

    var sign = n < 0 ? '-' : '';
    n = Math.abs(n);

    if (n < 1000) {
      // round to 2 dp; if rounding pushes to >= 1000 fall through to suffix path
      var rounded = Math.round(n * 100) / 100;
      if (rounded < 1000) return sign + trimSmall(rounded, 2);
      n = rounded;
    }

    if (opts.sci) return sign + toScientific(n, 2);

    var exp = Math.floor(Math.log10(n));
    var tier = Math.floor(exp / 3);
    var mantissa = n / Math.pow(10, tier * 3);

    // Floating point can leave mantissa at e.g. 999.9999 or 1000.0001 — normalize.
    if (mantissa >= 1000) {
      mantissa /= 1000;
      tier += 1;
    }

    // Render mantissa+tier to exactly 3 significant figures, handling the two
    // ways rounding can spill across a boundary:
    //   1) mantissa rounds up to >= 1000  -> carry into the next tier
    //   2) mantissa rounds up across a decimal bracket (9.999 -> 10.0, 99.96 -> 100)
    //      -> drop a decimal so we keep 3 sig figs, not 4
    var out = render(mantissa, tier);
    if (out === null) return sign + toScientific(n, 2); // beyond suffix table
    return sign + out;
  }

  function render(mant, tier) {
    var dec = mant < 10 ? 2 : mant < 100 ? 1 : 0;
    var val = parseFloat(mant.toFixed(dec));
    if (val >= 1000) return render(val / 1000, tier + 1); // carry
    var dec2 = val < 10 ? 2 : val < 100 ? 1 : 0;
    if (dec2 < dec) dec = dec2; // rounding crossed a bracket
    var suffix = suffixFor(tier);
    if (suffix === null) return null;
    return val.toFixed(dec) + suffix;
  }

  /** Money with a leading $. */
  function money(n, opts) {
    if (n === null || n === undefined || Number.isNaN(n)) return '$0';
    if (!isFinite(n)) return n > 0 ? '$∞' : '-$∞';
    var sign = n < 0 ? '-' : '';
    return sign + '$' + scaled(Math.abs(n), opts);
  }

  /** A per-second rate, e.g. "$1.2K/s". */
  function rate(n, opts) {
    return money(n, opts) + '/s';
  }

  /** A multiplier, e.g. "×2", "×1.50", "×1.23K". */
  function mult(n, opts) {
    if (n === null || n === undefined || Number.isNaN(n)) return '×1';
    if (!isFinite(n)) return '×∞';
    if (n < 1000) {
      if (Number.isInteger(n)) return '×' + n;
      return '×' + trimSmall(Math.round(n * 100) / 100, 2);
    }
    return '×' + scaled(n, opts);
  }

  /** A whole count (businesses owned, achievements, etc.). */
  function count(n, opts) {
    return scaled(n, opts);
  }

  /**
   * Human duration. Shows the two largest non-zero units.
   *  90 -> "1m 30s", 3661 -> "1h 1m", 90000 -> "1d 1h", 45 -> "45s"
   */
  function time(seconds) {
    if (seconds === null || seconds === undefined || Number.isNaN(seconds) || !isFinite(seconds)) return '0s';
    seconds = Math.max(0, Math.floor(seconds));
    if (seconds < 60) return seconds + 's';
    var d = Math.floor(seconds / 86400);
    var h = Math.floor((seconds % 86400) / 3600);
    var m = Math.floor((seconds % 3600) / 60);
    var s = seconds % 60;
    if (d > 0) return d + 'd ' + h + 'h';
    if (h > 0) return h + 'h ' + m + 'm';
    return m + 'm ' + s + 's';
  }

  /**
   * Compact cycle duration for badges. Shows decimals for sub-minute.
   *  0.5 -> "0.5s", 12 -> "12s", 90 -> "1m 30s"
   */
  function duration(seconds) {
    if (seconds === null || seconds === undefined || Number.isNaN(seconds) || !isFinite(seconds)) return '0s';
    if (seconds < 1) return (Math.round(seconds * 100) / 100) + 's';
    if (seconds < 60) return (Math.round(seconds * 10) / 10) + 's';
    return time(seconds);
  }

  return {
    scaled: scaled,
    money: money,
    rate: rate,
    mult: mult,
    count: count,
    time: time,
    duration: duration,
    _suffixFor: suffixFor // exposed for tests
  };
});
