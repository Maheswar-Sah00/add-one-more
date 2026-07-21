/**
 * Real-time score, identity, daily quota, and the PERMANENT all-time points
 * leaderboard. The physics client records each successful placement here so the
 * board fills with REAL Reddit players (resolved via context.userId / username),
 * never placeholder names.
 *
 * Rules enforced server-side (authoritative):
 *  - Points are accepted only at the fixed tier values (safe/risky/absurd), so a
 *    client cannot post an arbitrary number.
 *  - An account may make at most RULES.maxSuccessesPerDay (3) successful drops
 *    per UTC day; the quota resets at 00:00 UTC — the same Reddit-aligned daily
 *    boundary the tower uses (see nextUtcMidnight).
 *  - The leaderboard value is the LIFETIME points total (permanent), not a
 *    single day's score.
 */
import { Hono } from 'hono';
import { context, reddit, redis } from '@devvit/web/server';
import type {
  ErrorResponse,
  LeaderboardEntry,
  MeResponse,
  PointsBoardResponse,
  ScoreResponse,
} from '../../shared/api';
import { LEADERBOARD, RULES } from '../../shared/config';
import { CATEGORY_POINTS } from '../../shared/objects';
import { nextUtcMidnight } from '../../shared/post';
import { clampLimit } from '../core/leaderboards';
import { asNumber, isRecord, numStr } from '../core/json';
import { k } from '../core/keys';

export const score = new Hono();

function err(code: ErrorResponse['code'], message: string): ErrorResponse {
  return { status: 'error', code, message };
}

// A failed drop still spends a daily drop but awards 0 points, so 0 is valid.
const VALID_POINTS = new Set<number>([0, ...Object.values(CATEGORY_POINTS)]);

function utcDayKey(now: number): string {
  return new Date(now).toISOString().slice(0, 10);
}

/** Today's used-drop count for a user, treating a stale day as a fresh 0. */
async function dropsUsedToday(userId: string, dayKey: string): Promise<number> {
  const h = await redis.hGetAll(k.userDaily(userId));
  return h.dayKey === dayKey ? numStr(h.count, 0) : 0;
}

async function allTimePoints(userId: string): Promise<number> {
  return numStr(await redis.get(k.userPoints(userId)), 0);
}

/** The viewer's real Reddit handle + live standing (no writes). */
score.get('/me', async (c) => {
  const { userId } = context;
  const username = context.username ?? (await reddit.getCurrentUsername()) ?? 'anonymous';
  const now = Date.now();
  const resetsAt = nextUtcMidnight(now);
  if (!userId) {
    return c.json<MeResponse>({
      type: 'me',
      username,
      userId: null,
      score: 0,
      dropsRemaining: RULES.maxSuccessesPerDay,
      resetsAt,
      now,
    });
  }
  try {
    const [used, points] = await Promise.all([
      dropsUsedToday(userId, utcDayKey(now)),
      allTimePoints(userId),
    ]);
    return c.json<MeResponse>({
      type: 'me',
      username,
      userId,
      score: points,
      dropsRemaining: Math.max(0, RULES.maxSuccessesPerDay - used),
      resetsAt,
      now,
    });
  } catch (error) {
    console.error('score/me: redis read failed', error);
    return c.json<MeResponse>({
      type: 'me',
      username,
      userId,
      score: 0,
      dropsRemaining: RULES.maxSuccessesPerDay,
      resetsAt,
      now,
    });
  }
});

/** Record one resolved drop: spend one of today's drops and add its points to the
 *  viewer's lifetime total (points is 0 for a failed drop — the drop still counts).
 *  Rejects (accepted:false) once the daily quota is spent. */
score.post('/add', async (c) => {
  const { userId } = context;
  const now = Date.now();
  const resetsAt = nextUtcMidnight(now);
  const username = context.username ?? (await reddit.getCurrentUsername()) ?? 'anonymous';
  if (!userId) {
    return c.json<ErrorResponse>(err('no-user', 'Sign in on Reddit to appear on the leaderboard'), 401);
  }

  const raw: unknown = await c.req.json().catch(() => null);
  const points = isRecord(raw) ? asNumber(raw.points, 0) : 0;
  if (!VALID_POINTS.has(points)) {
    return c.json<ErrorResponse>(err('validation-failed', 'Invalid points value'), 400);
  }

  try {
    const dayKey = utcDayKey(now);
    const used = await dropsUsedToday(userId, dayKey);
    if (used >= RULES.maxSuccessesPerDay) {
      // Quota spent — reject without awarding points. The client shows the timer.
      return c.json<ScoreResponse>({
        type: 'score',
        username,
        score: await allTimePoints(userId),
        dropsRemaining: 0,
        resetsAt,
        accepted: false,
      });
    }

    const newTotal = await redis.incrBy(k.userPoints(userId), points);
    await redis.hSet(k.userDaily(userId), { dayKey, count: String(used + 1) });
    await redis.zAdd(k.lbPoints(), { member: userId, score: newTotal });
    await redis.hSet(k.names(), { [userId]: username });

    return c.json<ScoreResponse>({
      type: 'score',
      username,
      score: newTotal,
      dropsRemaining: Math.max(0, RULES.maxSuccessesPerDay - (used + 1)),
      resetsAt,
      accepted: true,
    });
  } catch (error) {
    console.error('score/add: redis failure', error);
    return c.json<ErrorResponse>(err('redis-error', 'Scores are temporarily unavailable'), 503);
  }
});

/** The permanent all-time points leaderboard — real players, highest first. */
score.get('/board', async (c) => {
  const { userId } = context;
  const limit = clampLimit(Number(c.req.query('limit')) || LEADERBOARD.defaultLimit);
  try {
    const rows = await redis.zRange(k.lbPoints(), 0, limit - 1, { by: 'rank', reverse: true });
    if (rows.length === 0) return c.json<PointsBoardResponse>({ type: 'points-board', entries: [] });
    const names = await redis.hGetAll(k.names());
    const entries: LeaderboardEntry[] = rows.map((row, i) => {
      const name = names[row.member];
      return {
        rank: i + 1,
        username: name && name.length > 0 ? name : 'anonymous',
        value: row.score,
        isViewer: userId !== undefined && userId !== null && row.member === userId,
      };
    });
    return c.json<PointsBoardResponse>({ type: 'points-board', entries });
  } catch (error) {
    console.error('score/board: redis read failed', error);
    return c.json<ErrorResponse>(err('redis-error', 'The leaderboard is unavailable'), 503);
  }
});
