import { afterEach, describe, expect, it } from 'vitest';
import {
  clearSettingsMemory,
  computeReducedMotion,
  readMuted,
  readReducedMotionPref,
  writeMuted,
  writeReducedMotionPref,
  type StorageLike,
} from './settings';

function fakeStorage(): StorageLike {
  const map = new Map<string, string>();
  return {
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => {
      map.set(k, v);
    },
  };
}

const throwing: StorageLike = {
  getItem: () => {
    throw new Error('blocked');
  },
  setItem: () => {
    throw new Error('blocked');
  },
};

afterEach(() => clearSettingsMemory());

describe('mute preference', () => {
  it('defaults off and round-trips through storage', () => {
    const s = fakeStorage();
    expect(readMuted(s)).toBe(false);
    writeMuted(true, s);
    expect(readMuted(s)).toBe(true);
    writeMuted(false, s);
    expect(readMuted(s)).toBe(false);
  });
});

describe('reduced-motion preference', () => {
  it('round-trips through storage', () => {
    const s = fakeStorage();
    expect(readReducedMotionPref(s)).toBe(false);
    writeReducedMotionPref(true, s);
    expect(readReducedMotionPref(s)).toBe(true);
  });
});

describe('graceful degradation without storage', () => {
  it('uses an in-memory fallback within the session', () => {
    expect(readMuted(null)).toBe(false);
    writeMuted(true, null);
    expect(readMuted(null)).toBe(true);
  });

  it('never throws when storage access throws', () => {
    expect(() => writeMuted(true, throwing)).not.toThrow();
    expect(readMuted(throwing)).toBe(true); // in-memory fallback answers
  });
});

describe('computeReducedMotion — OS ∪ user', () => {
  it('is on if either the OS or the user asks for it', () => {
    expect(computeReducedMotion(false, false)).toBe(false);
    expect(computeReducedMotion(true, false)).toBe(true);
    expect(computeReducedMotion(false, true)).toBe(true);
    expect(computeReducedMotion(true, true)).toBe(true);
  });
});
