import { DIFFICULTY_ORDER, objectsByTier } from '../../shared/objects';
import { pickOne, seededRandom } from '../../shared/rng';
import type { ObjectChoice } from '../../shared/types';

/**
 * Issue the three risk-tiered object options for an attempt (§7). Deterministic
 * from the daily seed + attemptId, so the client can never pick an arbitrary
 * object — the server owns the offer.
 */
export function issueChoices(seed: string, attemptId: string): ObjectChoice[] {
  const rand = seededRandom(`${seed}:${attemptId}`);
  const choices: ObjectChoice[] = [];
  for (const tier of DIFFICULTY_ORDER) {
    const pick = pickOne(objectsByTier(tier), rand);
    if (pick) {
      choices.push({
        objectId: pick.id,
        name: pick.name,
        difficulty: pick.difficulty,
        baseScore: pick.baseScore,
      });
    }
  }
  return choices;
}
