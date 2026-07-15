import type {
  ObjectChoice,
  PlayerDailyState,
  TowerFinalSummary,
  TowerState,
} from './types';

/** A community milestone reached by a placement (Task 13). */
export type MilestoneInfo = {
  id: string;
  title: string;
};

/** One leaderboard row — public username + value only, never an internal id. */
export type LeaderboardEntry = {
  rank: number;
  username: string;
  value: number;
  isViewer: boolean;
};

export type LeaderboardBoard = {
  id: string;
  title: string;
  entries: LeaderboardEntry[];
};

export type LeaderboardResponse = {
  type: 'leaderboard';
  boards: LeaderboardBoard[];
  limit: number;
};

/** The community-monument archive: recent finalized daily summaries (§17). */
export type ArchiveResponse = {
  type: 'archive';
  entries: TowerFinalSummary[];
};

/** A body transform as submitted by the client on commit (no ownership — the
 *  server derives ownership itself so it cannot be spoofed). */
export type SubmittedBody = {
  bodyId: string;
  objectId: string;
  x: number;
  y: number;
  angle: number;
  scaleX: number;
  scaleY: number;
};

export type BootstrapResponse = {
  type: 'bootstrap';
  tower: TowerState;
  player: PlayerDailyState;
  username: string;
  userId: string | null;
  /** True when Redis is degraded: the tower is viewable but not writable. */
  readOnly: boolean;
  /** Present once the daily tower has finalized (§16). */
  summary: TowerFinalSummary | null;
  now: number;
};

export type StartAttemptResponse = {
  type: 'attempt-start';
  attemptId: string;
  baseTowerVersion: number;
  choices: ObjectChoice[];
  expiresAt: number;
  player: PlayerDailyState;
};

export type CommitRequest = {
  attemptId: string;
  idempotencyKey: string;
  selectedObjectId: string;
  baseTowerVersion: number;
  /** bodyId of the newly placed object within `bodies`. */
  newBodyId: string;
  /** Full settled snapshot: every accepted body plus the new one. */
  bodies: SubmittedBody[];
};

export type CommitResponse = {
  type: 'commit';
  status: 'committed';
  placementId: string;
  bodyId: string;
  sequenceNumber: number;
  score: number;
  tower: TowerState;
  player: PlayerDailyState;
  /** Present only when this placement crossed a milestone (celebrate once). */
  milestone: MilestoneInfo | null;
};

export type FailRequest = {
  attemptId: string;
};

export type FailResponse = {
  type: 'fail';
  player: PlayerDailyState;
};

export type ErrorCode =
  | 'no-post'
  | 'no-user'
  | 'no-tower'
  | 'no-attempts'
  | 'already-succeeded'
  | 'attempt-invalid'
  | 'attempt-expired'
  | 'validation-failed'
  | 'tower-full'
  | 'duplicate'
  | 'redis-error'
  | 'server-error';

export type ErrorResponse = {
  status: 'error';
  code: ErrorCode;
  message: string;
};

/** Version conflict is non-fatal (§17): the attempt is preserved and the fresh
 *  tower is returned so the client can reposition. */
export type ConflictResponse = {
  status: 'conflict';
  code: 'version-conflict';
  message: string;
  tower: TowerState;
  player: PlayerDailyState;
};

/**
 * Exact player-facing text for a non-punitive version conflict (§17, Task 9).
 * Shared so every conflict path — the pre-check and the WATCH/EXEC abort —
 * returns identical wording.
 */
export const CONFLICT_MESSAGE =
  'Someone added to the tower while you were placing. Your attempt is safe. Reposition against the latest tower.';
