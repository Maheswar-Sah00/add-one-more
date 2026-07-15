/**
 * Reusable, pure tower-stability evaluation (§12).
 *
 * A placement succeeds ONLY when the ENTIRE tower stays under motion thresholds
 * for a continuous stable window — never merely because the new object touched
 * something. All logic here is pure and frame-driven so it is unit-testable
 * without Phaser: the scene samples Matter bodies into `BodyMotion[]` and feeds
 * frames to `stepStability`.
 */

/** Per-body motion sample extracted from a physics body. */
export type BodyMotion = {
  id: string;
  isStatic: boolean;
  isSleeping: boolean;
  vx: number;
  vy: number;
  angularVelocity: number;
};

export type StabilityStatus = 'pending' | 'stable' | 'failed' | 'timed-out';

/** Player-facing hint keys (never raw physics values). */
export type StabilityLabel = 'hold' | 'standing' | 'locked';

export const STABILITY_LABEL_TEXT: Record<StabilityLabel, string> = {
  hold: 'Hold…',
  standing: 'Still standing…',
  locked: 'Locked!',
};

export type StabilityConfig = {
  /** Max per-body |vx| + |vy|. */
  linearThreshold: number;
  /** Max per-body |angularVelocity|. */
  angularThreshold: number;
  /** Max combined kinetic metric per body. */
  motionThreshold: number;
  /** Weight applied to angular velocity in the combined metric. */
  angularWeight: number;
  /** Continuous stable time required to lock (≈2s). */
  requiredStableMs: number;
  /** Max evaluation window before giving up (≈6s). */
  maxEvalMs: number;
};

export const DEFAULT_STABILITY_CONFIG: StabilityConfig = {
  linearThreshold: 0.4,
  angularThreshold: 0.08,
  motionThreshold: 0.7,
  angularWeight: 12,
  requiredStableMs: 1800,
  maxEvalMs: 6000,
};

// --- pure per-body helpers -------------------------------------------------

export function linearMotion(b: BodyMotion): number {
  return Math.abs(b.vx) + Math.abs(b.vy);
}

export function angularMotion(b: BodyMotion): number {
  return Math.abs(b.angularVelocity);
}

export function combinedMotion(b: BodyMotion, cfg: StabilityConfig): number {
  return linearMotion(b) + angularMotion(b) * cfg.angularWeight;
}

/** A static or sleeping body is stable by definition; otherwise all three
 *  thresholds (linear, angular, combined) must hold. */
export function isBodyStable(b: BodyMotion, cfg: StabilityConfig): boolean {
  if (b.isStatic || b.isSleeping) return true;
  return (
    linearMotion(b) <= cfg.linearThreshold &&
    angularMotion(b) <= cfg.angularThreshold &&
    combinedMotion(b, cfg) <= cfg.motionThreshold
  );
}

export function allBodiesStable(
  bodies: readonly BodyMotion[],
  cfg: StabilityConfig
): boolean {
  return bodies.every((b) => isBodyStable(b, cfg));
}

// --- evaluator state machine (pure reducer) --------------------------------

export type StabilityState = {
  status: StabilityStatus;
  /** Time of the first meaningful collision (null until contact). */
  startedAt: number | null;
  /** Time the tower last became continuously stable (null when moving). */
  stableSince: number | null;
  label: StabilityLabel;
};

export type StabilityFrame = {
  bodies: readonly BodyMotion[];
  /** Scene-detected hard failure (a required body fell / left the world). */
  hardFail: boolean;
  now: number;
};

export function createStabilityState(): StabilityState {
  return { status: 'pending', startedAt: null, stableSince: null, label: 'hold' };
}

/** Mark the first meaningful collision; evaluation timing starts from here. */
export function beginEvaluation(state: StabilityState, now: number): StabilityState {
  if (state.status !== 'pending' || state.startedAt !== null) return state;
  return { ...state, startedAt: now };
}

/** Advance the evaluation by one frame. Terminal states are returned unchanged. */
export function stepStability(
  state: StabilityState,
  frame: StabilityFrame,
  cfg: StabilityConfig
): StabilityState {
  if (state.status !== 'pending') return state;

  if (frame.hardFail) {
    return { ...state, status: 'failed' };
  }

  // Waiting for the new object to actually contact the tower.
  if (state.startedAt === null) {
    return { ...state, label: 'hold' };
  }

  const elapsed = frame.now - state.startedAt;
  const stableNow = allBodiesStable(frame.bodies, cfg);

  let stableSince = state.stableSince;
  if (stableNow) {
    if (stableSince === null) stableSince = frame.now;
    if (frame.now - stableSince >= cfg.requiredStableMs) {
      return { status: 'stable', startedAt: state.startedAt, stableSince, label: 'locked' };
    }
  } else {
    stableSince = null;
  }

  if (elapsed >= cfg.maxEvalMs) {
    return { status: 'timed-out', startedAt: state.startedAt, stableSince, label: state.label };
  }

  return {
    status: 'pending',
    startedAt: state.startedAt,
    stableSince,
    label: stableNow ? 'standing' : 'hold',
  };
}
