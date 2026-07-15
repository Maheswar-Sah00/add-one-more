/**
 * Small deterministic PRNG. Used server-side to issue object choices from a
 * daily seed plus attempt-specific entropy (§7). Kept in shared so it can be
 * unit-tested and reasoned about identically on both sides.
 */

/** FNV-1a string hash -> 32-bit unsigned seed. */
export function hashStringToSeed(input: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** mulberry32: fast, well-distributed 32-bit PRNG returning [0, 1). */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Deterministic PRNG seeded from an arbitrary string. */
export function seededRandom(seedInput: string): () => number {
  return mulberry32(hashStringToSeed(seedInput));
}

/** Pick one element deterministically. Returns undefined only for empty input. */
export function pickOne<T>(items: readonly T[], rand: () => number): T | undefined {
  if (items.length === 0) return undefined;
  const index = Math.floor(rand() * items.length) % items.length;
  return items[index];
}
