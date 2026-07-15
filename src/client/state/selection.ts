/**
 * Object-selection presentation + tap interaction (Task 11). Builds player-safe
 * choice cards from the three server-issued options — surfacing name, tier
 * label, base score, and a short humorous blurb, while deliberately carrying NO
 * mass / friction / physics fields. The `tapCard` reducer models the mobile
 * two-tap flow (tap to select, tap again to confirm) so it is unit-testable
 * without a DOM.
 */
import { getObjectDef } from '../../shared/objects';
import type { Difficulty, ObjectChoice } from '../../shared/types';

const TIER_LABELS: Record<Difficulty, string> = {
  safe: 'Safe',
  risky: 'Risky',
  absurd: 'Absurd',
};

export function difficultyLabel(difficulty: Difficulty): string {
  return TIER_LABELS[difficulty];
}

/**
 * What a selection card shows. No physics numbers here by design — the player
 * decides on name, tier, score, and personality, not on density or friction.
 */
export type SelectionCard = {
  readonly objectId: string;
  readonly name: string;
  readonly difficulty: Difficulty;
  readonly difficultyLabel: string;
  readonly baseScore: number;
  readonly blurb: string;
};

export function selectionCards(choices: readonly ObjectChoice[]): SelectionCard[] {
  return choices.map((choice) => {
    const def = getObjectDef(choice.objectId);
    return {
      objectId: choice.objectId,
      name: choice.name,
      difficulty: choice.difficulty,
      difficultyLabel: TIER_LABELS[choice.difficulty],
      baseScore: choice.baseScore,
      blurb: def?.blurb ?? '',
    };
  });
}

export type SelectionState = { readonly selectedId: string | null };

export function initialSelection(): SelectionState {
  return { selectedId: null };
}

export function isSelected(state: SelectionState, objectId: string): boolean {
  return state.selectedId === objectId;
}

/**
 * Handle a tap on a choice card. Tapping a new card selects it (a clear visual
 * selected state, nothing committed yet); tapping the already-selected card
 * confirms it, which the caller uses to transition straight into placement.
 */
export function tapCard(
  state: SelectionState,
  objectId: string
): { state: SelectionState; confirmedId: string | null } {
  if (state.selectedId === objectId) {
    return { state, confirmedId: objectId };
  }
  return { state: { selectedId: objectId }, confirmedId: null };
}
