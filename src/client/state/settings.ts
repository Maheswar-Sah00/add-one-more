/**
 * Player feel/accessibility settings (Task 18): mute and reduced-motion. Pure and
 * DOM-free where it matters, with a disposable localStorage preference that
 * degrades to an in-memory fallback (mirrors the tutorial-seen pattern) so the
 * game still works without storage.
 *
 * Reduced motion is the OR of the OS preference and the player's explicit toggle,
 * so a user can always ask for calmer visuals even if the OS hasn't.
 */

export type StorageLike = {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
};

export const MUTE_KEY = 'omt.muted.v1';
export const REDUCED_MOTION_KEY = 'omt.reducedMotion.v1';

const memory = new Map<string, string>();

export function clearSettingsMemory(): void {
  memory.clear();
}

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

function readFlag(key: string, storage: StorageLike | null): boolean {
  if (storage) {
    try {
      const v = storage.getItem(key);
      if (v === '1') return true;
      if (v === '0') return false;
    } catch {
      /* fall through */
    }
  }
  return memory.get(key) === '1';
}

function writeFlag(key: string, value: boolean, storage: StorageLike | null): void {
  memory.set(key, value ? '1' : '0');
  if (!storage) return;
  try {
    storage.setItem(key, value ? '1' : '0');
  } catch {
    /* in-memory fallback already set */
  }
}

export function readMuted(storage: StorageLike | null = resolveStorage()): boolean {
  return readFlag(MUTE_KEY, storage);
}

export function writeMuted(value: boolean, storage: StorageLike | null = resolveStorage()): void {
  writeFlag(MUTE_KEY, value, storage);
}

export function readReducedMotionPref(storage: StorageLike | null = resolveStorage()): boolean {
  return readFlag(REDUCED_MOTION_KEY, storage);
}

export function writeReducedMotionPref(
  value: boolean,
  storage: StorageLike | null = resolveStorage()
): void {
  writeFlag(REDUCED_MOTION_KEY, value, storage);
}

/** Whether the OS has requested reduced motion. */
export function osPrefersReducedMotion(): boolean {
  try {
    return (
      typeof window !== 'undefined' &&
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches
    );
  } catch {
    return false;
  }
}

/** Pure: reduced motion is on if either the OS or the user's toggle asks for it. */
export function computeReducedMotion(osPref: boolean, userPref: boolean): boolean {
  return osPref || userPref;
}

/** Effective reduced-motion for the running client (OS ∪ stored user pref). */
export function prefersReducedMotion(storage: StorageLike | null = resolveStorage()): boolean {
  return computeReducedMotion(osPrefersReducedMotion(), readReducedMotionPref(storage));
}
