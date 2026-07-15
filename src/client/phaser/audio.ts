/**
 * Lightweight synthesized game audio (Task 18). Every sound is generated live
 * with the Web Audio API — there are **zero audio asset bytes** to download or
 * decode, which keeps the bundle small and mobile-friendly ("compress assets").
 *
 * Rules honoured here:
 * - No autoplay: the AudioContext is created only inside `initAudio()`, which the
 *   UI calls from a real user gesture. Before that, every play call is a no-op.
 * - Global mute.
 * - A hard cap on simultaneous voices, so a chaotic collapse can never stack into
 *   a wall of sound.
 *
 * The parameter math (`impactVoiceParams`) is pure and unit-tested; the engine
 * itself is guarded so it is inert in a non-browser/test environment.
 */

export type Material = 'wood' | 'metal' | 'plastic' | 'glass' | 'fabric' | 'rubber' | 'ceramic';

type Timbre = { base: number; type: OscillatorType; ring: number };

/** Per-material timbre: base pitch, waveform, and how "ringy" (sustained) it is. */
export const MATERIAL_TIMBRE: Record<Material, Timbre> = {
  wood: { base: 190, type: 'triangle', ring: 0.12 },
  metal: { base: 620, type: 'square', ring: 0.5 },
  plastic: { base: 300, type: 'triangle', ring: 0.14 },
  glass: { base: 900, type: 'sine', ring: 0.3 },
  fabric: { base: 130, type: 'sine', ring: 0.06 },
  rubber: { base: 220, type: 'sine', ring: 0.2 },
  ceramic: { base: 520, type: 'triangle', ring: 0.22 },
};

const DEFAULT_TIMBRE: Timbre = MATERIAL_TIMBRE.wood;

export type VoiceParams = {
  frequency: number;
  type: OscillatorType;
  /** Peak gain in [0, MAX_VOICE_GAIN]. */
  gain: number;
  durationMs: number;
};

export const MAX_VOICE_GAIN = 0.28;
export const MAX_VOICES = 8;

/**
 * Map an impact (unbounded positive `intensity`) + material to a single voice.
 * Louder/higher with harder hits, but gain is clamped so nothing is ever harsh.
 * Pure and deterministic — this is the tested core.
 */
export function impactVoiceParams(intensity: number, material?: string): VoiceParams {
  const t = (material && MATERIAL_TIMBRE[material as Material]) || DEFAULT_TIMBRE;
  const norm = Math.max(0, Math.min(1, intensity / 24)); // ~24 px/step = a hard hit
  return {
    frequency: t.base * (1 + norm * 0.35),
    type: t.type,
    gain: Math.min(MAX_VOICE_GAIN, 0.05 + norm * 0.22),
    durationMs: Math.round(70 + t.ring * 240 + norm * 60),
  };
}

// ---- engine ----------------------------------------------------------------

let muted = false;
let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let activeVoices = 0;

export function setAudioMuted(value: boolean): void {
  muted = value;
  if (master && ctx) master.gain.setTargetAtTime(value ? 0 : 1, ctx.currentTime, 0.02);
}

export function isAudioMuted(): boolean {
  return muted;
}

/** Whether another voice may start without exceeding the simultaneous-sound cap. */
export function canPlayVoice(active: number, max: number = MAX_VOICES): boolean {
  return active < max;
}

/**
 * Create/resume the AudioContext. MUST be called from a user gesture (click/tap).
 * Safe to call repeatedly. No sound has been produced before this point.
 */
export function initAudio(): void {
  if (typeof window === 'undefined') return;
  try {
    const Ctor: typeof AudioContext | undefined =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return;
    if (!ctx) {
      ctx = new Ctor();
      master = ctx.createGain();
      master.gain.value = muted ? 0 : 1;
      master.connect(ctx.destination);
    }
    if (ctx.state === 'suspended') void ctx.resume();
  } catch {
    ctx = null;
  }
}

/** Low-level: play one enveloped oscillator voice, respecting the voice cap. */
function voice(params: VoiceParams, delayMs = 0): void {
  if (muted || !ctx || !master) return;
  if (!canPlayVoice(activeVoices)) return;
  try {
    const now = ctx.currentTime + delayMs / 1000;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = params.type;
    osc.frequency.setValueAtTime(params.frequency, now);
    // Slight downward pitch glide reads as an "impact" rather than a beep.
    osc.frequency.exponentialRampToValueAtTime(
      Math.max(40, params.frequency * 0.7),
      now + params.durationMs / 1000
    );
    g.gain.setValueAtTime(0.0001, now);
    g.gain.exponentialRampToValueAtTime(params.gain, now + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, now + params.durationMs / 1000);
    osc.connect(g);
    g.connect(master);
    activeVoices += 1;
    osc.onended = () => {
      activeVoices = Math.max(0, activeVoices - 1);
      try {
        g.disconnect();
      } catch {
        /* already gone */
      }
    };
    osc.start(now);
    osc.stop(now + params.durationMs / 1000 + 0.02);
  } catch {
    /* audio failures must never break the game */
  }
}

/** A collision impact (also used per-collision, velocity-gated by the scene). */
export function playImpact(intensity: number, material?: string): void {
  if (intensity <= 0) return;
  voice(impactVoiceParams(intensity, material));
}

/** A short, pleasant two-note "it stays!" flourish. */
export function playSuccess(): void {
  voice({ frequency: 523, type: 'sine', gain: 0.16, durationMs: 120 });
  voice({ frequency: 784, type: 'sine', gain: 0.16, durationMs: 160 }, 90);
}

/** Layered collapse: a low rumble + a mid crack + the material impact on top. */
export function playCollapse(intensity: number, material?: string): void {
  voice({ frequency: 90, type: 'sine', gain: 0.24, durationMs: 420 });
  voice({ frequency: 160, type: 'square', gain: 0.14, durationMs: 220 }, 30);
  playImpact(intensity, material);
}

/** Three ascending notes for a community milestone. */
export function playMilestone(): void {
  const notes = [523, 659, 784];
  notes.forEach((f, i) => voice({ frequency: f, type: 'triangle', gain: 0.16, durationMs: 180 }, i * 110));
}

/** Test seam: reset engine state between cases. */
export function __resetAudioForTest(): void {
  muted = false;
  ctx = null;
  master = null;
  activeVoices = 0;
}
