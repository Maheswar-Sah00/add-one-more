import { describe, expect, it } from 'vitest';
import { getModifier } from './modifiers';
import { LAUNCH_DAY_KEY, buildPostTextFallback, buildPostTitle, dayNumber } from './post';

describe('day number', () => {
  it('starts at 1 on launch day and counts up (UTC)', () => {
    expect(dayNumber(LAUNCH_DAY_KEY)).toBe(1);
    expect(dayNumber('2026-07-02')).toBe(2);
    expect(dayNumber('2026-07-16')).toBe(16);
  });

  it('crosses month/year boundaries correctly', () => {
    expect(dayNumber('2026-08-01', '2026-07-31')).toBe(2);
    expect(dayNumber('2027-01-01', '2026-12-31')).toBe(2);
  });

  it('never drops below 1 and tolerates a bad key', () => {
    expect(dayNumber('2026-06-01')).toBe(1); // before launch → clamped
    expect(dayNumber('not-a-date')).toBe(1);
  });
});

describe('post title', () => {
  it('uses the required format with the modifier name', () => {
    expect(buildPostTitle(16, 'low-gravity')).toBe(
      `Day 16: Can we add one more thing? — ${getModifier('low-gravity').label}`
    );
    expect(buildPostTitle(1, 'normal')).toContain('Day 1: Can we add one more thing?');
  });
});

describe('text fallback', () => {
  const text = buildPostTextFallback({ day: 5, modifierId: 'heavy' });

  it('explains all five required points', () => {
    expect(text).toContain('Everyone is building the same daily tower');
    expect(text).toContain('one successful object');
    expect(text).toContain('next player');
    expect(text.toLowerCase()).toContain('supported reddit app');
    expect(text).toContain('resets daily');
  });

  it('names the day and the modifier, and needs no comments or external links', () => {
    expect(text).toContain('Day 5');
    expect(text).toContain(getModifier('heavy').label);
    expect(text.toLowerCase()).toContain('no comments');
    expect(text).not.toContain('http://');
    expect(text).not.toContain('https://');
  });
});
