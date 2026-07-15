import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';

/**
 * Practice-mode safety (Task 15). Practice is entirely client-side and issues NO
 * server request. This test nails down the server-side guarantee that makes that
 * safe: because a commit REQUIRES a server-issued attempt token, any request
 * that lacks one — which is the only thing a leaked practice action could be —
 * is rejected and leaves the official tower, attempts, and leaderboards untouched.
 * There is deliberately no "practice" endpoint at all.
 */

type ZMember = { member: string; score: number };
type Op = () => Promise<unknown>;

const mocks = vi.hoisted(() => {
  class MockRedis {
    strings = new Map<string, string>();
    hashes = new Map<string, Map<string, string>>();
    zsets = new Map<string, Map<string, number>>();

    flushAll(): void {
      this.strings.clear();
      this.hashes.clear();
      this.zsets.clear();
    }
    async get(key: string): Promise<string | undefined> {
      return this.strings.get(key);
    }
    async set(key: string, value: string): Promise<string> {
      this.strings.set(key, value);
      return 'OK';
    }
    async del(...keys: string[]): Promise<void> {
      for (const key of keys) this.strings.delete(key);
    }
    async expire(): Promise<void> {}
    async incrBy(key: string, n: number): Promise<number> {
      const next = Number(this.strings.get(key) ?? '0') + n;
      this.strings.set(key, String(next));
      return next;
    }
    async hGetAll(key: string): Promise<Record<string, string>> {
      const h = this.hashes.get(key);
      return h ? Object.fromEntries(h) : {};
    }
    async hSet(key: string, obj: Record<string, string>): Promise<number> {
      const h = this.hashes.get(key) ?? new Map<string, string>();
      for (const [f, v] of Object.entries(obj)) h.set(f, v);
      this.hashes.set(key, h);
      return Object.keys(obj).length;
    }
    async hSetNX(key: string, field: string, value: string): Promise<number> {
      const h = this.hashes.get(key) ?? new Map<string, string>();
      if (h.has(field)) return 0;
      h.set(field, value);
      this.hashes.set(key, h);
      return 1;
    }
    async zAdd(key: string, ...members: ZMember[]): Promise<number> {
      const z = this.zsets.get(key) ?? new Map<string, number>();
      for (const m of members) z.set(m.member, m.score);
      this.zsets.set(key, z);
      return members.length;
    }
    async zRange(
      key: string,
      start: number | string,
      stop: number | string,
      options?: { reverse?: boolean }
    ): Promise<ZMember[]> {
      const z = this.zsets.get(key);
      if (!z) return [];
      const entries = [...z.entries()].map(([member, score]) => ({ member, score }));
      entries.sort((a, b) => a.score - b.score);
      if (options?.reverse) entries.reverse();
      return entries.slice(Number(start), Number(stop) + 1);
    }
    async watch(): Promise<unknown> {
      const ops: Op[] = [];
      const tx = {
        multi: async (): Promise<void> => {},
        unwatch: async (): Promise<unknown> => tx,
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
import { asNumber, asString, isRecord } from '../core/json';
import { api } from './api';
import { attempt } from './attempt';
import { placement } from './placement';

function buildApp(): Hono {
  const app = new Hono();
  app.route('/api', api);
  app.route('/api/attempt', attempt);
  app.route('/api/placement', placement);
  return app;
}

let app: Hono;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(1_700_000_000_000);
  mocks.redis.flushAll();
  mocks.context.postId = 't3_tower';
  mocks.context.userId = 't2_alice';
  mocks.context.username = 'alice';
  app = buildApp();
});

afterEach(() => vi.useRealTimers());

async function rec(res: Response): Promise<Record<string, unknown>> {
  const data: unknown = await res.json();
  return isRecord(data) ? data : {};
}
function post(path: string, body: unknown): Promise<Response> {
  return Promise.resolve(
    app.request(path, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })
  );
}

async function towerSnapshot(): Promise<{ version: number; bodies: number; attemptsUsed: number }> {
  const boot = await rec(await app.request('/api/bootstrap'));
  const tower = isRecord(boot.tower) ? boot.tower : {};
  const meta = isRecord(tower.meta) ? tower.meta : {};
  const bodies = Array.isArray(tower.bodies) ? tower.bodies : [];
  const player = isRecord(boot.player) ? boot.player : {};
  return {
    version: asNumber(meta.version, -1),
    bodies: bodies.length,
    attemptsUsed: asNumber(player.attemptsUsed, -1),
  };
}

/** A commit payload shaped exactly like a real one — but with a bogus attempt id
 *  (the only thing a leaked practice request could carry, since practice never
 *  calls /attempt/start). */
function practiceLikeCommit(attemptId: string, objectId = 'book'): Record<string, unknown> {
  const newBodyId = randomUUID();
  return {
    attemptId,
    idempotencyKey: randomUUID(),
    selectedObjectId: objectId,
    baseTowerVersion: 1,
    newBodyId,
    bodies: [
      { bodyId: newBodyId, objectId, x: 240, y: 1560, angle: 0, scaleX: 1, scaleY: 1 },
    ],
  };
}

describe('practice cannot commit an official placement', () => {
  it('a commit with an attempt id that was never issued is rejected, tower untouched', async () => {
    const before = await towerSnapshot(); // creates tower v1, 0 bodies
    expect(before.bodies).toBe(0);

    const res = await post('/api/placement/commit', practiceLikeCommit(randomUUID()));
    expect(res.status).toBe(400);
    expect(asString((await rec(res)).code)).toBe('attempt-invalid');

    const after = await towerSnapshot();
    expect(after.version).toBe(before.version); // no version bump
    expect(after.bodies).toBe(0); // no body persisted
    expect(after.attemptsUsed).toBe(0); // no attempt consumed
  });

  it('an empty / malformed attempt id is rejected too', async () => {
    await towerSnapshot();
    for (const badId of ['', 'practice', 'local-only']) {
      const res = await post('/api/placement/commit', practiceLikeCommit(badId));
      expect(res.status).toBe(400);
    }
    const after = await towerSnapshot();
    expect(after.bodies).toBe(0);
  });

  it('leaves leaderboards empty (no practice score leaks into the community boards)', async () => {
    await towerSnapshot();
    await post('/api/placement/commit', practiceLikeCommit(randomUUID(), 'fridge'));

    const board = await rec(await app.request('/api/leaderboard'));
    const boards = Array.isArray(board.boards) ? board.boards : [];
    const totalEntries = boards.reduce((sum, b) => {
      const entries = isRecord(b) && Array.isArray(b.entries) ? b.entries : [];
      return sum + entries.length;
    }, 0);
    expect(totalEntries).toBe(0);
  });

  it('a real official commit still works — proving only the token path writes', async () => {
    await towerSnapshot();
    // Legitimately start an attempt, then commit with its real id.
    const started = await rec(await post('/api/attempt/start', {}));
    const attemptId = asString(started.attemptId);
    const choices = Array.isArray(started.choices) ? started.choices : [];
    const first = choices[0];
    const objectId = asString(isRecord(first) ? first.objectId : 'book');

    const newBodyId = randomUUID();
    const res = await post('/api/placement/commit', {
      attemptId,
      idempotencyKey: randomUUID(),
      selectedObjectId: objectId,
      baseTowerVersion: asNumber(started.baseTowerVersion, 1),
      newBodyId,
      bodies: [
        { bodyId: newBodyId, objectId, x: 240, y: 1560, angle: 0, scaleX: 1, scaleY: 1 },
      ],
    });
    expect(res.status).toBe(200);
    const after = await towerSnapshot();
    expect(after.bodies).toBe(1); // the official path DID write
  });
});
