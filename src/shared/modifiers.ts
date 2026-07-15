/**
 * Daily modifiers (Task 16). The modifier is chosen SERVER-SIDE, deterministically
 * from the day key, so every player on a given day sees the same one — it is
 * never per-player and never re-rolls. Modifiers only scale fixed physics
 * constants (gravity / density / friction); they introduce no randomness into
 * whether a placement holds, so outcomes stay skill-based, not luck-based.
 *
 * Shared so the server owns the choice and the client derives identical physics
 * from `meta.modifierId`.
 */
import { pickOne, seededRandom } from './rng';

export type DailyModifier = {
  readonly id: string;
  readonly label: string;
  /** One-line explanation shown to the player before an attempt. */
  readonly description: string;
  /** Multiplier on world gravity (1 = normal). */
  readonly gravityScale: number;
  /** Multiplier on every object's density / mass (1 = normal). */
  readonly densityScale: number;
  /** Multiplier on every object's friction (1 = normal). */
  readonly frictionScale: number;
  /** Score effect is a documented PLACEHOLDER today (all modifiers = neutral). */
  readonly scoreFlatBonus: number;
  readonly scoreMultiplier: number;
};

const NORMAL: DailyModifier = {
  id: 'normal',
  label: 'Normal Day',
  description: 'Standard gravity and grip. A fair, honest tower.',
  gravityScale: 1,
  densityScale: 1,
  frictionScale: 1,
  scoreFlatBonus: 0,
  scoreMultiplier: 1,
};

export const MODIFIERS: Readonly<Record<string, DailyModifier>> = {
  normal: NORMAL,
  'low-gravity': {
    id: 'low-gravity',
    label: 'Low Gravity',
    description: 'Objects fall gently and settle slowly — patience pays off.',
    gravityScale: 0.55,
    densityScale: 1,
    frictionScale: 1,
    scoreFlatBonus: 0,
    scoreMultiplier: 1,
  },
  heavy: {
    id: 'heavy',
    label: 'Heavy Day',
    description: 'Everything is denser and drops with authority. Commit to your placement.',
    gravityScale: 1,
    densityScale: 1.7,
    frictionScale: 1,
    scoreFlatBonus: 0,
    scoreMultiplier: 1,
  },
  slippery: {
    id: 'slippery',
    label: 'Slippery Day',
    description: 'Low friction — surfaces are slick, so balance carefully.',
    gravityScale: 1,
    densityScale: 1,
    frictionScale: 0.45,
    scoreFlatBonus: 0,
    scoreMultiplier: 1,
  },
};

/** Selection pool, in a fixed order (used for the deterministic daily pick). */
export const MODIFIER_IDS: readonly string[] = ['normal', 'low-gravity', 'heavy', 'slippery'];

export const DEFAULT_MODIFIER = NORMAL;

export function getModifier(id: string): DailyModifier {
  return MODIFIERS[id] ?? DEFAULT_MODIFIER;
}

/**
 * The day's modifier — deterministic from the day key, so it is identical for
 * every player and stable all day. Weighted toward Normal so most days feel
 * standard and the variants stay special.
 */
export function pickDailyModifier(dayKey: string): DailyModifier {
  // Weight Normal ~40%: pool = [normal, normal, low-gravity, heavy, slippery].
  const pool: readonly string[] = ['normal', 'normal', 'low-gravity', 'heavy', 'slippery'];
  const rand = seededRandom(`modifier:${dayKey}`);
  const id = pickOne(pool, rand) ?? 'normal';
  return getModifier(id);
}

/** Physics multipliers a client applies to reproduce the day's modifier exactly. */
export type ModifierPhysics = {
  gravityScale: number;
  densityScale: number;
  frictionScale: number;
};

export function modifierPhysics(id: string): ModifierPhysics {
  const m = getModifier(id);
  return {
    gravityScale: m.gravityScale,
    densityScale: m.densityScale,
    frictionScale: m.frictionScale,
  };
}
