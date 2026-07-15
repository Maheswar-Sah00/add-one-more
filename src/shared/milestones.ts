/**
 * Community milestones (Task 13). Shared so the server owns "which milestones a
 * count unlocks" (authoritative, saved once) and the client can render the same
 * labels for the celebration + community status line. Pure and side-effect free.
 */

export type Milestone = {
  readonly id: string;
  /** Successful-object count at which this milestone unlocks. */
  readonly threshold: number;
  /** Player-facing celebration / status title. */
  readonly title: string;
};

/** The five daily milestones, in ascending threshold order. */
export const MILESTONES: readonly Milestone[] = [
  { id: 'tower', threshold: 5, title: 'It’s officially a tower.' },
  { id: 'questionable', threshold: 10, title: 'Questionable engineering.' },
  { id: 'landmark', threshold: 20, title: 'Local landmark.' },
  { id: 'concerned', threshold: 35, title: 'Physics is concerned.' },
  { id: 'miracle', threshold: 50, title: 'Community miracle.' },
];

const BY_ID: ReadonlyMap<string, Milestone> = new Map(MILESTONES.map((m) => [m.id, m]));

export function getMilestone(id: string): Milestone | undefined {
  return BY_ID.get(id);
}

/** Every milestone unlocked at `count` successful objects. */
export function milestonesUpTo(count: number): Milestone[] {
  return MILESTONES.filter((m) => count >= m.threshold);
}

export function milestoneIdsUpTo(count: number): string[] {
  return milestonesUpTo(count).map((m) => m.id);
}

/** The highest milestone reached at `count` (the current community status), or null. */
export function currentMilestone(count: number): Milestone | null {
  let reached: Milestone | null = null;
  for (const m of MILESTONES) {
    if (count >= m.threshold) reached = m;
  }
  return reached;
}

/**
 * The milestones newly crossed when the object count moves from `prevCount` to
 * `newCount` (threshold in (prevCount, newCount]). This is what a single commit
 * should celebrate + persist exactly once; a refresh reads the saved set and
 * crosses nothing, so it never re-triggers.
 */
export function newlyReached(prevCount: number, newCount: number): Milestone[] {
  return MILESTONES.filter((m) => m.threshold > prevCount && m.threshold <= newCount);
}
