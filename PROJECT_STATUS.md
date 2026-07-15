# One More Thing — Project Status

_Task 0: Repository Audit & Implementation Plan. Last updated after the Phase 1→2 vertical slice._

> **Important context:** this repository is **no longer a bare template**. A working
> vertical slice (shared tower → place object → stability/collapse → persist → reload)
> has already been implemented on top of the Devvit React starter. This audit records
> both the preserved template configuration and the current implementation state.

---

## Audit answers (1–17)

| # | Question | Finding |
|---|---|---|
| 1 | Devvit template in use | **Devvit React starter** (`npm create devvit --template=react`), `@devvit/web` flavour (NOT Devvit blocks / `@devvit/public-api`). |
| 2 | Installed Devvit version | **0.13.8** (`devvit`, `@devvit/web`, `@devvit/start` all pinned to 0.13.8). |
| 3 | Installed Phaser version | **3.90.0** (added this session; Matter ships inside it — no separate `matter-js` dep). |
| 4 | Matter physics enabled? | **Yes.** Configured in [src/client/phaser/boot.ts](src/client/phaser/boot.ts) → `physics: { default: 'matter', matter: { gravity, enableSleeping: true } }`. Was NOT enabled in the original template. |
| 5 | Client entry point | **Two entrypoints** (per `devvit.json`): `splash.html`→[src/client/splash.tsx](src/client/splash.tsx) (inline feed view, `inline: true`), `game.html`→[src/client/game.tsx](src/client/game.tsx) (expanded view, hosts Phaser). |
| 6 | Server entry point | [src/server/index.ts](src/server/index.ts) → bundled to `dist/server/index.cjs`. Hono app served via `@hono/node-server` + `createServer`/`getServerPort` from `@devvit/web/server`. |
| 7 | Shared-types location | [src/shared/](src/shared/): `types.ts`, `api.ts`, `config.ts`, `objects.ts`, `rng.ts`. Its own tsconfig project (`WebWorker` lib, no DOM). |
| 8 | API routing structure | Hono. `/api/*` = gameplay (`api`, `attempt`, `placement` sub-routers); `/internal/*` = Devvit plumbing (`menu`, `form`, `triggers`). Client calls via plain `fetch` + shared typed contracts (NOT tRPC — AGENTS.md mentions tRPC but it is not installed). |
| 9 | Redis access | `import { redis } from '@devvit/web/server'`. Used: `get/set` (+ `nx`), `hSet/hGetAll/hSetNX`, `zAdd`, `expire`, `del`, and **`watch → multi → exec`** transactions for optimistic concurrency. |
| 10 | Reddit identity | `context.userId` / `context.username` (from `@devvit/web/server`), with `reddit.getCurrentUsername()` as fallback. `userId` is the stable player key; may be `undefined` when logged out. |
| 11 | Interactive post creation | `reddit.submitCustomPost({ title })` in [src/server/core/post.ts](src/server/core/post.ts). Invoked by the subreddit menu item `/internal/menu/post-create` and the `onAppInstall` trigger, both registered in `devvit.json`. |
| 12 | npm scripts | `build` (vite), `dev` (`devvit playtest`), `deploy` (`type-check && lint && devvit upload`), `launch` (`deploy && devvit publish`), `lint`, `login`, `prettier`, `type-check` (`tsc --build`). |
| 13 | TypeScript strict mode | **Yes**, and stricter: `tsconfig.base.json` sets `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes` (client/shared), `noUnusedLocals/Parameters`, `isolatedModules`. Project rule: **never use `as` casts** (AGENTS.md). |
| 14 | Does it build? | **Yes.** `npm run type-check` ✅, `eslint` ✅, `npm run build` ✅ (Phaser isolated in `game.js` ≈1.2 MB; splash stays light). |
| 15 | Runs inside a Reddit playtest post? | **Not yet verified.** Config is correct for it, but end-to-end requires interactive `devvit login` + `npm run dev` against a test subreddit (`dev.subreddit: one_more_tower_dev`). This is the single outstanding verification gate. |
| 16 | Starter files safe to replace | Already replaced: `game.tsx` counter UI, `useCounter` hook (deleted), counter API (`increment`/`decrement`), splash placeholder. Still-present template remnants that MAY be removed later: `src/server/routes/forms.ts` (example form) + its `example-form` menu item, `public/snoo.png`, `src/client/global.ts`. |
| 17 | Config that MUST be preserved | `devvit.json` (post entrypoints, server entry, menu/forms/triggers, dev subreddit), `vite.config.ts` (`@devvit/start/vite` plugin + react + tailwind), the `tsconfig` project tree under `tools/`, `eslint.config.js`, `package.json` Devvit deps, `src/client/*.html` entrypoints, `src/client/index.css` (`@import 'tailwindcss'`), `src/client/module.d.ts`. |

---

## A. Current repository map

```
one-more-tower/
├── devvit.json               [PRESERVE] post entrypoints, server entry, menu/forms/triggers, dev sub
├── vite.config.ts            [PRESERVE] devvit()+react()+tailwind() plugins
├── tsconfig.json + tools/*   [PRESERVE] composite project refs (client/server/shared/vite)
├── eslint.config.js          [PRESERVE] (edited: MatterJS global registered for client)
├── package.json              [PRESERVE deps] scripts + Devvit 0.13.8 + phaser 3.90
├── AGENTS.md / README.md
├── PROJECT_STATUS.md         (this file)
├── public/snoo.png           [template remnant]
└── src/
    ├── shared/               ← implemented
    │   ├── config.ts         WORLD coords, RULES, VALIDATION, SCORING (client+server source of truth)
    │   ├── types.ts          TowerMeta/State, PersistedBodyState, Placement, Attempt, PlayerDailyState
    │   ├── api.ts            request/response contracts + SubmittedBody
    │   ├── objects.ts        OBJECT_LIBRARY (5 objects, tiered) + lookups
    │   └── rng.ts            seeded mulberry32 PRNG
    ├── server/               ← implemented (Hono)
    │   ├── index.ts          [MODIFIED template] mounts /api, /api/attempt, /api/placement, /internal
    │   ├── core/
    │   │   ├── keys.ts       per-post Redis key builders
    │   │   ├── json.ts       cast-free JSON/hash parse guards
    │   │   ├── tower.ts      load/create + CAS commit (watch/multi/exec) + snapshot/placements
    │   │   ├── attempt.ts    attempt token lifecycle (TTL)
    │   │   ├── player.ts     daily player state, attempt limits, one-success/day
    │   │   ├── choices.ts    seeded 3-tier object offer
    │   │   ├── validate.ts   structural commit validation envelope
    │   │   └── scoring.ts    authoritative score + tower height
    │   ├── core/post.ts      [MODIFIED template] submitCustomPost title
    │   └── routes/
    │       ├── api.ts        [REPLACED counter] /bootstrap, /tower
    │       ├── attempt.ts    /start, /fail
    │       ├── placement.ts  /commit (idempotency + conflict)
    │       ├── menu.ts       [PRESERVE] post-create
    │       ├── triggers.ts   [PRESERVE] onAppInstall → create post
    │       └── forms.ts      [template remnant] example form
    └── client/
        ├── game.html / splash.html      [PRESERVE] entrypoints
        ├── index.css / module.d.ts / global.ts  [PRESERVE]
        ├── game.tsx          [REPLACED] React shell + HUD/screens + loop orchestration
        ├── splash.tsx        [REPLACED] lightweight inline view w/ live stats
        ├── state/api.ts      typed fetch client (cast-free response guards)
        └── phaser/
            ├── boot.ts       Phaser.Game config (Matter, RESIZE scale)
            ├── bridge.ts     typed React↔Phaser conduit (GameBridge)
            ├── bodyFactory.ts Matter body + placeholder graphics from object defs
            ├── stability.ts  kinetic-energy settle metric
            └── scenes/TowerScene.ts  reconstruct/place/drop/settle/collapse/camera
```

---

## B. Proposed final folder structure (target through P1)

Additive to the map above — no restructuring of what exists. New files land in these slots:

```
src/shared/
    milestones.ts      milestone thresholds + labels (shared for client display)
    modifiers.ts       daily modifier definitions (P1)
src/server/core/
    leaderboard.ts     zSet reads/writes (daily + all-time) (P1)
    milestones.ts      unlock detection on commit (P1)
    finalize.ts        daily finalization + next-post creation (P1, scheduler)
    streak.ts          builder streak (P1)
src/server/routes/
    leaderboard.ts     GET /api/leaderboard (P1)
    archive.ts         GET /api/archive (P2)
    scheduler.ts       internal scheduler job handler (P1)
src/client/phaser/
    scenes/PreloadScene.ts   asset/atlas + audio load (P1)
    effects/particles.ts     dust/sparks/confetti (P1)
    effects/audio.ts         material collision SFX + mute (P1)
    effects/slowmo.ts        collapse slow-motion (P1)
src/client/ui/
    screens/…                Inspect, Results, Leaderboard, Tutorial (P1)
    components/…             ObjectCard, Countdown, MilestoneBar, StatPanel (P1)
src/client/assets/           object sprites/atlas, audio (P1)
```

---

## C. Task-by-task implementation plan

Status legend: ✅ done · 🟡 partial · ⬜ not started.

### Phase 0 — Repo & Devvit validation
- ✅ Confirm template, versions, scripts, entry points, Redis/Reddit/post APIs.
- ✅ type-check + lint + build green.
- ⬜ **Confirm it loads in a live playtest post** (needs `devvit login`; the acceptance gate).

### Phase 1 — Local physics prototype
- ✅ Platform, 5 tiered objects, drag/rotate/drop, Matter collisions, stability detection, success/collapse, reset.

### Phase 2 — Persistent shared tower
- ✅ Tower schema, load accepted placements, save success, restore after refresh, ownership metadata, body reconstruction.

### Phase 3 — Official attempt flow
- ✅ `/attempt/start` (3 seeded choices, token), attempts-remaining, one-success/day, `/attempt/fail`, idempotency on commit.
- ⬜ Dedicated `/attempt/select` (currently folded into commit) — optional.
- ⬜ **Practice Mode** (client-only copy of tower; no server writes).

### Phase 4 — Concurrency safety
- ✅ Tower version, CAS commit, non-punitive conflict response, idempotency key, duplicate-commit guard.
- 🟡 Confirm `exec()` abort semantics on the live runtime (see risks D3).

### Phase 5 — UX & polish
- 🟡 Launch screen, minimal HUD, success/collapse summaries exist.
- ⬜ Real object sprites, tutorial cards, particles, screen-shake tuning, slow-mo collapse, audio + mute, object inspection, reduced-motion.

### Phase 6 — Retention
- 🟡 Daily countdown + per-post daily tower model in place.
- ⬜ Scheduler finalization + next-day post, milestones, builder streak, daily recap, leaderboard, daily modifiers.

### Phase 7 — Reddit integration
- ✅ Custom post creation (menu + install trigger).
- ⬜ Daily post titles/finalization pipeline, comment CTA copy, text fallback, public demo validation.

### Phase 8 — Testing & submission
- ⬜ Mobile/desktop/multi-user/concurrent/slow-network passes, README, demo post, Devpost writeup, 60-second demo script.

---

## D. Technical risks

1. **Devvit API compatibility** — LOW. All used APIs verified against installed `@devvit/*` 0.13.8 type definitions (redis, scheduler, reddit, context). No invented functions. Watch item: `context.username` is marked experimental (fallback to `reddit.getCurrentUsername()` is in place).
2. **Phaser + Matter compatibility** — LOW/MED. Phaser 3.90 bundles Matter; no poly-decomp library, so **collision shapes are kept convex** (rects + one trapezoid). Concave objects (real chairs, sofas) will need compound bodies or a decomp lib later. Bundle is ~1.2 MB — acceptable inside the expanded webview, kept out of the inline splash.
3. **Redis transaction support** — MED. `watch/multi/exec` exist and are typed. **Unverified at runtime:** whether a WATCH-aborted `exec()` returns `[]`/`null` (handled) or throws (would need a try/catch). Must confirm in playtest with a concurrent-commit test.
4. **Daily scheduler support** — LOW (unused so far). `@devvit/scheduler` (`runJob/cancelJob`, cron) is present and typed; finalization job is P1, not yet wired.
5. **Custom post creation** — LOW. `submitCustomPost` verified; menu + trigger wired and registered in `devvit.json`. First-post-on-install path exists.
6. **Mobile viewport constraints** — MED. Phaser uses `Scale.RESIZE` + width-fit zoom; HUD is one-finger drag + large buttons. Needs real-device verification (safe-area, tall towers, pointer capture during drag).
7. **Client/server state synchronization** — MED. Server is authoritative; server **cannot re-simulate physics**, so commit trust is structural only (validation envelope + CAS). Accepted honest limitation (spec §18). Polling/refresh reloads authoritative snapshot; no WebSockets.

---

## E. Feature list by priority

### P0 — required for a complete game (mostly DONE)
- ✅ Shared persistent tower (per-post, Redis)
- ✅ Phaser Matter physics: drag / rotate / drop
- ✅ Stability + collapse detection
- ✅ Success + failure states; failure restores last good tower
- ✅ Player identity; server-enforced attempt limits (3/day) + one success/day
- ✅ Tower version + optimistic-concurrency commit
- ✅ Mobile controls; clear first-screen premise
- ⬜ **Live playtest confirmation** (the remaining P0 gate)

### P1 — winning quality (NOT started unless noted)
- 🟡 Daily countdown (done) · ⬜ daily finalization + next-day post (scheduler)
- ⬜ ≥15 polished objects + real sprites · ⬜ audio + mute · ⬜ particles · ⬜ slow-mo collapse · ⬜ camera polish
- ⬜ Personal object tracking / inspection · ⬜ builder streak · ⬜ milestones · ⬜ daily leaderboard · ⬜ daily recap · ⬜ Practice Mode · ⬜ ≥1 daily modifier · ⬜ tutorial cards · ⬜ error/empty states hardening

### P2 — stretch
- ⬜ Automated multi-day post archive · ⬜ theme voting · ⬜ collapse gallery · ⬜ ghost replays · ⬜ cosmetic skins · ⬜ weekly seasons · ⬜ advanced achievements · ⬜ server-side physics verification

---

---

## Task 1 — Devvit Foundation Validation (added; temporary)

A minimal, cleanly-removable validation harness proving the stack end-to-end.
It does **not** touch tower gameplay.

**Proves:** (1) loads in the interactive post · (2) Phaser canvas renders
(independent mini-game) · (3) client→server call · (4) real Reddit username ·
(5) Redis write · (6) Redis read-back · (7) results shown in a dev panel.

**Files added (all marked TEMPORARY):**
- `src/shared/health.ts` — `HealthResponse` / `HealthErrorResponse` contract.
- `src/server/routes/health.ts` — `GET /api/health`: server status, auth state +
  username (never faked; `null` when signed out), Redis write/read/round-trip,
  `postId`, `serverTime`. Partial failure → `status: 'degraded'` (200); unexpected
  → `health-error` (500). All Redis/identity calls individually try/caught.
- `src/client/dev/healthApi.ts` — typed, cast-free fetch of `/api/health`.
- `src/client/dev/phaserCheck.ts` — standalone minimal Phaser game (proves canvas).
- `src/client/dev/HealthPanel.tsx` — the dev panel (loading / error+retry /
  unauthenticated / success states).

**Wiring (marked with `TASK 1 VALIDATION` comments):**
- `src/server/index.ts` — import + `app.route('/api/health', health)`.
- `src/client/game.tsx` — import + `DEV_PANEL_ENABLED` flag + a "🔧 check" toggle
  button and `<HealthPanel/>` block.

**Checks:** `type-check` ✅ · `eslint` ✅ · `build` ✅. No test runner is installed
(`package.json` has no `test` script / vitest), so there are no existing tests to run.

**Clean removal (later):** delete `src/shared/health.ts`, `src/server/routes/health.ts`,
`src/client/dev/`; then remove the two `TASK 1 VALIDATION` lines in `index.ts` and the
marked import + block in `game.tsx`. No game code depends on any of it.

**Status:** code-complete + builds; **live playtest confirmation still pending**
(this harness exists specifically to make that confirmation one glance).

---

## Task 2 — Phaser Game Shell & Responsive Viewport (added)

Formalized the Phaser architecture into a multi-scene shell and hardened the
viewport. **No persistent gameplay was added** — the existing tower logic in
TowerScene was left intact.

**Scene structure (`src/client/phaser/scenes/`):**
- `BootScene` — tiny entry scene; hands off to Preload.
- `PreloadScene` — loading bar (progress-driven), asset load (`/snoo.png`
  placeholder), `loaderror` → geometric-fallback flag; then starts Tower + launches UI.
- `TowerScene` — world shell: background, **foundation platform**, faint
  **"tower area"** boundary, camera, responsive zoom. (Also still hosts the
  earlier gameplay methods.)
- `UIScene` — parallel overlay scene for **dev-only debug readout** (fps / view
  size / zoom / body count / phase) + asset-fallback banner.

**Naming/architecture decision:** kept the recommended `Boot/Preload/Tower/UI`
names. Divergence from a typical Phaser HUD-in-UIScene: the game's real HUD lives
in **React/DOM over the canvas** (faster responsive/accessible UI, Task-1 pattern),
so `UIScene` is scoped to canvas-space debug/overlay only. Scenes needing
dependencies (`bridge`, shared `DebugModel`) are instantiated in `boot.ts` and
passed via constructors — no untyped cross-scene/registry lookups.

**Shell features:** Matter physics active; `Scale.RESIZE` + width-fit/`min-height`
zoom; `index.css` locks `html/body/#root` to full height, `overflow:hidden`,
`overscroll-behavior:none`, `canvas { touch-action:none }` → no page scroll, no
mobile rubber-banding, resizes correctly, no keyboard dependency. Empty tower area
+ platform render immediately (before any tower data). Debug gated by `SHOW_DEBUG`
in `phaser/debug.ts` (flip to false for submission).

**Checks:** type-check ✅ · eslint ✅ · build ✅.

---

## Task 3 — Local Physics Vertical Slice (added)

A standalone, server-free physics playground on its own `sandbox` post entrypoint.
No Redis, no scoring, no attempts.

**Files added:**
- `src/client/sandbox.html` + `src/client/sandbox.tsx` — dedicated entrypoint +
  React control bar (rotate ⟲/⟳, DROP, Reset, Spawn/Swap next).
- `src/client/phaser/scenes/SandboxScene.ts` — local physics loop.
- `src/client/phaser/sandbox.ts` — `SandboxController` + `SANDBOX_OBJECT_IDS`.
- `src/client/phaser/sandboxBoot.ts` — standalone Phaser game (SandboxScene only).
- `src/shared/objects.ts` — added a 6th object, `box`, so the 5 test objects are
  exactly: **box, book, brick, chair, fridge**.

**Wiring:** `devvit.json` gains a `sandbox` entrypoint (additive); `splash.tsx` has
a marked dev launcher (`🧪 open physics sandbox`) via `requestExpandedMode('sandbox')`.
Build confirmed it emits `dist/client/sandbox.html` + `sandbox.js`.

**Implements:** platform; 5 objects; Matter bodies + gravity; `enableSleeping`
(auto sleep/wake); `collisionstart` impact camera-shake; pointer drag (mouse+touch,
horizontal, bounded); rotate L/R + drop + reset; **gravity off until drop**; object
**locks after drop** (moved into `placed[]`, drag ignores it); dropped objects stay
physical; platform is static (no fall-through, `slop` tuned); **velocity clamp**
(linear 34 / angular 0.9) to prevent tunnelling/explosions; keyboard as *secondary*
(A/D/←/→ rotate, Space drop, N next, R reset); no multi-touch rotation.

**Not included (by task):** Redis persistence, scoring, attempts.

**Checks:** type-check ✅ · eslint ✅ · build ✅ (sandbox entrypoint emitted).

### Manual test cases (run in the `sandbox` view)
1. **Straight drop** — Spawn box, don't rotate, DROP over platform centre → lands flat and rests.
2. **Rotated drop** — Spawn book, ⟲/⟳ a few steps, DROP → lands at that angle, settles or tips believably.
3. **Edge placement** — Drag to the far left/right of the "tower area", DROP → teeters at the platform edge; can topple off (stays physical, no crash).
4. **Heavy-object impact** — Spawn fridge, DROP from height → camera shake fires on impact; nearby objects react.
5. **Multiple stacked objects** — Spawn→drop repeatedly (box→book→brick→chair→fridge, then wraps); each new object rests on the previous; earlier objects remain physical and can shift/topple.
6. **Mobile touch controls** — On a phone: one-finger drag moves the object; big ⟲/⟳/DROP buttons work; **no pinch/two-finger needed**; page doesn't scroll or rubber-band.
7. **Post-drop lock** — After DROP, dragging does nothing until the next spawn (object is committed).
8. **Reset** — Reset clears everything and re-spawns the first object.

---

## Task 4 — Object Catalogue Architecture (added)

Replaced ad-hoc object creation with a typed, validated catalogue + one factory.

**Catalogue (`src/shared/objects.ts`, pure — no Phaser):**
- Extended `GameObjectDef`: id, name, difficulty, baseScore, **shape** (rect /
  circle / poly / **compound**), **scale**, fill/stroke, density, friction,
  frictionStatic, **frictionAir**, restitution, material (audio category),
  safeRotationDeg, **spawnOffsetY**, blurb. (Mass is Matter-derived from
  density × area.)
- **15 objects, 5 per tier** — safe: box, book, brick, cushion, tray · risky:
  chair, desk lamp, tyre, television, potted plant · absurd: refrigerator, sofa,
  bathtub, canoe, giant rubber duck. Irregular ones (chair, lamp, plant, sofa,
  bathtub, duck) use **compound bodies**; tyre is a circle; canoe a convex poly.
- `validateCatalogue()` — checks finite numbers, positive sizes, well-formed
  shapes, unique ids, ≥1 per tier. **Verified: 15 objects, 5/5/5, 0 errors.**

**One factory (`src/client/phaser/bodyFactory.ts`): `createObject()`**
- Builds Matter body + synced view `Container` for every shape kind.
- Compound = area-weighted rect centroid; poly = area centroid — so the body's
  origin is deterministic, which makes **reconstruction from a persisted
  transform stable** (same call rebuilds a spawned or a saved object identically).
- TowerScene + SandboxScene both refactored onto it (single creation path).

**Client can't invent object IDs:** server issues choices + `validateCommit`
rejects any objectId not in the catalogue; bodyId (per-instance) stays distinct
from objectId (catalogue key).

**Dev object gallery** — new `gallery` post entrypoint (`gallery.html` /
`gallery.tsx` / `GalleryScene` / `galleryBoot`): renders all 15 in a labelled
grid (name · tier · score), **tap-to-drop** to test each object's physics, Reset,
and a live catalogue-validation banner. Reached from a marked splash launcher
(alongside the Task-3 sandbox). Build confirmed `dist/client/gallery.html`.

**Not added (by task):** official attempt rules (already exist from earlier work;
unchanged here).

**Checks:** type-check ✅ · eslint ✅ · build ✅ · catalogue validator ✅.

---

## Task 5 — Tower Stability Detection (added)

Replaced the inline settle heuristic with a reusable, **pure, unit-tested**
stability evaluator. Success requires the WHOLE tower to hold still — never mere
contact.

**Pure module (`src/client/phaser/stability.ts`, no Phaser):**
- Types: `BodyMotion`, `StabilityConfig`, `StabilityState`, `StabilityFrame`,
  `StabilityStatus = 'pending' | 'stable' | 'failed' | 'timed-out'`,
  `StabilityLabel = 'hold' | 'standing' | 'locked'` + `STABILITY_LABEL_TEXT`
  (Hold… / Still standing… / Locked!).
- Helpers: `linearMotion`, `angularMotion`, `combinedMotion`, `isBodyStable`
  (per-body linear + angular + combined checks; static/sleeping ⇒ stable),
  `allBodiesStable`.
- Reducer: `createStabilityState` → `beginEvaluation(now)` (first meaningful
  collision) → `stepStability(state, frame, cfg)` per frame. Tracks consecutive
  stable time, requires ≈1.8s continuous stability, times out at ≈6s, and fails
  immediately on a scene-reported hard fall.

**Scene integration (`TowerScene`):**
- `collisionstart` detects first contact of the active body (compound-part
  aware) → `beginEvaluation`. Each frame samples the whole tower into
  `BodyMotion[]` and steps the evaluator; `stable` → success, `failed` /
  `timed-out` → collapse. `hasFallen()` supplies the hard-fail signal.
- HUD shows the live label (Hold… / Still standing… / Locked!) via a new
  `bridge.onStabilityLabel`; **no raw physics numbers shown to players.**
- Dev-only viz (`SHOW_DEBUG`): green/red dot per body + `status/label` in the
  UIScene readout.

**Tests (`stability.test.ts`, vitest — `npm run test`): 12 passing**, covering
all required scenarios: stable flat, stable rotated, slow rocking (→ timed-out),
continuous sliding (→ timed-out), fall after several seconds (→ failed), an
existing tower body going unstable (→ blocks success), tiny harmless jitter
(→ stable), plus "touch alone is not success" and the pure helpers.

**Tooling:** added `vitest` (dev) + `test` script + `vitest.config.ts`
(standalone from the Devvit vite plugin). `npm run test` = `vitest run`.

**Checks:** type-check ✅ · eslint ✅ · **test ✅ (12/12)** · build ✅.

---

## Task 6 — Collapse Detection & Entertaining Failure (added)

Completed failure detection + a restore-safe, entertaining collapse sequence.
Still no Redis writes.

**Failure conditions (`TowerScene.hasFallen`, fed to the stability evaluator):**
new object below fail line · existing object below fail line · out of horizontal
world bounds · unstable past the ~6s timeout (`timed-out`) · **invalid physics
state** (NaN/Infinity position or angle) · **foundation cleared** (all accepted
bodies knocked off).

**Pre-attempt snapshot + restore:**
- Each `Entry` now carries its authoritative `PersistedBodyState`. On every
  `drop()` a local `preAttemptSnapshot` (positions **+ ownership**) is captured.
- On collapse, `buildAccepted(preAttemptSnapshot)` **clears everything first**
  (so no duplicate bodies) then rebuilds — restored bodies keep exact positions
  and ownership. Restore happens **locally in the scene** (no server round-trip);
  React no longer reloads the tower on collapse.

**Collapse sequence (`finishCollapse`):** phase → `collapsing` (input stays
disabled), brief **slow motion** (Matter `timing.timeScale`), impact-scaled
**camera shake**, **particle burst** at the fastest body, **audio hook**
(`playImpact`, prepared no-op module), then after ~1.5s: restore + a random
**humorous message** (the spec's lines) surfaced via `SettleResult.message` →
HUD. Controls return (retry/practice).

**Robustness:** the restore runs in `try/finally` — time scale is reset and the
settle is emitted even if rebuild throws; `resetTimeScale` also fires on scene
`SHUTDOWN` and at the start of each `drop`. `clearEntry` is exception-guarded.
**Reduced-motion** (`prefers-reduced-motion`) skips slow-mo/shake/particles/flash
and shortens the delay to ~250ms.

**Checks:** type-check ✅ · eslint ✅ · test ✅ (12/12) · build ✅.

### Manual tests (run in the playtest post; start an attempt, then drop)
Watch the object count in the top bar — after any collapse it must return to its
pre-drop value (no duplicates, positions intact).
1. **New object falls off** — drop so it misses the tower and drops past the
   bottom → collapse + restore.
2. **Existing object falls off** — drop hard against an edge object so it's
   knocked below the fail line → collapse.
3. **Exits horizontal bounds** — drop a tyre/bouncy object at the far edge so it
   shoots out the side → collapse.
4. **Settle timeout** — build a tall wobbly stack that never settles within ~6s →
   "timed-out" collapse (watch the dev readout show `timed-out`).
5. **Foundation cleared** — drop a refrigerator onto a small tower so everything
   is swept off → collapse.
6. **Invalid state** — defensive (NaN/Infinity guard); not normally reachable by
   hand. Confirmed by the guard + unit-tested `hardFail` path.
7. **Slow-mo always resets** — after any collapse, the next drop runs at normal
   speed.
8. **Input disabled during replay** — during the collapse animation, rotate/drop
   do nothing until the result panel appears.
9. **Reduced motion** — enable OS "reduce motion"; collapse is quick with no
   shake/particles, still restores correctly.

---

## Task 7 — Shared Tower Persistence (verified + hardened)

The shared-tower vertical slice (bootstrap → reconstruct → place → commit →
refresh → still there) already existed from earlier work and is confirmed. Two
gaps required by this task were added: **read-only mode on Redis failure** and
**runnable persistence tests**.

**Verified already-present:**
- Strongly-typed shared models: `TowerState`, `TowerMeta` (towerId, dayKey,
  version, status, seed, createdAt, endsAt, height, successfulPlacements,
  uniqueContributors), `TowerPlacement`, `PersistedBodyState` (with ownership),
  `TowerStatus`, `Difficulty` — all in `src/shared/types.ts`.
- `GET /api/bootstrap` (load from Redis) and `POST /api/placement/commit` (CAS
  store). Redis is the source of truth; no localStorage; failed placements are
  never written (validation before commit; `/attempt/fail` doesn't touch the tower).
- All 10 required commit validations in `validate.ts`: object id, body count,
  finite coords, finite angle, valid scales, bounds, no dup body ids, no
  unsupported objects, required prior bodies present, exactly one new object.

**Added — read-only mode (§ "Redis failures → read-only"):**
- `BootstrapResponse.readOnly` + new `redis-error` error code.
- `bootstrap` route: tower creation is a write; if it throws but the tower can
  still be read, returns `readOnly: true` instead of failing; if reads also fail,
  `redis-error` (503).
- `commit` route: wrapped so any Redis exception returns `redis-error` (503) —
  **never claims success on a storage failure.**
- Client: `readOnly` state (from bootstrap or a `redis-error` on start/commit)
  disables "Add One More Thing" and shows a read-only banner; the tower stays
  viewable.

**Added — persistence tests (`persistence.test.ts`, 11 tests):** mock
`@devvit/web/server` `redis` with an in-memory impl (incl. watch/multi/exec) so
the real `tower.ts` logic runs. Covers: create empty tower → commit → **fresh
reload reconstructs the body with ownership + advanced version/counts**; second
contributor stacks (version + uniqueContributors advance); stale base version →
non-punitive conflict, tower unchanged; failed validation never committed; plus
6 `validateCommit` rule checks.

**Checks:** type-check ✅ · eslint ✅ · **test ✅ (23/23: 12 stability + 11
persistence)** · build ✅.

---

## Task 8 — Official Attempts and Object Choices (verified + tested)

The server-controlled participation rules already existed from earlier work and
are confirmed correct. This task's one missing deliverable — the **attempt
lifecycle test suite** — was added; no source changes were needed.

**Verified already-present:**
- Typed models in `src/shared/types.ts`: `OfficialAttempt`, `PlayerDailyState`,
  `AttemptStatus` (issued/selected/submitted/failed/committed/expired),
  `ObjectChoice` (issued options + selected object), plus `attemptsRemaining` on
  the player and `expiresAt` on the attempt.
- `POST /api/attempt/start` (`routes/attempt.ts`): verifies the authed user
  (401 otherwise), an active tower, that the player hasn't already succeeded and
  has attempts left; mints an **expiring** attempt id (`RULES.attemptTtlSeconds`,
  120s); captures `meta.version` as `baseTowerVersion`; issues exactly three
  choices — one Safe / one Risky / one Absurd — deterministically from the daily
  seed (`core/choices.ts` → `issueChoices`), and stores the issued object ids in
  Redis on the attempt record.
- Selection is server-owned: the client can only pick from the issued three;
  `validateCommit` rejects any `selectedObjectId` not in `attempt.issuedObjectIds`.
- `POST /api/attempt/fail`: consumes one attempt (`consumeAttempt`), with a guard
  so a re-sent fail for an already-resolved attempt is **not** double-charged.
- Success integration lives in `commitPlacement`'s CAS tx: it sets
  `hasSucceeded`, `successfulPlacementId`, increments `attemptsUsed`, and adds the
  body atomically. Idempotency key makes a retried commit return the original
  placement (no second body, no second attempt spent).
- Non-punitive paths: a **version conflict** returns the fresh tower and keeps
  the attempt; a **Redis error** returns `redis-error` (503) → client read-only;
  neither consumes an attempt.
- Client (`game.tsx`): shows "N of 3 attempts left", the three tiered choice
  cards, and — after success — the "your object is in today's tower" status;
  never trusts a client-supplied attempt count (all derived server-side from Redis).

**Added — attempt lifecycle tests (`routes/attempts.test.ts`, 10 tests):** drives
the real `start` → `fail`/`commit` → `bootstrap` routes through Hono's
`app.request`, against an in-memory Redis with a mutable auth `context` and fake
timers. Covers all nine required scenarios: first attempt (3 tiered choices, none
spent yet), three failures then start refused (`no-attempts`), success on first
attempt, success after two failures (attemptsUsed→3), refresh (state read back,
never reset), duplicate commit (one body, one attempt) + duplicate fail (charged
once), expired attempt (`410 attempt-expired`, not consumed), unauthenticated
player (start `401`, bootstrap still inspectable), and a blocked second success
(`already-succeeded`).

**Checks:** type-check ✅ · eslint ✅ · **test ✅ (33/33: 12 stability + 11
persistence + 10 attempts)** · build ✅.

---

## Task 9 — Optimistic Concurrency and Idempotency (verified + hardened + tested)

The CAS commit path existed from earlier work. This task **verified it against the
real installed Redis API**, fixed two correctness gaps (exact conflict wording;
per-attempt idempotency key), and added a dedicated two-user concurrency test
suite. Risk D3 (unverified WATCH/EXEC abort semantics) is now **closed by
inspecting the shipped client** and reproduced in an automated test.

### How atomicity is actually achieved (installed API: `@devvit/web` → `@devvit/redis` 0.13.8)

The installed client exposes a genuine Redis transaction surface — verified in
`node_modules/@devvit/redis/types/redis.d.ts` and `RedisClient.js`, **not
assumed**:
- `redis.watch(...keys): Promise<TxClientLike>` (top-level, `redis.d.ts:724`).
- `TxClientLike`: `multi()`, `exec(): Promise<any[]>`, `discard()`,
  `unwatch()`, and queued `set/get/del/incrBy/hSet/zAdd/expire/...`.
- **Abort semantics (the key fact):** `exec()` builds its result by iterating
  the server's per-command replies (`RedisClient.js:65-89`). When WATCH detects a
  watched key changed, the server aborts and returns no per-command replies, so
  `exec()` yields an **empty array `[]`**. There is no exception and no `null`
  transaction object.

`commitPlacement` (`src/server/core/tower.ts`) uses exactly these, with two
layers of defence:
1. **Pre-check (fast path):** after `watch(version, player)`, read the version
   key; if it already differs from the attempt's `baseTowerVersion`, `unwatch()`
   and return a conflict without queuing anything. Catches the common case where
   the rival commit already landed before we started.
2. **CAS (race path):** otherwise `multi()`, queue all writes (version, snapshot,
   placements, meta, player, idem key, leaderboard), then `exec()`. If a rival
   commit lands in the window between our WATCH and EXEC, the watched `version`
   key changes and `exec()` returns `[]` → we treat `results.length === 0` as a
   conflict and write nothing. This is real compare-and-set, not a check-then-set
   race.

The version number lives in both `tower:{postId}:meta.version` and the watched
string key `tower:{postId}:version`; the attempt stores the base it was issued
against (`OfficialAttempt.baseTowerVersion`).

### Fixes made for this task
- **Exact conflict message.** Added `CONFLICT_MESSAGE` to `src/shared/api.ts` and
  used it in **both** conflict paths so the response is verbatim:
  *"Someone added to the tower while you were placing. Your attempt is safe.
  Reposition against the latest tower."* (The two paths previously had different,
  non-spec wording.)
- **Per-attempt idempotency key.** The client minted a fresh key on every settle,
  so a timeout retry would never hit the duplicate-lookup. `AttemptCtx` now holds
  one `idempotencyKey` generated when the attempt starts and reused across
  conflict-repositions and retries — so a re-sent commit is deduplicated
  server-side. (A conflicted commit writes no idem record, so reusing the key
  after a conflict is safe; a lost-response retry after a real success replays the
  original placement.)

### No attempt is consumed for (all confirmed):
- **Version conflict** — both pre-check and CAS return `ConflictResponse` before
  any consume; `commitPlacement` never reaches its write.
- **Redis failure** — `commit` route try/catch → `redis-error` (503); client goes
  read-only. Test: `failAll` outage → 503, `attemptsUsed` still 0.
- **Server timeout / invalid network response** — the client network layer
  (`state/api.ts`) try/catches every call and returns a typed `ErrorResponse`
  (never throws, never auto-calls `/fail`); only a real physics collapse calls
  `/fail`. Retrying reuses the same idem key.
- **Duplicate-commit lookup** — `redis.get(idem)` hit replays the original
  placement; no second body, no second attempt.

### Tests — `src/server/routes/concurrency.test.ts` (4 tests)
Uses a **WATCH-aware** in-memory Redis (snapshots watched keys; `exec()` returns
`[]` if any changed — mirroring the shipped client) plus a one-shot `beforeExec`
race hook:
- **Two users, same base version (the required flow 1-8):** both start at v1; Bob
  commits (→v2); Alice's stale commit is rejected `409` with the exact
  `CONFLICT_MESSAGE` and the fresh v2 tower; **Alice's `attemptsUsed` stays 0**;
  Alice rebuilds from the fresh snapshot (carrying Bob's body) and re-commits her
  same issued object against v2 → success; final tower = 2 bodies, 2 contributors,
  v3.
- **WATCH/EXEC abort:** `beforeExec` bumps the version key after the pre-check but
  before EXEC → `exec()` returns `[]` → `commitPlacement` reports a conflict and
  writes nothing (0 bodies).
- **Idempotent duplicate / timeout retry:** same key + different body id replays
  the original placement id; one body, one attempt used.
- **Redis outage:** forced failure during commit → `redis-error` 503, no attempt
  consumed.

**Checks:** type-check ✅ · eslint ✅ · **test ✅ (37/37: 12 stability + 11
persistence + 10 attempts + 4 concurrency)** · build ✅.

---

## Task 10 — Live Tower Launch Screen (temp dev UI retired + polished first screen)

Replaced the temporary Task 1 dev UI with the first polished player-facing
screen. The Phaser tower stays the full-bleed **visual hero**; all UI is compact
translucent overlays (one small header, one bottom CTA cluster) — deliberately
**not** a dashboard of cards.

**Temporary dev UI removed (kept cleanly removable, as promised in Task 1):**
- Deleted `src/client/dev/` (HealthPanel, healthApi, phaserCheck), `src/shared/health.ts`,
  `src/server/routes/health.ts`, and the `/api/health` route + import in `server/index.ts`.
- Removed the `🔧 check` button + `DEV_PANEL_ENABLED` block from `game.tsx`.
- Verified zero dangling references remain.

**The launch screen shows (all required elements):** daily tower title
(`dailyTitle`), object count, current height, unique contributor count, time
remaining (live countdown), the player's contribution status, a large
**ADD ONE MORE THING** button, and a smaller **HOW IT WORKS** button (opens a
3-step modal).

**Pure, testable presentation core — `src/client/state/launchView.ts`:** so the
node-only vitest env can cover the responsive + state logic (the visual layout is
Tailwind `sm:` at 640 px, matching `LAYOUT_BREAKPOINT`).
- `layoutMode(width)` → mobile/desktop at 640 px.
- `deriveLaunchState(input)` → exactly one of: `loading | network-error |
  redis-error | read-only | finalized | unauthenticated | contributed |
  no-attempts | ready`, with documented precedence (hard failures → infra → tower
  terminal → player status). `canStartAttempt` enables the button only for `ready`.
- `towerStats`, `towerIsEmpty` (empty-tower copy), `dailyTitle`, `formatCountdown`,
  `contributionStatus`.
- `inspectionModel(bodyId, tower, viewerUserId)` and `formatPlacedAt` / `formatScore`.

**Every required state has a UI branch** (`LaunchPanel`): loading **skeleton**
(animated placeholder), **empty tower** ("set the foundation"), **read-only**
banner (still viewable/inspectable), **unauthenticated** (inspect but can't
contribute), **finalized** tower, **network error** and **redis error** (distinct
copy + retry). Desktop/mobile via responsive Tailwind + tested `layoutMode`.

**Object inspection (tap/click accepted bodies):** `TowerScene` handles
`pointerup` while idle, hit-tests via `matter.intersectPoint`, and emits the
bodyId over the bridge (`onInspect`); tapping empty space clears it. The
`InspectionCard` shows object **name, contributor username (`u/…`), object #
(sequence), difficulty, score (placeholder `—` when unavailable), placement time
(relative), and number of later additions**. The inspected body gets a follow
highlight ring.

**Personal marker + no id exposure:**
- The viewer's own bodies get a subtle golden pip in Phaser (`addOwnershipMarker`,
  no text/id) and a `★ Your object` badge in the card (`isOwn`).
- **Internal ids are not exposed.** `InspectionModel` carries no id at all. New
  `toClientTower(tower, viewerUserId)` (server) redacts every client-facing tower
  payload (bootstrap, `/tower`, commit, conflict, idempotent replay): other users'
  `ownerUserId` blanked and all placement `userId` dropped; the viewer's OWN owner
  id is kept **only** so the client can mark their own bodies. Public usernames
  stay. Storage keeps full ids (server tests unaffected).

**Tests:** `launchView.test.ts` (24: both breakpoints, all 9 launch states, stats,
empty state, inspection model incl. own-marker + **explicit "no internal id in the
model / payload" assertions** + later-additions + score placeholder). Plus a
route-level redaction test in `concurrency.test.ts` (other users' ids absent from
the bootstrap payload, viewer's own present).

**Checks:** type-check ✅ · eslint ✅ · **test ✅ (62/62: 12 stability + 11
persistence + 10 attempts + 5 concurrency + 24 launch-view)** · build ✅ ·
responsive logic covered by `layoutMode` + state tests.

---

## Task 11 — First-Time Experience and Object Selection (three-step tutorial + rich choice cards)

Added the onboarding tutorial and upgraded the object-selection screen to show
personality and a visual preview, while keeping all physics numbers hidden.

**Three-step tutorial (`src/client/state/tutorial.ts` + `Tutorial` in `game.tsx`):**
- Exactly **three** steps (the required maximum), with the required headlines:
  1. "Everyone is building the same tower."
  2. "Choose one object. Position it. Rotate it. Drop it."
  3. "If it stays up, it becomes the next player's problem."
- **Visual demonstrations, not a rule page:** each step renders a small inline SVG
  (`TutorialVisual`) — shared tower + contributors, rotate/drop arrows, and a
  "it stays ✓" tower — with one short caption each (≤90 chars, enforced by test).
- **Skippable** at any point (Skip button); progress dots; Back/Next; the last step
  is "Start building".
- **Does not re-interrupt returning users.** Auto-shown once per player, gated by a
  disposable `omt.tutorial.seen.v1` preference. A `tutorialEvaluatedRef` guard means
  a retry/re-bootstrap never re-triggers it within a session.
- **Works without local storage.** `resolveStorage()` probes localStorage (write
  test) and returns null when blocked/private; reads/writes then fall back to a
  session in-memory map and **never throw**. Without persistence the game still
  runs; it just can't remember across sessions.
- **How It Works replay:** the launch screen's "How it works" button reopens the
  same tutorial (replaces the old static 3-line modal from Task 10).

**Object-selection screen (`src/client/state/selection.ts` + `objectPreview.ts`):**
- `selectionCards(choices)` builds player-safe cards from the three server-issued
  choices, each showing **name, visual preview, Safe/Risky/Absurd label, base
  score, and a short humorous blurb** (sourced from the catalogue `blurb`).
- **Visual preview** via `buildPreview(objectId)`: converts the object's collision
  geometry into centered SVG primitives (rect / circle / compound rects / polygon)
  using the catalogue fill/stroke colours — rendered by `ObjectPreviewSvg`.
- **No mass / friction / physics numbers** are ever placed on a card (asserted by a
  test that scans the serialized cards for banned keys).
- **Clear selected state + direct transition:** `tapCard` reducer models the mobile
  flow — first tap selects (orange ring + `aria-pressed`), tapping the selected card
  again (or the **PLACE IT** button) confirms and goes **straight into placement
  mode**. Mobile column layout, desktop row (`sm:` breakpoint).

**Tests (23 new):**
- `tutorial.test.ts` (9): three-step cap + exact headlines, short captions, step
  clamping/last-step, persisted seen round-trip, **graceful degradation with no
  storage and with throwing storage**, fresh-session-starts-unseen.
- `selection.test.ts` (14): card mapping incl. blurb/label/score, **"never leaks
  physics numbers"**, unknown-id blurb fallback, **tap-to-select/confirm/switch
  interaction**, preview geometry per shape kind (rect/circle/compound/poly),
  colour hex, in-bounds coords, unknown-id → null.

**Checks:** type-check ✅ · **test ✅ (85/85: 62 prior + 9 tutorial + 14 selection)**
· build ✅. Visual polish of the tutorial illustrations and the tap-to-place feel
remain a **live-playtest** confirmation (below).

---

## Task 13 — Server-Controlled Scoring, Milestones & Leaderboards

Made scoring fully server-authoritative, added the five community milestones, and
built five secondary leaderboards — while keeping the shared tower the hero.

**Server-controlled scoring (`src/server/core/scoring.ts`):**
- Base scores come from the catalogue: **Safe 100 / Risky 175 / Absurd 275**.
- `computeScoreBreakdown(objectId, y, { modifierId, milestoneReached })` returns
  `{ base, heightBonus, modifierBonus, milestoneBonus, total }` — **the only
  source of score truth.** The `CommitRequest` has no score field; even a client
  that injects `score`/`points` is ignored (test-proven).
- **Height bonus:** `round(heightAbove * 0.5)`, capped at 400.
- **Daily-modifier bonus (placeholder):** `modifierBonus(id, subtotal)` reads the
  `MODIFIERS` registry; `normal` contributes 0. Real modifiers (flat + multiplier)
  plug in via config with no pipeline changes.
- **Milestone bonus:** +150 folded into the score of the placement that crosses a
  milestone.

**Community milestones (`src/shared/milestones.ts`):** the five required —
5 "It's officially a tower.", 10 "Questionable engineering.", 20 "Local landmark.",
35 "Physics is concerned.", 50 "Community miracle."
- `newlyReached(prev, next)` decides what a single commit crosses; `milestoneIdsUpTo`
  writes the authoritative unlocked set into `meta.milestonesUnlocked` (monotonic
  from the count → **idempotent**, so a refresh re-derives the same set and crosses
  nothing). The commit response carries `milestone` **only** on the crossing commit;
  the idempotent replay and bootstrap carry `null` / no flag, so it **never
  re-triggers** after refresh or a duplicate request.

**Five secondary leaderboards (`src/server/core/leaderboards.ts`, `GET /api/leaderboard`):**
- `today-score` (per-tower cumulative), `top-placement` (per-tower best single),
  `most-absurd` (all-time absurd count), `streak` (all-time consecutive-day builder
  streak), `all-time` (all-time placements).
- Reads use `redis.zRange(key, 0, limit-1, { by: 'rank', reverse: true })` — top-N,
  highest first. `clampLimit` enforces default 10 / max 50 (`?limit=`), so Redis
  result sizes stay bounded (§14).
- **No internal ids exposed:** entries are `{ rank, username, value, isViewer }`.
  Usernames resolve from a global `user:names` map; `isViewer` is computed
  server-side so the client never needs a user id (test scans the payload for
  `t2_` and finds none).
- All leaderboard + streak/total/absurd counters are written **inside the existing
  WATCH/MULTI/EXEC commit transaction**, so they stay consistent with the placement
  and a conflict/duplicate writes nothing.

**Redis API discipline:** verified `zRange` (with `{ by, reverse, limit }`), `zAdd`,
`zIncrBy`, `zScore`, `zCard` against the installed `@devvit/redis` 0.13.8 type defs
before use — no invented functions.

**Client (kept the tower dominant):** milestone **celebration** overlay fires once
on the flagged commit; a subtle `🏆 <current milestone>` **community status** line
sits in the compact header; **Leaderboards** is a small secondary button opening a
modal (not a front-and-center board). Own row is highlighted; only usernames shown.

**Tests (19 new, 104 total):**
- `scoring.test.ts` (core, 12): base tiers, height cap, **modifier placeholder = 0**,
  milestone bonus, total = sum, milestone thresholds + exact copy, `newlyReached`
  fires once, streak increments/resets + previous-day-key across month/year.
- `scoring.test.ts` (routes, 7): **client-injected score ignored → server value
  saved**, non-issued object rejected, milestone celebrated exactly on the 5th
  object, **no re-trigger on refresh**, **no re-award on duplicate commit**,
  leaderboards ranked high-to-low with **no id leak**, and limit honoured.

**Checks:** type-check ✅ · lint ✅ · **test ✅ (104/104)** · build ✅.

**Playtest gate (un-automatable):** confirm the celebration animation feels good,
the leaderboard stays visually secondary to the tower, and streaks roll correctly
across real day boundaries.

---

## Task 15 — Practice Mode (client-only sandbox over a copy of the tower)

Added a fully **local** Practice Mode: unlimited placement with the same physics
and controls, success + collapse, restore-on-collapse — and **zero server
contact**, so it can never move the official tower, attempts, milestones,
leaderboards, or streaks.

**How it stays safe (architecture):** Practice reuses the exact same `TowerScene`
physics/controls. The difference is entirely in React: `handleSettle` checks a
`practiceRef` first and, when practicing, resolves the drop with **no `fetch`** —
it calls only the new local scene command `commitLocal()` (keep the settled body)
or lets the scene's existing collapse-restore run. There is **no practice API
endpoint and no practice commit builder anywhere** — practice literally cannot
emit a commit request.

**Client:**
- `src/client/state/practice.ts` — pure session model: `startPractice(tower)`
  deep-copies the accepted bodies (a local copy), `recordPractice` appends on
  "stayed" (unlimited stacking) and leaves the snapshot untouched on "collapsed"
  (restored), plus the exact banner constant.
- `TowerScene.commitLocal()` promotes the just-settled active body into the local
  accepted list using its settled transform — client state only, no Redis write.
- `game.tsx` — enter from a **🧪 Practice Mode** button on the launch panel
  (shown in every playable state, so it's usable **after official success and
  after all attempts are consumed**); an object picker offering **any** of the 15
  objects; the same rotate/drop controls; the persistent required banner
  **"Practice — this will not change the community tower."**; a placed/collapse
  counter; and **Exit** which calls `applyTower(officialTower)` to **reload the
  official accepted state exactly**, discarding all practice bodies.
- Practice never starts an official attempt, so no attempt is consumed; the
  official success/collapse/score panels never render in practice.

**Guarantees (all covered by tests):** no official Redis write · no attempt
consumed · no milestone/leaderboard/streak change · never claims practice was
saved (banner + "practice only" copy) · restore after collapse · usable after
success and after attempts are gone.

**Tests (11 new, 115 total):**
- `practice.test.ts` (client, 7): exact banner, **local copy is a deep copy**
  (mutating the session never touches the official tower), append-on-stay, **25
  placements (unlimited)**, **collapse restores the snapshot**, defensive no-body
  case, availability regardless of official state.
- `practice.test.ts` (routes, 4): **the required proof** — a commit carrying any
  attempt id that was never server-issued (the only thing a leaked practice
  action could be) is rejected `attempt-invalid` with the tower version, body
  count, and attempts **all unchanged**; malformed ids rejected; leaderboards stay
  empty; and a legitimate token commit still writes (only the official path can).

**Checks:** type-check ✅ · lint ✅ · **test ✅ (115/115)** · build ✅.

**Playtest gate (un-automatable):** confirm practice *feels* identical to the real
drop, the banner is always visible, stacking many objects performs well, and Exit
snaps back to the community tower cleanly.

---

## Task 16 — Daily Tower Lifecycle (modifiers, finalization, next-day, scheduler + lazy fallback)

Implemented the full daily lifecycle: server-chosen modifiers, an
authoritative end time, finalization with a saved summary + awards, and the
next-day state — with a **lazy fallback** so correctness never depends on the
scheduler.

**Tower now carries all required fields** (`TowerMeta`): day key, start
(`createdAt`), server-authoritative end (`endsAt`, drives the countdown), active
/ finalized status, daily seed, daily modifier, `finalizedAt`, plus a saved
**final summary** (`TowerFinalSummary`) and **next-day descriptor**
(`NextDailyState`).

**Daily modifiers (`src/shared/modifiers.ts`) — the four required + Normal:**
- Normal Day, Low Gravity (`gravityScale 0.55`), Heavy Day (`densityScale 1.7`),
  Slippery Day (`frictionScale 0.45`).
- **Chosen server-side, deterministically from the day key** (`pickDailyModifier`)
  → identical for every player, stable all day, never per-request random.
- **Physics derived consistently:** `modifierPhysics(id)` gives gravity/density/
  friction multipliers; `TowerScene` applies gravity on rebuild and `bodyFactory`
  scales each body's density/friction — every client reproduces the same physics
  from `meta.modifierId`.
- **Not random-feeling:** modifiers only scale fixed constants; they add **zero**
  score randomness (`scoreMultiplier 1`, `scoreFlatBonus 0` — Task 13 scoring
  unchanged), so outcomes stay skill-based.
- **Explained before an attempt:** a `ModifierExplainer` line shows the label +
  one-line description on the launch panel and again in the selection screen, plus
  a header chip.

**Finalization (`src/server/core/lifecycle.ts`) — idempotent + deterministic:**
- `finalizeTower(postId, now)`: computes final stats + awards (Top Builder,
  Highest Object, Boldest Object) from the frozen tower, saves the summary and the
  next-day descriptor, then flips status to `finalized` **last** (a crash mid-write
  leaves it active for a later retry). The accepted snapshot is already persisted
  and never changes once finalized, so it **is** the saved final snapshot.
- **Repeated finalization is safe:** an already-finalized tower returns its saved
  summary and mutates nothing (`finalizedAt` stays put) — proven by test.
- `finalizeIfDue` is called from **bootstrap, attempt/start, and commit**: the
  **lazy fallback**. If the scheduler never fires, the next request finalizes.

**End-of-day rule (documented):** at finalization new official attempts stop
immediately (`attempt/start` and `commit` reject once `status==='finalized'` or
`now>=endsAt`, non-punitively — no attempt consumed). An already-issued attempt
may still commit only while active; past the end it is refused and simply expires,
keeping the final snapshot immutable.

**New-day reset + historical validity:** each daily tower is its own post
(Devvit's post-per-day model), so a new post = fresh eligibility automatically;
the finalized post keeps its summary + leaderboards untouched forever. Finalization
also produces the **next daily tower state** (`buildNextDaily`: next day key, seed,
server-chosen modifier, continuous start/end).

**Scheduler — confirmed API only:** `scheduler.runJob({ name, data, runAt })`
(verified in installed `@devvit/scheduler` 0.13.8; also `cancelJob`/`listJobs`).
Best-effort `scheduleDailyFinalize` runs at tower creation, registered in
`devvit.json` as the `daily-finalize` task → `/internal/scheduler/finalize`. It is
**advisory** and fully wrapped: any failure is swallowed because lazy finalization
is authoritative. No invented scheduler functions.

**Tests (17 new, 132 total):**
- `modifiers.test.ts` (10): four modifiers + physics, **deterministic same-day
  selection** (all players identical), variety across a month, neutral score.
- `lifecycle.test.ts` (9 — the required **date-boundary + repeated-finalization**
  coverage): day-key rollover across month/year/leap-day; required lifecycle
  fields + `isDue`; finalize saves summary + awards + next-day state; **not before
  end time**; **idempotent repeated finalization** (later timestamp changes
  nothing); previous stats persist; empty-tower finalize; a fresh post is an
  independent active tower; `buildNextDaily`.

**Checks:** type-check ✅ · lint ✅ · **test ✅ (132/132)** · build ✅.

**Playtest gate (un-automatable):** confirm each modifier *feels* right in the real
Phaser sim (low-gravity float, heavy slam, slippery slide), the countdown reads
from the server end time, and a real scheduled `daily-finalize` job fires (with the
lazy fallback as backstop) across an actual day boundary.

---

## Task 17 — Daily Results & Community Monument

Built the finalized-tower results screen, the six deterministic daily awards, a
personal result, and a lightweight archive of finalized days — all kept secondary
to today's active tower.

**Results screen (`DailyResults` in `game.tsx`) shows every required field:** the
final tower (the finalized Phaser tower stays the hero), final height, total
accepted objects, unique contributors, **total official attempts**, milestones
reached, daily modifier, **personal result**, the closed countdown state
("Closed"), and the date. Rendered on the launch screen when the tower is
finalized, from the `TowerFinalSummary` in bootstrap.

**Total official attempts:** a per-tower counter (`k.attemptCount`) incremented on
every consumed attempt — a **failed drop** (fail route) and a **success** (inside
the commit transaction) — surfaced as `summary.totalAttempts`.

**Six deterministic, server-calculated awards (`src/server/core/awards.ts`):**
Highest Placement, Bravest Builder, Safest Hands, Last Stable Addition, Community
MVP, Most Absurd Success.
- **Deterministic:** pure `computeAwards(placements, bodies)`; every tie breaks on
  the earliest placement (lowest sequenceNumber), so output is stable and
  order-independent (tested).
- **Never rewards failure over success:** awards derive ONLY from successful
  placements — there is no code path that takes failed attempts. A collapse can
  never win an award.
- Awards with no eligible placement (e.g. no absurd object) are omitted.

**Personal result (client-side, per-user):** `personalResult()` derives the
viewer's own object (via their own `ownerUserId` on the redacted tower), score,
attempts used, and any awards they won (matched by public username) — kept out of
the shared immutable summary since it differs per user.

**Lightweight archive (community monument):**
- On finalization, the tower is added to a global archive index
  (`archive:index` zset by `finalizedAt`) and **trimmed to the most recent 30**
  (`zRemRangeByRank`) to bound Redis usage. Only the compact `TowerFinalSummary`
  is stored — **no replay/body data** is archived (the accepted snapshot already
  persists per-post and is reconstructable by id).
- `GET /api/archive?limit=` → recent finalized summaries; each archive row shows
  date, modifier, height, object count, contributor count, and the top award +
  final milestone. The `ArchiveModal` is a small secondary button, never competing
  with today's tower.

**Redis-API discipline:** `zRemRangeByRank`, `zRange`, `zAdd` verified against the
installed `@devvit/redis` 0.13.8 types before use.

**Tests (7 new, 139 total):** `awards.test.ts` — each award to the right
contributor, **determinism** (identical + shuffled inputs → identical winners),
tie-break on earliest placement, omitted awards, empty tower, and the explicit
"awards come only from successful placements, never failures" guarantee.
(Awards feed `computeSummary`, already covered by `lifecycle.test.ts`.)

**Checks:** type-check ✅ · lint ✅ · **test ✅ (139/139)** · build ✅.

**Playtest gate (un-automatable):** confirm the results screen reads well on a
finalized tower, the personal result matches your own object, and the archive
renders past days without crowding today's tower.

---

## Task 18 — Phaser Polish Pass (feel + audio, no rule changes)

Improved moment-to-moment feel without touching any game rule. Physics,
stability, scoring, and lifecycle are all unchanged.

**Feel (in `TowerScene`):**
- **Smooth camera tracking** (existing lerp) + **controlled zoom**: the camera now
  eases *outward* as the tower grows (`zoomLevel` 1 → 0.72, smoothed) so the whole
  build stays in frame, then eases back — never a lurch.
- **Impact-based shake** + **slow-motion collapse** (existing) — slow motion
  ALWAYS resets (`resetTimeScale` in the collapse `finally` **and** on scene
  SHUTDOWN).
- **Dust** for heavy non-metal impacts, **small sparks** for metal/glass
  collisions, **small success particles** (a gentle upward fan replacing the old
  full-screen flash — **no flashing effects**).
- **Rotation feedback** (quick scale pulse), **drop feedback** (expanding ring at
  the release point), **stability tension feedback** (a faint ring on the settling
  object that shifts green→amber→red with how much the tower is still moving).
- **Milestone celebration**: React modal (Task 13) now also fires a Phaser particle
  burst (`bridge.celebrate()`) + a sound.

**Audio (`src/client/phaser/audio.ts`) — fully synthesized, ZERO asset bytes:**
- Web Audio oscillator voices; **no audio files to download/decode** ("compress
  assets" taken to its limit).
- **No autoplay:** the `AudioContext` is created only in `initAudio()`, called from
  a real user gesture (Add / Drop / unmute). Every play call before that is a no-op.
- **Material-based collision hooks:** per-material timbre (wood thud … metal ring …
  glass ping), pitch/gain scaled by impact speed and **gain-capped** so it's never
  harsh.
- **Success sound** (two-note flourish) and **layered collapse** (low rumble + mid
  crack + material impact).
- **Simultaneous-sound cap** (`MAX_VOICES = 8`) + a per-collision throttle so a
  chaotic collapse can't stack into noise.
- **Mute** control (persisted) that ramps the master gain.

**Accessibility / robustness (`src/client/state/settings.ts`):**
- **Mute** and **reduced-motion** toggles in the HUD, persisted (localStorage with
  an in-memory fallback — works without storage).
- **Reduced motion = OS preference ∪ user toggle.** When on, the scene skips shake,
  slow-mo, particles, tension, rotation/drop pulses (physics/audio unchanged).
- **Visual equivalents for audio cues:** success → particles, collapse → shake +
  particles + slow-mo, impacts → dust/sparks, tension → the ring. Nothing is
  audio-only, so a muted player misses no information.
- **Do not hide the tower:** all particles are count-limited and low-alpha; dust is
  faint; the tension ring is a thin low-alpha stroke.

**Tests (10 new, 149 total):**
- `audio.test.ts` — impact params deterministic, louder/higher with harder hits,
  gain-capped, per-material timbre, unknown-material fallback, and the
  simultaneous-voice cap.
- `settings.test.ts` — mute + reduced-motion round-trip, **works without storage /
  never throws**, and reduced-motion = OS ∪ user.

**Checks:** type-check ✅ · lint ✅ · **test ✅ (149/149)** · build ✅.

### Performance profile

Honest scope note: I can't run the live Phaser canvas from here, so FPS is a
**reasoned estimate pending on-device playtest**; asset sizes below are **measured
from the real build**.

- **Approximate body count (realistic tall tower):** cap is
  `RULES.maxObjectsPerTower = 60` objects. Many are compound (chair/sofa/bathtub/
  duck = 3–4 Matter parts each), so a full tower is ≈ **40–60 objects ≈ 120–200
  Matter sub-bodies** plus one static platform. Matter sleeping is enabled, so a
  settled tower parks most bodies asleep.
- **Frame-rate observations (estimate):** desktop should hold 60 fps comfortably;
  the load spike is the ~1–2 s settling window right after a drop when the top of a
  tall tower is awake. Particles are short-lived and capped, so effect overhead is
  small. To be confirmed on a mid-range phone.
- **Asset sizes (measured, `dist/client`):** `bodyFactory.js` **≈ 1.18 MB**
  (Phaser engine — the dominant weight), React runtime ≈ 187 KB, `default.js`
  (splash) ≈ 124 KB, `game.js` ≈ 59 KB, CSS ≈ 30 KB. **Audio: 0 bytes** (synth).
- **Largest performance risks:** (1) the **Phaser bundle (~1.18 MB)** on first load
  over mobile data — mitigated by the split entrypoints (splash stays light; Phaser
  only loads in `game.html`); (2) **compound bodies** multiply the Matter body count
  ~3× vs. object count — the 60-object cap keeps it bounded; (3) a **collapse of a
  tall awake tower** is the worst-case physics + particle frame — slow-mo actually
  helps by spreading it, and reduced-motion removes the particle/shake cost.

**Playtest gate (un-automatable):** real-device FPS on a mid-range phone with a
40–60 object tower, confirm slow-mo always recovers, audio starts only after a
gesture, and effects never obscure the build.

---

## Task 19 — Reddit-Native Post Experience

Made the custom post Reddit-native: a useful title, an interactive inline surface,
a real text fallback, and the daily context — with no external links, no comments,
and no Reddit-logo imagery.

**Post creation (`src/server/core/post.ts` + pure `src/shared/post.ts`):**
- **Useful title** in the required format: `buildPostTitle` →
  `"Day {n}: Can we add one more thing? — {Modifier}"` (e.g. "Day 16: Can we add
  one more thing? — Low Gravity"). Day number is deterministic from the day key
  vs. `LAUNCH_DAY_KEY`.
- **Text fallback** (`textFallback: { text }`, old.reddit / unsupported clients)
  explaining, in plain markdown, all five required points: same daily tower · one
  successful object each · placements become the next player's challenge · open in
  a supported Reddit app · resets daily. Plus the day + modifier, and "no comments
  required".
- **postData** carries `{ dayNumber, dayKey, modifierId, endsAt }` (≤2 KB).
- Created on the **APP account** (no `runAs: 'USER'`, no `addComment`) — the app
  never posts or comments on a user's behalf.

**Interactive inline surface (`src/client/splash.tsx`, the default entrypoint):**
now shows the **day number**, the **daily modifier** (label + one-line
description), live stats, **basic 3-step instructions**, a **live "tower … left"
countdown** to the daily ending, a big **"Add One More Thing"** CTA that expands
to the game (`requestExpandedMode('game')`), and a **community call to action**
("help the community reach the next milestone"). When finalized it flips to "See
today's results". The leftover **dev launchers were removed** (retiring the last
temporary UI flagged back in Tasks 10/11).

**Compliance with the "do nots":**
- **No comments to play / none posted on behalf of users** — the game uses zero
  comment APIs.
- **No Reddit logos** — removed the template's `snoo.png` load from
  `PreloadScene`; the game renders entirely from code-drawn geometry.
- **No external links** — the fallback is plain text with no URLs (test asserts no
  `http(s)://`), and the game makes no external requests (Devvit CSP would block
  them anyway).

**Tests (6 new, 155 total):** `post.test.ts` — day-number math (launch = day 1,
month/year rollover, clamp/bad-key), title format with modifier, and the fallback
containing all five required points + day + modifier + "no comments" and **no
external links**.

**Checks:** type-check ✅ · lint ✅ · **test ✅ (155/155)** · build ✅.

### Verification notes + honest limitation

- **Moderator vs. regular user:** the "Create a new post" mod-menu action and the
  `onAppInstall` trigger both create the post on the app account; **playing
  requires no elevated permissions** — any signed-in user can open the post and
  add an object (unauthenticated users can still inspect, per Task 8). Only post
  *creation* is mod/app-gated, which is correct.
- **Desktop vs. mobile / accessibility:** the inline surface and expanded game are
  the same responsive React/Tailwind UI verified in Tasks 10–11 (mobile-first,
  `sm:` breakpoints); the text fallback covers old.reddit and any client that
  can't render the custom post. Rendering *on real Reddit desktop + mobile clients*
  is the **playtest gate** — it can't be exercised from here.
- **Automatic daily post creation — honest limitation:** it is **not wired to a
  cron**. Task 16 finalizes the daily tower and produces the next-day descriptor,
  but no scheduled job calls `createPost`, because auto-posting on a schedule is
  exactly the "not fully reliable" case (risk of duplicate/spam posts, and
  scheduler firing is unverified here). Per the task's allowance, we **preserve one
  stable public demo post**: a moderator creates a single post via the menu, and it
  stays valid — its tower runs, finalizes, and shows results. Enabling true daily
  rotation later is a small, deliberate step (a `daily-post` cron in devvit.json →
  a route that calls `createPost`, mirroring the `daily-finalize` wiring), left
  out on purpose until it can be validated against real subreddit behaviour.

---

## UI/UX Pass — Light, friendly "playground" look (visual only)

Restyled the whole game surface to a soft, light, card-based aesthetic (matching a
provided reference) **without changing any game rule, state machine, or physics
behaviour** — purely presentation.

**Phaser stage (`TowerScene`, `boot.ts`, `bodyFactory.ts`):**
- Light background (`#f6f7fc`) instead of the dark theme.
- A soft **circular "stage" pool** (light lavender), **pastel clouds**, and static
  **sparkles** behind the tower (no flashing — all static).
- **White rounded platform** with a soft drop shadow + subtle indigo "side" for a
  gentle 3D slab feel; removed the old dark "tower area" chrome/label in favour of
  a soft ground shadow.
- Each object now casts a **soft drop shadow** so it reads on the light stage
  (added behind the art in the factory).
- Camera fit widened (`h/1000`) so the platform, roughly the top three objects, and
  the incoming object stay framed together.

**React HUD (`game.tsx`, `index.css`):**
- White **rounded stat card** (indigo numbers, gray labels, dividers) and a
  matching **"CLOSES IN" countdown card** with a stopwatch — as in the reference.
- Contribution **status pill** ("✓ Your object is in today's tower") and a
  prominent white **Leaderboard card** (trophy) as the primary secondary action.
- Indigo primary buttons, white/indigo secondary controls, and the mute /
  reduced-motion toggles restyled as light chips.
- Every gameplay surface converted to the light system: selection cards, placement
  controls, result/collapse panels, inspection card, tutorial, milestone
  celebration, leaderboard + archive modals, and the daily-results screen.

**Checks:** type-check ✅ · lint ✅ · **test ✅ (155/155)** · build ✅. (No test
changes — this pass is visual only; all logic is untouched.)

**Playtest gate (un-automatable):** the exact stage/cloud/sparkle positions,
object shadow weight, and camera framing are tuned "blind" (I can't render the
canvas here) — confirm on a real device that the tower sits nicely in the stage,
light-coloured objects (fridge/bathtub) still read against the pale backdrop, and
the ~3-objects-visible framing feels right; these are quick constant tweaks in
`TowerScene` if not.

---

## Next action (gate before further gameplay work)
The `🔧 check` dev panel is **gone** (retired in Task 10) — the foundation it
verified is now exercised by the automated suite. The remaining un-automatable
gate is the **live playtest**: `devvit login` + `npm run dev`, open the post, and
confirm (a) the launch screen renders with the tower as hero on both a desktop and
a phone width, (b) tapping a body opens the inspection card with a personal marker
on your own object, and (c) the reload-shows-persisted-object loop and
concurrent-commit conflict path (risk D3). Only after that gate should P1 work begin.
