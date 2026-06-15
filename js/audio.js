/*
 * MOGUL — audio.js
 * Tiny synthesized SFX via WebAudio (no asset files → works offline instantly).
 * Lazily unlocked on first user gesture (iOS requirement). Off by default.
 */
(function (root) {
  'use strict';
  var ctx = null;
  var enabled = false;
  var master = null;

  function ensure() {
    if (ctx) return ctx;
    try {
      var AC = root.AudioContext || root.webkitAudioContext;
      if (!AC) return null;
      ctx = new AC();
      master = ctx.createGain();
      master.gain.value = 0.22;
      master.connect(ctx.destination);
    } catch (e) { ctx = null; }
    return ctx;
  }

  // Call from within a user gesture to satisfy autoplay policies.
  function unlock() {
    var c = ensure();
    if (c && c.state === 'suspended') c.resume();
  }

  function setEnabled(on) {
    enabled = !!on;
    if (enabled) unlock();
  }
  function isEnabled() { return enabled; }

  function tone(freq, dur, type, vol, when) {
    var c = ensure();
    if (!c) return;
    var t0 = c.currentTime + (when || 0);
    var osc = c.createOscillator();
    var g = c.createGain();
    osc.type = type || 'sine';
    osc.frequency.setValueAtTime(freq, t0);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(vol || 0.5, t0 + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(g); g.connect(master);
    osc.start(t0); osc.stop(t0 + dur + 0.02);
  }

  function play(kind) {
    if (!enabled) return;
    var c = ensure();
    if (!c || c.state !== 'running') { if (c) c.resume(); return; }
    switch (kind) {
      case 'tap':     tone(420 + Math.random() * 30, 0.06, 'triangle', 0.18); break;
      case 'buy':     tone(660, 0.07, 'triangle', 0.3); tone(990, 0.09, 'sine', 0.22, 0.04); break;
      case 'manager': tone(523, 0.08, 'sine', 0.3); tone(784, 0.12, 'sine', 0.25, 0.06); break;
      case 'upgrade': tone(700, 0.07, 'square', 0.16); tone(1040, 0.1, 'sine', 0.2, 0.05); break;
      case 'milestone':
        [523, 659, 784].forEach(function (fz, i) { tone(fz, 0.16, 'sine', 0.28, i * 0.07); });
        break;
      case 'event':   tone(880, 0.1, 'sine', 0.3); tone(1320, 0.14, 'sine', 0.24, 0.07); break;
      case 'ipo':
        [392, 523, 659, 784, 1047].forEach(function (fz, i) { tone(fz, 0.22, 'sine', 0.3, i * 0.09); });
        break;
      case 'error':   tone(160, 0.12, 'sawtooth', 0.12); break;
    }
  }

  root.MOGUL = root.MOGUL || {};
  root.MOGUL.audio = { unlock: unlock, setEnabled: setEnabled, isEnabled: isEnabled, play: play };
})(typeof window !== 'undefined' ? window : this);
