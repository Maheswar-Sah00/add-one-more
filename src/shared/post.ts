/**
 * Reddit-native post presentation (Task 19). Pure builders for the post title,
 * the old.reddit text fallback, and the day number — shared so the server owns
 * them and they stay unit-testable. No external links, no Reddit logos: this is
 * plain text/markdown describing the game.
 */
/** Day 1 of "One More Thing". Day numbers are computed relative to this (UTC). */
export const LAUNCH_DAY_KEY = '2026-07-20';

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * The next UTC-midnight boundary (ms epoch) strictly after `now`. Daily towers
 * end here, so the reset always lands at 00:00 UTC — aligned with the UTC day
 * key the game already uses (Reddit's backend clock is UTC). This is what makes
 * the countdown a real, predictable daily reset rather than "24h from creation".
 */
export function nextUtcMidnight(now: number): number {
  const d = new Date(now);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1, 0, 0, 0, 0);
}

/** The 1-based day number for a given day key, relative to launch. */
export function dayNumber(dayKey: string, launch: string = LAUNCH_DAY_KEY): number {
  const d = Date.parse(`${dayKey}T00:00:00.000Z`);
  const l = Date.parse(`${launch}T00:00:00.000Z`);
  if (Number.isNaN(d) || Number.isNaN(l)) return 1;
  return Math.max(1, Math.floor((d - l) / DAY_MS) + 1);
}

/** e.g. "Day 1: can you add one more thing?". */
export function buildPostTitle(day: number): string {
  return `Day ${day}: can you add one more thing?`;
}

/**
 * The old.reddit / unsupported-client text fallback. Explains the game in plain
 * markdown and points readers to open the interactive post — with no external
 * links and no dependency on comments.
 */
export function buildPostTextFallback(opts: { day: number }): string {
  return [
    `**One More Thing — Day ${opts.day}**`,
    '',
    'How it works:',
    '',
    '- Everyone is building the same daily tower.',
    '- Each person can add up to three successful objects.',
    '- Successful placements become part of the next player’s challenge.',
    '- Open this post in a supported Reddit app (iOS, Android, or new web) to play the interactive tower.',
    '- The tower resets daily.',
    '',
    'No comments required — just open the post and add your object before the day ends.',
  ].join('\n');
}
