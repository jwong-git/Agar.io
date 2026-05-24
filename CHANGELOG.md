# Changelog

All notable changes to this project, grouped by build phase / session.

Format loosely follows [Keep a Changelog](https://keepachangelog.com/).

---

## v0.6.2 — 2026-05-22 (Latency quick-wins)

### Changed
- **Tick rate 30 → 60 Hz** (`shared/config.ts CONFIG.tickRate`). Halves the per-tick wait (≈33ms → ≈17ms) and doubles snapshot frequency. Server CPU and outbound bandwidth roughly double — fine for a Fly.io small machine and a handful of players. CLAUDE.md architecture invariant updated to match.
- **Client interpolation buffer 100 → 50 ms** (`RENDER_DELAY_MS` in `src/main.ts`). Cuts ~50ms off perceived input lag. Trade-off: more visible motion jitter if a snapshot is late (mitigated by the higher tick rate; snapshots now arrive every ~17ms).
- **WebSocket `permessage-deflate` enabled** (`server/index.ts`, `WebSocketServer({ perMessageDeflate: true })`). Snapshots are JSON-heavy with lots of repeated keys/colors; typical compression ratio is 3–5×, which translates to lower latency on slow uplinks (less to push). Modest CPU cost.

### Notes
- These are the "quick wins" before considering client-side prediction. Combined they should shave roughly **~65 ms** off perceived input lag and feel smoother on a modest connection. If lag still feels bad, the next step is client-side prediction of the local cells (movement only, no interaction prediction), which removes ~RTT from the feel of your own movement at the cost of meaningful code complexity.

---

## v0.6.1 — 2026-05-22 (Fly.io deployment)

### Added
- **`Dockerfile`** — single-stage Alpine Node 22 image that runs `npm ci`, `npm run build`, then `npm start`. Reads `PORT` from the env so Fly.io can pick the port.
- **`.dockerignore`** — excludes `node_modules/`, `dist/`, `.git/`, `*.md`, etc. from the build context for a smaller, safer image.
- **`DEPLOY.md`** rewritten as a focused Fly.io guide (install `flyctl` → `fly launch` → `fly deploy`, with `fly.toml` recommendations and cost expectations).

### Removed
- Previous `DEPLOY.md` (port-forward + DuckDNS walkthrough) — that route is no longer the deployment target. Single-origin server code remains in place (host-agnostic and required by Fly.io anyway).

### Changed
- **Game title renamed** from "Agar Clone" to **"Agar.io Retro"** — both the browser tab `<title>` and the `<h1>` on the start/death overlay.

---

## v0.6.0 — 2026-05-21 (Single-origin deploy)

### Changed
- **The game server now serves the built client *and* the WebSocket on one port.** Previously the client (Vite, :5173) and the ws server (:8080) were separate origins, which can't be exposed through a single tunnel/host and breaks `wss` on an `https` page. `server/index.ts` now wraps the ws server in a Node `http.createServer`: static requests are served from `dist/` via `sirv` (SPA fallback), and only `Upgrade` requests to `/ws` are handed to the `WebSocketServer` (`noServer` + manual `handleUpgrade`). Listens on `process.env.PORT || CONFIG.port` for PaaS portability.
- **Client connects to its own origin.** `src/main.ts` now derives the socket URL as `` `${wss|ws}://${location.host}/ws` `` instead of the hardcoded `ws://host:8080`, so it works behind TLS/tunnels automatically.
- **Vite dev proxy** forwards `/ws` → `ws://localhost:CONFIG.port` (`vite.config.ts`), so the dev flow (`npm run dev`) uses the identical single-origin connection path as production.

### Added
- **`npm start`** script (`tsx server/index.ts`) — runs the production server serving `dist/` + `/ws`.
- **`sirv`** dependency for static file serving.
- `.claude/settings.local.json` added to `.gitignore` (machine-local, no longer tracked).

### Notes
- Build + run for a public deploy: `npm run build` → `npm start` → expose port `8080`. The single-origin server serves both client and `wss` on the same port.

---

## v0.5.18 — 2026-05-21 (HUD Update)

### Added
- **"Leaderboard" title** above the leaderboard list (uppercase header with a divider).
- **Self-highlight in the leaderboard:** your own entry renders in red/bold. `LeaderboardEntry` now carries the owner `id` so the client can match it against `net.myId` (name-matching would collide on duplicate names).
- **Drop-down animation** on the start/death overlay: the panel slides in from the top each time the overlay appears.
- **Death dimming:** when you die, the overlay background darkens (a `dead` class on the overlay) to push focus to the death message; cleared on respawn.
- **Scrollable special-cell guide** on the start screen, replacing the plain-text blurb. Lists every special cell (virus, mother, speed, anti-aging, explosive, magnet) with a colour swatch and a one-line description of what it does.

---

## v0.5.17 — 2026-05-21 (Tune mother mint cap; decouple drain from cap)

### Added
- **Version number** in the bottom-right corner of the start/death overlay.

### Changed
- **`mother.maxSpawnedFood` 800 → 250.** Now that the cap is per-mother (v0.5.16), 800 × 20 mothers could mint up to 16k pellets. 250 caps the world at ~5k minted (250 × 20) on top of the 5k base field.
- **`consumedMass` now drains every spawn regardless of the mint cap.** Previously the drain happened per-pellet inside the mint loop, so when a mother hit `maxSpawnedFood` (e.g. its food wasn't being eaten) it stopped minting *and* stopped draining — staying engorged forever. The intended bonus-pellet drain is now applied up front, before minting, so the mother always shrinks back to base size over time even if the cap blocks the actual pellets.

### Fixed
- **An engorged mother that hit its food cap never spawned food again.** The per-mother cap (`maxSpawnedFood`) was applied to *all* minted food, so once a mother's pellets weren't being eaten fast enough it stalled at the cap and stopped producing — even while engorged from eating players. Mother food is now split into two streams:
  - **Natural food** (the base `foodPerSpawn` pellets) — still subject to the per-mother cap (counts toward `spawnedFood`, freed when eaten).
  - **Bonus food** (converted from `consumedMass` after eating player cells) — **ignores the cap** and is minted every spawn until `consumedMass` drains to 0, so a mother that grinds up players keeps pumping out food no matter how much is already on the field. Bonus pellets are uncounted (`source = null`) so they never block natural food.
  - No mother food is expired/removed except by being eaten — accepted that heavy player-grinding can grow the field's total food (rare in practice).

---

## v0.5.16 — 2026-05-21 (Mother food cap is per-mother)

### Fixed
- **Mothers stopped producing food once the global mint cap was hit.** `maxSpawnedFood` was a single world-wide counter (`transientFoodCount`), so whichever mothers were processed first in the tick used up the whole budget and the rest minted nothing. The cap is now **per-mother**: each `Mother` tracks its own live minted food (`spawnedFood`), incremented on mint and decremented when that pellet is eaten (each `ServerFood` records its `source` mother). Total minted food across the world can now reach `count × maxSpawnedFood`.

---

## v0.5.15 — 2026-05-21 (Mother food no longer drains the map)

### Fixed
- **Mothers no longer drain the field of food.** `motherSpawnFood` used to recycle pellets from the fixed 5000-food pool — relocating them to the mother — so many/engorged mothers vacuumed the whole map's food into clusters. It now **mints new transient food** instead, leaving the 5000 field pellets untouched.

### Added
- **Transient (mother-minted) food:** marked `transient` on `ServerFood`; removed when eaten (via `sweepEatenFood`) rather than respawning, so it doesn't permanently inflate the field. Total minted food is capped at `mother.maxSpawnedFood` (800) so it can't grow unbounded if uneaten. Base field food is unaffected and still respawns on eat.

---

## v0.5.14 — 2026-05-21 (Mother eats small cells and engorges)

### Added
- **The mother now eats player cells** with `mass < consumeMassRatio × effectiveMass` — the threshold scales with the mother's current (engorged) size, starting at 0.8 × 300 = **240** and growing as it eats. The eaten cell is removed (its owner dies if it was their last cell, killedBy "Mother").
- **`Mother.consumedMass` pool:** eating a cell banks **90%** of its mass (`consumeConvertRate`). This pool drives three things:
  - **Size:** effective mass = `mass + consumedMass × consumedSizeFactor` (linear, factor 1) → bigger collision radius (`motherEffectiveMass`) and bigger render (snapshot now sends effective mass).
  - **Food spawn rate:** each spawn emits `foodPerSpawn` base pellets plus `floor(consumedMass × foodPerConsumedMass)` bonus pellets.
  - **Drain:** each bonus pellet subtracts `foodMassCost` from `consumedMass` (always ≥1 bonus while >0), so size and spawn rate ramp back to normal as the pool empties to 0.
- **Food launch speed scales with the mother's radius** (`foodInitialVelocity × effR/baseR`) so pellets still clear the body when the mother is engorged instead of hiding under it.
- **`popThreshold` also scales** with effective mass (`popThreshold × effectiveMass/mass`), so a bigger mother needs a bigger cell to pop it. Popping now yields the mother's **full effective mass** (`300 + consumedMass`) instead of just the base 300.

### Notes
- The three coefficients (`consumedSizeFactor`, `foodPerConsumedMass`, `foodMassCost`) are placeholder values — the size/rate equations are easy to retune in `config.ts`.
- Both thresholds scale together, so the harmless band between consume (`0.8×eff`) and pop (`1.33×eff`) holds its proportion as the mother grows.

---

## v0.5.13 — 2026-05-21 (Mother is now virus-style + magnet glow tuning)

### Changed
- **Magnet glow tuning:** glow opacity 0.2 → **0.45**, glow radius now matches the pull range exactly (`r × magnet.pullRadiusMultiplier` = 1.6×, was a fixed 1.45×), and the pull-range indicator ring opacity ~0.1 → **0.5** (still gently pulsed).
- **Mother is no longer eaten by small cells.** The old rule let any cell with `mass < mother.mass` (300) consume it. Now the mother behaves like a virus: only cells with `mass >= mother.popThreshold` (**400**) interact, popping into pieces and gaining the mother's mass; smaller cells pass by harmlessly. Added `mother.popThreshold: 400`; `eatMothers` gate changed from `c.mass >= mother.mass` to `c.mass < mother.popThreshold`.

---

## v0.5.12 — 2026-05-21 (Magnet: visible gradual pull + dimmer glow)

### Changed
- **Magnet pull range 1.25× → 1.6×** cell radius (`magnet.pullRadiusMultiplier`), and **`pullLerp` 0.3 → 0.12**. The old range barely exceeded the eat radius and the high lerp closed that gap in ~1 tick, so food appeared to be consumed the instant it entered range. The wider range + gentler easing make food visibly stream across the gap and only get eaten when it actually reaches the cell body (`eatFood`, radius `r`).
- **Magnet cell glow dimmed** (alpha 0.45 → 0.2).

---

## v0.5.11 — 2026-05-21 (Magnet tuning: nearest-cell pull + range indicator)

### Changed
- **Magnet pull range 1.15× → 1.25×** cell radius (`magnet.pullRadiusMultiplier`).
- **Food is now pulled toward the nearest covering buffed cell** instead of every in-range cell at once. `applyMagnet` collects all buffed cells, and each food defers to any closer buffed cell that also covers it — so it streams toward one cell rather than being tugged between several.

### Added
- **Faint pull-range indicator** drawn around magnet-buffed cells: a low-alpha dashed purple ring at the pull radius, gently animated (marching dash + subtle alpha pulse) to hint at the suction. Purely cosmetic, time-driven by `performance.now()`.

---

## v0.5.10 — 2026-05-21 (Magnet cell + pickup hitbox & pop-cap bug fixes)

### Added
- **Magnet cell** — a new player-wide buff pickup, drawn as a **purple circle with a red horseshoe-magnet logo** (`drawMagnet`). While active (30s), food within `cell radius × magnet.pullRadiusMultiplier` (1.15) of any of the player's cells is eased toward that cell each tick (`magnet.pullLerp`) and consumed by the normal eat pass — implemented in `applyMagnet` (runs before `eatFood`). Buffed cells get a purple glow + a `🧲` buff-HUD entry. Sizing mirrors the explosive (`mass: 80`, `count: 5`, `consumableMinMass: 1`, `respawnInterval: 2500`). Wired through every layer (config, `MagnetSnapshot` + `magnetBuffRemainingMs`, server entity/grid/respawn/`eatMagnets`/`magnetUntil`, network, render, main).

### Fixed
- **Large cells could not consume explosive / anti-aging (and speed) pickups even while sitting on top of them.** The eat test compared distance against the *pickup* radius from the cell's center, so once a cell's radius exceeded the pickup's, its center never got close enough. Now the consume radius is `max(cellRadius, pickupRadius)`, so a big cell covering a pickup consumes it. Applied to `eatSpeedCells`, `eatExplosives`, `eatAntiAgings`, `eatMagnets`.
- **Virus/mother pops could push a player's cell count over `player.maxCells`.** `popCell` forced a minimum of 2 pieces, so popping while at the cap added a cell. Now: if the owner is at the cap (no free slots) the cell just **absorbs the mass** (no split); otherwise it splits into at most `freeSlots + 1` pieces (capped at 8) so the total stays within `maxCells`, with mass divided evenly across the pieces.

---

## v0.5.9 — 2026-05-21 (bottle tuning + open consumption + random food friction)

### Changed
- **Bottle shapes are now proportion-driven** via a `BottleShape` preset per pickup (`EXPLOSIVE_BOTTLE`, `ANTIAGING_BOTTLE`) instead of hardcoded fractions in `bottlePath`.
  - Explosive: **shorter neck** (taller body).
  - Anti-Aging: **shorter, wider triangle body**, shorter neck, smaller mouth.
- **Anti-Aging bottle now has an hourglass icon** in its body (`drawHourglass`).
- **`explosive.consumableMinMass` 105 → 1** and **`antiAging.consumableMinMass` 330 → 1** — any cell can now consume either. **`antiAging.mass` 200 → 80** (explosive stays 80).
- **Mother food friction is now randomized per shot** in `[0.85, 0.9]`. Replaced `mother.foodFriction` with `foodFrictionMin` / `foodFrictionMax`; added a `friction` field to `ServerFood` set by `randomFoodFriction()` on each mother shot and applied in the food-movement loop.

---

## v0.5.8 — 2026-05-21 (bottle pickups + Anti-Aging cell)

### Added
- **Anti-Aging cell** — a new player-wide buff pickup. Eating one cuts mass decay by 50% (`antiAging.decayMultiplier: 0.5`) for 30s. Rendered as an **orange triangle (flask) bottle** with an orange glow on buffed cells and an `⏳` entry in the buff HUD. Only big cells can take it (`consumableMinMass: 330`); `mass: 200`, `count: 5`, `respawnInterval: 2500`. Wired through every layer: `antiAging` config block, `AntiAgingSnapshot` + `antiAgingBuffRemainingMs` on `CellSnapshot`, server entity/grid/respawn-queue/`eatAntiAgings`/`antiAgingUntil` on the player + decay-loop multiplier, `network.ts` Snapshot, `render.ts` draw + glow, `main.ts` state passing + buff HUD.
- `bottlePath()` render helper traces a bottle outline (wide mouth, thin neck, `rect` or `triangle` body) inscribed in the cell's radius — purely cosmetic, collision stays a circle. `drawBurst()` draws the explosive starburst icon.

### Changed
- **Explosive cell restyled** from a dark-red square-with-X to a **rectangular bottle with a red outline** and a yellow explosive-burst icon in the body. Hitbox is unchanged (circle of `radiusOf(80)`, eater's center must enter).
- **`explosive.count` 8 → 5.**
- **`mother.foodFriction` 0.86 → 0.875** (centered in the 0.85–0.9 range).

---

## v0.5.7 — 2026-05-20 (mother food friction + render cap)

### Changed
- **Mother-shot food now slows down and settles near the mother** instead of flying at constant speed to the world edge. Replaced `mother.foodSpeed` with `mother.foodInitialVelocity: 500` + `mother.foodFriction: 0.86`. Food is launched fast enough to clear the mother's body, then friction (applied per tick in the food-movement loop) bleeds off speed until it snaps to rest, forming a loose ring of pellets around the mother. The boundary clamp still applies as a fallback.
- **Render buffer is now capped at `maxRenderWidth: 1920 × maxRenderHeight: 1080`.** Previously a larger OS window enlarged the canvas drawing buffer, letting you see (and navigate) more of the map — effectively a zoom-out exploit on big monitors. Now `resize()` scales the buffer down to fit within the cap while CSS still stretches the canvas to 100vw/100vh, so oversized windows **zoom in** rather than revealing more world. Same scale on both axes preserves aspect ratio. Mouse input converts display px → buffer px so aiming stays accurate when the buffer is scaled.

### Removed
- `mother.foodSpeed` (replaced by `foodInitialVelocity` + `foodFriction`).

---

## v0.5.6 — 2026-05-20 (mother shoots + mother-pop)

### Changed
- **Mother no longer clusters food in a ring around itself.** Instead it shoots food from its origin at a random angle, constant speed (`mother.foodSpeed: 150 px/sec`). Food keeps moving at constant speed (no friction) until it reaches the world boundary, where it stops and becomes a regular static pellet. Removed `mother.foodRadius`. Added `vx`/`vy` to `ServerFood` and a movement loop in tick (skipped for stationary food, so the 5000-pellet loop is still cheap).
- **Eating a mother now pops the cell like a virus.** Unified `popCellOnVirus` into a generic `popCell(c, addedMass, now)` helper. `eatMothers` calls `popCell(c, CONFIG.mother.mass, now)`; `handleVirusCollisions` calls `popCell(c, CONFIG.virus.mass, now)`. Net effect: small cells (mass < 300) that touch a mother now fragment into up to 8 pieces with total mass = `cell.mass + 300`, same shape as virus pop. No more "free +300 mass with no downside".

---

## v0.5.5 — 2026-05-20 (bug fix: NaN blob crash + eject spam)

### Fixed
- **Server crash on eject from very small cells.** When a cell ejected with `mass < eject.costMass`, `c.mass -= costMass` went negative, `radiusOf(negative) = NaN`, blob inherited `x: NaN` / `y: NaN`, and next tick's `blobGrid.rebuild` crashed on `buckets[NaN].push`. Fix: compute radius from pre-subtract mass.
- **Eject spam at minimum size.** With `eject.minCellMass: 10` and `costMass: 16`, a player at the `minMass: 10` floor could spam W and produce free blobs (the clamp introduced in the NaN fix made the exploit silent rather than crashing). Now `doEject` requires `cell.mass >= max(eject.minCellMass, player.minMass + eject.costMass)` — effectively 26 mass with current values. The config-level `eject.minCellMass: 10` stays as the user-facing intent; the additional check enforces mass conservation.

---

## v0.5.4 — 2026-05-20 (minMass independent of startMass)

### Added
- **`player.minMass: 10`** — new config value separating the spawn mass (`startMass`) from the absolute floor any cell can shrink to.

### Changed
- Decay-floor clamp in server tick now uses `CONFIG.player.minMass` instead of `CONFIG.player.startMass`.
- `fragmentCell` piece-mass clamp now uses `minMass`.
- Cells spawn at `startMass`, decay toward `minMass`, and stop there. With production `startMass: 10` the behavior is unchanged from before; with testing `startMass: 100` cells correctly shrink down to 10 instead of being held at 100.

---

## v0.5.3 — 2026-05-20 (eject threshold)

### Changed
- **`eject.minCellMass: 35 → 10`** and removed the startMass-coupled safety check in `doEject`. The threshold is now a flat 10 regardless of `startMass`. With production `startMass: 10`, ejecting at 10 mass still triggers a small mass-creation effect via the decay floor — intentional, as it enables small-cell ejection for feeding/feeding-viruses gameplay.

---

## v0.5.2 — 2026-05-20 (rage rework + speed-buff player-wide)

### Changed
- **Speed buff is now player-wide, not per-cell.** Eating a speed cell sets `ServerPlayer.speedBuffUntil`; all of that player's cells (current and future) move at +20% for 30s. Removed `Cell.speedBuffUntil` and all the inheritance/merge propagation logic — much cleaner.
- **Rage struck cell loses 20% mass before fragmenting.** When a raged cell touches an opponent: `victim.mass *= 0.8`, then `fragmentCell(victim)`. The raged cell itself still fragments at full mass. Net effect: each rage contact is a small mass tax on the victim plus the chaos of fragmentation.
- **Raged cells repel siblings.** Previously raged cells skipped both merging (correct) and repulsion (bug — they'd pass through their own siblings). `repelSiblings` now keeps repulsion active whenever either cell is `raged`, regardless of merge cooldown.
- **`explosive.consumableMaxMass: 105` → `consumableMinMass: 105`.** Semantic flip: only cells with `mass >= 105` can eat the explosive. Big players take the risk now, not small ones. Updated server check accordingly.

---

## v0.5.1 — 2026-05-20 (follow-up tweaks)

### Changed
- **Speed cell**: visual size reduced from mass 150 → **60** (small powerup pellet feel). Removed `consumableMaxMass` field — any cell can now consume a speed cell regardless of mass.
- **Raged cells refuse to merge**: `mergeSiblings` now skips any pair where either cell is `raged`. Rage prevents recombination until the rage state ends (i.e., until contact triggers explosion).
- **Rage-contact behavior**: instead of instantly removing the opponent's cell, both the victim AND the raged cell now **fragment into 6 random-size pieces** (mass conserved per cell, capped by `maxCells`). Unified the logic into a shared `fragmentCell(c, now)` helper. Net effect: rage now causes chaos rather than instant kills — a small attacker can be effectively neutralized for a while, while the raged player also loses their consolidated mass.

### Naming note
Kept `popThreshold` for viruses (trap activates when `cell.mass >= threshold`) distinct from `consumableMaxMass` for mother/explosive (only cells where `cell.mass < max` can eat). They serve opposite semantic purposes; a single name would mislead. Speed cell now has no restriction so the field was simply removed.

---

## v0.5 — 2026-05-20

### Added
- **Speed cells** (`shared/config.ts:speedCell`, server arrays + grid): light-blue cells of mass 150, consumable by cells with mass < 200. Eating grants a 30s **+20% speed buff** on the eating cell. Max 5 in field; eaten ones respawn after 1200ms. New `SpeedCellSnapshot` in protocol; rendered as light-blue circles with a white lightning bolt.
- **Explosive virus** (`shared/config.ts:explosive`): dark-red rectangle of mass 80, consumable by cells with mass < 105. Eating triggers **RAGE** on that specific cell — speed ×2, dark-red glow, kills any opposing cell it contacts. On contact the raged cell **explodes into 6 random-size pieces** (mass conserved). Max 8 in field; respawn after 2500ms. Rendered as dark-red square with a red X.
- **Per-cell buff fields** in `Cell` (server) and `CellSnapshot` (wire): `speedBuffUntil` / `speedBuffRemainingMs`, `raged`. Children inherit buffs on split; survivors take max-of on merge.
- **Buff bar HUD** (`#buffs` in index.html, `renderBuffs` in src/main.ts): bottom-left, above instructions. Shows ⚡ Speed bar draining over 30s and 💥 RAGED indicator. Only visible when a buff is active; stacks vertically.
- **Theme switch** (`themeToggle` button on start screen): toggles a `.theme-light` class on body. Canvas reads colors from `THEMES` table in render.ts via `setRenderTheme`. Persisted in localStorage.
- **Contrast border for extreme cell colors**: cells whose hex color is near-white get a black outline; near-black get a white outline. Prevents "hiding" against the background.

### Changed
- **Mother count** reduced from 5 → 2; **`foodPerSpawn`** from 3 → 2 (less food cluttering each mother).
- **Mother color** changed from dark red → **dark orange** (`#cc6e1f`) so it visually contrasts with the new dark-red explosive virus.
- **Mother no longer grants the split boost.** Eating a mother now only gives +300 mass. Removed `player.boostedSplitMinMass`, `boostedSplitVelocity`, `boostEndsBelowTotal` from config; removed `ServerPlayer.boosted`; removed `CellSnapshot.boosted`; removed gold glow path from `drawCells`. The mother is now purely a food spike with a size restriction.
- **Cell mass label**: now rendered **only on your own cells**. Other players show name but not mass. Server still sends mass for everyone (rendering decides what to display).
- Theme-aware `bg`/`grid`/`worldBorder`/`nameStroke`/`nameFill` for the canvas; HUD/overlay use CSS variables.
- Idle demo loop background also respects the theme via `getBackgroundColor()`.

### Removed
- Boost-related config keys, server state, and rendering paths (see Changed above).

---

## v0.4 — 2026-05-20

### Added
- **Spatial grid** (`server/spatial-grid.ts`): uniform-grid broad-phase for food, blob, virus, and mother lookups. Rebuilt each tick; `forEachInRange` replaces full-array scans.
- **Virus feeding**: ejected blobs absorbed by viruses increment `fedCount`; at 7 feeds, virus shoots a new virus in the last-fed direction (`feedThreshold`, `shootVelocity` in config).
- **Mother cells**: 5 dark-red cells (mass 300) seeded at startup. Each spawns 3 food in a 70px ring every 1.5s. Cells with `mass < 300` eat them; the player gets a **split boost** (lower `splitMinMass: 35 → 15`, higher `splitVelocity: 1200 → 1800`) that ends when total mass falls below 30.
- **Custom cell color**: `<input type="color">` on start screen, sent in `join` message; server validates with hex regex; persisted to localStorage.
- **High-score HUD**: persistent localStorage high score in the top-left, gradient styled.
- **Per-cell mass label**: current mass renders under the owner name in smaller font.
- **Consume / death animation**: cells that disappear from the snapshot while on-screen spawn a shrink + expanding-ring fade (~380ms).
- **Idle demo loop**: drifting colored cells render behind the start overlay before connecting.
- **Unified start / death screen**: removed the separate dead overlay. On death the start screen reappears with a red banner message; name input is auto-focused and selected for one-Enter respawn.
- **Project docs**: `README.md`, `CLAUDE.md`, and this `CHANGELOG.md`.

### Changed
- Snapshot now carries `cells`, `food`, `blobs`, `viruses`, **`mothers`**, `leaderboard`.
- `VirusSnapshot` gained `fedCount`.
- `CellSnapshot` gained optional `boosted` flag for boost glow rendering.
- `ClientMessage` `join` accepts optional `color`.
- Snapshot food and mother filtering now uses spatial grid range query.

---

## v0.3 — Splitting, ejecting, viruses

### Added
- **Splitting** (Space): each cell ≥ 35 mass halves; one piece launches in cursor direction with `splitVelocity`. Cap of 16 cells per player.
- **Merge cooldown**: split pieces have `mergeAt = now + 10s + 25ms × mass`; until then they repel each other; after, they merge on overlap.
- **Ejecting mass** (W): each cell ≥ 35 mass loses 16 mass and emits a 12-mass blob flying toward cursor.
- **Viruses**: green spiky obstacles (20). Cells ≥ 133 mass touching one explode into pieces; smaller cells pass through harmlessly.
- **Multi-cell camera**: weighted centroid + min(mass-zoom, fit-bbox-zoom) so split cells stay framed.

### Changed
- Data model: `PlayerSnapshot` → `CellSnapshot` (cells become first-class with `ownerId`).
- Player "dead" event now fires only when **all** of their cells are eaten.
- Per-cell physics: velocity, friction, target-steering.

---

## v0.2 — Multiplayer

### Added
- Node.js + `ws` WebSocket server at `server/index.ts`, launched via `tsx watch`.
- Server-authoritative game state with 30Hz tick.
- Per-viewer **Area-of-Interest** snapshots so each client only receives nearby entities.
- **Snapshot interpolation**: client renders 100ms behind latest snapshot, lerping between two for smooth 60Hz visuals over 30Hz network.
- Names rendered on cells, leaderboard top-right.
- Death + respawn flow.
- `concurrently` runs client + server with one `npm run dev`.

### Changed
- Game logic moved from browser to server. Client became a thin renderer + input sender.
- Shared `config.ts`, `math.ts`, `protocol.ts` in `shared/` imported by both sides.

---

## v0.1 — Single-player MVP

### Added
- Project scaffolded with Vite + TypeScript.
- HTML5 Canvas full-screen game.
- Player cell follows mouse, eats food pellets, grows, mass decay.
- Mass-based zoom + camera follow.
- 800 food pellets respawning to keep total constant.
