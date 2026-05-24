# Project rules for Claude

This file is automatically loaded into Claude's context for this project. It captures conventions, must-not-break invariants, and where things live.

## What this project is

An Agar.io clone built incrementally over multiple sessions. The user is a comfortable coder (knows JS/TS/general programming) but new to game dev — frame explanations in terms of general programming concepts rather than engine-specific vocabulary.

## Working agreement

- **Always append to `CHANGELOG.md`** when making code changes. Group entries by phase or session under a dated heading. Use Added / Changed / Fixed / Removed subheadings. This is a hard rule for this project.
- The user **frequently tweaks `shared/config.ts` in the IDE** while playing — preserve any local changes when re-writing the file (re-read with Bash if the Write tool blocks on "modified since read"; user changes that you didn't make are intentional).
- **Don't introduce a UI element without wiring it through every layer.** Adding a new entity = update `shared/protocol.ts`, server data structures, server snapshot building, `src/network.ts` Snapshot type, `src/render.ts` draw function, `src/main.ts` state passing. Skipping a layer breaks rendering or types.

## Architecture invariants (do not break)

- **Server is the only source of truth.** Clients send input + events; they render whatever the server sends. Never compute authoritative game state in `src/`.
- **Wire format lives in `shared/protocol.ts`.** Both sides import these types. Add new fields here first.
- **All tunable gameplay numbers live in `shared/config.ts`.** No magic numbers in physics or rendering code — refer to `CONFIG.*`.
- **Tick rate is 60Hz**, render rate is 60Hz (rAF). Clients interpolate 50ms behind latest snapshot to hide network jitter (`RENDER_DELAY_MS` in `src/main.ts`).
- **Per-viewer AOI**: server filters snapshots to each viewer's area. Don't send the whole world to everyone.

## Stack

- Client: TypeScript + HTML5 Canvas, bundled by Vite (`npm run dev:client`)
- Server: Node.js + `ws`, launched via `tsx watch` (`npm run dev:server`)
- `npm run dev` runs both together with `concurrently`
- One `tsconfig.json` at root, includes `src`, `shared`, `server`, with `types: ["node"]`

## File map (don't guess — these are exhaustive)

```
shared/
  config.ts        # ALL tunable numbers — player, eject, virus, mother, food, world
  math.ts          # radiusOf, speedOf, zoomOf, aoiHalfExtent (pure functions)
  protocol.ts      # CellSnapshot, FoodSnapshot, BlobSnapshot, VirusSnapshot, MotherSnapshot, ClientMessage, ServerMessage

server/
  index.ts         # 60Hz tick: input → move → grid rebuild → repulse → eat → virus → merge → opponents → decay → snapshots
  spatial-grid.ts  # uniform-grid broad-phase: rebuild(), forEachInRange(x0,y0,x1,y1,fn)

src/
  main.ts          # frame loop, snapshot interpolation, camera (centroid + fit-bbox zoom), keyboard dispatch, death-fade tracking, idle demo loop
  network.ts       # WebSocket client + Snapshot buffer; methods: sendInput, split, eject, respawn
  render.ts        # render(), renderDeathFades(); private draw* functions for grid/food/blobs/viruses/mothers/cells

index.html         # canvas + HUD (high score, leaderboard, controls hint) + unified start/death overlay
```

## Common operations

| Task | Steps |
|---|---|
| Change a tunable | Edit `shared/config.ts` only. tsx restarts server; refresh browser. |
| Add a new entity type | shared/protocol.ts → server data struct + tick logic + snapshot building → network.ts Snapshot type → render.ts draw fn → main.ts state passing → render() args |
| Add a key binding | main.ts keydown handler → network.ts method → protocol.ts ClientMessage variant → server message dispatch |
| Inspect wire format | DevTools → Network → WS tab → click connection → Messages |

## Things to watch for

- **Discriminated union narrowing**: `ServerMessage` and `ClientMessage` are tagged unions on `type`. TypeScript narrows correctly when you `if (msg.type === "...")`. Don't lose this by typing parameters as `any`.
- **Splice-during-iteration**: when removing cells/blobs from arrays during a tick, iterate backwards or use sentinel-mark-then-sweep (see `eatBlobs` + `sweepEatenBlobs` in server/index.ts).
- **Spatial grid staleness within a tick**: the grid is built once per tick. If entities are removed mid-tick (e.g., blob eaten), mark them with a sentinel (`x = -1`) and check inside the `forEachInRange` callback.
- **`tsc --noEmit`** is the source of truth for type errors; run it before declaring done.

## User preferences (specific to this project)

- Prefers terse, structured responses with tables and brief explanations
- Wants to understand what's changing and why, but doesn't need step-by-step play-by-play
- Will modify `config.ts` between turns — be tolerant
- Asks clarifying questions in dedicated "Questions:" sections; always answer them
