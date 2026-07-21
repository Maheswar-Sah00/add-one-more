/**
 * Redis key builders. Everything for one daily tower is namespaced by postId
 * (one tower per post), which keeps towers isolated without cross-post locks.
 */
export const k = {
  meta: (postId: string): string => `tower:${postId}:meta`,
  version: (postId: string): string => `tower:${postId}:version`,
  snapshot: (postId: string): string => `tower:${postId}:snapshot`,
  placements: (postId: string): string => `tower:${postId}:placements`,
  /** Immutable final summary, saved once at finalization. */
  summary: (postId: string): string => `tower:${postId}:summary`,
  /** Next daily tower's initial-state descriptor, produced at finalization. */
  nextDaily: (postId: string): string => `tower:${postId}:next`,
  /** Total official attempts spent on this tower (fails + successes). */
  attemptCount: (postId: string): string => `tower:${postId}:attempts`,
  /** Global archive index: member = postId, score = finalizedAt. */
  archiveIndex: (): string => `archive:index`,
  player: (postId: string, userId: string): string => `tower:${postId}:player:${userId}`,
  // --- per-tower leaderboards (today) ---
  lbScore: (postId: string): string => `tower:${postId}:lb:score`,
  lbPlacement: (postId: string): string => `tower:${postId}:lb:placement`,
  // --- global / all-time leaderboards ---
  lbAbsurd: (): string => `lb:absurd`,
  lbStreak: (): string => `lb:streak`,
  lbAllTime: (): string => `lb:alltime`,
  /** Permanent all-time POINTS board: member = userId, score = lifetime points. */
  lbPoints: (): string => `lb:points`,
  /** A user's cumulative all-time points (authoritative counter). */
  userPoints: (userId: string): string => `user:${userId}:points`,
  /** A user's daily drop quota: hash { dayKey, count } — resets each UTC day. */
  userDaily: (userId: string): string => `user:${userId}:daily`,
  /** Global userId -> username map, so leaderboards resolve names without ids. */
  names: (): string => `user:names`,
  /** Global per-user all-time bookkeeping (streak, totals, last active day). */
  userAllTime: (userId: string): string => `user:${userId}:alltime`,
  attempt: (attemptId: string): string => `attempt:${attemptId}`,
  idem: (idempotencyKey: string): string => `idem:${idempotencyKey}`,
} as const;
