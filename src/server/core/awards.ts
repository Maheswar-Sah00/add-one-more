/**
 * Daily awards (Task 17). DETERMINISTIC and server-calculated from the frozen
 * final tower — every award is derived only from SUCCESSFUL placements, so a
 * failed collapse is never rewarded over a real contribution. All ties break on
 * the earliest placement (lowest sequenceNumber), which is stable given the
 * append-only placement order.
 */
import type { Difficulty, PersistedBodyState, TowerAward, TowerPlacement } from '../../shared/types';
import { heightAbove } from './scoring';

const DIFFICULTY_RANK: Record<Difficulty, number> = { safe: 0, risky: 1, absurd: 2 };

type Ranked = {
  placement: TowerPlacement;
  /** World y (smaller = higher); +Infinity if the body is missing. */
  y: number;
  height: number;
};

/** Pick the best of `items` by `score` (higher wins), tie → lowest sequenceNumber. */
function best(items: Ranked[], score: (r: Ranked) => number): Ranked | null {
  let winner: Ranked | null = null;
  let winnerScore = -Infinity;
  for (const r of items) {
    const s = score(r);
    if (
      winner === null ||
      s > winnerScore ||
      (s === winnerScore && r.placement.sequenceNumber < winner.placement.sequenceNumber)
    ) {
      winner = r;
      winnerScore = s;
    }
  }
  return winner;
}

function award(id: string, label: string, r: Ranked | null, value: number, detail: string): TowerAward | null {
  if (!r) return null;
  return { id, label, username: r.placement.username, value, detail };
}

/**
 * Compute the six daily awards, in the required display order. An award is
 * omitted when no eligible successful placement exists (e.g. no absurd object →
 * no "Most Absurd Success").
 */
export function computeAwards(
  placements: readonly TowerPlacement[],
  bodies: readonly PersistedBodyState[]
): TowerAward[] {
  if (placements.length === 0) return [];

  const yByBody = new Map(bodies.map((b) => [b.bodyId, b.y]));
  const ranked: Ranked[] = placements.map((placement) => {
    const y = yByBody.get(placement.bodyId) ?? Infinity;
    return { placement, y, height: Number.isFinite(y) ? Math.round(heightAbove(y)) : 0 };
  });

  const byDifficulty = (d: Difficulty): Ranked[] =>
    ranked.filter((r) => r.placement.difficulty === d);

  // Highest Placement — the object sitting highest in the tower (min y).
  const highest = best(ranked, (r) => -r.y);

  // Bravest Builder — the highest-risk object, and among that tier the one placed
  // highest. Rewards putting a risky/absurd object up high (still a success).
  const maxRank = Math.max(...ranked.map((r) => DIFFICULTY_RANK[r.placement.difficulty]));
  const bravest = best(
    ranked.filter((r) => DIFFICULTY_RANK[r.placement.difficulty] === maxRank),
    (r) => -r.y
  );

  // Safest Hands — the best SAFE-tier placement (highest), rewarding steady play.
  const safest = best(byDifficulty('safe'), (r) => -r.y);

  // Last Stable Addition — the final object that stayed up (max sequenceNumber).
  const last = ranked.reduce<Ranked | null>(
    (acc, r) => (acc === null || r.placement.sequenceNumber > acc.placement.sequenceNumber ? r : acc),
    null
  );

  // Community MVP — highest contribution score.
  const mvp = best(ranked, (r) => r.placement.score);

  // Most Absurd Success — best absurd-tier placement by score.
  const absurd = best(byDifficulty('absurd'), (r) => r.placement.score);

  const out: (TowerAward | null)[] = [
    award('highest-placement', 'Highest Placement', highest, highest?.height ?? 0, `${highest?.height ?? 0}u high`),
    award('bravest-builder', 'Bravest Builder', bravest, bravest?.height ?? 0,
      bravest ? `${bravest.placement.difficulty} · ${bravest.height}u` : ''),
    award('safest-hands', 'Safest Hands', safest, safest?.height ?? 0, `${safest?.height ?? 0}u high`),
    award('last-stable', 'Last Stable Addition', last, last?.placement.sequenceNumber ?? 0,
      `object #${last?.placement.sequenceNumber ?? 0}`),
    award('community-mvp', 'Community MVP', mvp, mvp?.placement.score ?? 0, `${mvp?.placement.score ?? 0} pts`),
    award('most-absurd', 'Most Absurd Success', absurd, absurd?.placement.score ?? 0, `${absurd?.placement.score ?? 0} pts`),
  ];

  return out.filter((a): a is TowerAward => a !== null);
}
