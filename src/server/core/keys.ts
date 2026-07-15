/**
 * Redis key builders. Everything for one daily tower is namespaced by postId
 * (one tower per post), which keeps towers isolated without cross-post locks.
 */
export const k = {
  meta: (postId: string): string => `tower:${postId}:meta`,
  version: (postId: string): string => `tower:${postId}:version`,
  snapshot: (postId: string): string => `tower:${postId}:snapshot`,
  placements: (postId: string): string => `tower:${postId}:placements`,
  player: (postId: string, userId: string): string => `tower:${postId}:player:${userId}`,
  lbScore: (postId: string): string => `tower:${postId}:lb:score`,
  attempt: (attemptId: string): string => `attempt:${attemptId}`,
  idem: (idempotencyKey: string): string => `idem:${idempotencyKey}`,
} as const;
