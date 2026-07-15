import { describe, expect, it } from 'vitest';
import type { PersistedBodyState, TowerState } from '../../shared/types';
import {
  PRACTICE_BANNER,
  canPractice,
  recordPractice,
  startPractice,
} from './practice';

function body(bodyId: string, seq: number): PersistedBodyState {
  return {
    bodyId,
    objectId: 'book',
    ownerUserId: 't2_alice',
    ownerUsername: 'alice',
    sequenceNumber: seq,
    x: 240,
    y: 1560 - seq * 30,
    angle: 0,
    scaleX: 1,
    scaleY: 1,
  };
}

function tower(bodies: PersistedBodyState[]): TowerState {
  return {
    meta: {
      towerId: 't3_x', postId: 't3_x', dayKey: '2026-07-15', version: 7, status: 'active',
      seed: 's', modifierId: 'normal', themeId: 'warehouse', createdAt: 0, endsAt: 0, finalizedAt: 0,
      height: 0, successfulPlacements: bodies.length, uniqueContributors: 1, milestonesUnlocked: [],
    },
    bodies,
    placements: [],
  };
}

describe('practice mode — required disclaimer', () => {
  it('uses the exact required banner text', () => {
    expect(PRACTICE_BANNER).toBe('Practice — this will not change the community tower.');
  });
});

describe('practice session is a local copy of the official tower', () => {
  it('deep-copies the accepted bodies (mutating the session never touches the source)', () => {
    const official = tower([body('b1', 1), body('b2', 2)]);
    const session = startPractice(official);
    expect(session.bodies).toHaveLength(2);
    expect(session.placed).toBe(0);
    expect(session.collapses).toBe(0);

    // Mutate the session's copy…
    session.bodies[0]!.x = -999;
    // …the official tower is untouched.
    expect(official.bodies[0]!.x).toBe(240);
  });
});

describe('unlimited placement + restore semantics', () => {
  it('a body that stays is appended (so the next object stacks on it)', () => {
    let session = startPractice(tower([body('b1', 1)]));
    session = recordPractice(session, 'stayed', body('p1', 2));
    session = recordPractice(session, 'stayed', body('p2', 3));
    expect(session.bodies).toHaveLength(3);
    expect(session.placed).toBe(2);
    expect(session.collapses).toBe(0);
  });

  it('supports far more than three placements — it is unlimited', () => {
    let session = startPractice(tower([]));
    for (let i = 0; i < 25; i++) {
      session = recordPractice(session, 'stayed', body(`p${i}`, i + 1));
    }
    expect(session.placed).toBe(25);
    expect(session.bodies).toHaveLength(25);
  });

  it('a collapse restores the local snapshot (bodies unchanged, collapse counted)', () => {
    let session = startPractice(tower([body('b1', 1)]));
    session = recordPractice(session, 'stayed', body('p1', 2)); // 2 bodies now
    const before = session.bodies.length;
    session = recordPractice(session, 'collapsed', null);
    expect(session.bodies).toHaveLength(before); // nothing added on collapse
    expect(session.collapses).toBe(1);
    expect(session.placed).toBe(1);
  });

  it('ignores a "stayed" outcome with no body (defensive)', () => {
    let session = startPractice(tower([]));
    session = recordPractice(session, 'stayed', null);
    expect(session.bodies).toHaveLength(0);
    expect(session.placed).toBe(0);
  });
});

describe('practice availability', () => {
  it('is available whenever a tower is loaded, regardless of official state', () => {
    // No dependence on attempts remaining or prior success — always usable.
    expect(canPractice(true)).toBe(true);
    expect(canPractice(false)).toBe(false);
  });
});
