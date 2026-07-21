# One More Tower

A daily, community-built stacking game for Reddit. Everyone contributes to the
**same** tower — one object at a time, up to three drops a day. Balance it,
don't topple it, and climb the all-time leaderboard.

## How to play

1. Tap **ENTER** on the post to open the tower.
2. Pick an object — **Safe** (+100), **Risky** (+250), or **Absurd** (+500 points).
3. Drag to aim, rotate, then **DROP**.
4. If it lands and the tower stays standing, it's saved as part of the shared
   tower for the next player.
5. You get **3 drops per day** — every drop counts, even a wobble that falls.
   The quota resets at **00:00 UTC**, and a live timer counts down to the reset.

## Scoring & leaderboard

- Bolder objects are worth more points, so risk is rewarded.
- Your points add to a **permanent, all-time leaderboard** of real Reddit
  players — updated live as everyone plays.
- The community tower persists: it keeps growing across sessions.

## Built with

- [Devvit](https://developers.reddit.com/) — Reddit's Developer Platform
- [Phaser](https://phaser.io/) with Matter.js — physics + rendering
- [React](https://react.dev/) + [Vite](https://vite.dev/) +
  [Tailwind](https://tailwindcss.com/) — the web view
- [Hono](https://hono.dev/) — server logic
- [TypeScript](https://www.typescriptlang.org/) — type safety

## Commands

- `npm run dev` — playtest live on Reddit
- `npm run build` — build the client + server bundles
- `npm run deploy` — type-check, lint, and upload a new version
- `npm run launch` — deploy, then publish for review
- `npm run login` — log the CLI into Reddit
