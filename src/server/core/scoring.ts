import { SCORING, WORLD } from '../../shared/config';
import { getModifier } from '../../shared/modifiers';
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

/** Capped height bonus for a body placed at `y`. */
export function heightBonus(y: number): number {
  return Math.min(Math.round(heightAbove(y) * SCORING.heightBonusPerUnit), SCORING.maxHeightBonus);
}

/**
 * Daily-modifier score contribution (§18) — placeholder. Returns the flat bonus
 * and the extra points from the multiplier for the active modifier. 'normal'
 * (today's only modifier) contributes nothing; real modifiers slot in via the
 * MODIFIERS registry with zero changes here.
 */
export function modifierBonus(modifierId: string, subtotal: number): number {
  const mod = getModifier(modifierId);
  const flat = mod.scoreFlatBonus;
  const scaled = Math.round((subtotal + flat) * mod.scoreMultiplier) - (subtotal + flat);
  return flat + scaled;
}

export type ScoreBreakdown = {
  base: number;
  heightBonus: number;
  modifierBonus: number;
  milestoneBonus: number;
  total: number;
};

/**
 * Authoritative placement score (§19), fully server-computed. The client never
 * submits a score — this is the only source of truth. Score =
 * base + height bonus + daily-modifier bonus + milestone bonus (when this
 * placement crosses a community milestone).
 */
export function computeScoreBreakdown(
  objectId: string,
  newBodyY: number,
  opts: { modifierId: string; milestoneReached: boolean }
): ScoreBreakdown {
  const def = getObjectDef(objectId);
  const base = def ? def.baseScore : 100;
  const hBonus = heightBonus(newBodyY);
  const mBonus = modifierBonus(opts.modifierId, base + hBonus);
  const milestoneBonus = opts.milestoneReached ? SCORING.milestoneBonus : 0;
  return {
    base,
    heightBonus: hBonus,
    modifierBonus: mBonus,
    milestoneBonus,
    total: base + hBonus + mBonus + milestoneBonus,
  };
}

/** Back-compat convenience: base + height bonus only (no modifier / milestone). */
export function computeScore(objectId: string, newBodyY: number): number {
  return computeScoreBreakdown(objectId, newBodyY, {
    modifierId: 'normal',
    milestoneReached: false,
  }).total;
}
