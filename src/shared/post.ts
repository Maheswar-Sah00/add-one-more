/**
 * Reddit-native post presentation (Task 19). Pure builders for the post title,
 * the old.reddit text fallback, and the day number — shared so the server owns
 * them and they stay unit-testable. No external links, no Reddit logos: this is
 * plain text/markdown describing the game.
 */
import { getModifier } from './modifiers';

/** Day 1 of "One More Thing". Day numbers are computed relative to this (UTC). */
export const LAUNCH_DAY_KEY = '2026-07-01';

const DAY_MS = 24 * 60 * 60 * 1000;

/** The 1-based day number for a given day key, relative to launch. */
export function dayNumber(dayKey: string, launch: string = LAUNCH_DAY_KEY): number {
  const d = Date.parse(`${dayKey}T00:00:00.000Z`);
  const l = Date.parse(`${launch}T00:00:00.000Z`);
  if (Number.isNaN(d) || Number.isNaN(l)) return 1;
  return Math.max(1, Math.floor((d - l) / DAY_MS) + 1);
}

/** e.g. "Day 16: Can we add one more thing? — Low Gravity". */
export function buildPostTitle(day: number, modifierId: string): string {
  return `Day ${day}: Can we add one more thing? — ${getModifier(modifierId).label}`;
}

/**
 * The old.reddit / unsupported-client text fallback. Explains the game in plain
 * markdown and points readers to open the interactive post — with no external
 * links and no dependency on comments.
 */
export function buildPostTextFallback(opts: { day: number; modifierId: string }): string {
  const mod = getModifier(opts.modifierId);
  return [
    `**One More Thing — Day ${opts.day}**`,
    '',
    `Today's modifier: **${mod.label}** — ${mod.description}`,
    '',
    'How it works:',
    '',
    '- Everyone is building the same daily tower.',
    '- Each person may add one successful object.',
    '- Successful placements become part of the next player’s challenge.',
    '- Open this post in a supported Reddit app (iOS, Android, or new web) to play the interactive tower.',
    '- The tower resets daily.',
    '',
    'No comments required — just open the post and add your object before the day ends.',
  ].join('\n');
}
