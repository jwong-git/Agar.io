// Shared constants used by both client and server. Tweak freely.
// Interval/Cooldown/Duration values are in milliseconds. Velocity/speed are px/sec.
export const CONFIG = {
  port: 8080,
  // TPS — reverted from 60 back to 30 to halve snapshot allocations after we
  // saw repeated server OOMs at 60 Hz on Fly. The 50ms client interpolation
  // buffer and 50ms ping to the Singapore region still keep perceived input
  // lag well below the original v0.5.x feel.
  tickRate: 30,

  world: {
    width: 5000,
    height: 5000,
    gridSize: 50,
  },

  player: {
    // v0.6.8: start at the mass floor (was 1000). Smaller start = higher zoom =
    // much smaller per-viewer AOI/snapshot (helps scalability), plus a real
    // from-scratch growth curve.
    startMass: 10,
    // hard floor for any cell's mass — independent of startMass. cells shrink
    // toward this via decay, eject, rage, etc. but never below it.
    minMass: 10,
    baseSpeed: 600,
    decayRate: 0.002, // 0.002
    // a cell must have at least this many times the other's mass to eat it
    eatRatio: 1.25,
    maxCells: 16,
    splitMinMass: 35,
    splitVelocity: 1200,
    splitFriction: 0.92,
    mergeCooldownBase: 10000,
    mergeCooldownPerMass: 25,
  },

  eject: {
    minCellMass: 10,
    costMass: 16,
    blobMass: 12,
    initialVelocity: 1100,
    friction: 0.92,
    radius: 8,
  },

  virus: {
    count: 30,
    // world-wide cap on live viruses. feedViruses only adds (never removes), so
    // without this they accumulate over a session and grow tick + snapshot cost.
    // (v0.6.8)
    maxCount: 60,
    mass: 100,
    popThreshold: 133,
    friction: 0.92,
    feedThreshold: 7,
    shootVelocity: 900,
  },

  mother: {
    count: 3,
    mass: 300,
    // cells with mass >= popThreshold × (effectiveMass / mass) pop on the mother
    // (virus-style), obtaining its FULL effective mass (300 + consumedMass). this
    // base value applies at base size and scales up as the mother engorges.
    popThreshold: 400,
    // the mother EATS player cells with mass < consumeMassRatio × its EFFECTIVE mass,
    // so the threshold grows as the mother engorges (starts at 0.8×300 = 240). cells
    // at/above this but below popThreshold sit on the mother harmlessly.
    consumeMassRatio: 0.8,
    // fraction of an eaten cell's mass stored in the mother's consumedMass pool
    consumeConvertRate: 0.9,
    // consumedMass adds to the mother's effective mass for size & collision
    // (linear for now: effectiveMass = mass + consumedMass × this; tune later)
    consumedSizeFactor: 1.0,
    spawnInterval: 1500,
    foodPerSpawn: 2,
    // while consumedMass > 0 the mother spawns extra pellets ≈ consumedMass × this…
    foodPerConsumedMass: 0.04,
    // …and each extra pellet drains this much from consumedMass, so the mother's
    // size & spawn rate ramp back to normal as the pool empties. (=1 → 1:1 with
    // each mass-1 pellet; >1 drains faster but discards mass.)
    foodMassCost: 1,
    // mother food is MINTED (added to the world), never recycled from the 5000-pellet
    // field pool — so mothers never drain the rest of the map. Minted food is
    // transient (removed when eaten). PER-MOTHER cap on live minted food, so every
    // mother spawns independently — total across all mothers can reach count × this.
    // PER-MOTHER cap on live NATURAL food only (the base foodPerSpawn pellets). BONUS
    // food converted from consumedMass (player cells the mother ate) IGNORES this cap
    // and is minted until consumedMass hits 0. No mother food is ever expired/removed
    // except by being eaten — so heavy player-grinding can grow the field's food.
    maxSpawnedFood: 150,
    // world-wide cap on live BONUS food (the uncapped consumedMass-driven pellets).
    // when total bonus food across all mothers reaches this, new bonus pellets are
    // skipped — consumedMass still drains so the mother shrinks back. prevents the
    // tick loop from slowing down as bonus food accumulates over a long session.
    maxTotalBonusFood: 1000,
    // base launch speed (px/sec), scaled up with the mother's radius so food still
    // clears the body when the mother is engorged. Friction then settles it nearby.
    foodInitialVelocity: 500,
    // each shot of food gets a random friction in [min, max]: lower = settles
    // closer, higher = drifts farther. Randomizing gives a more organic spread.
    foodFrictionMin: 0.85,
    foodFrictionMax: 0.9,
  },

  speedCell: {
    count: 5,
    mass: 60,
    // no mass restriction — any cell can consume a speed cell
    buffDurationMs: 30000,
    speedMultiplier: 1.2,
    respawnInterval: 1200,
  },

  explosive: {
    count: 5,
    mass: 80,
    // minimum cell mass to eat the explosive (1 = any cell can take the risk)
    consumableMinMass: 1,
    rageSpeedMultiplier: 2.0,
    explodePieces: 6,
    respawnInterval: 2500,
  },

  antiAging: {
    count: 5,
    mass: 80,
    // minimum cell mass to consume it (1 = any cell)
    consumableMinMass: 1,
    // multiplies decayRate while the buff is active (0.5 = decay halved)
    decayMultiplier: 0.5,
    buffDurationMs: 30000,
    respawnInterval: 2500,
  },

  magnet: {
    count: 5,
    mass: 80,
    // minimum cell mass to consume it (1 = any cell)
    consumableMinMass: 1,
    buffDurationMs: 30000,
    respawnInterval: 2500,
    // while active, food within (player cell radius × this) is pulled in
    pullRadiusMultiplier: 1.6,
    // fraction of the remaining distance food eases toward the cell each tick.
    // keep low so food visibly streams across the gap between the pull range and
    // the cell body instead of snapping in and getting eaten in a single tick.
    pullLerp: 0.12,
  },

  food: {
    // v0.6.8: 4000 -> 1500. Whole-map snapshots serialize ~food.count
    // objects per viewer per tick, so this is the biggest single lever on
    // snapshot build + JSON cost + the per-tick food grid rebuild.
    count: 1500,
    mass: 1,
    radius: 5,
  },

  radiusScale: 4,
  zoomBase: 6,
  minZoom: 0.5,
  maxZoom: 2.5,
  // hard cap on the render buffer. windows larger than this don't reveal more
  // world — the capped buffer is stretched to fill, so the game zooms in.
  maxRenderWidth: 1920,
  maxRenderHeight: 1080,
  spatialGridCellSize: 200,
};
