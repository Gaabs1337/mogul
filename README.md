# MOGUL — *Build your empire*

A premium idle business tycoon, made to be played on iPhone. Start with a lemonade
stand and grow into a galaxy-spanning conglomerate.

**Play:** open the GitHub Pages URL in Safari, then **Share → Add to Home Screen**
for a full-screen, offline app.

## Features
- 10 businesses with managers, milestone multipliers, and dozens of upgrades
- **A living skyline** — an animated cityscape that grows with your empire and
  shifts through the eras (dawn → day → dusk → starlit deep space)
- **The Hustle** — tap to earn, with a combo multiplier
- **Challenges** — opt-in restricted runs (Bootstrapped, Lean, Frugal, Blitz…)
  for permanent rewards
- **Boardroom Decisions** — periodic strategic choices with real trade-offs
- **Eras** — a journey from Street Vendor to Cosmic Magnate, each a new chapter
- **R&D / Innovations** — a slow-burning *Insight* resource spent on a tree of
  rule-changing unlocks (Franchise Model, Synergy, Economies of Scale, …)
- **Active Boosts** — Surge & Cash Injection on cooldowns, so late game stays active
- **IPO / Go Public** (prestige) → permanent Investors + a Boardroom upgrade tree
- **Dynasty** (deep prestige) → permanent Legacy multipliers
- **Market Events** — tap floating opportunities for booms, frenzies, and windfalls
- **The Pinnacle** — a real "you built it" win-state, then keep going forever
- Achievements with real bonuses, full stats, generous offline earnings
- Time-to-afford estimates, buy-max, autosave (survives the tab being closed)
- Installable PWA, works offline
- Premium "luxury wealth" design — near-black + brushed gold + money-green

## Tech
Zero dependencies, no build step. Vanilla HTML/CSS/JS. Pure game logic is
unit-tested (`tests/` — run with `node tests/format.test.js` and
`node tests/game.test.js`); economy pacing via `node tests/economy.sim.js`.

Made with care. 🥂
