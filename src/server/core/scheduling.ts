/**
 * Best-effort daily finalization scheduling (Task 16). Uses only the confirmed
 * installed Scheduler API — `scheduler.runJob({ name, data, runAt })` (from
 * `@devvit/scheduler`, re-exported by `@devvit/web/server`). Scheduling is
 * ADVISORY: every failure is swallowed because request-time lazy finalization
 * (`finalizeIfDue`) is the authoritative mechanism. If the scheduler is
 * unavailable or the job never fires, the next request still finalizes the tower.
 *
 * The scheduler is loaded via a dynamic import and accessed defensively so this
 * module never hard-depends on the scheduler being present (e.g. in tests or a
 * runtime where scheduling is disabled).
 */

/** The scheduler task name — must match the entry registered in devvit.json. */
export const DAILY_FINALIZE_JOB = 'daily-finalize';

export async function scheduleDailyFinalize(postId: string, runAtMs: number): Promise<void> {
  try {
    const mod = await import('@devvit/web/server');
    const scheduler = (mod as { scheduler?: { runJob?: (job: unknown) => Promise<string> } }).scheduler;
    if (!scheduler || typeof scheduler.runJob !== 'function') return;
    await scheduler.runJob({
      name: DAILY_FINALIZE_JOB,
      data: { postId },
      runAt: new Date(runAtMs),
    });
  } catch (error) {
    // Non-fatal: lazy finalization on the next request covers this.
    console.error('scheduleDailyFinalize failed (lazy fallback will finalize)', error);
  }
}
