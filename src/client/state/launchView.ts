/**
 * Pure presentation logic for the live tower launch screen (Task 10). Kept free
 * of React/DOM so every state transition, the responsive breakpoint, the tower
 * stats, and the object-inspection model are unit-testable in the node vitest
 * environment. The visual layout itself is Tailwind CSS breakpoints; this module
 * owns the decisions those layouts render.
 */
import { RULES } from '../../shared/config';
import { getObjectDef } from '../../shared/objects';
import type { Difficulty, PlayerDailyState, TowerState, TowerStatus } from '../../shared/types';

/** Tailwind `sm`. Below this we lay the hero + controls out for a phone. */
export const LAYOUT_BREAKPOINT = 640;

export type LayoutMode = 'mobile' | 'desktop';

export function layoutMode(widthPx: number): LayoutMode {
  return widthPx < LAYOUT_BREAKPOINT ? 'mobile' : 'desktop';
}

export const MAX_ATTEMPTS = RULES.maxAttemptsPerDay;
export const MAX_PLACEMENTS = RULES.maxSuccessesPerDay;

/**
 * The one primary state the launch screen is in. Exactly one applies; the order
 * of checks in `deriveLaunchState` defines precedence (hard failures first, then
 * infra degradation, then terminal tower state, then the player's own status).
 */
export type LaunchState =
  | 'loading'
  | 'network-error'
  | 'redis-error'
  | 'read-only'
  | 'finalized'
  | 'unauthenticated'
  | 'contributed'
  | 'no-attempts'
  | 'ready';

export type LaunchInput = {
  loading: boolean;
  /** A hard bootstrap failure: distinguish a transport error from storage. */
  errorCode: 'network' | 'redis' | null;
  /** Redis degraded but the tower is still viewable. */
  readOnly: boolean;
  /** userId !== null. */
  authenticated: boolean;
  player: PlayerDailyState | null;
  /** null while still loading. */
  towerStatus: TowerStatus | null;
};

export function deriveLaunchState(input: LaunchInput): LaunchState {
  if (input.loading) return 'loading';
  if (input.errorCode === 'network') return 'network-error';
  if (input.errorCode === 'redis') return 'redis-error';
  if (input.readOnly) return 'read-only';
  if (input.towerStatus === 'finalized' || input.towerStatus === 'completed') return 'finalized';
  if (!input.authenticated) return 'unauthenticated';
  // "Contributed" now means the player has used up all their placement slots
  // (placed maxSuccessesPerDay objects) — a single success no longer locks them out.
  if (input.player && input.player.placementsRemaining <= 0) return 'contributed';
  if ((input.player?.attemptsRemaining ?? 0) <= 0) return 'no-attempts';
  return 'ready';
}

/** Whether the big primary "ADD ONE MORE THING" button should be enabled. */
export function canStartAttempt(state: LaunchState): boolean {
  return state === 'ready';
}

// ---- tower header / stats --------------------------------------------------

export function dailyTitle(tower: TowerState): string {
  return `Daily Tower · ${tower.meta.dayKey}`;
}

export function towerIsEmpty(tower: TowerState): boolean {
  return tower.bodies.length === 0;
}

export type TowerStat = { key: string; label: string; value: string };

export function towerStats(tower: TowerState): TowerStat[] {
  return [
    { key: 'objects', label: 'Objects', value: String(tower.meta.successfulPlacements) },
    { key: 'height', label: 'Height', value: String(Math.round(tower.meta.height)) },
    { key: 'builders', label: 'Builders', value: String(tower.meta.uniqueContributors) },
  ];
}

export function formatCountdown(ms: number): string {
  if (ms <= 0) return 'closed';
  const total = Math.floor(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m ${String(s).padStart(2, '0')}s`;
}

/** Short player contribution status line shown on the launch screen. */
export function contributionStatus(
  state: LaunchState,
  player: PlayerDailyState | null
): string {
  switch (state) {
    case 'contributed':
      return `All ${MAX_PLACEMENTS} of your objects are in today’s tower.`;
    case 'no-attempts':
      return 'No attempts left today — come back tomorrow.';
    case 'ready': {
      const attemptsLeft = player?.attemptsRemaining ?? MAX_ATTEMPTS;
      const placed = player?.successfulPlacements ?? 0;
      if (placed > 0) {
        const slots = player?.placementsRemaining ?? MAX_PLACEMENTS;
        return `${placed} placed · ${slots} more object${slots === 1 ? '' : 's'} you can add · ${attemptsLeft} attempt${attemptsLeft === 1 ? '' : 's'} left`;
      }
      return `${attemptsLeft} of ${MAX_ATTEMPTS} attempts left today`;
    }
    case 'unauthenticated':
      return 'Sign in on Reddit to add your object.';
    case 'read-only':
      return 'Saving is paused — you can still explore the tower.';
    case 'finalized':
      return 'This tower is finalized. Watch for the next one.';
    default:
      return '';
  }
}

// ---- object inspection -----------------------------------------------------

/**
 * What an inspected body reveals (Task 10). Deliberately carries NO user id —
 * only the public username — so internal ids are never exposed to the client UI.
 */
export type InspectionModel = {
  objectName: string;
  contributor: string;
  sequenceNumber: number;
  difficulty: Difficulty;
  /** null when scoring is unavailable → the UI shows a placeholder. */
  score: number | null;
  /** ms epoch, or null if the placement record is missing. */
  placedAt: number | null;
  laterAdditions: number;
  /** Whether this is the viewer's own object — drives the subtle marker. */
  isOwn: boolean;
};

export function inspectionModel(
  bodyId: string,
  tower: TowerState,
  currentUserId: string | null
): InspectionModel | null {
  const body = tower.bodies.find((b) => b.bodyId === bodyId);
  if (!body) return null;
  const placement = tower.placements.find((p) => p.bodyId === bodyId);
  const def = getObjectDef(body.objectId);
  const score =
    placement && Number.isFinite(placement.score) && placement.score > 0 ? placement.score : null;
  const laterAdditions = tower.bodies.filter(
    (b) => b.sequenceNumber > body.sequenceNumber
  ).length;
  return {
    objectName: def?.name ?? body.objectId,
    contributor: body.ownerUsername || placement?.username || 'anonymous',
    sequenceNumber: body.sequenceNumber,
    difficulty: placement?.difficulty ?? def?.difficulty ?? 'safe',
    score,
    placedAt: placement?.placedAt ?? null,
    laterAdditions,
    isOwn: currentUserId !== null && currentUserId.length > 0 && body.ownerUserId === currentUserId,
  };
}

export function formatPlacedAt(placedAt: number | null, now: number): string {
  if (placedAt === null) return 'moments ago';
  const diff = Math.max(0, now - placedAt);
  const m = Math.floor(diff / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

export function formatScore(score: number | null): string {
  return score === null ? '—' : `${score} pts`;
}
