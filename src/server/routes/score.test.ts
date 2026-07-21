import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';

/**
 * The real-time score service (Task: live leaderboard). Proves the three rules
 * the client relies on: points are recorded to a REAL per-user all-time total,
 * an account is capped at 3 successful drops per UTC day (the 4th is rejected
 * without awarding points), and the board resolves real Reddit usernames ranked
 * high-to-low without leaking internal ids.
 */
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
    async zAdd(key: string, ...members: { member: string; score: number }[]): Promise<number> {
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
    ): Promise<{ member: string; score: number }[]> {
      const z = this.zsets.get(key);
      if (!z) return [];
      const entries = [...z.entries()].map(([member, score]) => ({ member, score }));
      entries.sort((a, b) => a.score - b.score || (a.member < b.member ? -1 : 1));
      if (options?.reverse) entries.reverse();
      return entries.slice(Number(start), Number(stop) + 1);
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
}));

import { asNumber, asString, isRecord } from '../core/json';
import { score } from './score';

// 2026-07-21T12:00:00Z — comfortably mid-UTC-day so the reset is later today.
const BASE_TIME = Date.parse('2026-07-21T12:00:00.000Z');

function buildApp(): Hono {
  const app = new Hono();
  app.route('/api/score', score);
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
function post(path: string, body: unknown): Promise<Response> {
  return Promise.resolve(
    app.request(path, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })
  );
}
function as(userId: string, username: string): void {
  mocks.context.userId = userId;
  mocks.context.username = username;
}

describe('score/add — points + daily quota', () => {
  it('accumulates a lifetime total and only accepts the three tier values', async () => {
    const a = await rec(await post('/api/score/add', { points: 100 }));
    expect(a.accepted).toBe(true);
    expect(asNumber(a.score, -1)).toBe(100);
    expect(asNumber(a.dropsRemaining, -1)).toBe(2);

    const b = await rec(await post('/api/score/add', { points: 500 }));
    expect(asNumber(b.score, -1)).toBe(600); // 100 + 500, all-time
    expect(asNumber(b.dropsRemaining, -1)).toBe(1);

    const bad = await post('/api/score/add', { points: 137 });
    expect(bad.status).toBe(400); // not a tier value
  });

  it('counts a failed drop (0 points) against the quota without awarding points', async () => {
    const a = await rec(await post('/api/score/add', { points: 100 }));
    expect(asNumber(a.score, -1)).toBe(100);
    expect(asNumber(a.dropsRemaining, -1)).toBe(2);

    // A collapse posts points:0 — the drop still counts, the score does not move.
    const fail = await rec(await post('/api/score/add', { points: 0 }));
    expect(fail.accepted).toBe(true);
    expect(asNumber(fail.score, -1)).toBe(100); // unchanged
    expect(asNumber(fail.dropsRemaining, -1)).toBe(1); // but a drop was spent
  });

  it('caps an account at 3 successful drops per UTC day (4th rejected, no award)', async () => {
    await post('/api/score/add', { points: 250 });
    await post('/api/score/add', { points: 250 });
    const third = await rec(await post('/api/score/add', { points: 250 }));
    expect(third.accepted).toBe(true);
    expect(asNumber(third.dropsRemaining, -1)).toBe(0);

    const fourth = await rec(await post('/api/score/add', { points: 250 }));
    expect(fourth.accepted).toBe(false);
    expect(asNumber(fourth.score, -1)).toBe(750); // unchanged — no award
    expect(asNumber(fourth.dropsRemaining, -1)).toBe(0);
  });

  it('resets the quota the next UTC day while keeping the all-time total', async () => {
    await post('/api/score/add', { points: 250 });
    await post('/api/score/add', { points: 250 });
    await post('/api/score/add', { points: 250 }); // quota spent today

    vi.setSystemTime(BASE_TIME + 24 * 60 * 60 * 1000); // tomorrow
    const next = await rec(await post('/api/score/add', { points: 100 }));
    expect(next.accepted).toBe(true);
    expect(asNumber(next.dropsRemaining, -1)).toBe(2); // fresh quota
    expect(asNumber(next.score, -1)).toBe(850); // 750 + 100, carried over
  });
});

describe('score/board — permanent leaderboard', () => {
  it('ranks real usernames high-to-low and never leaks internal ids', async () => {
    as('t2_alice', 'alice');
    await post('/api/score/add', { points: 100 });
    as('t2_bob', 'bob');
    await post('/api/score/add', { points: 500 });
    await post('/api/score/add', { points: 500 });

    as('t2_alice', 'alice');
    const body = await rec(await app.request('/api/score/board'));
    expect(body.type).toBe('points-board');
    const entries = Array.isArray(body.entries) ? body.entries : [];
    expect(entries.length).toBe(2);

    const first = isRecord(entries[0]) ? entries[0] : {};
    expect(asString(first.username)).toBe('bob'); // 1000 > 100
    expect(asNumber(first.value, -1)).toBe(1000);

    const serialized = JSON.stringify(body);
    expect(serialized).not.toContain('t2_'); // no internal ids
    // The viewer (alice) is flagged on her own row.
    const mine = entries.find((e) => isRecord(e) && e.isViewer === true);
    expect(isRecord(mine) ? mine.username : null).toBe('alice');
  });
});

describe('score/me — identity + standing', () => {
  it('reports the real handle, all-time score and remaining drops', async () => {
    await post('/api/score/add', { points: 250 });
    const me = await rec(await app.request('/api/score/me'));
    expect(me.type).toBe('me');
    expect(asString(me.username)).toBe('alice');
    expect(asNumber(me.score, -1)).toBe(250);
    expect(asNumber(me.dropsRemaining, -1)).toBe(2);
    expect(asNumber(me.resetsAt, 0)).toBeGreaterThan(BASE_TIME);
  });
});
