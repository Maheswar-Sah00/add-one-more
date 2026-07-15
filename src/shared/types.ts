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
  createdAt: number;
  endsAt: number;
  /** Vertical extent above the platform, in world units. */
  height: number;
  successfulPlacements: number;
  uniqueContributors: number;
  milestonesUnlocked: string[];
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
  hasSucceeded: boolean;
  successfulPlacementId: string | null;
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
