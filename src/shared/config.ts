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
  /** Up to three successful persistent objects per player per daily tower — each
   *  stable drop ("perfect balance") is scored independently and summed into the
   *  player's daily score. */
  maxSuccessesPerDay: 3,
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
  /** Awarded to the player whose placement crosses a community milestone. */
  milestoneBonus: 150,
} as const;

/** Leaderboard read discipline (§14) — cap result sizes coming out of Redis. */
export const LEADERBOARD = {
  /** Default number of rows returned per board. */
  defaultLimit: 10,
  /** Hard ceiling regardless of a requested limit. */
  maxLimit: 50,
} as const;

/**
 * Community-monument archive (§16/17). Kept deliberately small — only compact
 * finalized summaries are archived (never full replay/body data), and the index
 * is trimmed to the most recent N days to bound Redis usage.
 */
export const ARCHIVE = {
  /** How many finalized days to keep in the archive index. */
  maxEntries: 30,
  /** Default rows returned by the archive endpoint. */
  defaultLimit: 14,
} as const;
