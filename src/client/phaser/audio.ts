/**
 * Collision-audio hooks (prepared, not yet wired to real samples). Centralised
 * so a later polish task can drop in per-material sounds without touching scene
 * logic. Respects a global mute flag and browser autoplay restrictions (no
 * sound is produced until real buffers + a user gesture exist).
 */
let muted = false;

export function setAudioMuted(value: boolean): void {
  muted = value;
}

export function isAudioMuted(): boolean {
  return muted;
}

/**
 * Impact hook. `intensity` is an unspecified positive magnitude (bigger = harder
 * hit); `material` maps to a future sound set. Currently a no-op placeholder.
 */
export function playImpact(intensity: number, material?: string): void {
  if (muted || intensity <= 0) return;
  void material;
  // TODO(polish): play a material-specific impact sample scaled by intensity.
}
