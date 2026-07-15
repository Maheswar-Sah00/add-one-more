import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';

/**
 * Official-attempt lifecycle tests (§6, §7, §17). The routes are exercised
 * end-to-end through Hono's `app.request`, with `@devvit/web/server` replaced by
 * an in-memory Redis, a mutable auth `context` (so we can simulate signed-out
 * users), and a `reddit` stub. This proves the server — not the client — owns
 * attempts remaining, object choices, and the up-to-three-placements-per-day rule.
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

const BASE_TIME = 1_700_000_000_000;
const TTL_MS = 120_000;

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
  vi.setSystemTime(BASE_TIME);
  mocks.redis.flushAll();
  mocks.context.postId = 't3_tower';
  mocks.context.userId = 't2_alice';
  mocks.context.username = 'alice';
  app = buildApp();
});

afterEach(() => {
  vi.useRealTimers();
});

async function rec(res: Response): Promise<Record<string, unknown>> {
  const data: unknown = await res.json();
  return isRecord(data) ? data : {};
}

async function post(path: string, body?: unknown): Promise<Response> {
  return app.request(path, {
    method: 'POST',
    headers: body === undefined ? {} : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

type Started = {
  status: number;
  attemptId: string;
  baseTowerVersion: number;
  objectId: string;
  difficulties: string[];
  attemptsRemaining: number;
};

async function start(): Promise<Started> {
  const res = await post('/api/attempt/start');
  const b = await rec(res);
  const choices = Array.isArray(b.choices) ? b.choices : [];
  const first = choices[0];
  const player = isRecord(b.player) ? b.player : {};
  return {
    status: res.status,
    attemptId: asString(b.attemptId),
    baseTowerVersion: asNumber(b.baseTowerVersion, -1),
    objectId: asString(isRecord(first) ? first.objectId : ''),
    difficulties: choices.map((ch) => asString(isRecord(ch) ? ch.difficulty : '')),
    attemptsRemaining: asNumber(player.attemptsRemaining, -1),
  };
}

function fail(attemptId: string): Promise<Response> {
  return post('/api/attempt/fail', { attemptId });
}

function commit(s: Started, idempotencyKey: string): Promise<Response> {
  const newBodyId = randomUUID();
  return post('/api/placement/commit', {
    attemptId: s.attemptId,
    idempotencyKey,
    selectedObjectId: s.objectId,
    baseTowerVersion: s.baseTowerVersion,
    newBodyId,
    bodies: [
      { bodyId: newBodyId, objectId: s.objectId, x: 240, y: 1560, angle: 0, scaleX: 1, scaleY: 1 },
    ],
  });
}

/** A "refresh": bootstrap is a GET route reading persisted server state. */
async function bootstrap(): Promise<Record<string, unknown>> {
  return rec(await app.request('/api/bootstrap'));
}

async function bootstrapPlayer(): Promise<Record<string, unknown>> {
  const b = await bootstrap();
  return isRecord(b.player) ? b.player : {};
}

/** Current accepted bodies as SubmittedBody[], for building a stacking commit. */
async function bootstrapBodies(): Promise<
  { bodyId: string; objectId: string; x: number; y: number; angle: number; scaleX: number; scaleY: number }[]
> {
  const b = await bootstrap();
  const tower = isRecord(b.tower) ? b.tower : {};
  const bodies = Array.isArray(tower.bodies) ? tower.bodies : [];
  return bodies.filter(isRecord).map((body) => ({
    bodyId: asString(body.bodyId),
    objectId: asString(body.objectId),
    x: asNumber(body.x, 0),
    y: asNumber(body.y, 0),
    angle: asNumber(body.angle, 0),
    scaleX: asNumber(body.scaleX, 1),
    scaleY: asNumber(body.scaleY, 1),
  }));
}

describe('official attempts — lifecycle', () => {
  it('first attempt: issues three tiered choices and does not yet consume an attempt', async () => {
    const s = await start();
    expect(s.status).toBe(200);
    expect(s.attemptId.length).toBeGreaterThan(0);
    expect(s.difficulties).toHaveLength(3);
    expect(new Set(s.difficulties)).toEqual(new Set(['safe', 'risky', 'absurd']));
    // Starting an attempt captures the version but spends nothing until it resolves.
    expect(s.baseTowerVersion).toBe(1);
    expect(s.attemptsRemaining).toBe(3);
  });

  it('three failures exhaust the daily allowance, then start is refused', async () => {
    for (let i = 0; i < 3; i++) {
      const s = await start();
      const res = await fail(s.attemptId);
      expect(res.status).toBe(200);
    }
    const player = await bootstrapPlayer();
    expect(asNumber(player.attemptsUsed, -1)).toBe(3);
    expect(asNumber(player.attemptsRemaining, -1)).toBe(0);

    const blocked = await post('/api/attempt/start');
    expect(blocked.status).toBe(409);
    expect(asString((await rec(blocked)).code)).toBe('no-attempts');
  });

  it('success on the first attempt marks the player and consumes one attempt', async () => {
    const s = await start();
    const res = await commit(s, randomUUID());
    expect(res.status).toBe(200);
    const boot = await bootstrap();
    expect(asString(boot.username)).toBe('alice');
    const player = isRecord(boot.player) ? boot.player : {};
    expect(player.hasSucceeded).toBe(true);
    expect(asNumber(player.attemptsUsed, -1)).toBe(1);
    expect(asNumber(player.attemptsRemaining, -1)).toBe(2);
  });

  it('success after two failures: attempts used reaches three and the placement sticks', async () => {
    for (let i = 0; i < 2; i++) {
      const s = await start();
      await fail(s.attemptId);
    }
    const s = await start();
    expect(s.attemptsRemaining).toBe(1);
    const res = await commit(s, randomUUID());
    expect(res.status).toBe(200);

    const player = await bootstrapPlayer();
    expect(player.hasSucceeded).toBe(true);
    expect(asNumber(player.attemptsUsed, -1)).toBe(3);
    expect(asNumber(player.attemptsRemaining, -1)).toBe(0);
  });

  it('refresh: attempts and success state are read back from Redis, never reset', async () => {
    const s = await start();
    await fail(s.attemptId);

    // A "refresh" is just a fresh bootstrap against the same server state.
    const first = await bootstrapPlayer();
    const second = await bootstrapPlayer();
    expect(asNumber(first.attemptsUsed, -1)).toBe(1);
    expect(asNumber(second.attemptsUsed, -1)).toBe(1);
    expect(asNumber(second.attemptsRemaining, -1)).toBe(2);
  });

  it('duplicate commit (same idempotency key) does not place twice or spend a second attempt', async () => {
    const s = await start();
    const key = randomUUID();
    const first = await commit(s, key);
    expect(first.status).toBe(200);

    // Same idempotency key: the server must return the original placement.
    const dupBodyId = randomUUID();
    const second = await post('/api/placement/commit', {
      attemptId: s.attemptId,
      idempotencyKey: key,
      selectedObjectId: s.objectId,
      baseTowerVersion: s.baseTowerVersion,
      newBodyId: dupBodyId,
      bodies: [
        { bodyId: dupBodyId, objectId: s.objectId, x: 240, y: 1560, angle: 0, scaleX: 1, scaleY: 1 },
      ],
    });
    expect(second.status).toBe(200);

    const boot = await bootstrap();
    const player = isRecord(boot.player) ? boot.player : {};
    expect(asNumber(player.attemptsUsed, -1)).toBe(1); // not 2
    const tower = isRecord(boot.tower) ? boot.tower : {};
    const meta = isRecord(tower.meta) ? tower.meta : {};
    expect(asNumber(meta.successfulPlacements, -1)).toBe(1); // one body, not two
  });

  it('duplicate fail on the same attempt is not double-charged', async () => {
    const s = await start();
    const one = await fail(s.attemptId);
    const two = await fail(s.attemptId);
    expect(one.status).toBe(200);
    expect(two.status).toBe(200);
    const player = await bootstrapPlayer();
    expect(asNumber(player.attemptsUsed, -1)).toBe(1); // charged once
  });

  it('expired attempt is rejected clearly and does not consume an attempt', async () => {
    const s = await start();
    vi.setSystemTime(BASE_TIME + TTL_MS + 1_000); // walk past the attempt TTL

    const res = await commit(s, randomUUID());
    expect(res.status).toBe(410);
    expect(asString((await rec(res)).code)).toBe('attempt-expired');

    const player = await bootstrapPlayer();
    expect(asNumber(player.attemptsUsed, -1)).toBe(0);
    expect(asNumber(player.attemptsRemaining, -1)).toBe(3);
  });

  it('unauthenticated player may inspect the tower but cannot start an attempt', async () => {
    mocks.context.userId = undefined;

    const started = await post('/api/attempt/start');
    expect(started.status).toBe(401);
    expect(asString((await rec(started)).code)).toBe('no-user');

    // Inspection still works.
    const boot = await rec(await app.request('/api/bootstrap'));
    expect(asString(boot.type)).toBe('bootstrap');
    expect(isRecord(boot.tower)).toBe(true);
  });

  it('a player may place up to three objects — each scored — before further attempts are refused', async () => {
    let cumulative = 0;
    for (let i = 0; i < 3; i++) {
      const s = await start();
      // A stacking commit must resubmit the full settled snapshot (every prior
      // body at its persisted transform) plus exactly one new body.
      const prior = await bootstrapBodies();
      const newBodyId = randomUUID();
      const res = await post('/api/placement/commit', {
        attemptId: s.attemptId,
        idempotencyKey: randomUUID(),
        selectedObjectId: s.objectId,
        baseTowerVersion: s.baseTowerVersion,
        newBodyId,
        bodies: [
          ...prior,
          { bodyId: newBodyId, objectId: s.objectId, x: 240, y: 1560, angle: 0, scaleX: 1, scaleY: 1 },
        ],
      });
      expect(res.status).toBe(200);
      const score = asNumber((await rec(res)).score, 0);
      expect(score).toBeGreaterThan(0); // each perfect balance is scored
      cumulative += score;
    }

    const player = await bootstrapPlayer();
    expect(asNumber(player.successfulPlacements, -1)).toBe(3);
    expect(asNumber(player.placementsRemaining, -1)).toBe(0);
    expect(asNumber(player.attemptsUsed, -1)).toBe(3);
    // Daily score is the sum of every perfect-balance placement.
    expect(asNumber(player.score, -1)).toBe(cumulative);

    const boot = await bootstrap();
    const tower = isRecord(boot.tower) ? boot.tower : {};
    const meta = isRecord(tower.meta) ? tower.meta : {};
    expect(asNumber(meta.successfulPlacements, -1)).toBe(3); // three objects in the tower
    expect(asNumber(meta.uniqueContributors, -1)).toBe(1); // but still one builder

    // A fourth object is refused once all placement slots are spent.
    const again = await post('/api/attempt/start');
    expect(again.status).toBe(409);
    expect(asString((await rec(again)).code)).toBe('already-succeeded');
  });
});
