/**
 * First-time experience logic (Task 11). Pure and DOM-free so the three-step
 * copy, the step navigation, and the "have they seen it?" preference are all
 * unit-testable. The preference is DISPOSABLE: it lives in localStorage when
 * available and silently degrades to an in-memory fallback when storage is
 * blocked or absent — the game must keep working either way, it just can't
 * remember across sessions without storage.
 */

export type TutorialStep = {
  /** 0-based index. */
  readonly index: number;
  /** The required headline for this step. */
  readonly title: string;
  /** One short supporting line — never a wall of rules. */
  readonly caption: string;
};

/** Exactly three steps — the required maximum. */
export const TUTORIAL_STEPS: readonly TutorialStep[] = [
  {
    index: 0,
    title: 'Everyone is building the same tower.',
    caption: 'One shared tower per day. Every player stacks onto the same one.',
  },
  {
    index: 1,
    title: 'Choose one object. Position it. Rotate it. Drop it.',
    caption: 'Pick from three objects, nudge and spin it into place, then let go.',
  },
  {
    index: 2,
    title: 'If it stays up, it becomes the next player’s problem.',
    caption: 'Survive the wobble and your object is saved for whoever builds next.',
  },
];

export const TUTORIAL_STEP_COUNT = TUTORIAL_STEPS.length;

/** Versioned so future copy changes can re-show the tutorial if we choose to. */
export const TUTORIAL_SEEN_KEY = 'omt.tutorial.seen.v1';

export type StorageLike = {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
};

/** Session-scoped fallback used whenever real storage is unavailable. */
const memory = new Map<string, string>();

/** Test seam: forget the in-memory fallback between cases. */
export function clearTutorialMemory(): void {
  memory.clear();
}

/**
 * Resolve a usable storage, probing that it actually accepts writes (private
 * mode / disabled cookies throw on setItem). Returns null when unavailable so
 * callers fall back to the in-memory map.
 */
export function resolveStorage(): StorageLike | null {
  try {
    if (typeof localStorage === 'undefined') return null;
    const probe = '__omt_probe__';
    localStorage.setItem(probe, '1');
    localStorage.removeItem(probe);
    return localStorage;
  } catch {
    return null;
  }
}

/** Whether the player has already dismissed or finished the tutorial. */
export function readTutorialSeen(storage: StorageLike | null = resolveStorage()): boolean {
  if (storage) {
    try {
      if (storage.getItem(TUTORIAL_SEEN_KEY) === '1') return true;
    } catch {
      // fall through to the in-memory fallback
    }
  }
  return memory.get(TUTORIAL_SEEN_KEY) === '1';
}

/** Record that the tutorial was seen; never throws even if storage rejects. */
export function markTutorialSeen(storage: StorageLike | null = resolveStorage()): void {
  // Always remember for this session so returning to the launch screen does
  // not re-interrupt, even when persistent storage is unavailable.
  memory.set(TUTORIAL_SEEN_KEY, '1');
  if (!storage) return;
  try {
    storage.setItem(TUTORIAL_SEEN_KEY, '1');
  } catch {
    // in-memory fallback already set
  }
}

/** Auto-show the tutorial only for players who have not seen it. */
export function shouldAutoShowTutorial(
  storage: StorageLike | null = resolveStorage()
): boolean {
  return !readTutorialSeen(storage);
}

export function clampStep(index: number): number {
  if (!Number.isFinite(index)) return 0;
  return Math.max(0, Math.min(Math.trunc(index), TUTORIAL_STEP_COUNT - 1));
}

export function isLastStep(index: number): boolean {
  return clampStep(index) >= TUTORIAL_STEP_COUNT - 1;
}
