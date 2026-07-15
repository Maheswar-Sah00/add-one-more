import { redis } from '@devvit/web/server';
import { RULES } from '../../shared/config';
import type { PlayerDailyState } from '../../shared/types';
import { boolStr, numStr } from './json';
import { k } from './keys';

export function serializePlayer(p: PlayerDailyState): Record<string, string> {
  return {
    userId: p.userId,
    username: p.username,
    attemptsUsed: String(p.attemptsUsed),
    hasSucceeded: p.hasSucceeded ? '1' : '0',
    successfulPlacementId: p.successfulPlacementId ?? '',
    score: String(p.score),
  };
}

function withDerived(
  userId: string,
  username: string,
  attemptsUsed: number,
  hasSucceeded: boolean,
  successfulPlacementId: string | null,
  score: number
): PlayerDailyState {
  return {
    userId,
    username,
    attemptsUsed,
    attemptsRemaining: Math.max(0, RULES.maxAttemptsPerDay - attemptsUsed),
    hasSucceeded,
    successfulPlacementId,
    score,
  };
}

export async function loadPlayer(
  postId: string,
  userId: string,
  username: string
): Promise<PlayerDailyState> {
  const h = await redis.hGetAll(k.player(postId, userId));
  const placementId = h.successfulPlacementId;
  return withDerived(
    userId,
    h.username && h.username.length > 0 ? h.username : username,
    numStr(h.attemptsUsed, 0),
    boolStr(h.hasSucceeded),
    placementId && placementId.length > 0 ? placementId : null,
    numStr(h.score, 0)
  );
}

/** Whether the player may start / resolve another official attempt. */
export function canContribute(player: PlayerDailyState): boolean {
  return !player.hasSucceeded && player.attemptsRemaining > 0;
}

/** Consume one attempt after a failed drop (§6). Conflicts do NOT call this. */
export async function consumeAttempt(
  postId: string,
  userId: string,
  username: string
): Promise<PlayerDailyState> {
  const player = await loadPlayer(postId, userId, username);
  const updated = withDerived(
    userId,
    player.username,
    player.attemptsUsed + 1,
    player.hasSucceeded,
    player.successfulPlacementId,
    player.score
  );
  await redis.hSet(k.player(postId, userId), serializePlayer(updated));
  return updated;
}
