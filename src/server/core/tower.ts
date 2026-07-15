import { redis } from '@devvit/web/server';
import type { SubmittedBody } from '../../shared/api';
import { RULES } from '../../shared/config';
import { getObjectDef } from '../../shared/objects';
import type {
  PersistedBodyState,
  PlayerDailyState,
  TowerMeta,
  TowerPlacement,
  TowerState,
  TowerStatus,
} from '../../shared/types';
import { milestoneIdsUpTo, newlyReached, type Milestone } from '../../shared/milestones';
import { pickDailyModifier } from '../../shared/modifiers';
import { asNumber, asString, asStringArray, isRecord, numStr, safeParse } from './json';
import { k } from './keys';
import { advanceAllTime, loadAllTime, serializeAllTime } from './leaderboards';
import { loadPlayer, serializePlayer } from './player';
import { scheduleDailyFinalize } from './scheduling';
import { computeScoreBreakdown, towerHeight } from './scoring';

function toDayKey(ts: number): string {
  return new Date(ts).toISOString().slice(0, 10);
}

function toStatus(value: string | undefined): TowerStatus {
  return value === 'completed' || value === 'finalized' ? value : 'active';
}

export { toStatus };

function serializeMeta(m: TowerMeta): Record<string, string> {
  return {
    towerId: m.towerId,
    postId: m.postId,
    dayKey: m.dayKey,
    version: String(m.version),
    status: m.status,
    seed: m.seed,
    modifierId: m.modifierId,
    themeId: m.themeId,
    createdAt: String(m.createdAt),
    endsAt: String(m.endsAt),
    finalizedAt: String(m.finalizedAt),
    height: String(m.height),
    successfulPlacements: String(m.successfulPlacements),
    uniqueContributors: String(m.uniqueContributors),
    milestonesUnlocked: JSON.stringify(m.milestonesUnlocked),
  };
}

function deserializeMeta(h: Record<string, string>): TowerMeta | null {
  const towerId = h.towerId;
  if (!towerId || towerId.length === 0) return null;
  const milestones = safeParse(h.milestonesUnlocked);
  return {
    towerId,
    postId: h.postId && h.postId.length > 0 ? h.postId : towerId,
    dayKey: h.dayKey ?? '',
    version: numStr(h.version, 1),
    status: toStatus(h.status),
    seed: h.seed ?? towerId,
    modifierId: h.modifierId ?? 'normal',
    themeId: h.themeId ?? 'warehouse',
    createdAt: numStr(h.createdAt, 0),
    endsAt: numStr(h.endsAt, 0),
    finalizedAt: numStr(h.finalizedAt, 0),
    height: numStr(h.height, 0),
    successfulPlacements: numStr(h.successfulPlacements, 0),
    uniqueContributors: numStr(h.uniqueContributors, 0),
    milestonesUnlocked: asStringArray(milestones),
  };
}

function buildInitialMeta(postId: string, now: number): TowerMeta {
  const dayKey = toDayKey(now);
  return {
    towerId: postId,
    postId,
    dayKey,
    version: 1,
    status: 'active',
    seed: `${dayKey}:${postId}`,
    // Chosen server-side, deterministically from the day key: identical for every
    // player, stable all day, never per-request random.
    modifierId: pickDailyModifier(dayKey).id,
    themeId: 'warehouse',
    createdAt: now,
    endsAt: now + RULES.towerDurationMs,
    finalizedAt: 0,
    height: 0,
    successfulPlacements: 0,
    uniqueContributors: 0,
    milestonesUnlocked: [],
  };
}

export async function loadMeta(postId: string): Promise<TowerMeta | null> {
  return deserializeMeta(await redis.hGetAll(k.meta(postId)));
}

export async function loadSnapshot(postId: string): Promise<PersistedBodyState[]> {
  const data = safeParse(await redis.get(k.snapshot(postId)));
  if (!Array.isArray(data)) return [];
  const out: PersistedBodyState[] = [];
  for (const item of data) {
    if (!isRecord(item)) continue;
    const bodyId = asString(item.bodyId);
    const objectId = asString(item.objectId);
    if (!bodyId || !objectId) continue;
    out.push({
      bodyId,
      objectId,
      ownerUserId: asString(item.ownerUserId),
      ownerUsername: asString(item.ownerUsername),
      sequenceNumber: asNumber(item.sequenceNumber, 0),
      x: asNumber(item.x, 0),
      y: asNumber(item.y, 0),
      angle: asNumber(item.angle, 0),
      scaleX: asNumber(item.scaleX, 1),
      scaleY: asNumber(item.scaleY, 1),
    });
  }
  return out;
}

export async function loadPlacements(postId: string): Promise<TowerPlacement[]> {
  const data = safeParse(await redis.get(k.placements(postId)));
  if (!Array.isArray(data)) return [];
  const out: TowerPlacement[] = [];
  for (const item of data) {
    if (!isRecord(item)) continue;
    const placementId = asString(item.placementId);
    if (!placementId) continue;
    const difficulty = asString(item.difficulty);
    out.push({
      placementId,
      bodyId: asString(item.bodyId),
      userId: asString(item.userId),
      username: asString(item.username),
      objectId: asString(item.objectId),
      difficulty:
        difficulty === 'risky' || difficulty === 'absurd' ? difficulty : 'safe',
      score: asNumber(item.score, 0),
      placedAt: asNumber(item.placedAt, 0),
      sequenceNumber: asNumber(item.sequenceNumber, 0),
    });
  }
  return out;
}

/**
 * Load the full tower, creating it on first access. Creation uses hSetNX as a
 * single-winner claim so concurrent first-loads don't clobber each other.
 */
export async function ensureTower(postId: string, now: number): Promise<TowerMeta> {
  const existing = await loadMeta(postId);
  if (existing) return existing;

  const claimed = await redis.hSetNX(k.meta(postId), 'towerId', postId);
  const meta = buildInitialMeta(postId, now);
  if (claimed === 1) {
    await redis.hSet(k.meta(postId), serializeMeta(meta));
    await redis.set(k.version(postId), String(meta.version));
    await redis.set(k.snapshot(postId), '[]');
    await redis.set(k.placements(postId), '[]');
    // Best-effort: schedule finalization at the day's end. Lazy finalization is
    // the authoritative fallback, so a failure here is non-fatal.
    await scheduleDailyFinalize(postId, meta.endsAt);
    return meta;
  }
  // Another request won the claim; read theirs (falling back to our identical
  // initial values if it hasn't finished writing yet).
  return (await loadMeta(postId)) ?? meta;
}

export async function loadTowerState(postId: string): Promise<TowerState | null> {
  const meta = await loadMeta(postId);
  if (!meta) return null;
  const [bodies, placements] = await Promise.all([
    loadSnapshot(postId),
    loadPlacements(postId),
  ]);
  return { meta, bodies, placements };
}

/**
 * Strip internal Reddit ids before a tower goes to the client (Task 10: "do not
 * expose internal user IDs"). Public usernames are kept; the viewer's OWN owner
 * id is kept so the client can mark their own bodies, but every other user's id
 * is blanked and placement ids are dropped entirely (the client never needs them).
 */
export function toClientTower(tower: TowerState, viewerUserId: string | null): TowerState {
  const keep = viewerUserId !== null && viewerUserId.length > 0;
  return {
    meta: tower.meta,
    bodies: tower.bodies.map((b) => ({
      ...b,
      ownerUserId: keep && b.ownerUserId === viewerUserId ? b.ownerUserId : '',
    })),
    placements: tower.placements.map((p) => ({ ...p, userId: '' })),
  };
}

export type CommitOutcome =
  | {
      kind: 'committed';
      tower: TowerState;
      player: PlayerDailyState;
      placement: TowerPlacement;
      /** The milestone this placement crossed, if any (celebrate + save once). */
      milestone: Milestone | null;
    }
  | { kind: 'conflict' };

/**
 * Atomically commit a validated placement using optimistic concurrency (§17).
 * Watches the version and player keys: if either changed since the attempt
 * started, EXEC yields nothing and we report a (non-punitive) conflict.
 */
export async function commitPlacement(input: {
  postId: string;
  userId: string;
  username: string;
  submitted: readonly SubmittedBody[];
  newBodyId: string;
  selectedObjectId: string;
  baseTowerVersion: number;
  placementId: string;
  idempotencyKey: string;
  now: number;
}): Promise<CommitOutcome> {
  const { postId, userId, username, newBodyId, selectedObjectId, baseTowerVersion } = input;

  const meta = await loadMeta(postId);
  if (!meta) return { kind: 'conflict' };

  const [existing, placements, player, prevAllTime] = await Promise.all([
    loadSnapshot(postId),
    loadPlacements(postId),
    loadPlayer(postId, userId, username),
    loadAllTime(userId),
  ]);

  const submittedById = new Map(input.submitted.map((b) => [b.bodyId, b]));
  const newSubmitted = submittedById.get(newBodyId);
  if (!newSubmitted) return { kind: 'conflict' };

  const sequenceNumber = placements.length + 1;
  const newBodies: PersistedBodyState[] = [];
  for (const e of existing) {
    const s = submittedById.get(e.bodyId);
    if (!s) return { kind: 'conflict' };
    newBodies.push({ ...e, x: s.x, y: s.y, angle: s.angle, scaleX: s.scaleX, scaleY: s.scaleY });
  }

  const def = getObjectDef(selectedObjectId);
  const difficulty = def ? def.difficulty : 'safe';
  const newBody: PersistedBodyState = {
    bodyId: newBodyId,
    objectId: selectedObjectId,
    ownerUserId: userId,
    ownerUsername: username,
    sequenceNumber,
    x: newSubmitted.x,
    y: newSubmitted.y,
    angle: newSubmitted.angle,
    scaleX: newSubmitted.scaleX,
    scaleY: newSubmitted.scaleY,
  };
  newBodies.push(newBody);

  // Community milestones + authoritative score. The count moving prevCount ->
  // newCount decides which milestone (if any) this placement crosses; the
  // milestone bonus and modifier bonus fold into the server-computed score.
  const prevCount = meta.successfulPlacements;
  const newCount = prevCount + 1;
  const milestone = newlyReached(prevCount, newCount)[0] ?? null;
  const breakdown = computeScoreBreakdown(selectedObjectId, newBody.y, {
    modifierId: meta.modifierId,
    milestoneReached: milestone !== null,
  });
  const score = breakdown.total;
  const allTime = advanceAllTime(prevAllTime, meta.dayKey, difficulty === 'absurd');
  const placement: TowerPlacement = {
    placementId: input.placementId,
    bodyId: newBodyId,
    userId,
    username,
    objectId: selectedObjectId,
    difficulty,
    score,
    placedAt: input.now,
    sequenceNumber,
  };
  const newPlacements = [...placements, placement];
  const newVersion = baseTowerVersion + 1;
  // A player may place up to maxSuccessesPerDay objects; only their FIRST
  // successful placement adds them as a unique contributor.
  const isFirstSuccessForPlayer = player.successfulPlacements === 0;
  const newPlayerSuccesses = player.successfulPlacements + 1;
  const newMeta: TowerMeta = {
    ...meta,
    version: newVersion,
    height: towerHeight(newBodies),
    // Tower object count grows with every commit (used for community milestones).
    successfulPlacements: newCount,
    uniqueContributors: meta.uniqueContributors + (isFirstSuccessForPlayer ? 1 : 0),
    // Authoritative unlocked set derived from the count: monotonic, so this is
    // idempotent — a refresh reads it back and crosses nothing new.
    milestonesUnlocked: milestoneIdsUpTo(newCount),
  };
  const updatedPlayer: PlayerDailyState = {
    ...player,
    attemptsUsed: player.attemptsUsed + 1,
    attemptsRemaining: Math.max(0, RULES.maxAttemptsPerDay - (player.attemptsUsed + 1)),
    successfulPlacements: newPlayerSuccesses,
    placementsRemaining: Math.max(0, RULES.maxSuccessesPerDay - newPlayerSuccesses),
    hasSucceeded: true,
    successfulPlacementId: input.placementId,
    score: player.score + score,
  };

  const tx = await redis.watch(k.version(postId), k.player(postId, userId));
  const currentVersion = numStr(await redis.get(k.version(postId)), meta.version);
  if (currentVersion !== baseTowerVersion) {
    await tx.unwatch();
    return { kind: 'conflict' };
  }

  await tx.multi();
  await tx.set(k.version(postId), String(newVersion));
  await tx.set(k.snapshot(postId), JSON.stringify(newBodies));
  await tx.set(k.placements(postId), JSON.stringify(newPlacements));
  await tx.hSet(k.meta(postId), serializeMeta(newMeta));
  await tx.hSet(k.player(postId, userId), serializePlayer(updatedPlayer));
  await tx.set(k.idem(input.idempotencyKey), input.placementId);
  // A successful placement spends one official attempt (§17 total-attempts stat).
  await tx.incrBy(k.attemptCount(postId), 1);
  // Leaderboards (§13). Per-tower: cumulative score + best single placement.
  await tx.zAdd(k.lbScore(postId), { member: userId, score: updatedPlayer.score });
  await tx.zAdd(k.lbPlacement(postId), { member: userId, score });
  // Global name map (so leaderboards resolve usernames without exposing ids).
  await tx.hSet(k.names(), { [userId]: username });
  // Global all-time bookkeeping: streak, total placements, absurd count.
  await tx.hSet(k.userAllTime(userId), serializeAllTime(allTime));
  await tx.zAdd(k.lbStreak(), { member: userId, score: allTime.streak });
  await tx.zAdd(k.lbAllTime(), { member: userId, score: allTime.totalPlacements });
  if (allTime.absurdCount > 0) {
    await tx.zAdd(k.lbAbsurd(), { member: userId, score: allTime.absurdCount });
  }
  const results = await tx.exec();
  if (!results || results.length === 0) {
    return { kind: 'conflict' };
  }

  await redis.expire(k.idem(input.idempotencyKey), RULES.idempotencyTtlSeconds);

  return {
    kind: 'committed',
    tower: { meta: newMeta, bodies: newBodies, placements: newPlacements },
    player: updatedPlayer,
    placement,
    milestone,
  };
}
