import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';

/**
 * Optimistic-concurrency + idempotency tests (§17, Task 9). Two users start
 * attempts from the same tower version; the loser's stale commit is rejected
 * without consuming an attempt, keeps its issued object, and can reposition
 * against the fresh tower.
 *
 * The in-memory Redis here implements REAL WATCH semantics: `watch()` snapshots
 * the watched keys and `exec()` returns an empty array (aborts) if any of them
 * changed — mirroring how the installed Devvit `@devvit/redis` client's
 * `exec()` yields `[]` when the server aborts a watched transaction. A one-shot
 * `beforeExec` hook lets us drop a competing commit into the exact race window
 * between another player's WATCH and EXEC.
 */

type ZMember = { member: string; score: number };
type Op = () => Promise<unknown>;

const mocks = vi.hoisted(() => {
  class MockRedis {
    strings = new Map<string, string>();
    hashes = new Map<string, Map<string, string>>();
    zsets = new Map<string, Map<string, number>>();
    /** When set, throws on the next operation (simulates a Redis outage). */
    failAll = false;
    /** One-shot hook fired at the start of the next exec() — the race window. */
    beforeExec: (() => void) | undefined = undefined;

    flushAll(): void {
      this.strings.clear();
      this.hashes.clear();
      this.zsets.clear();
      this.failAll = false;
      this.beforeExec = undefined;
    }
    private guard(): void {
      if (this.failAll) throw new Error('redis unavailable');
    }
    /** A type-aware signature of a key's current value, for WATCH comparison. */
    private snapshotKey(key: string): string {
      if (this.strings.has(key)) return `s:${this.strings.get(key) ?? ''}`;
      const h = this.hashes.get(key);
      if (h) return `h:${JSON.stringify([...h.entries()].sort())}`;
      const z = this.zsets.get(key);
      if (z) return `z:${JSON.stringify([...z.entries()].sort())}`;
      return 'nil';
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
      for (const key of keys) this.strings.delete(key);
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
    async watch(...keys: string[]): Promise<unknown> {
      this.guard();
      const watched = new Map(keys.map((key) => [key, this.snapshotKey(key)]));
      const ops: Op[] = [];
      const tx = {
        multi: async (): Promise<void> => {},
        unwatch: async (): Promise<unknown> => tx,
        discard: async (): Promise<void> => {},
        set: async (key: string, value: string): Promise<unknown> => {
          ops.push(() => this.set(key, value));
          return tx;
        },
        hSet: async (key: string, obj: Record<string, string>): Promise<unknown> => {
          ops.push(() => this.hSet(key, obj));
          return tx;
        },
        zAdd: async (key: string, ...m: ZMember[]): Promise<unknown> => {
          ops.push(() => this.zAdd(key, ...m));
          return tx;
        },
        incrBy: async (key: string, n: number): Promise<unknown> => {
          ops.push(() => this.incrBy(key, n));
          return tx;
        },
        exec: async (): Promise<unknown[]> => {
          if (this.beforeExec) {
            const hook = this.beforeExec;
            this.beforeExec = undefined;
            hook();
          }
          // WATCH abort: if any watched key changed since watch(), EXEC yields [].
          for (const [key, snap] of watched) {
            if (this.snapshotKey(key) !== snap) return [];
          }
          for (const op of ops) await op();
          return ops.map(() => 1);
        },
      };
      return tx;
    }
  }

  const context: { postId?: string; userId?: string; username?: string } = {
    postId: 't3_tower',
    userId: 't2_alice',
    username: 'alice',
  };
  const reddit = {
    getCurrentUsername: async (): Promise<string> => context.username ?? 'anonymous',
  };
  return { redis: new MockRedis(), context, reddit };
});

vi.mock('@devvit/web/server', () => ({
  redis: mocks.redis,
  context: mocks.context,
  reddit: mocks.reddit,
  scheduler: { runJob: async () => 'job', cancelJob: async () => {}, listJobs: async () => [] },
}));

import { randomUUID } from 'node:crypto';
import { CONFLICT_MESSAGE } from '../../shared/api';
import { asNumber, asString, isRecord } from '../core/json';
import { commitPlacement, ensureTower, loadTowerState } from '../core/tower';
import { api } from './api';
import { attempt } from './attempt';
import { placement } from './placement';

let app: Hono;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(1_700_000_000_000);
  mocks.redis.flushAll();
  mocks.context.postId = 't3_tower';
  mocks.context.userId = 't2_alice';
  mocks.context.username = 'alice';
  app = new Hono();
  app.route('/api', api);
  app.route('/api/attempt', attempt);
  app.route('/api/placement', placement);
});

afterEach(() => vi.useRealTimers());

async function rec(res: Response): Promise<Record<string, unknown>> {
  const data: unknown = await res.json();
  return isRecord(data) ? data : {};
}
function post(path: string, body?: unknown): Promise<Response> {
  return Promise.resolve(
    app.request(path, {
      method: 'POST',
      headers: body === undefined ? {} : { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
  );
}
function as(userId: string, username: string): void {
  mocks.context.userId = userId;
  mocks.context.username = username;
}

type Started = { attemptId: string; baseTowerVersion: number; objectId: string };
async function start(): Promise<Started> {
  const b = await rec(await post('/api/attempt/start'));
  const choices = Array.isArray(b.choices) ? b.choices : [];
  const first = choices[0];
  return {
    attemptId: asString(b.attemptId),
    baseTowerVersion: asNumber(b.baseTowerVersion, -1),
    objectId: asString(isRecord(first) ? first.objectId : ''),
  };
}
function commitBody(s: Started, idempotencyKey: string): Record<string, unknown> {
  const newBodyId = randomUUID();
  return {
    attemptId: s.attemptId,
    idempotencyKey,
    selectedObjectId: s.objectId,
    baseTowerVersion: s.baseTowerVersion,
    newBodyId,
    bodies: [
      { bodyId: newBodyId, objectId: s.objectId, x: 240, y: 1560, angle: 0, scaleX: 1, scaleY: 1 },
    ],
  };
}
async function playerOf(userId: string, username: string): Promise<Record<string, unknown>> {
  as(userId, username);
  const b = await rec(await app.request('/api/bootstrap'));
  return isRecord(b.player) ? b.player : {};
}

describe('optimistic concurrency — two users, same base version', () => {
  it('rejects the stale commit, keeps the attempt + object, and lets the loser reposition', async () => {
    await ensureTower('t3_tower', 1_700_000_000_000); // version 1

    // 1. Both players start attempts at version N=1.
    as('t2_alice', 'alice');
    const alice = await start();
    as('t2_bob', 'bob');
    const bob = await start();
    expect(alice.baseTowerVersion).toBe(1);
    expect(bob.baseTowerVersion).toBe(1);

    // 2. Bob commits version N+1 first.
    as('t2_bob', 'bob');
    const bobRes = await post('/api/placement/commit', commitBody(bob, randomUUID()));
    expect(bobRes.status).toBe(200);

    // 3-4. Alice submits against the now-stale version N -> rejected.
    as('t2_alice', 'alice');
    const aliceStale = await post('/api/placement/commit', commitBody(alice, randomUUID()));
    expect(aliceStale.status).toBe(409);
    const conflict = await rec(aliceStale);
    expect(conflict.status).toBe('conflict');
    expect(conflict.code).toBe('version-conflict');
    // Exact required player-facing wording.
    expect(conflict.message).toBe(CONFLICT_MESSAGE);

    // 6. The conflict response carries the fresh tower (version 2).
    const freshTower = isRecord(conflict.tower) ? conflict.tower : {};
    const freshMeta = isRecord(freshTower.meta) ? freshTower.meta : {};
    expect(asNumber(freshMeta.version, -1)).toBe(2);

    // 5. No attempt was consumed for Alice.
    const aliceBefore = await playerOf('t2_alice', 'alice');
    expect(asNumber(aliceBefore.attemptsUsed, -1)).toBe(0);
    expect(aliceBefore.hasSucceeded).toBe(false);

    // 7-8. Alice retains the same issued object and repositions against version 2.
    // Like the real client, she rebuilds her snapshot from the fresh tower, so
    // Bob's now-persisted body is carried forward alongside her new one.
    as('t2_alice', 'alice');
    const carried = (isRecord(freshTower) && Array.isArray(freshTower.bodies) ? freshTower.bodies : [])
      .filter(isRecord)
      .map((b) => ({
        bodyId: asString(b.bodyId),
        objectId: asString(b.objectId),
        x: asNumber(b.x, 0),
        y: asNumber(b.y, 0),
        angle: asNumber(b.angle, 0),
        scaleX: 1,
        scaleY: 1,
      }));
    const aliceNewBodyId = randomUUID();
    const aliceRetry = await post('/api/placement/commit', {
      attemptId: alice.attemptId,
      idempotencyKey: randomUUID(),
      selectedObjectId: alice.objectId,
      baseTowerVersion: 2,
      newBodyId: aliceNewBodyId,
      bodies: [
        ...carried,
        { bodyId: aliceNewBodyId, objectId: alice.objectId, x: 240, y: 1500, angle: 0, scaleX: 1, scaleY: 1 },
      ],
    });
    expect(aliceRetry.status).toBe(200);

    const tower = await loadTowerState('t3_tower');
    expect(tower?.bodies).toHaveLength(2);
    expect(tower?.meta.version).toBe(3);
    expect(tower?.meta.uniqueContributors).toBe(2);

    const aliceAfter = await playerOf('t2_alice', 'alice');
    expect(aliceAfter.hasSucceeded).toBe(true);
    expect(asNumber(aliceAfter.attemptsUsed, -1)).toBe(1); // only the successful commit
  });

  it('WATCH/EXEC aborts a commit when the version changes inside the race window', async () => {
    await ensureTower('t3_tower', 1_700_000_000_000); // version 1

    // A competing commit lands *after* this commit passes its pre-check read but
    // *before* its EXEC — the WATCH on the version key must abort the transaction.
    mocks.redis.beforeExec = () => {
      mocks.redis.strings.set('tower:t3_tower:version', '2');
    };

    const outcome = await commitPlacement({
      postId: 't3_tower',
      userId: 't2_alice',
      username: 'alice',
      submitted: [
        { bodyId: 'b1', objectId: 'book', x: 240, y: 1560, angle: 0, scaleX: 1, scaleY: 1 },
      ],
      newBodyId: 'b1',
      selectedObjectId: 'book',
      baseTowerVersion: 1,
      placementId: 'p1',
      idempotencyKey: 'k1',
      now: 2000,
    });

    expect(outcome.kind).toBe('conflict');
    // The aborted transaction wrote nothing: no body, version unchanged by us.
    const tower = await loadTowerState('t3_tower');
    expect(tower?.bodies).toHaveLength(0);
  });
});

describe('idempotency + non-consuming failures', () => {
  it('a duplicate commit (same key, e.g. a timeout retry) returns the original placement, not a second body', async () => {
    await ensureTower('t3_tower', 1_700_000_000_000);
    as('t2_alice', 'alice');
    const s = await start();
    const key = randomUUID();

    const first = await rec(await post('/api/placement/commit', commitBody(s, key)));
    expect(first.type).toBe('commit');
    const firstId = asString(first.placementId);

    // Re-send with the SAME idempotency key but a different body id (as a retry
    // after a lost response would): the server replays the original result.
    const retryBody = { ...commitBody(s, key), newBodyId: 'different-body' };
    const second = await rec(await post('/api/placement/commit', retryBody));
    expect(asString(second.placementId)).toBe(firstId);

    const tower = await loadTowerState('t3_tower');
    expect(tower?.bodies).toHaveLength(1); // one body, not two
    const player = await playerOf('t2_alice', 'alice');
    expect(asNumber(player.attemptsUsed, -1)).toBe(1); // one attempt, not two
  });

  it('client tower payloads redact other users’ ids but keep the viewer’s own for the marker', async () => {
    await ensureTower('t3_tower', 1_700_000_000_000);
    as('t2_alice', 'alice');
    const a = await start();
    await post('/api/placement/commit', commitBody(a, randomUUID())); // alice places body 1
    as('t2_bob', 'bob');
    const b = await start();
    // Bob carries alice's body forward and stacks his own.
    const fresh = await loadTowerState('t3_tower');
    const carried = (fresh?.bodies ?? []).map((body) => ({
      bodyId: body.bodyId, objectId: body.objectId, x: body.x, y: body.y, angle: body.angle, scaleX: 1, scaleY: 1,
    }));
    const bobNew = randomUUID();
    await post('/api/placement/commit', {
      attemptId: b.attemptId, idempotencyKey: randomUUID(), selectedObjectId: b.objectId,
      baseTowerVersion: 2, newBodyId: bobNew,
      bodies: [...carried, { bodyId: bobNew, objectId: b.objectId, x: 240, y: 1500, angle: 0, scaleX: 1, scaleY: 1 }],
    });

    // Alice bootstraps: bob's id must be absent; alice's own id present so her
    // body can be marked. Usernames (public) are fine.
    as('t2_alice', 'alice');
    const boot = await rec(await app.request('/api/bootstrap'));
    const serialized = JSON.stringify(boot.tower);
    expect(serialized).not.toContain('t2_bob');
    expect(serialized).toContain('t2_alice'); // her own owner id, for the personal marker
    expect(serialized).toContain('alice'); // usernames still present
    expect(serialized).toContain('bob');
  });

  it('a Redis failure during commit returns redis-error and consumes no attempt', async () => {
    await ensureTower('t3_tower', 1_700_000_000_000);
    as('t2_alice', 'alice');
    const s = await start();

    mocks.redis.failAll = true;
    const res = await post('/api/placement/commit', commitBody(s, randomUUID()));
    expect(res.status).toBe(503);
    expect(asString((await rec(res)).code)).toBe('redis-error');

    mocks.redis.failAll = false;
    const player = await playerOf('t2_alice', 'alice');
    expect(asNumber(player.attemptsUsed, -1)).toBe(0);
    expect(player.hasSucceeded).toBe(false);
  });
});
