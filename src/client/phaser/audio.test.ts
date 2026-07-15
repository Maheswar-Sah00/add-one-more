import { describe, expect, it } from 'vitest';
import {
  MAX_VOICES,
  MAX_VOICE_GAIN,
  MATERIAL_TIMBRE,
  canPlayVoice,
  impactVoiceParams,
} from './audio';

describe('impact voice params — pure + deterministic', () => {
  it('is deterministic for the same input', () => {
    expect(impactVoiceParams(10, 'wood')).toEqual(impactVoiceParams(10, 'wood'));
  });

  it('gets louder and higher with harder hits, but caps the gain', () => {
    const soft = impactVoiceParams(2, 'wood');
    const hard = impactVoiceParams(40, 'wood');
    expect(hard.gain).toBeGreaterThan(soft.gain);
    expect(hard.frequency).toBeGreaterThan(soft.frequency);
    // Never harsh, regardless of how extreme the impact.
    expect(impactVoiceParams(9999, 'metal').gain).toBeLessThanOrEqual(MAX_VOICE_GAIN);
  });

  it('uses the per-material timbre (metal is brighter than fabric)', () => {
    expect(impactVoiceParams(10, 'metal').frequency).toBeGreaterThan(
      impactVoiceParams(10, 'fabric').frequency
    );
    expect(impactVoiceParams(10, 'metal').type).toBe(MATERIAL_TIMBRE.metal.type);
  });

  it('falls back to a default timbre for an unknown material', () => {
    const p = impactVoiceParams(10, 'unobtanium');
    expect(p.frequency).toBeGreaterThan(0);
    expect(['sine', 'square', 'triangle', 'sawtooth']).toContain(p.type);
  });
});

describe('simultaneous-sound cap', () => {
  it('permits voices below the cap and blocks at/above it', () => {
    expect(canPlayVoice(0)).toBe(true);
    expect(canPlayVoice(MAX_VOICES - 1)).toBe(true);
    expect(canPlayVoice(MAX_VOICES)).toBe(false);
    expect(canPlayVoice(MAX_VOICES + 5)).toBe(false);
  });
});
