import { describe, expect, it } from 'vitest';
import type { Difficulty, PersistedBodyState, TowerPlacement } from '../../shared/types';
import { computeAwards } from './awards';

let seq = 0;
function place(
  username: string,
  difficulty: Difficulty,
  score: number,
  y: number
): { placement: TowerPlacement; body: PersistedBodyState } {
  seq += 1;
  const bodyId = `b${seq}`;
  return {
    placement: {
      placementId: `p${seq}`, bodyId, userId: `t2_${username}`, username,
      objectId: 'x', difficulty, score, placedAt: seq * 1000, sequenceNumber: seq,
    },
    body: {
      bodyId, objectId: 'x', ownerUserId: `t2_${username}`, ownerUsername: username,
      sequenceNumber: seq, x: 240, y, angle: 0, scaleX: 1, scaleY: 1,
    },
  };
}

function fixture() {
  seq = 0;
  const rows = [
    place('alice', 'safe', 120, 1500), // seq 1, mid
    place('bob', 'absurd', 400, 1300), // seq 2, highest + top score + absurd
    place('carol', 'risky', 200, 1450), // seq 3
    place('dave', 'safe', 130, 1400), // seq 4, safe higher than alice
  ];
  return {
    placements: rows.map((r) => r.placement),
    bodies: rows.map((r) => r.body),
  };
}

describe('computeAwards — six deterministic daily awards', () => {
  it('returns no awards for an empty tower (no failures rewarded)', () => {
    expect(computeAwards([], [])).toHaveLength(0);
  });

  it('assigns each award to the correct successful contributor', () => {
    const { placements, bodies } = fixture();
    const byId = Object.fromEntries(computeAwards(placements, bodies).map((a) => [a.id, a]));

    expect(byId['highest-placement']?.username).toBe('bob'); // y=1300, highest
    expect(byId['community-mvp']?.username).toBe('bob'); // score 400
    expect(byId['most-absurd']?.username).toBe('bob'); // only absurd
    expect(byId['bravest-builder']?.username).toBe('bob'); // absurd tier, highest
    expect(byId['safest-hands']?.username).toBe('dave'); // best safe (y=1400 < 1500)
    expect(byId['last-stable']?.username).toBe('dave'); // seq 4, the last one up
  });

  it('is deterministic — identical inputs give identical output', () => {
    const a = fixture();
    const b = fixture();
    expect(computeAwards(a.placements, a.bodies)).toEqual(computeAwards(b.placements, b.bodies));
  });

  it('is order-independent (shuffling placements does not change winners)', () => {
    const { placements, bodies } = fixture();
    const shuffled = [...placements].reverse();
    const forward = Object.fromEntries(computeAwards(placements, bodies).map((a) => [a.id, a.username]));
    const reversed = Object.fromEntries(computeAwards(shuffled, bodies).map((a) => [a.id, a.username]));
    expect(reversed).toEqual(forward);
  });

  it('omits awards with no eligible placement (no absurd → no Most Absurd)', () => {
    seq = 0;
    const only = [place('alice', 'safe', 100, 1500)];
    const ids = computeAwards(only.map((r) => r.placement), only.map((r) => r.body)).map((a) => a.id);
    expect(ids).not.toContain('most-absurd');
    expect(ids).toContain('community-mvp');
    expect(ids).toContain('safest-hands');
  });

  it('never rewards a failed collapse — awards come only from placements', () => {
    // There is no code path that accepts failures: computeAwards takes ONLY the
    // successful placements + their bodies. A tower with successes yields awards
    // whose winners are all successful contributors.
    const { placements, bodies } = fixture();
    const winners = new Set(computeAwards(placements, bodies).map((a) => a.username));
    const contributors = new Set(placements.map((p) => p.username));
    for (const w of winners) expect(contributors.has(w)).toBe(true);
  });

  it('breaks ties on the earliest placement (lowest sequenceNumber)', () => {
    seq = 0;
    // Two identical top scores; the earlier one (seq 1) must win MVP.
    const rows = [place('early', 'risky', 300, 1400), place('late', 'risky', 300, 1400)];
    const mvp = computeAwards(rows.map((r) => r.placement), rows.map((r) => r.body)).find(
      (a) => a.id === 'community-mvp'
    );
    expect(mvp?.username).toBe('early');
  });
});
