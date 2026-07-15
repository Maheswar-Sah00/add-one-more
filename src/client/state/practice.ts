/**
 * Practice Mode (Task 15). A purely LOCAL sandbox over a copy of the current
 * accepted tower: unlimited placement, the same physics/controls, success and
 * collapse — but it never touches the server. This module owns the session
 * model (the local snapshot + counters) so the "local copy / restore on
 * collapse / unlimited / no server" semantics are unit-testable without a DOM.
 *
 * There is deliberately NO function here that builds a commit/attempt request:
 * practice can only ever produce local outcomes, so it cannot commit an official
 * placement even by accident.
 */
import type { PersistedBodyState, TowerState } from '../../shared/types';

/** Exact required disclaimer shown throughout Practice Mode. */
export const PRACTICE_BANNER = 'Practice — this will not change the community tower.';

export type PracticeSession = {
  /** The local practice tower — a deep copy of the official accepted bodies. */
  bodies: PersistedBodyState[];
  /** Objects that stayed up this session. */
  placed: number;
  /** Collapses this session (each restores the local snapshot). */
  collapses: number;
};

/** Begin a practice session from a COPY of the official accepted tower. */
export function startPractice(tower: TowerState): PracticeSession {
  return {
    bodies: tower.bodies.map((b) => ({ ...b })),
    placed: 0,
    collapses: 0,
  };
}

export type PracticeOutcome = 'stayed' | 'collapsed';

/**
 * Fold a resolved practice drop into the session. A body that stayed is appended
 * to the local snapshot (so the next object stacks on it — unlimited); a collapse
 * leaves the snapshot untouched (it was restored to the pre-drop state).
 */
export function recordPractice(
  session: PracticeSession,
  outcome: PracticeOutcome,
  placedBody: PersistedBodyState | null
): PracticeSession {
  if (outcome === 'stayed' && placedBody) {
    return {
      ...session,
      bodies: [...session.bodies, { ...placedBody }],
      placed: session.placed + 1,
    };
  }
  return { ...session, collapses: session.collapses + 1 };
}

/**
 * Practice is always available — it never gates on official attempts or a prior
 * official success, and never consumes either.
 */
export function canPractice(hasTower: boolean): boolean {
  return hasTower;
}
