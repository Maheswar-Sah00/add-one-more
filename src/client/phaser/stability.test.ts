import { describe, expect, it } from 'vitest';
import {
  DEFAULT_STABILITY_CONFIG,
  allBodiesStable,
  beginEvaluation,
  createStabilityState,
  isBodyStable,
  stepStability,
  type BodyMotion,
  type StabilityFrame,
  type StabilityState,
} from './stability';

const cfg = DEFAULT_STABILITY_CONFIG;

function body(over: Partial<BodyMotion> = {}): BodyMotion {
  return { id: 'b', isStatic: false, isSleeping: false, vx: 0, vy: 0, angularVelocity: 0, ...over };
}

/** Drive the evaluator from t=0 to t=endMs at fixed 100ms steps, producing a
 *  frame per step via `frameAt`. Begins evaluation (contact) at t=0. */
function run(endMs: number, frameAt: (t: number) => Omit<StabilityFrame, 'now'>): StabilityState {
  let s = createStabilityState();
  s = beginEvaluation(s, 0);
  for (let t = 0; t <= endMs; t += 100) {
    s = stepStability(s, { ...frameAt(t), now: t }, cfg);
    if (s.status !== 'pending') break;
  }
  return s;
}

describe('per-body helpers', () => {
  it('treats static and sleeping bodies as stable', () => {
    expect(isBodyStable(body({ isStatic: true, vx: 99 }), cfg)).toBe(true);
    expect(isBodyStable(body({ isSleeping: true, angularVelocity: 99 }), cfg)).toBe(true);
  });

  it('flags fast linear or angular motion as unstable', () => {
    expect(isBodyStable(body({ vx: 5 }), cfg)).toBe(false);
    expect(isBodyStable(body({ angularVelocity: 1 }), cfg)).toBe(false);
    expect(isBodyStable(body(), cfg)).toBe(true);
  });

  it('requires every body to be stable', () => {
    expect(allBodiesStable([body(), body({ id: 'c', vx: 9 })], cfg)).toBe(false);
    expect(allBodiesStable([body(), body({ id: 'c' })], cfg)).toBe(true);
  });
});

describe('stepStability scenarios', () => {
  it('waits for contact before evaluating (touch alone is not success)', () => {
    let s = createStabilityState();
    // Still bodies but no beginEvaluation() => never locks.
    for (let t = 0; t <= 5000; t += 100) {
      s = stepStability(s, { bodies: [body()], hardFail: false, now: t }, cfg);
    }
    expect(s.status).toBe('pending');
    expect(s.startedAt).toBeNull();
  });

  it('stable flat placement -> stable', () => {
    const s = run(2500, () => ({ bodies: [body(), body({ id: 'base', isStatic: true })], hardFail: false }));
    expect(s.status).toBe('stable');
    expect(s.label).toBe('locked');
  });

  it('stable rotated placement -> stable (rotation is position, not motion)', () => {
    // A settled but rotated object still reports zero velocity.
    const s = run(2500, () => ({ bodies: [body({ id: 'tilted' })], hardFail: false }));
    expect(s.status).toBe('stable');
  });

  it('slowly rocking object -> timed-out (never holds the window)', () => {
    const s = run(6100, (t) => ({
      bodies: [body({ angularVelocity: (t / 100) % 2 === 0 ? 0 : 0.2 })],
      hardFail: false,
    }));
    expect(s.status).toBe('timed-out');
  });

  it('continuous sliding -> timed-out', () => {
    const s = run(6100, () => ({ bodies: [body({ vx: 1.0 })], hardFail: false }));
    expect(s.status).toBe('timed-out');
  });

  it('object that falls after several seconds -> failed', () => {
    // Wobbling (never locks) then a hard fall at 3s.
    const s = run(3000, (t) => ({ bodies: [body({ vx: 0.6 })], hardFail: t >= 3000 }));
    expect(s.status).toBe('failed');
  });

  it('an existing tower object becoming unstable blocks success -> timed-out', () => {
    // New object is still, but an accepted body keeps moving.
    const s = run(6100, () => ({
      bodies: [body({ id: 'new' }), body({ id: 'old', vx: 0.6 })],
      hardFail: false,
    }));
    expect(s.status).toBe('timed-out');
  });

  it('very small harmless jitter -> stable', () => {
    const s = run(2500, () => ({
      bodies: [body({ vx: 0.05, vy: 0.03, angularVelocity: 0.01 })],
      hardFail: false,
    }));
    expect(s.status).toBe('stable');
  });

  it('does not lock before the required stable window elapses', () => {
    let s = createStabilityState();
    s = beginEvaluation(s, 0);
    s = stepStability(s, { bodies: [body()], hardFail: false, now: 500 }, cfg);
    expect(s.status).toBe('pending');
    expect(s.label).toBe('standing');
  });
});
