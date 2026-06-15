# MOGUL — *Build your empire*

A premium idle business tycoon, made to be played on iPhone. Start with a lemonade
stand and grow into a galaxy-spanning conglomerate.

**Play:** open the GitHub Pages URL in Safari, then **Share → Add to Home Screen**
for a full-screen, offline app.

## Features
- 10 businesses with managers, milestone multipliers, and dozens of upgrades
- **The Hustle** — tap to earn, with a combo multiplier
- **IPO / Go Public** (prestige) → permanent Investors + a Boardroom upgrade tree
- **Dynasty** (deep prestige) → permanent Legacy multipliers
- **Market Events** — tap floating opportunities for booms, frenzies, and windfalls
- Achievements with real bonuses, full stats, offline earnings
- Installable PWA, works offline, autosaves (survives the tab being closed)
- Premium "luxury wealth" design — near-black + brushed gold + money-green

## Tech
Zero dependencies, no build step. Vanilla HTML/CSS/JS. Pure game logic is
unit-tested (`tests/` — run with `node tests/format.test.js` and
`node tests/game.test.js`); economy pacing via `node tests/economy.sim.js`.

Made with care. 🥂
