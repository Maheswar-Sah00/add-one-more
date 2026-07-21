/**
 * Shared-tower persistence. The community tower is saved in Redis (per post) and
 * loaded on entry, so the build survives reloads AND production deploys — code
 * pushes never touch stored data. Kept deliberately small and independent of the
 * full attempt/commit pipeline: a settled body is appended atomically (WATCH so
 * two simultaneous drops can't erase each other), nothing more.
 */
import { Hono } from 'hono';
import { context, reddit, redis } from '@devvit/web/server';
import type {
  BuildStateResponse,
  ErrorResponse,
  PlaceBodyResponse,
  PlacedBody,
} from '../../shared/api';
import { RULES } from '../../shared/config';
import { getObjectDef } from '../../shared/objects';
import type { PersistedBodyState } from '../../shared/types';
import { asNumber, asString, isRecord } from '../core/json';
import { k } from '../core/keys';
import { ensureTower, loadSnapshot } from '../core/tower';

export const build = new Hono();

function err(code: ErrorResponse['code'], message: string): ErrorResponse {
  return { status: 'error', code, message };
}

/** Public transform-only view — never leaks internal owner ids. */
function toPlaced(b: PersistedBodyState): PlacedBody {
  return { objectId: b.objectId, x: b.x, y: b.y, angle: b.angle, scaleX: b.scaleX, scaleY: b.scaleY };
}

/** The saved shared tower for this post. */
build.get('/state', async (c) => {
  const { postId } = context;
  if (!postId) return c.json<ErrorResponse>(err('no-post', 'postId missing'), 400);
  try {
    await ensureTower(postId, Date.now());
    const bodies = await loadSnapshot(postId);
    return c.json<BuildStateResponse>({ type: 'build-state', bodies: bodies.map(toPlaced) });
  } catch (error) {
    console.error('build/state: redis read failed', error);
    return c.json<ErrorResponse>(err('redis-error', 'The tower is unavailable'), 503);
  }
});

/** Append one settled body to the shared tower (atomic, retried on contention). */
build.post('/place', async (c) => {
  const { postId, userId } = context;
  if (!postId) return c.json<ErrorResponse>(err('no-post', 'postId missing'), 400);

  const raw: unknown = await c.req.json().catch(() => null);
  if (!isRecord(raw)) return c.json<ErrorResponse>(err('validation-failed', 'Malformed body'), 400);
  const objectId = asString(raw.objectId);
  if (!objectId || !getObjectDef(objectId)) {
    return c.json<ErrorResponse>(err('validation-failed', 'Unknown object'), 400);
  }
  const username = context.username ?? (await reddit.getCurrentUsername()) ?? 'anonymous';

  try {
    await ensureTower(postId, Date.now());

    // Optimistic append with a bounded retry: WATCH the snapshot so a concurrent
    // drop invalidates the transaction instead of silently clobbering it.
    for (let attempt = 0; attempt < 4; attempt++) {
      const tx = await redis.watch(k.snapshot(postId));
      const existing = await loadSnapshot(postId);
      if (existing.length >= RULES.maxObjectsPerTower) {
        await tx.unwatch();
        return c.json<PlaceBodyResponse>({ type: 'placed', bodies: existing.map(toPlaced) });
      }
      const body: PersistedBodyState = {
        bodyId: `${Date.now()}-${existing.length + 1}`,
        objectId,
        ownerUserId: userId ?? '',
        ownerUsername: username,
        sequenceNumber: existing.length + 1,
        x: asNumber(raw.x, 0),
        y: asNumber(raw.y, 0),
        angle: asNumber(raw.angle, 0),
        scaleX: asNumber(raw.scaleX, 1),
        scaleY: asNumber(raw.scaleY, 1),
      };
      const next = [...existing, body];
      await tx.multi();
      await tx.set(k.snapshot(postId), JSON.stringify(next));
      const results = await tx.exec();
      if (results && results.length > 0) {
        return c.json<PlaceBodyResponse>({ type: 'placed', bodies: next.map(toPlaced) });
      }
      // Contended — another drop landed first; loop and re-read.
    }
    // Persisted contention exhausted retries: report the current tower, unchanged.
    const bodies = await loadSnapshot(postId);
    return c.json<PlaceBodyResponse>({ type: 'placed', bodies: bodies.map(toPlaced) });
  } catch (error) {
    console.error('build/place: redis write failed', error);
    return c.json<ErrorResponse>(err('redis-error', 'Saving is temporarily unavailable'), 503);
  }
});
