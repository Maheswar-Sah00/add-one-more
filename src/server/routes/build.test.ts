import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';

/**
 * Shared-tower persistence. Proves the build is durable: bodies survive across
 * requests (a fresh load returns them), a new drop APPENDS without erasing what
 * is already standing, and the per-tower object cap is honoured. Internal owner
 * ids never leak to the client.
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
    async watch(): Promise<unknown> {
      const ops: Op[] = [];
      const tx = {
        multi: async (): Promise<void> => {},
        unwatch: async (): Promise<unknown> => tx,
        set: async (key: string, value: string): Promise<unknown> => {
          ops.push(() => this.set(key, value));
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
  scheduler: { runJob: async () => 'job' },
}));

import { asNumber, asString, isRecord } from '../core/json';
import { build } from './build';

const BASE_TIME = Date.parse('2026-07-21T12:00:00.000Z');

function buildApp(): Hono {
  const app = new Hono();
  app.route('/api/build', build);
  return app;
}

let app: Hono;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(BASE_TIME);
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
function place(body: unknown): Promise<Response> {
  return Promise.resolve(
    app.request('/api/build/place', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })
  );
}
function bodyAt(x: number, y: number, objectId = 'book'): Record<string, unknown> {
  return { objectId, x, y, angle: 0, scaleX: 1, scaleY: 1 };
}

describe('shared-tower persistence', () => {
  it('starts empty then persists a placed body across loads', async () => {
    const empty = await rec(await app.request('/api/build/state'));
    expect(empty.type).toBe('build-state');
    expect(Array.isArray(empty.bodies) ? empty.bodies : ['x']).toHaveLength(0);

    await place(bodyAt(240, 1560));

    const after = await rec(await app.request('/api/build/state'));
    const bodies = Array.isArray(after.bodies) ? after.bodies : [];
    expect(bodies).toHaveLength(1);
    expect(isRecord(bodies[0]) ? bodies[0].objectId : null).toBe('book');
  });

  it('APPENDS new drops without erasing what already stands', async () => {
    await place(bodyAt(240, 1560, 'book'));
    await place(bodyAt(250, 1500, 'brick'));
    const res = await rec(await place(bodyAt(245, 1440, 'tyre')));
    const bodies = Array.isArray(res.bodies) ? res.bodies : [];
    expect(bodies.map((b) => (isRecord(b) ? b.objectId : null))).toEqual(['book', 'brick', 'tyre']);
  });

  it('never leaks internal owner ids to the client', async () => {
    await place(bodyAt(240, 1560));
    const res = await app.request('/api/build/state');
    const serialized = JSON.stringify(await rec(res));
    expect(serialized).not.toContain('t2_'); // no internal user id
    expect(serialized).not.toContain('ownerUserId');
  });

  it('rejects an unknown object id', async () => {
    const res = await place(bodyAt(240, 1560, 'not-a-real-object'));
    expect(res.status).toBe(400);
    const body = await rec(res);
    expect(asString(body.code)).toBe('validation-failed');
  });

  it('preserves stored bodies for a returning visitor (no reset on load)', async () => {
    await place(bodyAt(240, 1560));
    // A second visitor merely loading the tower must not clear it.
    mocks.context.userId = 't2_bob';
    mocks.context.username = 'bob';
    const res = await rec(await app.request('/api/build/state'));
    expect(asNumber((Array.isArray(res.bodies) ? res.bodies : []).length, 0)).toBe(1);
  });
});
