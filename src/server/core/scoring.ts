import { SCORING, WORLD } from '../../shared/config';
import { getObjectDef } from '../../shared/objects';
import type { PersistedBodyState } from '../../shared/types';

/** Vertical extent of a body above the platform, in world units (never negative). */
export function heightAbove(y: number): number {
  return Math.max(0, WORLD.platformTopY - y);
}

/** Tower height = highest body above the platform. */
export function towerHeight(bodies: readonly PersistedBodyState[]): number {
  let max = 0;
  for (const b of bodies) {
    const h = heightAbove(b.y);
    if (h > max) max = h;
  }
  return Math.round(max);
}

/** Authoritative placement score (§19): base + capped height bonus. */
export function computeScore(objectId: string, newBodyY: number): number {
  const def = getObjectDef(objectId);
  const base = def ? def.baseScore : 100;
  const bonus = Math.min(
    Math.round(heightAbove(newBodyY) * SCORING.heightBonusPerUnit),
    SCORING.maxHeightBonus
  );
  return base + bonus;
}
