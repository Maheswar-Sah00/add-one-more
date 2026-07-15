import { Hono } from 'hono';
import { context, reddit } from '@devvit/web/server';
import type {
  BootstrapResponse,
  ErrorResponse,
} from '../../shared/api';
import { RULES } from '../../shared/config';
import type { PlayerDailyState, TowerState } from '../../shared/types';
import { loadPlayer } from '../core/player';
import { ensureTower, loadTowerState, toClientTower } from '../core/tower';

export const api = new Hono();

function err(code: ErrorResponse['code'], message: string): ErrorResponse {
  return { status: 'error', code, message };
}

function anonymousPlayer(userId: string, username: string): PlayerDailyState {
  return {
    userId,
    username,
    attemptsUsed: 0,
    attemptsRemaining: RULES.maxAttemptsPerDay,
    hasSucceeded: false,
    successfulPlacementId: null,
    score: 0,
  };
}

api.get('/bootstrap', async (c) => {
  const { postId, userId } = context;
  if (!postId) {
    return c.json<ErrorResponse>(err('no-post', 'postId missing from context'), 400);
  }

  const now = Date.now();
  let readOnly = false;
  let tower: TowerState | null;

  // Creating the tower requires a write. If that fails but the tower can still
  // be read, drop to read-only rather than blocking viewing.
  try {
    await ensureTower(postId, now);
    tower = await loadTowerState(postId);
  } catch (error) {
    console.error('bootstrap: redis write degraded, trying read-only', error);
    readOnly = true;
    try {
      tower = await loadTowerState(postId);
    } catch (readError) {
      console.error('bootstrap: redis read failed', readError);
      tower = null;
    }
  }

  if (!tower) {
    return c.json<ErrorResponse>(err('redis-error', 'Tower storage is unavailable'), 503);
  }

  const username = context.username ?? (await reddit.getCurrentUsername()) ?? 'anonymous';
  let player;
  try {
    player = userId
      ? await loadPlayer(postId, userId, username)
      : anonymousPlayer('', username);
  } catch (error) {
    console.error('bootstrap: player load failed, read-only', error);
    readOnly = true;
    player = anonymousPlayer(userId ?? '', username);
  }

  return c.json<BootstrapResponse>({
    type: 'bootstrap',
    tower: toClientTower(tower, userId ?? null),
    player,
    username,
    userId: userId ?? null,
    readOnly,
    now,
  });
});

api.get('/tower', async (c) => {
  const { postId, userId } = context;
  if (!postId) {
    return c.json<ErrorResponse>(err('no-post', 'postId missing from context'), 400);
  }
  const tower = await loadTowerState(postId);
  if (!tower) {
    return c.json<ErrorResponse>(err('no-tower', 'no active tower'), 404);
  }
  return c.json<TowerState>(toClientTower(tower, userId ?? null));
});
