import { Hono } from 'hono';
import { context, reddit } from '@devvit/web/server';
import type {
  ArchiveResponse,
  BootstrapResponse,
  ErrorResponse,
  LeaderboardResponse,
} from '../../shared/api';
import { ARCHIVE, RULES } from '../../shared/config';
import type { PlayerDailyState, TowerState } from '../../shared/types';
import {
  LEADERBOARD_IDS,
  LEADERBOARD_TITLES,
  clampLimit,
  readAllBoards,
} from '../core/leaderboards';
import { finalizeIfDue, loadArchive, loadSummary } from '../core/lifecycle';
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
    successfulPlacements: 0,
    placementsRemaining: RULES.maxSuccessesPerDay,
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
    // Lazy finalization fallback (§16): if the day has ended, finalize on read.
    await finalizeIfDue(postId, now);
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

  const summary = tower.meta.status === 'finalized' ? await loadSummary(postId).catch(() => null) : null;

  return c.json<BootstrapResponse>({
    type: 'bootstrap',
    tower: toClientTower(tower, userId ?? null),
    player,
    username,
    userId: userId ?? null,
    readOnly,
    summary,
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

api.get('/leaderboard', async (c) => {
  const { postId, userId } = context;
  if (!postId) {
    return c.json<ErrorResponse>(err('no-post', 'postId missing from context'), 400);
  }
  const limit = clampLimit(Number(c.req.query('limit')));
  try {
    const boards = await readAllBoards(postId, userId ?? null, limit);
    return c.json<LeaderboardResponse>({
      type: 'leaderboard',
      limit,
      boards: LEADERBOARD_IDS.map((id) => ({
        id,
        title: LEADERBOARD_TITLES[id],
        entries: boards[id],
      })),
    });
  } catch (error) {
    console.error('leaderboard: redis read failed', error);
    return c.json<ErrorResponse>(err('redis-error', 'Leaderboards are unavailable'), 503);
  }
});

api.get('/archive', async (c) => {
  const requested = Number(c.req.query('limit'));
  const limit = Number.isFinite(requested)
    ? Math.max(1, Math.min(Math.trunc(requested), ARCHIVE.maxEntries))
    : ARCHIVE.defaultLimit;
  try {
    const entries = await loadArchive(limit);
    return c.json<ArchiveResponse>({ type: 'archive', entries });
  } catch (error) {
    console.error('archive: redis read failed', error);
    return c.json<ErrorResponse>(err('redis-error', 'The archive is unavailable'), 503);
  }
});
