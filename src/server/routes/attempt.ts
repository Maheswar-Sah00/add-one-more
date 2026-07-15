import { Hono } from 'hono';
import { context, reddit } from '@devvit/web/server';
import type {
  ErrorResponse,
  FailResponse,
  StartAttemptResponse,
} from '../../shared/api';
import { RULES } from '../../shared/config';
import { createAttempt, loadAttempt, newAttemptId, setAttemptStatus } from '../core/attempt';
import { issueChoices } from '../core/choices';
import { asString, isRecord } from '../core/json';
import { canContribute, consumeAttempt, loadPlayer } from '../core/player';
import { ensureTower } from '../core/tower';

export const attempt = new Hono();

function err(code: ErrorResponse['code'], message: string): ErrorResponse {
  return { status: 'error', code, message };
}

attempt.post('/start', async (c) => {
  const { postId, userId } = context;
  if (!postId) return c.json<ErrorResponse>(err('no-post', 'postId missing'), 400);
  if (!userId) {
    return c.json<ErrorResponse>(err('no-user', 'Sign in on Reddit to contribute'), 401);
  }

  const now = Date.now();
  const meta = await ensureTower(postId, now);
  if (meta.status !== 'active') {
    return c.json<ErrorResponse>(err('no-tower', 'This tower has closed'), 409);
  }
  if (meta.successfulPlacements >= RULES.maxObjectsPerTower) {
    return c.json<ErrorResponse>(err('tower-full', 'This tower is full'), 409);
  }

  const username = context.username ?? (await reddit.getCurrentUsername()) ?? 'anonymous';
  const player = await loadPlayer(postId, userId, username);
  if (player.hasSucceeded) {
    return c.json<ErrorResponse>(
      err('already-succeeded', 'You already added your object today'),
      409
    );
  }
  if (!canContribute(player)) {
    return c.json<ErrorResponse>(err('no-attempts', 'No attempts remaining today'), 409);
  }

  const attemptId = newAttemptId();
  const choices = issueChoices(meta.seed, attemptId);
  const created = await createAttempt({
    attemptId,
    towerId: postId,
    userId,
    baseTowerVersion: meta.version,
    issuedObjectIds: choices.map((ch) => ch.objectId),
    now,
  });

  return c.json<StartAttemptResponse>({
    type: 'attempt-start',
    attemptId: created.attemptId,
    baseTowerVersion: created.baseTowerVersion,
    choices,
    expiresAt: created.expiresAt,
    player,
  });
});

attempt.post('/fail', async (c) => {
  const { postId, userId } = context;
  if (!postId) return c.json<ErrorResponse>(err('no-post', 'postId missing'), 400);
  if (!userId) return c.json<ErrorResponse>(err('no-user', 'Sign in to play'), 401);

  const raw: unknown = await c.req.json();
  const attemptId = isRecord(raw) ? asString(raw.attemptId) : '';
  if (!attemptId) return c.json<ErrorResponse>(err('attempt-invalid', 'attemptId required'), 400);

  const record = await loadAttempt(attemptId);
  if (!record || record.userId !== userId) {
    return c.json<ErrorResponse>(err('attempt-invalid', 'Unknown attempt'), 400);
  }
  // A failed drop already resolved cannot be double-charged.
  if (record.status === 'committed' || record.status === 'failed') {
    const username = context.username ?? (await reddit.getCurrentUsername()) ?? 'anonymous';
    const player = await loadPlayer(postId, userId, username);
    return c.json<FailResponse>({ type: 'fail', player });
  }

  const username = context.username ?? (await reddit.getCurrentUsername()) ?? 'anonymous';
  await setAttemptStatus(record, 'failed');
  const player = await consumeAttempt(postId, userId, username);
  return c.json<FailResponse>({ type: 'fail', player });
});
