import { randomUUID } from 'node:crypto';
import { Hono } from 'hono';
import { context, reddit, redis } from '@devvit/web/server';
import {
  CONFLICT_MESSAGE,
  type CommitRequest,
  type CommitResponse,
  type ConflictResponse,
  type ErrorResponse,
  type SubmittedBody,
} from '../../shared/api';
import { asNumber, asString, isRecord } from '../core/json';
import { k } from '../core/keys';
import { finalizeIfDue } from '../core/lifecycle';
import { loadPlayer } from '../core/player';
import {
  commitPlacement,
  loadMeta,
  loadSnapshot,
  loadTowerState,
  toClientTower,
} from '../core/tower';
import { loadAttempt, setAttemptStatus } from '../core/attempt';
import { validateCommit } from '../core/validate';

export const placement = new Hono();

function err(code: ErrorResponse['code'], message: string): ErrorResponse {
  return { status: 'error', code, message };
}

function parseCommitRequest(data: unknown): CommitRequest | null {
  if (!isRecord(data)) return null;
  const attemptId = asString(data.attemptId);
  const idempotencyKey = asString(data.idempotencyKey);
  const selectedObjectId = asString(data.selectedObjectId);
  const newBodyId = asString(data.newBodyId);
  if (!attemptId || !idempotencyKey || !selectedObjectId || !newBodyId) return null;
  if (!Array.isArray(data.bodies)) return null;

  const bodies: SubmittedBody[] = [];
  for (const item of data.bodies) {
    if (!isRecord(item)) return null;
    const bodyId = asString(item.bodyId);
    const objectId = asString(item.objectId);
    if (!bodyId || !objectId) return null;
    bodies.push({
      bodyId,
      objectId,
      x: asNumber(item.x),
      y: asNumber(item.y),
      angle: asNumber(item.angle),
      scaleX: asNumber(item.scaleX, 1),
      scaleY: asNumber(item.scaleY, 1),
    });
  }
  return {
    attemptId,
    idempotencyKey,
    selectedObjectId,
    newBodyId,
    baseTowerVersion: asNumber(data.baseTowerVersion, -1),
    bodies,
  };
}

placement.post('/commit', async (c) => {
  const { postId, userId } = context;
  if (!postId) return c.json<ErrorResponse>(err('no-post', 'postId missing'), 400);
  if (!userId) return c.json<ErrorResponse>(err('no-user', 'Sign in to contribute'), 401);

  const body = parseCommitRequest(await c.req.json());
  if (!body) return c.json<ErrorResponse>(err('validation-failed', 'Malformed request'), 400);

  const username = context.username ?? (await reddit.getCurrentUsername()) ?? 'anonymous';

  try {
  // Idempotency: a retried commit (e.g. after a network drop) must not place twice.
  const priorPlacementId = await redis.get(k.idem(body.idempotencyKey));
  if (priorPlacementId) {
    const tower = await loadTowerState(postId);
    const player = await loadPlayer(postId, userId, username);
    const prior = tower?.placements.find((p) => p.placementId === priorPlacementId);
    if (tower && prior) {
      return c.json<CommitResponse>({
        type: 'commit',
        status: 'committed',
        placementId: prior.placementId,
        bodyId: prior.bodyId,
        sequenceNumber: prior.sequenceNumber,
        score: prior.score,
        tower: toClientTower(tower, userId),
        player,
        // Idempotent replay: never re-celebrate a milestone already awarded.
        milestone: null,
      });
    }
  }

  const attemptRecord = await loadAttempt(body.attemptId);
  if (!attemptRecord || attemptRecord.userId !== userId) {
    return c.json<ErrorResponse>(err('attempt-invalid', 'Unknown or foreign attempt'), 400);
  }
  if (Date.now() > attemptRecord.expiresAt) {
    await setAttemptStatus(attemptRecord, 'expired');
    return c.json<ErrorResponse>(err('attempt-expired', 'Attempt expired — start again'), 410);
  }

  // End-of-day rule (§16): a commit is only accepted while the tower is active
  // and before its end time. Past that, finalize and refuse (non-punitive — the
  // attempt is not consumed), keeping the final snapshot immutable.
  await finalizeIfDue(postId, Date.now());
  const meta = await loadMeta(postId);
  if (!meta || meta.status !== 'active' || Date.now() >= meta.endsAt) {
    return c.json<ErrorResponse>(err('no-tower', 'Tower is not accepting placements'), 409);
  }

  const player = await loadPlayer(postId, userId, username);
  if (player.placementsRemaining <= 0) {
    return c.json<ErrorResponse>(
      err('already-succeeded', 'You’ve already placed all of today’s objects'),
      409
    );
  }
  if (player.attemptsRemaining <= 0) {
    return c.json<ErrorResponse>(err('no-attempts', 'No attempts remaining'), 409);
  }

  // Version conflict is non-punitive (§17): return the fresh tower, keep the attempt.
  if (body.baseTowerVersion !== meta.version) {
    const tower = await loadTowerState(postId);
    if (!tower) return c.json<ErrorResponse>(err('no-tower', 'Tower unavailable'), 409);
    return c.json<ConflictResponse>(
      {
        status: 'conflict',
        code: 'version-conflict',
        message: CONFLICT_MESSAGE,
        tower: toClientTower(tower, userId),
        player,
      },
      409
    );
  }

  const existingBodies = await loadSnapshot(postId);
  const validation = validateCommit({
    existing: existingBodies,
    submitted: body.bodies,
    newBodyId: body.newBodyId,
    selectedObjectId: body.selectedObjectId,
    issuedObjectIds: attemptRecord.issuedObjectIds,
  });
  if (!validation.ok) {
    // A rejected submission does not consume an attempt and never touches the tower.
    return c.json<ErrorResponse>(err('validation-failed', validation.message), 400);
  }

  const outcome = await commitPlacement({
    postId,
    userId,
    username,
    submitted: body.bodies,
    newBodyId: body.newBodyId,
    selectedObjectId: body.selectedObjectId,
    baseTowerVersion: body.baseTowerVersion,
    placementId: randomUUID(),
    idempotencyKey: body.idempotencyKey,
    now: Date.now(),
  });

  if (outcome.kind === 'conflict') {
    const tower = await loadTowerState(postId);
    const freshPlayer = await loadPlayer(postId, userId, username);
    if (!tower) return c.json<ErrorResponse>(err('no-tower', 'Tower unavailable'), 409);
    return c.json<ConflictResponse>(
      {
        status: 'conflict',
        code: 'version-conflict',
        message: CONFLICT_MESSAGE,
        tower: toClientTower(tower, userId),
        player: freshPlayer,
      },
      409
    );
  }

  await setAttemptStatus(attemptRecord, 'committed', body.selectedObjectId);

  return c.json<CommitResponse>({
    type: 'commit',
    status: 'committed',
    placementId: outcome.placement.placementId,
    bodyId: outcome.placement.bodyId,
    sequenceNumber: outcome.placement.sequenceNumber,
    score: outcome.placement.score,
    tower: toClientTower(outcome.tower, userId),
    player: outcome.player,
    milestone: outcome.milestone
      ? { id: outcome.milestone.id, title: outcome.milestone.title }
      : null,
  });
  } catch (error) {
    // Never claim success on a storage failure — the client goes read-only.
    console.error('commit: redis failure', error);
    return c.json<ErrorResponse>(
      err('redis-error', 'Saving is temporarily unavailable — try again shortly'),
      503
    );
  }
});
