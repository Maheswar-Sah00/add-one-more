import { randomUUID } from 'node:crypto';
import { redis } from '@devvit/web/server';
import { RULES } from '../../shared/config';
import type { AttemptStatus, OfficialAttempt } from '../../shared/types';
import { asNumber, asString, asStringArray, isRecord, safeParse } from './json';
import { k } from './keys';

function toStatus(value: unknown): AttemptStatus {
  if (
    value === 'issued' ||
    value === 'selected' ||
    value === 'submitted' ||
    value === 'failed' ||
    value === 'committed' ||
    value === 'expired'
  ) {
    return value;
  }
  return 'issued';
}

function parseAttempt(raw: string | undefined): OfficialAttempt | null {
  const data = safeParse(raw);
  if (!isRecord(data)) return null;
  const attemptId = asString(data.attemptId);
  const towerId = asString(data.towerId);
  const userId = asString(data.userId);
  if (!attemptId || !towerId || !userId) return null;
  const selected = asString(data.selectedObjectId);
  return {
    attemptId,
    towerId,
    userId,
    baseTowerVersion: asNumber(data.baseTowerVersion, 0),
    issuedObjectIds: asStringArray(data.issuedObjectIds),
    selectedObjectId: selected.length > 0 ? selected : null,
    status: toStatus(data.status),
    createdAt: asNumber(data.createdAt, 0),
    expiresAt: asNumber(data.expiresAt, 0),
  };
}

export function newAttemptId(): string {
  return randomUUID();
}

export async function createAttempt(input: {
  attemptId: string;
  towerId: string;
  userId: string;
  baseTowerVersion: number;
  issuedObjectIds: string[];
  now: number;
}): Promise<OfficialAttempt> {
  const attempt: OfficialAttempt = {
    attemptId: input.attemptId,
    towerId: input.towerId,
    userId: input.userId,
    baseTowerVersion: input.baseTowerVersion,
    issuedObjectIds: input.issuedObjectIds,
    selectedObjectId: null,
    status: 'issued',
    createdAt: input.now,
    expiresAt: input.now + RULES.attemptTtlSeconds * 1000,
  };
  await redis.set(k.attempt(attempt.attemptId), JSON.stringify(attempt));
  // Give the token a little slack beyond expiry so late commits can be told
  // "expired" rather than "invalid".
  await redis.expire(k.attempt(attempt.attemptId), RULES.attemptTtlSeconds + 120);
  return attempt;
}

export async function loadAttempt(attemptId: string): Promise<OfficialAttempt | null> {
  return parseAttempt(await redis.get(k.attempt(attemptId)));
}

export async function setAttemptStatus(
  attempt: OfficialAttempt,
  status: AttemptStatus,
  selectedObjectId?: string
): Promise<void> {
  const updated: OfficialAttempt = {
    ...attempt,
    status,
    selectedObjectId: selectedObjectId ?? attempt.selectedObjectId,
  };
  await redis.set(k.attempt(attempt.attemptId), JSON.stringify(updated));
  await redis.expire(k.attempt(attempt.attemptId), RULES.attemptTtlSeconds + 120);
}
