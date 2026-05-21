# Agar Clone

A multiplayer Agar.io clone built from scratch with TypeScript, HTML5 Canvas, and a Node.js WebSocket server. Server-authoritative architecture with snapshot interpolation, spatial-grid collision, area-of-interest filtering, splitting, ejecting, viruses, and mother cells.

## Quick start

```bash
npm install
npm run dev
```

Opens `http://localhost:5173` automatically. The dev script launches both the WebSocket server (port 8080) and Vite client concurrently with `tsx watch` for live server reload. Open two browser tabs to play multiplayer.

## Controls

| Key / Input | Action |
|---|---|
| Mouse | Move (cell follows cursor) |
| Space | Split cells (each ≥ 35 mass halves; one piece launches toward cursor) |
| W | Eject a mass blob in cursor direction (cell loses 16 mass) |

## Mechanics

- **Eating**: predator must have at least 1.25× the prey's mass (the "25% rule"). Food is always edible.
- **Movement**: speed scales inversely with cell size — bigger cells are slower.
- **Splitting**: up to 16 pieces per player. Pieces merge after ~10s + 0.025s × mass cooldown when they overlap.
- **Viruses** (green spiky): pop cells ≥ 133 mass into pieces. Smaller cells pass through harmlessly. Feed a virus by ejecting 7 mass blobs into it — it spawns a new virus in the last-fed direction.
- **Mother cells** (dark red, mass 300): only cells smaller than the mother can eat them. Eater gets +300 mass and a **split boost** (lower min-split mass, faster split velocity, golden glow) until total mass drops below 30.
- **Decay**: each cell slowly loses 0.2% mass per second.

## Architecture

```
Browser tab                          Node.js server
┌─────────────────────┐              ┌──────────────────────┐
│ Render (60Hz)       │  ws:// json  │ Game tick (30Hz)     │
│ Snapshot interp.    │ ◄──────────► │ Authoritative state  │
│ Input → target xy   │              │ AOI snapshots        │
│ Color picker, HUD   │              │ Spatial-grid collide │
└─────────────────────┘              └──────────────────────┘
```

- **Server-authoritative**: server holds the only real game state. Clients send mouse targets + split/eject events; server runs physics, eating, splitting, merging.
- **Snapshot interpolation**: client renders 100ms behind the latest snapshot, lerping between the last two — makes 30Hz network feel smooth at 60Hz.
- **Area of Interest**: server only sends each client the entities visible from their cells' bounding box (computed in `shared/math.ts:aoiHalfExtent`).
- **Spatial grid** (`server/spatial-grid.ts`): uniform-grid broad-phase for cell-vs-food, cell-vs-blob, blob-vs-virus, and cell-vs-mother lookups. Cell-vs-cell stays O(n²) — fine at small player counts.

## Project layout

```
Agar.io/
├── shared/             # types and constants used by both sides
│   ├── config.ts       # all gameplay tunables
│   ├── math.ts         # radius/speed/zoom/AOI helpers
│   └── protocol.ts     # client <-> server message types
├── server/
│   ├── index.ts        # WebSocket server + 30Hz game tick
│   └── spatial-grid.ts # uniform-grid broad-phase
├── src/                # browser client
│   ├── main.ts         # frame loop, interpolation, input dispatch
│   ├── network.ts      # WebSocket client + snapshot buffer
│   ├── render.ts       # canvas drawing
│   └── input.ts        # mouse tracking
├── index.html          # canvas + HUD + start/death overlay
└── package.json
```

## Tuning

All gameplay constants live in `shared/config.ts`. Server hot-reloads on save thanks to `tsx watch` — refresh the browser to pick up client changes.

Common tweaks:

| Setting | Effect |
|---|---|
| `player.baseSpeed` | Movement speed (try 200 for slow, 1200 for chase) |
| `player.eatRatio` | Threshold to eat opponents (1.0 = anything touching, 2.0 = need double) |
| `player.splitMinMass` | Smaller = chaotic split spam |
| `player.mergeCooldownBase` | Smaller = faster re-merging after split |
| `virus.count` | More viruses = more risk for big players |
| `virus.popThreshold` | Mass at which viruses become dangerous |
| `virus.feedThreshold` | Blobs needed to make a virus shoot a new one |
| `mother.count` | Number of dark-red mother cells |
| `food.count` | Total food pellets in the world |

## See also

- [CHANGELOG.md](CHANGELOG.md) — features added per phase
- [CLAUDE.md](CLAUDE.md) — project conventions for AI-assisted development
