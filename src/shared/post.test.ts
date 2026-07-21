import { describe, expect, it } from 'vitest';
import { LAUNCH_DAY_KEY, buildPostTextFallback, buildPostTitle, dayNumber } from './post';

describe('day number', () => {
  it('starts at 1 on launch day and counts up (UTC)', () => {
    expect(dayNumber(LAUNCH_DAY_KEY)).toBe(1);
    expect(dayNumber('2026-07-02', '2026-07-01')).toBe(2);
    expect(dayNumber('2026-07-16', '2026-07-01')).toBe(16);
  });

  it('crosses month/year boundaries correctly', () => {
    expect(dayNumber('2026-08-01', '2026-07-31')).toBe(2);
    expect(dayNumber('2027-01-01', '2026-12-31')).toBe(2);
  });

  it('never drops below 1 and tolerates a bad key', () => {
    expect(dayNumber('2020-06-01')).toBe(1); // before launch → clamped
    expect(dayNumber('not-a-date')).toBe(1);
  });
});

describe('post title', () => {
  it('is the plain day-numbered call to action (no modifier)', () => {
    expect(buildPostTitle(1)).toBe('Day 1: can you add one more thing?');
    expect(buildPostTitle(7)).toBe('Day 7: can you add one more thing?');
  });
});

describe('text fallback', () => {
  const text = buildPostTextFallback({ day: 5 });

  it('explains all five required points', () => {
    expect(text).toContain('Everyone is building the same daily tower');
    expect(text).toContain('up to three successful objects');
    expect(text).toContain('next player');
    expect(text.toLowerCase()).toContain('supported reddit app');
    expect(text).toContain('resets daily');
  });

  it('names the day, and needs no comments or external links', () => {
    expect(text).toContain('Day 5');
    expect(text.toLowerCase()).toContain('no comments');
    expect(text).not.toContain('http://');
    expect(text).not.toContain('https://');
  });
});
