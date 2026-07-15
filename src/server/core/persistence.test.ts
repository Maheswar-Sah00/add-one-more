import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Persistence round-trip tests. `@devvit/web/server`'s `redis` singleton is
 * replaced with an in-memory implementation (incl. watch/multi/exec) so the
 * real tower.ts store/load logic runs unchanged. Proves: create → commit →
 * reload reconstructs the accepted state; failed placements are never stored.
 */

type ZMember = { member: string; score: number };
type Op = () => Promise<unknown>;

const mocks = vi.hoisted(() => {
  class MockRedis {
    strings = new Map<string, string>();
    hashes = new Map<string, Map<string, string>>();
    zsets = new Map<string, Map<string, number>>();
    fail = false;

    flushAll(): void {
      this.strings.clear();
      this.hashes.clear();
      this.zsets.clear();
      this.fail = false;
    }
    private guard(): void {
      if (this.fail) throw new Error('redis unavailable');
    }
    async get(key: string): Promise<string | undefined> {
      this.guard();
      return this.strings.get(key);
    }
    async set(key: string, value: string): Promise<string> {
      this.guard();
      this.strings.set(key, value);
      return 'OK';
    }
    async del(...keys: string[]): Promise<void> {
      this.guard();
      for (const k of keys) this.strings.delete(k);
    }
    async expire(): Promise<void> {
      this.guard();
    }
    async incrBy(key: string, n: number): Promise<number> {
      this.guard();
      const next = Number(this.strings.get(key) ?? '0') + n;
      this.strings.set(key, String(next));
      return next;
    }
    async hGetAll(key: string): Promise<Record<string, string>> {
      this.guard();
      const h = this.hashes.get(key);
      return h ? Object.fromEntries(h) : {};
    }
    async hSet(key: string, obj: Record<string, string>): Promise<number> {
      this.guard();
      const h = this.hashes.get(key) ?? new Map<string, string>();
      for (const [f, v] of Object.entries(obj)) h.set(f, v);
      this.hashes.set(key, h);
      return Object.keys(obj).length;
    }
    async hSetNX(key: string, field: string, value: string): Promise<number> {
      this.guard();
      const h = this.hashes.get(key) ?? new Map<string, string>();
      if (h.has(field)) return 0;
      h.set(field, value);
      this.hashes.set(key, h);
      return 1;
    }
    async zAdd(key: string, ...members: ZMember[]): Promise<number> {
      this.guard();
      const z = this.zsets.get(key) ?? new Map<string, number>();
      for (const m of members) z.set(m.member, m.score);
      this.zsets.set(key, z);
      return members.length;
    }
    async watch(): Promise<unknown> {
      this.guard();
      const ops: Op[] = [];
      const tx = {
        multi: async (): Promise<void> => {},
        unwatch: async (): Promise<unknown> => tx,
        set: async (k: string, v: string): Promise<unknown> => {
          ops.push(() => this.set(k, v));
          return tx;
        },
        hSet: async (k: string, o: Record<string, string>): Promise<unknown> => {
          ops.push(() => this.hSet(k, o));
          return tx;
        },
        zAdd: async (k: string, ...m: ZMember[]): Promise<unknown> => {
          ops.push(() => this.zAdd(k, ...m));
          return tx;
        },
        incrBy: async (k: string, n: number): Promise<unknown> => {
          ops.push(() => this.incrBy(k, n));
          return tx;
        },
        exec: async (): Promise<unknown[]> => {
          for (const op of ops) await op();
          return ops.map(() => 1);
        },
      };
      return tx;
    }
  }
  return { redis: new MockRedis() };
});

vi.mock('@devvit/web/server', () => ({
  redis: mocks.redis,
  scheduler: { runJob: async () => 'job', cancelJob: async () => {}, listJobs: async () => [] },
}));

import type { SubmittedBody } from '../../shared/api';
import type { PersistedBodyState } from '../../shared/types';
import { commitPlacement, ensureTower, loadTowerState } from './tower';
import { validateCommit } from './validate';

const POST = 't3_test';

beforeEach(() => mocks.redis.flushAll());

function sub(over: Partial<SubmittedBody> = {}): SubmittedBody {
  return { bodyId: 'b1', objectId: 'book', x: 240, y: 1560, angle: 0, scaleX: 1, scaleY: 1, ...over };
}
function carry(bodies: readonly PersistedBodyState[]): SubmittedBody[] {
  return bodies.map((b) => ({
    bodyId: b.bodyId,
    objectId: b.objectId,
    x: b.x,
    y: b.y,
    angle: b.angle,
    scaleX: 1,
    scaleY: 1,
  }));
}

describe('shared tower persistence', () => {
  it('creates an empty active tower on first access', async () => {
    const meta = await ensureTower(POST, 1000);
    expect(meta.version).toBe(1);
    expect(meta.status).toBe('active');
    const tower = await loadTowerState(POST);
    expect(tower?.bodies).toHaveLength(0);
  });

  it('commit stores the placement; a fresh load reconstructs it with ownership', async () => {
    await ensureTower(POST, 1000);
    const submitted = [sub({ bodyId: 'b1' })];
    expect(
      validateCommit({ existing: [], submitted, newBodyId: 'b1', selectedObjectId: 'book', issuedObjectIds: ['book'] }).ok
    ).toBe(true);

    const outcome = await commitPlacement({
      postId: POST, userId: 't2_alice', username: 'alice',
      submitted, newBodyId: 'b1', selectedObjectId: 'book',
      baseTowerVersion: 1, placementId: 'p1', idempotencyKey: 'k1', now: 2000,
    });
    expect(outcome.kind).toBe('committed');

    // Simulate the refresh: read straight back from Redis.
    const tower = await loadTowerState(POST);
    expect(tower?.meta.version).toBe(2);
    expect(tower?.bodies).toHaveLength(1);
    expect(tower?.bodies[0]?.objectId).toBe('book');
    expect(tower?.bodies[0]?.ownerUsername).toBe('alice');
    expect(tower?.meta.successfulPlacements).toBe(1);
    expect(tower?.meta.uniqueContributors).toBe(1);
    expect(tower?.placements[0]?.userId).toBe('t2_alice');
  });

  it('a second contributor stacks on top; version + counts advance', async () => {
    await ensureTower(POST, 1000);
    await commitPlacement({
      postId: POST, userId: 't2_alice', username: 'alice',
      submitted: [sub({ bodyId: 'b1' })], newBodyId: 'b1', selectedObjectId: 'book',
      baseTowerVersion: 1, placementId: 'p1', idempotencyKey: 'k1', now: 2000,
    });
    const afterFirst = await loadTowerState(POST);
    const submitted2 = [
      ...carry(afterFirst?.bodies ?? []),
      sub({ bodyId: 'b2', objectId: 'brick', y: 1520 }),
    ];
    const outcome = await commitPlacement({
      postId: POST, userId: 't2_bob', username: 'bob',
      submitted: submitted2, newBodyId: 'b2', selectedObjectId: 'brick',
      baseTowerVersion: 2, placementId: 'p2', idempotencyKey: 'k2', now: 3000,
    });
    expect(outcome.kind).toBe('committed');

    const tower = await loadTowerState(POST);
    expect(tower?.bodies).toHaveLength(2);
    expect(tower?.meta.version).toBe(3);
    expect(tower?.meta.uniqueContributors).toBe(2);
  });

  it('a stale base version is a non-punitive conflict and does not mutate the tower', async () => {
    await ensureTower(POST, 1000);
    const outcome = await commitPlacement({
      postId: POST, userId: 't2_alice', username: 'alice',
      submitted: [sub({ bodyId: 'b1' })], newBodyId: 'b1', selectedObjectId: 'book',
      baseTowerVersion: 99, placementId: 'p1', idempotencyKey: 'k1', now: 2000,
    });
    expect(outcome.kind).toBe('conflict');
    const tower = await loadTowerState(POST);
    expect(tower?.bodies).toHaveLength(0);
    expect(tower?.meta.version).toBe(1);
  });

  it('a failed validation is never committed (tower unchanged)', async () => {
    await ensureTower(POST, 1000);
    const bad = validateCommit({
      existing: [],
      submitted: [sub({ bodyId: 'b1', objectId: 'not_real', x: NaN })],
      newBodyId: 'b1',
      selectedObjectId: 'not_real',
      issuedObjectIds: ['not_real'],
    });
    expect(bad.ok).toBe(false);
    const tower = await loadTowerState(POST);
    expect(tower?.bodies).toHaveLength(0);
    expect(tower?.meta.version).toBe(1);
  });
});

describe('validateCommit rules', () => {
  const base = { newBodyId: 'b1', selectedObjectId: 'book', issuedObjectIds: ['book'] as string[] };
  const good = sub({ bodyId: 'b1' });

  it('rejects unsupported object ids', () => {
    expect(validateCommit({ existing: [], submitted: [sub({ objectId: 'nope' })], newBodyId: 'b1', selectedObjectId: 'nope', issuedObjectIds: ['nope'] }).ok).toBe(false);
  });
  it('rejects duplicate body ids', () => {
    expect(validateCommit({ existing: [], submitted: [good, good], ...base }).ok).toBe(false);
  });
  it('rejects non-finite coordinates', () => {
    expect(validateCommit({ existing: [], submitted: [sub({ x: Infinity })], ...base }).ok).toBe(false);
  });
  it('rejects out-of-bounds positions', () => {
    expect(validateCommit({ existing: [], submitted: [sub({ x: 99999 })], ...base }).ok).toBe(false);
  });
  it('rejects wrong body count (not exactly +1)', () => {
    expect(validateCommit({ existing: [], submitted: [], ...base }).ok).toBe(false);
  });
  it('accepts a clean single placement', () => {
    expect(validateCommit({ existing: [], submitted: [good], ...base }).ok).toBe(true);
  });
});
