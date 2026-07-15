import { describe, expect, it } from 'vitest';
import type { PlayerDailyState, TowerState } from '../../shared/types';
import {
  LAYOUT_BREAKPOINT,
  MAX_ATTEMPTS,
  MAX_PLACEMENTS,
  canStartAttempt,
  contributionStatus,
  dailyTitle,
  deriveLaunchState,
  formatCountdown,
  formatPlacedAt,
  formatScore,
  inspectionModel,
  layoutMode,
  towerIsEmpty,
  towerStats,
  type LaunchInput,
} from './launchView';

function makeTower(over: Partial<TowerState['meta']> = {}, bodies: TowerState['bodies'] = [], placements: TowerState['placements'] = []): TowerState {
  return {
    meta: {
      towerId: 't3_x', postId: 't3_x', dayKey: '2026-07-15', version: 1, status: 'active',
      seed: 's', modifierId: 'normal', themeId: 'warehouse', createdAt: 0, endsAt: 0, finalizedAt: 0,
      height: 128, successfulPlacements: bodies.length, uniqueContributors: 1, milestonesUnlocked: [],
      ...over,
    },
    bodies,
    placements,
  };
}

function player(over: Partial<PlayerDailyState> = {}): PlayerDailyState {
  return {
    userId: 't2_alice', username: 'alice', attemptsUsed: 0, attemptsRemaining: 3,
    successfulPlacements: 0, placementsRemaining: 3,
    hasSucceeded: false, successfulPlacementId: null, score: 0, ...over,
  };
}

const READY: LaunchInput = {
  loading: false, errorCode: null, readOnly: false, authenticated: true,
  player: player(), towerStatus: 'active',
};

describe('responsive layout mode', () => {
  it('is mobile below the breakpoint and desktop at/above it', () => {
    expect(layoutMode(320)).toBe('mobile'); // small phone
    expect(layoutMode(375)).toBe('mobile'); // iPhone
    expect(layoutMode(LAYOUT_BREAKPOINT - 1)).toBe('mobile');
    expect(layoutMode(LAYOUT_BREAKPOINT)).toBe('desktop');
    expect(layoutMode(768)).toBe('desktop'); // tablet
    expect(layoutMode(1440)).toBe('desktop'); // desktop
  });
});

describe('deriveLaunchState — every required screen state', () => {
  it('loading takes precedence over everything', () => {
    expect(deriveLaunchState({ ...READY, loading: true })).toBe('loading');
  });
  it('network error', () => {
    expect(deriveLaunchState({ ...READY, errorCode: 'network' })).toBe('network-error');
  });
  it('redis error (hard bootstrap failure)', () => {
    expect(deriveLaunchState({ ...READY, errorCode: 'redis' })).toBe('redis-error');
  });
  it('read-only (redis degraded but viewable)', () => {
    expect(deriveLaunchState({ ...READY, readOnly: true })).toBe('read-only');
  });
  it('finalized tower', () => {
    expect(deriveLaunchState({ ...READY, towerStatus: 'finalized' })).toBe('finalized');
    expect(deriveLaunchState({ ...READY, towerStatus: 'completed' })).toBe('finalized');
  });
  it('unauthenticated may inspect but not contribute', () => {
    expect(deriveLaunchState({ ...READY, authenticated: false })).toBe('unauthenticated');
  });
  it('placed all objects → contributed (a single success no longer locks out)', () => {
    // One success still leaves placement slots, so the player stays "ready".
    expect(
      deriveLaunchState({
        ...READY,
        player: player({ hasSucceeded: true, successfulPlacements: 1, placementsRemaining: 2 }),
      })
    ).toBe('ready');
    // Using every placement slot is what marks the player "contributed".
    expect(
      deriveLaunchState({
        ...READY,
        player: player({
          hasSucceeded: true,
          successfulPlacements: 3,
          placementsRemaining: 0,
          attemptsRemaining: 0,
          attemptsUsed: 3,
        }),
      })
    ).toBe('contributed');
  });
  it('out of attempts', () => {
    expect(deriveLaunchState({ ...READY, player: player({ attemptsRemaining: 0, attemptsUsed: 3 }) })).toBe('no-attempts');
  });
  it('ready to add', () => {
    expect(deriveLaunchState(READY)).toBe('ready');
  });

  it('only the ready state enables the primary button', () => {
    expect(canStartAttempt('ready')).toBe(true);
    for (const s of ['loading', 'network-error', 'redis-error', 'read-only', 'finalized', 'unauthenticated', 'contributed', 'no-attempts'] as const) {
      expect(canStartAttempt(s)).toBe(false);
    }
  });
});

describe('tower header + stats + empty state', () => {
  it('formats the daily title from the day key', () => {
    expect(dailyTitle(makeTower({ dayKey: '2026-07-15' }))).toContain('2026-07-15');
  });
  it('reports empty vs non-empty towers', () => {
    expect(towerIsEmpty(makeTower({}, []))).toBe(true);
    expect(towerIsEmpty(makeTower({}, [body('b1', 1, 't2_a', 'a')]))).toBe(false);
  });
  it('exposes object / height / builder counts', () => {
    const stats = towerStats(makeTower({ successfulPlacements: 4, height: 251.6, uniqueContributors: 3 }));
    expect(stats.map((s) => `${s.label}:${s.value}`)).toEqual(['Objects:4', 'Height:252', 'Builders:3']);
  });
  it('formats the countdown and closes at zero', () => {
    expect(formatCountdown(2 * 3600_000 + 5 * 60_000)).toBe('2h 5m');
    expect(formatCountdown(90_000)).toBe('1m 30s');
    expect(formatCountdown(0)).toBe('closed');
  });

  it('contribution status reflects the state', () => {
    expect(contributionStatus('ready', player({ attemptsRemaining: 2 }))).toBe(`2 of ${MAX_ATTEMPTS} attempts left today`);
    // After a first success, ready copy reflects remaining placement slots.
    const partial = contributionStatus(
      'ready',
      player({ attemptsRemaining: 2, successfulPlacements: 1, placementsRemaining: 2 })
    );
    expect(partial).toContain('1 placed');
    expect(partial).toContain('2 more objects');
    expect(contributionStatus('contributed', player())).toContain('in today');
    expect(contributionStatus('contributed', player())).toContain(String(MAX_PLACEMENTS));
    expect(contributionStatus('unauthenticated', null)).toContain('Sign in');
  });
});

function body(bodyId: string, seq: number, ownerUserId: string, ownerUsername: string): TowerState['bodies'][number] {
  return {
    bodyId, objectId: 'book', ownerUserId, ownerUsername, sequenceNumber: seq,
    x: 240, y: 1560 - seq * 30, angle: 0, scaleX: 1, scaleY: 1,
  };
}
function placement(bodyId: string, seq: number, username: string, score: number, placedAt: number): TowerState['placements'][number] {
  return {
    placementId: `p${seq}`, bodyId, userId: 't2_secret', username, objectId: 'book',
    difficulty: 'safe', score, placedAt, sequenceNumber: seq,
  };
}

describe('object inspection model', () => {
  const tower = makeTower(
    { successfulPlacements: 3, uniqueContributors: 2 },
    [
      body('b1', 1, 't2_alice', 'alice'),
      body('b2', 2, 't2_bob', 'bob'),
      body('b3', 3, 't2_alice', 'alice'),
    ],
    [
      placement('b1', 1, 'alice', 120, 1_000),
      placement('b2', 2, 'bob', 175, 2_000),
      placement('b3', 3, 'alice', 100, 3_000),
    ]
  );

  it('returns name, contributor, sequence, difficulty, score, time, and later additions', () => {
    const m = inspectionModel('b1', tower, 't2_alice');
    expect(m).not.toBeNull();
    expect(m?.objectName).toBe('Hardback Book');
    expect(m?.contributor).toBe('alice');
    expect(m?.sequenceNumber).toBe(1);
    expect(m?.difficulty).toBe('safe');
    expect(m?.score).toBe(120);
    expect(m?.placedAt).toBe(1_000);
    expect(m?.laterAdditions).toBe(2); // b2 and b3 came later
  });

  it('marks the viewer’s own object and only theirs', () => {
    expect(inspectionModel('b1', tower, 't2_alice')?.isOwn).toBe(true); // alice's
    expect(inspectionModel('b2', tower, 't2_alice')?.isOwn).toBe(false); // bob's
    expect(inspectionModel('b2', tower, 't2_bob')?.isOwn).toBe(true);
  });

  it('never marks isOwn for an unauthenticated viewer', () => {
    expect(inspectionModel('b1', tower, null)?.isOwn).toBe(false);
    expect(inspectionModel('b1', tower, '')?.isOwn).toBe(false);
  });

  it('does NOT expose any internal user id in the model', () => {
    const m = inspectionModel('b1', tower, 't2_alice');
    const serialized = JSON.stringify(m);
    expect(serialized).not.toContain('t2_alice'); // owner id absent
    expect(serialized).not.toContain('t2_secret'); // placement.userId absent
    expect(Object.keys(m ?? {})).not.toContain('userId');
    expect(Object.keys(m ?? {})).not.toContain('ownerUserId');
  });

  it('the last object has no later additions', () => {
    expect(inspectionModel('b3', tower, 't2_alice')?.laterAdditions).toBe(0);
  });

  it('falls back to a placeholder score when scoring is unavailable', () => {
    const noScore = makeTower({}, [body('b1', 1, 't2_a', 'a')], []); // no placement record
    expect(inspectionModel('b1', noScore, 't2_a')?.score).toBeNull();
    expect(formatScore(null)).toBe('—');
    expect(formatScore(120)).toBe('120 pts');
  });

  it('returns null for an unknown body id', () => {
    expect(inspectionModel('nope', tower, 't2_alice')).toBeNull();
  });
});

describe('formatPlacedAt', () => {
  const now = 10 * 3600_000;
  it('reads out relative time', () => {
    expect(formatPlacedAt(now, now)).toBe('just now');
    expect(formatPlacedAt(now - 5 * 60_000, now)).toBe('5m ago');
    expect(formatPlacedAt(now - 3 * 3600_000, now)).toBe('3h ago');
    expect(formatPlacedAt(now - 26 * 3600_000, now)).toBe('1d ago');
    expect(formatPlacedAt(null, now)).toBe('moments ago');
  });
});
