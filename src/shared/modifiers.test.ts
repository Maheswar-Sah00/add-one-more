import { describe, expect, it } from 'vitest';
import {
  DEFAULT_MODIFIER,
  MODIFIERS,
  MODIFIER_IDS,
  getModifier,
  modifierPhysics,
  pickDailyModifier,
} from './modifiers';

describe('daily modifier registry', () => {
  it('defines at least the four required modifiers', () => {
    for (const id of ['normal', 'low-gravity', 'heavy', 'slippery']) {
      expect(MODIFIERS[id]).toBeDefined();
      expect(MODIFIERS[id]?.label.length).toBeGreaterThan(0);
      expect(MODIFIERS[id]?.description.length).toBeGreaterThan(0);
    }
    expect(MODIFIER_IDS).toContain('low-gravity');
  });

  it('maps required modifiers to the intended physics', () => {
    expect(MODIFIERS['low-gravity']?.gravityScale).toBeLessThan(1); // falls gently
    expect(MODIFIERS.heavy?.densityScale).toBeGreaterThan(1); // denser
    expect(MODIFIERS.slippery?.frictionScale).toBeLessThan(1); // slick
    expect(MODIFIERS.normal?.gravityScale).toBe(1);
  });

  it('modifiers never randomize the SCORE (score effect is neutral placeholder)', () => {
    for (const id of MODIFIER_IDS) {
      expect(MODIFIERS[id]?.scoreFlatBonus).toBe(0);
      expect(MODIFIERS[id]?.scoreMultiplier).toBe(1);
    }
  });

  it('falls back to Normal for an unknown id', () => {
    expect(getModifier('nope')).toBe(DEFAULT_MODIFIER);
    expect(getModifier('nope').id).toBe('normal');
  });

  it('exposes physics multipliers consistently', () => {
    expect(modifierPhysics('heavy')).toEqual({
      gravityScale: 1,
      densityScale: MODIFIERS.heavy?.densityScale,
      frictionScale: 1,
    });
  });
});

describe('server-side daily selection is deterministic (same for all players)', () => {
  it('returns the same modifier for a given day key, every time', () => {
    const a = pickDailyModifier('2026-07-15');
    const b = pickDailyModifier('2026-07-15');
    const c = pickDailyModifier('2026-07-15');
    expect(a.id).toBe(b.id);
    expect(b.id).toBe(c.id);
  });

  it('always returns a real, known modifier', () => {
    for (const day of ['2026-01-01', '2026-06-15', '2026-12-31', '2027-02-28']) {
      expect(MODIFIER_IDS).toContain(pickDailyModifier(day).id);
    }
  });

  it('exercises the variety over a month (not stuck on one modifier)', () => {
    const seen = new Set<string>();
    for (let d = 1; d <= 31; d++) {
      const day = `2026-05-${String(d).padStart(2, '0')}`;
      seen.add(pickDailyModifier(day).id);
    }
    // Over a month we expect Normal plus at least one variant to appear.
    expect(seen.has('normal')).toBe(true);
    expect(seen.size).toBeGreaterThan(1);
  });
});
