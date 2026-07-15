/**
 * Shared world + gameplay constants.
 *
 * These MUST be identical on client (Phaser simulation) and server (commit
 * validation). Coordinates use a fixed virtual world: origin at the top-left,
 * y increases downward (Phaser convention). The platform sits near the bottom
 * and the tower grows upward (decreasing y).
 */
export const WORLD = {
  /** Virtual design width. The Phaser camera scales this to the viewport. */
  width: 480,
  /** Horizontal centre of the world / platform. */
  centerX: 240,
  /** Y of the top surface of the platform (objects rest just above this). */
  platformTopY: 1600,
  platformWidth: 210,
  platformHeight: 80,
  /** Anything whose y exceeds this has fallen off the tower => failure. */
  failLineY: 1720,
  /** Horizontal play bounds. A body outside these has left the world. */
  minX: 24,
  maxX: 456,
  /** Highest point a body may legally occupy (soft tower ceiling). */
  ceilingY: 120,
  /** New object spawns this far above the current tower top. */
  spawnGap: 150,
  /** Matter gravity y scale. */
  gravityY: 1,
} as const;

/** Server-side commit validation tolerances. */
export const VALIDATION = {
  /**
   * How far an already-accepted body may move (from its persisted position)
   * during a placement before we treat the snapshot as implausible. Settling
   * shifts are expected; wholesale teleports are not.
   */
  maxDisplacement: 96,
  minScale: 0.5,
  maxScale: 2,
} as const;

/** Daily player + attempt rules (§6 of the spec). */
export const RULES = {
  maxAttemptsPerDay: 3,
  /** One successful persistent object per player per daily tower. */
  maxSuccessesPerDay: 1,
  /** Hard cap on objects in a single daily tower (storage discipline, §14). */
  maxObjectsPerTower: 60,
  /** Attempt token lifetime in seconds. */
  attemptTtlSeconds: 120,
  /** Idempotency record lifetime in seconds. */
  idempotencyTtlSeconds: 600,
  /** Daily tower lifetime in ms (drives the countdown). */
  towerDurationMs: 24 * 60 * 60 * 1000,
} as const;

/** Scoring weights (§19). Score is always computed server-side. */
export const SCORING = {
  heightBonusPerUnit: 0.5,
  maxHeightBonus: 400,
} as const;
