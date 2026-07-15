import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Daily tower lifecycle (Task 16): finalization, final summary, next-day state,
 * date boundaries, and repeated finalization. Uses an in-memory redis so the
 * real tower.ts + lifecycle.ts logic runs. `@devvit/web/server` here has no
 * `scheduler`, which also proves the best-effort scheduling call degrades
 * silently to the lazy fallback.
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
    async zRemRangeByRank(): Promise<number> {
      return 0;
    }
    async watch(): Promise<unknown> {
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
        incrBy: async (): Promise<unknown> => tx,
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
import { RULES } from '../../shared/config';
import {
  buildNextDaily,
  finalizeIfDue,
  finalizeTower,
  isDue,
  loadNextDaily,
  loadSummary,
  nextDayKey,
} from './lifecycle';
import { commitPlacement, ensureTower, loadMeta } from './tower';

const POST = 't3_life';
const DAY_START = Date.UTC(2026, 6, 15, 0, 0, 0); // 2026-07-15 UTC
const DAY = RULES.towerDurationMs;

beforeEach(() => mocks.redis.flushAll());

function sub(over: Partial<SubmittedBody> = {}): SubmittedBody {
  return { bodyId: 'b1', objectId: 'book', x: 240, y: 1560, angle: 0, scaleX: 1, scaleY: 1, ...over };
}

async function placeOne(userId: string, username: string, bodyId: string, at: number): Promise<void> {
  const meta = await loadMeta(POST);
  const version = meta?.version ?? 1;
  await commitPlacement({
    postId: POST, userId, username,
    submitted: [sub({ bodyId })], newBodyId: bodyId, selectedObjectId: 'book',
    baseTowerVersion: version, placementId: `p-${bodyId}`, idempotencyKey: `k-${bodyId}`, now: at,
  });
}

describe('date-key arithmetic across boundaries', () => {
  it('advances a day, including month and year rollovers', () => {
    expect(nextDayKey('2026-07-15')).toBe('2026-07-16');
    expect(nextDayKey('2026-07-31')).toBe('2026-08-01');
    expect(nextDayKey('2026-12-31')).toBe('2027-01-01');
    expect(nextDayKey('2028-02-28')).toBe('2028-02-29'); // leap year
  });
});

describe('tower has the required lifecycle fields', () => {
  it('starts active with day key, start/end times, seed and a modifier', async () => {
    const meta = await ensureTower(POST, DAY_START);
    expect(meta.status).toBe('active');
    expect(meta.dayKey).toBe('2026-07-15');
    expect(meta.createdAt).toBe(DAY_START);
    expect(meta.endsAt).toBe(DAY_START + DAY);
    expect(meta.finalizedAt).toBe(0);
    expect(meta.seed.length).toBeGreaterThan(0);
    expect(meta.modifierId.length).toBeGreaterThan(0);
    expect(isDue(meta, DAY_START)).toBe(false);
    expect(isDue(meta, DAY_START + DAY)).toBe(true);
  });
});

describe('finalization', () => {
  it('finalizes a due tower: saves summary, snapshot stays, next-day state created', async () => {
    await ensureTower(POST, DAY_START);
    await placeOne('t2_alice', 'alice', 'b1', DAY_START + 1000);

    const end = DAY_START + DAY;
    const summary = await finalizeIfDue(POST, end);
    expect(summary).not.toBeNull();
    expect(summary?.totalObjects).toBe(1);
    expect(summary?.uniqueContributors).toBe(1);
    expect(summary?.dayKey).toBe('2026-07-15');
    // Awards computed from the frozen state (all six derive from placements).
    expect(summary?.awards.find((a) => a.id === 'community-mvp')?.username).toBe('alice');
    expect(summary?.awards.find((a) => a.id === 'highest-placement')?.username).toBe('alice');

    const meta = await loadMeta(POST);
    expect(meta?.status).toBe('finalized');
    expect(meta?.finalizedAt).toBe(end);

    // Next daily state created.
    const next = await loadNextDaily(POST);
    expect(next?.dayKey).toBe('2026-07-16');
    expect(next?.startsAt).toBe(end);
    expect(next?.endsAt).toBe(end + DAY);
    expect(next?.seed).toContain('2026-07-16');
  });

  it('does NOT finalize before the end time', async () => {
    await ensureTower(POST, DAY_START);
    const result = await finalizeIfDue(POST, DAY_START + DAY - 1);
    expect(result).toBeNull();
    expect((await loadMeta(POST))?.status).toBe('active');
  });

  it('is idempotent — repeated finalization returns the same summary and changes nothing', async () => {
    await ensureTower(POST, DAY_START);
    await placeOne('t2_alice', 'alice', 'b1', DAY_START + 1000);
    const end = DAY_START + DAY;

    const first = await finalizeTower(POST, end);
    const firstFinalizedAt = (await loadMeta(POST))?.finalizedAt;

    // Call again with a LATER timestamp: must not recompute or move finalizedAt.
    const second = await finalizeTower(POST, end + 999_999);
    const third = await finalizeIfDue(POST, end + 5_000_000);

    expect(second?.totalObjects).toBe(first?.totalObjects);
    expect(second?.finalizedAt).toBe(first?.finalizedAt);
    expect(third?.dayKey).toBe(first?.dayKey);
    expect((await loadMeta(POST))?.finalizedAt).toBe(firstFinalizedAt); // unchanged
    expect((await loadMeta(POST))?.status).toBe('finalized');
  });

  it('previous statistics remain valid after finalization (summary persists)', async () => {
    await ensureTower(POST, DAY_START);
    await placeOne('t2_alice', 'alice', 'b1', DAY_START + 1000);
    await finalizeTower(POST, DAY_START + DAY);

    // Much later, the saved summary is still readable and unchanged.
    const stored = await loadSummary(POST);
    expect(stored?.totalObjects).toBe(1);
    expect(stored?.dayKey).toBe('2026-07-15');
  });

  it('finalizes an empty tower cleanly (no awards, zero stats)', async () => {
    await ensureTower(POST, DAY_START);
    const summary = await finalizeTower(POST, DAY_START + DAY);
    expect(summary?.totalObjects).toBe(0);
    expect(summary?.awards).toHaveLength(0);
  });
});

describe('next daily eligibility resets on a fresh post', () => {
  it('a different post gets its own independent active tower', async () => {
    await ensureTower(POST, DAY_START);
    await finalizeTower(POST, DAY_START + DAY);
    expect((await loadMeta(POST))?.status).toBe('finalized');

    // The next daily tower is a new post: fresh, active, independent history.
    const other = await ensureTower('t3_tomorrow', DAY_START + DAY);
    expect(other.status).toBe('active');
    expect(other.dayKey).toBe('2026-07-16');
    // The finalized post's summary is untouched by the new tower.
    expect((await loadSummary(POST))?.dayKey).toBe('2026-07-15');
  });
});

describe('buildNextDaily', () => {
  it('derives a continuous next-day descriptor from a finalized meta', async () => {
    const meta = await ensureTower(POST, DAY_START);
    const next = buildNextDaily(meta);
    expect(next.dayKey).toBe('2026-07-16');
    expect(next.startsAt).toBe(meta.endsAt);
    expect(next.endsAt).toBe(meta.endsAt + DAY);
    expect(next.modifierId.length).toBeGreaterThan(0);
  });
});
