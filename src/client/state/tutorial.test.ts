import { afterEach, describe, expect, it } from 'vitest';
import {
  TUTORIAL_SEEN_KEY,
  TUTORIAL_STEPS,
  TUTORIAL_STEP_COUNT,
  clampStep,
  clearTutorialMemory,
  isLastStep,
  markTutorialSeen,
  readTutorialSeen,
  shouldAutoShowTutorial,
  type StorageLike,
} from './tutorial';

/** A minimal in-memory Storage stand-in for the happy path. */
function fakeStorage(): StorageLike {
  const map = new Map<string, string>();
  return {
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => {
      map.set(k, v);
    },
  };
}

/** Storage that throws on every access (private mode / disabled cookies). */
const throwingStorage: StorageLike = {
  getItem: () => {
    throw new Error('blocked');
  },
  setItem: () => {
    throw new Error('blocked');
  },
};

afterEach(() => clearTutorialMemory());

describe('tutorial steps', () => {
  it('has exactly three steps (the required maximum)', () => {
    expect(TUTORIAL_STEP_COUNT).toBe(3);
    expect(TUTORIAL_STEPS).toHaveLength(3);
    expect(TUTORIAL_STEPS.length).toBeLessThanOrEqual(3);
  });

  it('uses the required headlines in order', () => {
    expect(TUTORIAL_STEPS[0]?.title).toBe('Everyone is building the same tower.');
    expect(TUTORIAL_STEPS[1]?.title).toBe('Choose one object. Position it. Rotate it. Drop it.');
    expect(TUTORIAL_STEPS[2]?.title).toBe('If it stays up, it becomes the next player’s problem.');
  });

  it('keeps captions short (not a long rule page)', () => {
    for (const step of TUTORIAL_STEPS) {
      expect(step.caption.length).toBeGreaterThan(0);
      expect(step.caption.length).toBeLessThanOrEqual(90);
    }
  });

  it('clamps and detects the last step for navigation', () => {
    expect(clampStep(-5)).toBe(0);
    expect(clampStep(99)).toBe(2);
    expect(clampStep(1)).toBe(1);
    expect(isLastStep(2)).toBe(true);
    expect(isLastStep(0)).toBe(false);
  });
});

describe('seen preference — persisted', () => {
  it('defaults to unseen, and auto-shows for a new player', () => {
    const storage = fakeStorage();
    expect(readTutorialSeen(storage)).toBe(false);
    expect(shouldAutoShowTutorial(storage)).toBe(true);
  });

  it('remembers once marked, so returning players are not interrupted', () => {
    const storage = fakeStorage();
    markTutorialSeen(storage);
    expect(readTutorialSeen(storage)).toBe(true);
    expect(shouldAutoShowTutorial(storage)).toBe(false);
    expect(storage.getItem(TUTORIAL_SEEN_KEY)).toBe('1');
  });
});

describe('graceful degradation without storage', () => {
  it('works with no storage at all — falls back to in-memory for the session', () => {
    expect(readTutorialSeen(null)).toBe(false);
    markTutorialSeen(null);
    // Within the same session the in-memory fallback prevents re-interrupting.
    expect(readTutorialSeen(null)).toBe(true);
    expect(shouldAutoShowTutorial(null)).toBe(false);
  });

  it('never throws when storage access itself throws', () => {
    expect(() => markTutorialSeen(throwingStorage)).not.toThrow();
    // The throwing read is swallowed and the in-memory fallback answers.
    expect(readTutorialSeen(throwingStorage)).toBe(true);
  });

  it('a fresh session with no storage starts unseen again', () => {
    // Simulates a brand-new load: memory cleared by afterEach, no persistence.
    expect(readTutorialSeen(null)).toBe(false);
  });
});
