/**
 * Cast-free helpers for reading untrusted JSON and Redis hash strings.
 * The project forbids `as` casts, so parsing narrows via type guards instead.
 */

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function asString(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

export function asNumber(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

export function asBool(value: unknown): boolean {
  return value === true;
}

export function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === 'string');
}

/** Parse a number stored as a Redis hash string. */
export function numStr(value: string | undefined, fallback = 0): number {
  if (value === undefined || value === '') return fallback;
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

/** Parse a boolean stored as a Redis hash string ('1' / 'true'). */
export function boolStr(value: string | undefined): boolean {
  return value === '1' || value === 'true';
}

/** JSON.parse that never throws — returns undefined on malformed input. */
export function safeParse(raw: string | undefined): unknown {
  if (raw === undefined) return undefined;
  try {
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
}
