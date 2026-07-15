/** Core domain types shared between the Phaser client and the Devvit server. */

export type Difficulty = 'safe' | 'risky' | 'absurd';

export type TowerStatus = 'active' | 'completed' | 'finalized';

/**
 * One physics body currently accepted into the tower. This is the render +
 * simulation source of truth: the client rebuilds Matter bodies from these.
 */
export type PersistedBodyState = {
  bodyId: string;
  objectId: string;
  ownerUserId: string;
  ownerUsername: string;
  sequenceNumber: number;
  x: number;
  y: number;
  /** Radians. */
  angle: number;
  scaleX: number;
  scaleY: number;
};

/** Append-only metadata about a successful placement (for inspection/ownership). */
export type TowerPlacement = {
  placementId: string;
  bodyId: string;
  userId: string;
  username: string;
  objectId: string;
  difficulty: Difficulty;
  score: number;
  placedAt: number;
  sequenceNumber: number;
};

export type TowerMeta = {
  /** Equals the postId — one tower per post. */
  towerId: string;
  postId: string;
  dayKey: string;
  version: number;
  status: TowerStatus;
  seed: string;
  modifierId: string;
  themeId: string;
  /** Daily start time (ms epoch). */
  createdAt: number;
  /** Server-authoritative daily end time (ms epoch) — drives the countdown. */
  endsAt: number;
  /** When the tower was finalized (ms epoch), or 0 while still running. */
  finalizedAt: number;
  /** Vertical extent above the platform, in world units. */
  height: number;
  successfulPlacements: number;
  uniqueContributors: number;
  milestonesUnlocked: string[];
};

/** An award winner shown in the final summary (public name only, no id). */
export type TowerAward = {
  /** Stable award id, e.g. 'highest-placement'. */
  id: string;
  label: string;
  username: string;
  value: number;
  /** Short human unit/detail, e.g. '312 pts' or 'object #14'. */
  detail: string;
};

/**
 * The immutable record of a finished daily tower (Task 16/17). Saved once at
 * finalization so previous-day statistics stay historically valid.
 */
export type TowerFinalSummary = {
  towerId: string;
  dayKey: string;
  modifierId: string;
  startedAt: number;
  endedAt: number;
  finalizedAt: number;
  totalObjects: number;
  uniqueContributors: number;
  totalAttempts: number;
  finalHeight: number;
  milestonesUnlocked: string[];
  awards: TowerAward[];
};

/** Initial state descriptor for the next day's tower, produced at finalization. */
export type NextDailyState = {
  dayKey: string;
  seed: string;
  modifierId: string;
  startsAt: number;
  endsAt: number;
};

/** Everything the client needs to render the current tower. */
export type TowerState = {
  meta: TowerMeta;
  bodies: PersistedBodyState[];
  placements: TowerPlacement[];
};

export type PlayerDailyState = {
  userId: string;
  username: string;
  attemptsUsed: number;
  attemptsRemaining: number;
  /** How many objects this player has successfully placed today (0..maxSuccessesPerDay). */
  successfulPlacements: number;
  /** Successful placements still allowed today = max(0, maxSuccessesPerDay - successfulPlacements). */
  placementsRemaining: number;
  /** True once the player has at least one successful placement today (for markers/status). */
  hasSucceeded: boolean;
  /** The player's most recent successful placement id, or null. */
  successfulPlacementId: string | null;
  /** Daily score: the sum of every successful placement's server-computed score. */
  score: number;
};

export type AttemptStatus =
  | 'issued'
  | 'selected'
  | 'submitted'
  | 'failed'
  | 'committed'
  | 'expired';

/** One of the three risk-tiered options offered at the start of an attempt. */
export type ObjectChoice = {
  objectId: string;
  name: string;
  difficulty: Difficulty;
  baseScore: number;
};

export type OfficialAttempt = {
  attemptId: string;
  towerId: string;
  userId: string;
  baseTowerVersion: number;
  issuedObjectIds: string[];
  selectedObjectId: string | null;
  status: AttemptStatus;
  createdAt: number;
  expiresAt: number;
};
