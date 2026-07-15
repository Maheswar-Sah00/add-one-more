import { Hono } from 'hono';
import { asString, isRecord } from '../core/json';
import { finalizeIfDue } from '../core/lifecycle';

/**
 * Scheduler-invoked finalization (§16). Registered in devvit.json as the
 * `daily-finalize` task; the runtime POSTs here when a scheduled job fires,
 * carrying the `postId` in the job data. It simply defers to `finalizeIfDue`,
 * so it is idempotent and identical to the lazy request-time path.
 */
export const scheduler = new Hono();

scheduler.post('/finalize', async (c) => {
  const raw: unknown = await c.req.json().catch(() => ({}));
  // TaskRequest carries { name, data } — accept either the wrapper or bare data.
  const data = isRecord(raw) && isRecord(raw.data) ? raw.data : isRecord(raw) ? raw : {};
  const postId = asString(data.postId);
  if (!postId) {
    return c.json({ status: 'error', message: 'postId required' }, 400);
  }
  try {
    const summary = await finalizeIfDue(postId, Date.now());
    return c.json({ status: 'success', finalized: summary !== null }, 200);
  } catch (error) {
    console.error('scheduled finalize failed', error);
    return c.json({ status: 'error', message: 'finalize failed' }, 500);
  }
});
