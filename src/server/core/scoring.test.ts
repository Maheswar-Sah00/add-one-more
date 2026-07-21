import { describe, expect, it } from 'vitest';
import { SCORING, WORLD } from '../../shared/config';
import {
  MILESTONES,
  currentMilestone,
  milestoneIdsUpTo,
  milestonesUpTo,
  newlyReached,
} from '../../shared/milestones';
import {
  advanceAllTime,
  parseAllTime,
  previousDayKey,
  type AllTimeRecord,
} from './leaderboards';
import { computeScore, computeScoreBreakdown, heightBonus, modifierBonus } from './scoring';

const PLATFORM = WORLD.platformTopY;

describe('base scores (§13)', () => {
  it('uses 100 / 250 / 500 for safe / risky / absurd', () => {
    // Book = safe, tyre = risky, fridge = absurd. Placed at platform => no height bonus.
    expect(computeScoreBreakdown('book', PLATFORM, opts()).base).toBe(100);
    expect(computeScoreBreakdown('tyre', PLATFORM, opts()).base).toBe(250);
    expect(computeScoreBreakdown('fridge', PLATFORM, opts()).base).toBe(500);
  });
});

function opts(over: Partial<{ modifierId: string; milestoneReached: boolean }> = {}) {
  return { modifierId: 'normal', milestoneReached: false, ...over };
}

describe('height bonus', () => {
  it('is zero at the platform and grows (capped) with height', () => {
    expect(heightBonus(PLATFORM)).toBe(0);
    expect(heightBonus(PLATFORM - 100)).toBe(Math.round(100 * SCORING.heightBonusPerUnit));
    expect(heightBonus(PLATFORM - 100000)).toBe(SCORING.maxHeightBonus); // capped
  });
});

describe('daily modifier bonus (placeholder)', () => {
  it('contributes nothing for the normal / unknown modifier', () => {
    expect(modifierBonus('normal', 300)).toBe(0);
    expect(modifierBonus('does-not-exist', 300)).toBe(0);
    expect(computeScoreBreakdown('book', PLATFORM, opts()).modifierBonus).toBe(0);
  });
});

describe('milestone bonus', () => {
  it('is added only when the placement crosses a milestone', () => {
    expect(computeScoreBreakdown('book', PLATFORM, opts()).milestoneBonus).toBe(0);
    const hit = computeScoreBreakdown('book', PLATFORM, opts({ milestoneReached: true }));
    expect(hit.milestoneBonus).toBe(SCORING.milestoneBonus);
    expect(hit.total).toBe(100 + SCORING.milestoneBonus);
  });
});

describe('total = base + height + modifier + milestone', () => {
  it('sums the components', () => {
    const b = computeScoreBreakdown('fridge', PLATFORM - 200, opts({ milestoneReached: true }));
    expect(b.total).toBe(b.base + b.heightBonus + b.modifierBonus + b.milestoneBonus);
    expect(b.base).toBe(500);
    expect(b.heightBonus).toBeGreaterThan(0);
    expect(b.milestoneBonus).toBe(SCORING.milestoneBonus);
  });

  it('computeScore convenience is base + height only', () => {
    expect(computeScore('book', PLATFORM)).toBe(100);
    expect(computeScore('book', PLATFORM - 100)).toBe(100 + heightBonus(PLATFORM - 100));
  });
});

describe('milestones (§13 thresholds + copy)', () => {
  it('defines the five required milestones', () => {
    expect(MILESTONES.map((m) => m.threshold)).toEqual([5, 10, 20, 35, 50]);
    expect(MILESTONES.map((m) => m.title)).toEqual([
      'It’s officially a tower.',
      'Questionable engineering.',
      'Local landmark.',
      'Physics is concerned.',
      'Community miracle.',
    ]);
  });

  it('unlocks by count', () => {
    expect(milestonesUpTo(4)).toHaveLength(0);
    expect(milestoneIdsUpTo(5)).toEqual(['tower']);
    expect(milestoneIdsUpTo(20)).toEqual(['tower', 'questionable', 'landmark']);
    expect(currentMilestone(0)).toBeNull();
    expect(currentMilestone(37)?.id).toBe('concerned');
    expect(currentMilestone(999)?.id).toBe('miracle');
  });

  it('newlyReached fires exactly once at the crossing count', () => {
    // Placement moving 4 -> 5 crosses "tower"; the refresh (5 -> 5) crosses nothing.
    expect(newlyReached(4, 5).map((m) => m.id)).toEqual(['tower']);
    expect(newlyReached(5, 5)).toHaveLength(0);
    expect(newlyReached(5, 6)).toHaveLength(0);
    // A single +1 step never crosses two milestones.
    expect(newlyReached(9, 10).map((m) => m.id)).toEqual(['questionable']);
  });
});

describe('all-time streak bookkeeping', () => {
  const empty: AllTimeRecord = parseAllTime({});

  it('starts a streak at 1 on the first ever placement', () => {
    const r = advanceAllTime(empty, '2026-07-15', false);
    expect(r.streak).toBe(1);
    expect(r.totalPlacements).toBe(1);
    expect(r.absurdCount).toBe(0);
    expect(r.lastDayKey).toBe('2026-07-15');
  });

  it('increments on consecutive days and resets on a gap', () => {
    const day1 = advanceAllTime(empty, '2026-07-14', true);
    const day2 = advanceAllTime(day1, '2026-07-15', false);
    expect(day2.streak).toBe(2);
    expect(day2.totalPlacements).toBe(2);
    expect(day2.absurdCount).toBe(1);

    const afterGap = advanceAllTime(day2, '2026-07-20', true);
    expect(afterGap.streak).toBe(1); // missed days -> reset
    expect(afterGap.totalPlacements).toBe(3);
    expect(afterGap.absurdCount).toBe(2);
  });

  it('computes the previous day key across month boundaries', () => {
    expect(previousDayKey('2026-07-15')).toBe('2026-07-14');
    expect(previousDayKey('2026-08-01')).toBe('2026-07-31');
    expect(previousDayKey('2026-01-01')).toBe('2025-12-31');
  });
});
