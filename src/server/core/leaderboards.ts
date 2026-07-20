/**
 * Secondary leaderboards (Task 13). Five boards, kept deliberately secondary to
 * the shared tower. Reads use zRange with a reverse rank window so Redis returns
 * at most `limit` rows (§14 storage discipline). Entries expose a public
 * username + value only — never an internal user id.
 */
import { redis } from '@devvit/web/server';
import { LEADERBOARD } from '../../shared/config';
import { numStr } from './json';
import { k } from './keys';

export type LeaderboardId =
  | 'today-score'
  | 'top-placement'
  | 'most-absurd'
  | 'streak'
  | 'all-time';

export const LEADERBOARD_IDS: readonly LeaderboardId[] = [
  'today-score',
  'top-placement',
  'most-absurd',
  'streak',
  'all-time',
];

export const LEADERBOARD_TITLES: Record<LeaderboardId, string> = {
  'today-score': 'Top score today',
  'top-placement': 'Highest placement today',
  'most-absurd': 'Most absurd (all-time)',
  streak: 'Longest builder streak',
  'all-time': 'All-time placements',
};

/** No user id here by design — leaderboards show public names only. */
export type LeaderboardEntry = {
  rank: number;
  username: string;
  value: number;
  isViewer: boolean;
};

function keyFor(id: LeaderboardId, postId: string): string {
  switch (id) {
    case 'today-score':
      return k.lbScore(postId);
    case 'top-placement':
      return k.lbPlacement(postId);
    case 'most-absurd':
      return k.lbAbsurd();
    case 'streak':
      return k.lbStreak();
    case 'all-time':
      return k.lbAllTime();
  }
}

export function clampLimit(requested: number | undefined): number {
  if (requested === undefined || !Number.isFinite(requested)) return LEADERBOARD.defaultLimit;
  return Math.max(1, Math.min(Math.trunc(requested), LEADERBOARD.maxLimit));
}

/** Read one board's top `limit` rows, highest first, names resolved, ids hidden. */
export async function readBoard(
  id: LeaderboardId,
  postId: string,
  viewerUserId: string | null,
  limit: number
): Promise<LeaderboardEntry[]> {
  const rows = await redis.zRange(keyFor(id, postId), 0, limit - 1, {
    by: 'rank',
    reverse: true,
  });
  if (rows.length === 0) return [];
  const names = await redis.hGetAll(k.names());
  return rows.map((row, i) => {
    const name = names[row.member];
    return {
      rank: i + 1,
      username: name && name.length > 0 ? name : 'anonymous',
      value: row.score,
      isViewer: viewerUserId !== null && viewerUserId.length > 0 && row.member === viewerUserId,
    };
  });
}

export async function readAllBoards(
  postId: string,
  viewerUserId: string | null,
  limit: number
): Promise<Record<LeaderboardId, LeaderboardEntry[]>> {
  const results = await Promise.all(
    LEADERBOARD_IDS.map((id) => readBoard(id, postId, viewerUserId, limit))
  );
  const out = {} as Record<LeaderboardId, LeaderboardEntry[]>;
  LEADERBOARD_IDS.forEach((id, i) => {
    out[id] = results[i] ?? [];
  });
  return out;
}

// ---- all-time / streak bookkeeping ----------------------------------------

export type AllTimeRecord = {
  lastDayKey: string;
  streak: number;
  totalPlacements: number;
  absurdCount: number;
};

export function parseAllTime(h: Record<string, string>): AllTimeRecord {
  return {
    lastDayKey: h.lastDayKey ?? '',
    streak: numStr(h.streak, 0),
    totalPlacements: numStr(h.totalPlacements, 0),
    absurdCount: numStr(h.absurdCount, 0),
  };
}

export function serializeAllTime(r: AllTimeRecord): Record<string, string> {
  return {
    lastDayKey: r.lastDayKey,
    streak: String(r.streak),
    totalPlacements: String(r.totalPlacements),
    absurdCount: String(r.absurdCount),
  };
}

export function previousDayKey(dayKey: string): string {
  const d = new Date(`${dayKey}T00:00:00.000Z`);
  if (Number.isNaN(d.getTime())) return '';
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

/**
 * Roll a player's all-time record forward for a new successful placement on
 * `dayKey`. Streak increments on consecutive days, resets otherwise, and stays
 * put for a same-day repeat — so a player's 2nd/3rd placement of the day counts
 * toward totals/absurd but never inflates the day streak.
 */
export function advanceAllTime(
  prev: AllTimeRecord,
  dayKey: string,
  isAbsurd: boolean
): AllTimeRecord {
  let streak: number;
  if (prev.totalPlacements === 0 || prev.lastDayKey === '') {
    streak = 1;
  } else if (prev.lastDayKey === dayKey) {
    streak = prev.streak;
  } else if (prev.lastDayKey === previousDayKey(dayKey)) {
    streak = prev.streak + 1;
  } else {
    streak = 1;
  }
  return {
    lastDayKey: dayKey,
    streak,
    totalPlacements: prev.totalPlacements + 1,
    absurdCount: prev.absurdCount + (isAbsurd ? 1 : 0),
  };
}

export async function loadAllTime(userId: string): Promise<AllTimeRecord> {
  return parseAllTime(await redis.hGetAll(k.userAllTime(userId)));
}
