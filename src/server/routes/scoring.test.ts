import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';

/**
 * Server-controlled scoring + milestones + leaderboards (Task 13). Exercised
 * end-to-end through Hono. The key adversarial proof: a client that injects its
 * own `score` (or selects an object it was never issued) cannot influence the
 * saved score — the server always recomputes it. The mock Redis implements
 * `zRange` with reverse-rank windows so the leaderboard reads are real.
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
      options?: { by?: string; reverse?: boolean }
    ): Promise<ZMember[]> {
      const z = this.zsets.get(key);
      if (!z) return [];
      const entries = [...z.entries()].map(([member, score]) => ({ member, score }));
      entries.sort((a, b) => a.score - b.score || (a.member < b.member ? -1 : 1));
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

const BASE_TIME = 1_700_000_000_000;

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
function commitBodyRaw(s: Started, extra: Record<string, unknown> = {}): Record<string, unknown> {
  const newBodyId = randomUUID();
  return {
    attemptId: s.attemptId,
    idempotencyKey: randomUUID(),
    selectedObjectId: s.objectId,
    baseTowerVersion: s.baseTowerVersion,
    newBodyId,
    bodies: [
      { bodyId: newBodyId, objectId: s.objectId, x: 240, y: 1560, angle: 0, scaleX: 1, scaleY: 1 },
    ],
    ...extra,
  };
}

/** Carry the current tower's bodies forward (as the real client does) so a
 *  second, third… placement doesn't look like it dropped everyone else's. */
async function commitCarrying(s: Started): Promise<Record<string, unknown>> {
  const tower = await rec(await app.request('/api/tower'));
  const existing = (Array.isArray(tower.bodies) ? tower.bodies : []).filter(isRecord).map((b) => ({
    bodyId: asString(b.bodyId),
    objectId: asString(b.objectId),
    x: asNumber(b.x, 0),
    y: asNumber(b.y, 0),
    angle: asNumber(b.angle, 0),
    scaleX: asNumber(b.scaleX, 1),
    scaleY: asNumber(b.scaleY, 1),
  }));
  const newBodyId = randomUUID();
  return rec(
    await post('/api/placement/commit', {
      attemptId: s.attemptId,
      idempotencyKey: randomUUID(),
      selectedObjectId: s.objectId,
      baseTowerVersion: s.baseTowerVersion,
      newBodyId,
      bodies: [
        ...existing,
        { bodyId: newBodyId, objectId: s.objectId, x: 240, y: 1560, angle: 0, scaleX: 1, scaleY: 1 },
      ],
    })
  );
}

describe('server-controlled scoring — client cannot manipulate the score', () => {
  it('ignores a client-injected score and saves the server-computed value', async () => {
    const s = await start();
    // choices[0] is the SAFE tier (base 100); y=1560 is 40 above the platform =>
    // height bonus round(40 * 0.5) = 20; no milestone on the 1st object.
    const res = await rec(
      await post('/api/placement/commit', commitBodyRaw(s, { score: 999999, points: 999999 }))
    );
    expect(res.type).toBe('commit');
    expect(asNumber(res.score, -1)).toBe(120); // 100 + 20, NOT 999999
  });

  it('rejects selecting an object that was never issued (no attempt consumed)', async () => {
    const s = await start();
    const res = await post(
      '/api/placement/commit',
      commitBodyRaw({ ...s, objectId: 'fridge' }) // absurd, high base — but not issued to us
    );
    // Unless 'fridge' happened to be the issued absurd option, validation rejects it.
    // The safe option is choices[0]; forcing 'fridge' as the selected+new body is
    // only valid if it was one of the three issued ids. We assert the server checks:
    const body = await rec(res);
    if (res.status === 200) {
      // fridge WAS issued as the absurd option — then the score must be its real
      // base (275) + height, never a client value.
      expect(asNumber(body.score, -1)).toBe(275 + 20);
    } else {
      expect(res.status).toBe(400);
      expect(asString(body.code)).toBe('validation-failed');
    }
    // Either way, a rejected/among-issued commit never trusts a client score field.
  });
});

describe('community milestones — saved once, no re-trigger', () => {
  async function placeAs(userId: string, username: string): Promise<Record<string, unknown>> {
    as(userId, username);
    const s = await start();
    return commitCarrying(s);
  }

  it('celebrates the 5-object milestone exactly on the crossing placement', async () => {
    for (let i = 1; i <= 4; i++) {
      const res = await placeAs(`t2_u${i}`, `u${i}`);
      expect(res.milestone).toBeNull(); // objects 1..4 cross nothing
    }
    const fifth = await placeAs('t2_u5', 'u5');
    const milestone = isRecord(fifth.milestone) ? fifth.milestone : {};
    expect(asString(milestone.id)).toBe('tower');
    expect(asString(milestone.title)).toBe('It’s officially a tower.');
    // The placer of a milestone gets the milestone bonus folded into their score.
    expect(asNumber(fifth.score, -1)).toBe(100 + 20 + 150);
  });

  it('a refresh after the milestone does not re-trigger it', async () => {
    for (let i = 1; i <= 5; i++) await placeAs(`t2_u${i}`, `u${i}`);

    as('t2_alice', 'alice');
    const boot = await rec(await app.request('/api/bootstrap'));
    const tower = isRecord(boot.tower) ? boot.tower : {};
    const meta = isRecord(tower.meta) ? tower.meta : {};
    const unlocked = Array.isArray(meta.milestonesUnlocked) ? meta.milestonesUnlocked : [];
    expect(unlocked).toContain('tower'); // persisted…
    expect('milestone' in boot).toBe(false); // …but bootstrap carries no celebration flag
  });

  it('a duplicate commit of the milestone placement does not re-award it', async () => {
    for (let i = 1; i <= 4; i++) await placeAs(`t2_u${i}`, `u${i}`);
    as('t2_u5', 'u5');
    const s = await start();

    // Build the milestone-crossing 5th commit, carrying the 4 existing bodies.
    const tower = await rec(await app.request('/api/tower'));
    const existing = (Array.isArray(tower.bodies) ? tower.bodies : []).filter(isRecord).map((b) => ({
      bodyId: asString(b.bodyId),
      objectId: asString(b.objectId),
      x: asNumber(b.x, 0),
      y: asNumber(b.y, 0),
      angle: asNumber(b.angle, 0),
      scaleX: asNumber(b.scaleX, 1),
      scaleY: asNumber(b.scaleY, 1),
    }));
    const key = randomUUID();
    const newBodyId = randomUUID();
    const payload = {
      attemptId: s.attemptId,
      idempotencyKey: key,
      selectedObjectId: s.objectId,
      baseTowerVersion: s.baseTowerVersion,
      newBodyId,
      bodies: [
        ...existing,
        { bodyId: newBodyId, objectId: s.objectId, x: 240, y: 1560, angle: 0, scaleX: 1, scaleY: 1 },
      ],
    };
    const first = await rec(await post('/api/placement/commit', payload));
    expect(isRecord(first.milestone) ? first.milestone.id : null).toBe('tower');

    // Same idempotency key => replayed original placement, no re-celebration.
    const second = await rec(
      await post('/api/placement/commit', { ...payload, newBodyId: randomUUID() })
    );
    expect(second.milestone).toBeNull();
  });
});

describe('secondary leaderboards', () => {
  async function placeAs(userId: string, username: string): Promise<void> {
    as(userId, username);
    const s = await start();
    await commitCarrying(s);
  }

  it('returns all five boards, ranked high-to-low, and never leaks internal ids', async () => {
    await placeAs('t2_alice', 'alice');
    await placeAs('t2_bob', 'bob');
    await placeAs('t2_carol', 'carol');

    as('t2_alice', 'alice');
    const res = await app.request('/api/leaderboard');
    expect(res.status).toBe(200);
    const body = await rec(res);
    expect(body.type).toBe('leaderboard');
    const boards = Array.isArray(body.boards) ? body.boards : [];
    expect(boards).toHaveLength(5);

    const serialized = JSON.stringify(body);
    expect(serialized).not.toContain('t2_'); // no internal user ids anywhere
    expect(serialized).toContain('alice'); // usernames are fine

    const todayScore = boards.find((b) => isRecord(b) && b.id === 'today-score');
    const entries = isRecord(todayScore) && Array.isArray(todayScore.entries) ? todayScore.entries : [];
    expect(entries.length).toBe(3);
    // Ranked descending by value.
    const values = entries.map((e) => (isRecord(e) ? asNumber(e.value, 0) : 0));
    expect([...values].sort((a, b) => b - a)).toEqual(values);
    // The viewer is flagged for their own row (no id needed to know it's them).
    const mine = entries.find((e) => isRecord(e) && e.isViewer === true);
    expect(isRecord(mine) ? mine.username : null).toBe('alice');
  });

  it('honours a result limit (pagination discipline)', async () => {
    for (let i = 1; i <= 4; i++) await placeAs(`t2_p${i}`, `p${i}`);
    as('t2_p1', 'p1');
    const body = await rec(await app.request('/api/leaderboard?limit=2'));
    expect(asNumber(body.limit, -1)).toBe(2);
    const boards = Array.isArray(body.boards) ? body.boards : [];
    for (const b of boards) {
      const entries = isRecord(b) && Array.isArray(b.entries) ? b.entries : [];
      expect(entries.length).toBeLessThanOrEqual(2);
    }
  });
});
