/**
 * Daily tower lifecycle (Task 16): finalization, final summary, and the next
 * day's initial state. Finalization is IDEMPOTENT and deterministic — calling it
 * again on an already-finalized tower returns the saved summary and mutates
 * nothing, so both the scheduled job and the lazy request-time fallback are safe
 * to run any number of times.
 *
 * Documented end-of-day rule for in-flight attempts: at finalization new
 * official attempts stop immediately (status flips to `finalized`, which the
 * attempt + commit routes reject). An attempt that was already issued may still
 * COMMIT only while the tower is active; once finalized, its commit is refused
 * (non-punitive — no attempt is consumed) and the attempt simply expires. This
 * keeps the saved final snapshot immutable.
 */
import { redis } from '@devvit/web/server';
import { ARCHIVE, RULES } from '../../shared/config';
import { pickDailyModifier } from '../../shared/modifiers';
import type {
  NextDailyState,
  TowerAward,
  TowerFinalSummary,
  TowerMeta,
  TowerState,
} from '../../shared/types';
import { computeAwards } from './awards';
import { isRecord, numStr, safeParse } from './json';
import { k } from './keys';
import { loadMeta, loadTowerState } from './tower';

/** UTC day key one day after `dayKey` (YYYY-MM-DD). */
export function nextDayKey(dayKey: string): string {
  const d = new Date(`${dayKey}T00:00:00.000Z`);
  if (Number.isNaN(d.getTime())) return dayKey;
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

/** Whether the tower has reached its server-authoritative end time. */
export function isDue(meta: TowerMeta, now: number): boolean {
  return meta.status === 'active' && now >= meta.endsAt;
}

/**
 * Compute the immutable final statistics + the six deterministic awards from the
 * frozen tower state. `totalAttempts` is passed in (read from its counter) so
 * this stays a pure function.
 */
export function computeSummary(
  meta: TowerMeta,
  tower: TowerState | null,
  now: number,
  totalAttempts: number
): TowerFinalSummary {
  const bodies = tower?.bodies ?? [];
  const placements = tower?.placements ?? [];

  return {
    towerId: meta.towerId,
    dayKey: meta.dayKey,
    modifierId: meta.modifierId,
    startedAt: meta.createdAt,
    endedAt: meta.endsAt,
    finalizedAt: now,
    totalObjects: meta.successfulPlacements,
    uniqueContributors: meta.uniqueContributors,
    totalAttempts,
    finalHeight: Math.round(meta.height),
    milestonesUnlocked: [...meta.milestonesUnlocked],
    awards: computeAwards(placements, bodies),
  };
}

export async function loadAttemptCount(postId: string): Promise<number> {
  return numStr(await redis.get(k.attemptCount(postId)), 0);
}

/** The next day's initial-state descriptor, produced when a tower finalizes. */
export function buildNextDaily(meta: TowerMeta): NextDailyState {
  const dayKey = nextDayKey(meta.dayKey);
  const startsAt = meta.endsAt; // continuous with the day that just ended
  return {
    dayKey,
    seed: `${dayKey}:${meta.postId}`,
    modifierId: pickDailyModifier(dayKey).id,
    startsAt,
    endsAt: startsAt + RULES.towerDurationMs,
  };
}

export async function loadSummary(postId: string): Promise<TowerFinalSummary | null> {
  const data = safeParse(await redis.get(k.summary(postId)));
  return isRecord(data) ? (parseSummary(data) ?? null) : null;
}

export async function loadNextDaily(postId: string): Promise<NextDailyState | null> {
  const data = safeParse(await redis.get(k.nextDaily(postId)));
  return isRecord(data) ? (parseNextDaily(data) ?? null) : null;
}

/**
 * Finalize a tower: stop attempts, compute + save final statistics/awards, save
 * the next daily descriptor, and flip status to `finalized`. Idempotent: an
 * already-finalized tower returns its saved summary without recomputing.
 */
export async function finalizeTower(
  postId: string,
  now: number
): Promise<TowerFinalSummary | null> {
  const meta = await loadMeta(postId);
  if (!meta) return null;
  if (meta.status === 'finalized') {
    const existing = await loadSummary(postId);
    if (existing) return existing;
    return computeSummary(meta, await loadTowerState(postId), meta.finalizedAt || now, await loadAttemptCount(postId));
  }

  // The accepted snapshot is already persisted and, once finalized, will never
  // change — so it IS the final snapshot; we only compute the derived summary.
  const tower = await loadTowerState(postId);
  const totalAttempts = await loadAttemptCount(postId);
  const summary = computeSummary(meta, tower, now, totalAttempts);
  const next = buildNextDaily(meta);

  await redis.set(k.summary(postId), JSON.stringify(summary));
  await redis.set(k.nextDaily(postId), JSON.stringify(next));
  // Add to the lightweight archive index (compact summaries only, no replay
  // data), then trim to the most recent N to bound Redis usage.
  await archiveFinalized(postId, now);
  // Status + finalizedAt last, so a crash mid-write leaves the tower still
  // active (a later request re-finalizes) rather than half-finalized.
  await redis.hSet(k.meta(postId), { status: 'finalized', finalizedAt: String(now) });

  return summary;
}

/** Record a finalized tower in the archive index and trim to the recent cap. */
async function archiveFinalized(postId: string, finalizedAt: number): Promise<void> {
  try {
    await redis.zAdd(k.archiveIndex(), { member: postId, score: finalizedAt });
    // Keep only the most recent ARCHIVE.maxEntries (drop the oldest by rank).
    await redis.zRemRangeByRank(k.archiveIndex(), 0, -(ARCHIVE.maxEntries + 1));
  } catch (error) {
    // Archive is secondary — never block finalization on it.
    console.error('archiveFinalized failed', error);
  }
}

/** Read the most recent finalized daily summaries (secondary to today's tower). */
export async function loadArchive(limit: number): Promise<TowerFinalSummary[]> {
  const rows = await redis.zRange(k.archiveIndex(), 0, limit - 1, { by: 'rank', reverse: true });
  if (rows.length === 0) return [];
  const summaries = await Promise.all(rows.map((r) => loadSummary(r.member)));
  return summaries.filter((s): s is TowerFinalSummary => s !== null);
}

/**
 * Lazy finalization fallback: if the tower is past its end time, finalize it
 * now. Safe to call on every request — a not-due or already-finalized tower is
 * a cheap no-op / summary load.
 */
export async function finalizeIfDue(
  postId: string,
  now: number
): Promise<TowerFinalSummary | null> {
  const meta = await loadMeta(postId);
  if (!meta) return null;
  if (isDue(meta, now)) return finalizeTower(postId, now);
  if (meta.status === 'finalized') return loadSummary(postId);
  return null;
}

// ---- parsing ---------------------------------------------------------------

function parseAwards(value: unknown): TowerAward[] {
  if (!Array.isArray(value)) return [];
  const out: TowerAward[] = [];
  for (const item of value) {
    if (!isRecord(item)) continue;
    if (typeof item.label === 'string' && typeof item.username === 'string' && typeof item.value === 'number') {
      out.push({
        id: typeof item.id === 'string' ? item.id : item.label,
        label: item.label,
        username: item.username,
        value: item.value,
        detail: typeof item.detail === 'string' ? item.detail : '',
      });
    }
  }
  return out;
}

function parseSummary(data: Record<string, unknown>): TowerFinalSummary | null {
  if (typeof data.towerId !== 'string' || typeof data.dayKey !== 'string') return null;
  const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
  return {
    towerId: data.towerId,
    dayKey: data.dayKey,
    modifierId: typeof data.modifierId === 'string' ? data.modifierId : 'normal',
    startedAt: num(data.startedAt),
    endedAt: num(data.endedAt),
    finalizedAt: num(data.finalizedAt),
    totalObjects: num(data.totalObjects),
    uniqueContributors: num(data.uniqueContributors),
    totalAttempts: num(data.totalAttempts),
    finalHeight: num(data.finalHeight),
    milestonesUnlocked: Array.isArray(data.milestonesUnlocked)
      ? data.milestonesUnlocked.filter((m): m is string => typeof m === 'string')
      : [],
    awards: parseAwards(data.awards),
  };
}

function parseNextDaily(data: Record<string, unknown>): NextDailyState | null {
  if (typeof data.dayKey !== 'string' || typeof data.seed !== 'string') return null;
  const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
  return {
    dayKey: data.dayKey,
    seed: data.seed,
    modifierId: typeof data.modifierId === 'string' ? data.modifierId : 'normal',
    startsAt: num(data.startsAt),
    endsAt: num(data.endsAt),
  };
}
