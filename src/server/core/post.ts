import { reddit } from '@devvit/web/server';
import { RULES } from '../../shared/config';
import { pickDailyModifier } from '../../shared/modifiers';
import { buildPostTextFallback, buildPostTitle, dayNumber } from '../../shared/post';

function todayDayKey(now: number): string {
  return new Date(now).toISOString().slice(0, 10);
}

/**
 * Create the daily custom post (Task 19). The post is Reddit-native: a useful
 * title with the day number + modifier, the interactive splash surface as the
 * default entrypoint, a plain-text/markdown fallback for old.reddit, and post
 * data carrying the day's context. Created on the APP account (no `runAs: USER`),
 * so it never posts on a user's behalf.
 */
export const createPost = async () => {
  const now = Date.now();
  const dayKey = todayDayKey(now);
  const day = dayNumber(dayKey);
  const modifier = pickDailyModifier(dayKey);

  return await reddit.submitCustomPost({
    title: buildPostTitle(day, modifier.id),
    // `entry` defaults to the `default` entrypoint (splash.html) — the inline,
    // interactive game surface. No external links, no Reddit-logo imagery.
    textFallback: { text: buildPostTextFallback({ day, modifierId: modifier.id }) },
    postData: {
      dayNumber: day,
      dayKey,
      modifierId: modifier.id,
      endsAt: now + RULES.towerDurationMs,
    },
  });
};
