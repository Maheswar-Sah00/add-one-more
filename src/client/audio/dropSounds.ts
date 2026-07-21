/**
 * Object-drop sound system for "One More Thing".
 *
 * ONE unique, material-specific sound per catalogue object, played EXACTLY ONCE
 * when the local player commits a drop (see TowerScene.onDrop). It is deliberately
 * NOT wired to selection, dragging, hovering, rendering, tower loading, server
 * sync, or physics collision callbacks — only to the single drop-commit event.
 *
 * The .wav assets are procedurally synthesised (scripts/generate-drop-sounds.py) —
 * 100% original / CC0, bundled locally via Vite (no external URL at runtime).
 * Playback goes through Phaser's WebAudio sound manager, which handles the mobile
 * autoplay-unlock (on the first user gesture) and low-latency mixing for us.
 */
import type Phaser from 'phaser';

// Bundle every drop .wav → a hashed, self-hosted URL (same pattern as objectArt).
const FILES = import.meta.glob('../assets/audio/object-drops/*.wav', {
  eager: true,
  query: '?url',
  import: 'default',
}) as Record<string, string>;

function fileUrl(basename: string): string | undefined {
  const path = Object.keys(FILES).find((k) => k.endsWith(`/${basename}.wav`));
  return path ? FILES[path] : undefined;
}

// UI result cues (success / collapse) — same bundling, kept separate from objects.
const UI_FILES = import.meta.glob('../assets/audio/ui/*.wav', {
  eager: true,
  query: '?url',
  import: 'default',
}) as Record<string, string>;

function uiUrl(basename: string): string | undefined {
  const path = Object.keys(UI_FILES).find((k) => k.endsWith(`/${basename}.wav`));
  return path ? UI_FILES[path] : undefined;
}

/** Result-cue sounds: played once when a drop resolves (IT'S IN / NOT THIS TIME). */
export const UI_SOUNDS: Readonly<Record<'success' | 'collapse', { file: string; gain: number }>> = {
  success: { file: 'success', gain: 0.9 },
  collapse: { file: 'collapse', gain: 0.85 },
};

/**
 * Central object → sound mapping. Keys are the catalogue object ids
 * (src/shared/objects.ts); `gain` is the per-object level (0.75–1.0) layered on
 * top of the master SFX volume. This is the single source of truth — file paths
 * live nowhere else.
 */
export const OBJECT_DROP_SOUNDS: Readonly<Record<string, { file: string; gain: number }>> = {
  box: { file: 'cardboard-box-drop', gain: 0.85 },
  book: { file: 'hardback-book-drop', gain: 0.9 },
  brick: { file: 'clay-brick-drop', gain: 0.95 },
  cushion: { file: 'sofa-cushion-drop', gain: 0.8 },
  tray: { file: 'cafeteria-tray-drop', gain: 0.85 },
  chair: { file: 'wooden-chair-drop', gain: 0.9 },
  lamp: { file: 'desk-lamp-drop', gain: 0.85 },
  tyre: { file: 'rubber-tyre-drop', gain: 0.9 },
  television: { file: 'old-tv-drop', gain: 0.9 },
  plant: { file: 'potted-plant-drop', gain: 0.85 },
  fridge: { file: 'refrigerator-drop', gain: 1.0 },
  sofa: { file: 'two-seat-sofa-drop', gain: 0.95 },
  bathtub: { file: 'cast-iron-bathtub-drop', gain: 1.0 },
  canoe: { file: 'fibreglass-canoe-drop', gain: 0.85 },
  duck: { file: 'giant-rubber-duck-drop', gain: 0.85 },
};

// Two independent category levels so object impacts and result cues are balanced
// separately (the melodic cues carry more than a short thud, so they sit lower).
const MASTER_DROP = 0.65; // object drop-impact sounds
const MASTER_UI = 0.5; // success / collapse result cues
const LS_MUTE = 'omt-sfx-muted';
const LS_VOLUME = 'omt-sfx-volume';

const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));
const cacheKey = (id: string): string => `drop-${id}`;

function readMuted(): boolean {
  try {
    return localStorage.getItem(LS_MUTE) === '1';
  } catch {
    return false;
  }
}
function readVolume(): number {
  try {
    const v = parseFloat(localStorage.getItem(LS_VOLUME) ?? '');
    return Number.isFinite(v) ? clamp(v, 0, 1) : 1;
  } catch {
    return 1;
  }
}

/**
 * Owns the drop-sound lifecycle for one Phaser scene: queueing the files into the
 * scene loader, and playing exactly one clip per drop. All playback is wrapped in
 * try/catch so audio can never interrupt gameplay.
 */
export class DropAudio {
  private scene: Phaser.Scene;
  private muted: boolean = readMuted();
  private volume: number = readVolume(); // user SFX volume 0..1

  constructor(scene: Phaser.Scene) {
    this.scene = scene;
  }

  /** Queue the drop sounds into the scene loader. Call BEFORE scene.load.start(). Never plays. */
  preload(): void {
    for (const [id, def] of Object.entries(OBJECT_DROP_SOUNDS)) {
      const key = cacheKey(id);
      const url = fileUrl(def.file);
      if (!url || this.scene.cache.audio.exists(key)) continue;
      try {
        this.scene.load.audio(key, url);
      } catch {
        /* a bad url must not abort the whole load */
      }
    }
    for (const [name, def] of Object.entries(UI_SOUNDS)) {
      const key = `ui-${name}`;
      const url = uiUrl(def.file);
      if (!url || this.scene.cache.audio.exists(key)) continue;
      try {
        this.scene.load.audio(key, url);
      } catch {
        /* ignore */
      }
    }
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    try {
      localStorage.setItem(LS_MUTE, muted ? '1' : '0');
    } catch {
      /* ignore */
    }
  }

  setVolume(v: number): void {
    this.volume = clamp(v, 0, 1);
    try {
      localStorage.setItem(LS_VOLUME, String(this.volume));
    } catch {
      /* ignore */
    }
  }

  isMuted(): boolean {
    return this.muted;
  }

  /**
   * Play the drop sound for `objectId` — exactly one instance for this call.
   * `strength` (release energy, 0..~1.5) gives ONLY subtle volume/pitch variation;
   * it never changes which sound is chosen. Fails silently on missing files,
   * mute, zero volume, or any error.
   */
  play(objectId: string, strength = 1): void {
    try {
      if (this.muted || this.volume <= 0) return;
      const def = OBJECT_DROP_SOUNDS[objectId];
      if (!def) return;
      const key = cacheKey(objectId);
      if (!this.scene.cache.audio.exists(key)) return; // file unavailable → silent

      const s = clamp(strength, 0, 1.6);
      const volume = clamp(MASTER_DROP * def.gain * this.volume * (0.9 + 0.12 * (s - 1)), 0, 1);
      // subtle pitch: stronger → marginally lower; plus a touch of humanising jitter
      const rate = clamp(1 - 0.04 * (s - 1) + (Math.random() - 0.5) * 0.05, 0.9, 1.08);

      // A fresh play each time → correctly restarts if another valid drop happens later.
      this.scene.sound.play(key, { volume, rate });
    } catch {
      /* never let audio break the game */
    }
  }

  /**
   * Play a result cue — 'success' (IT'S IN) or 'collapse' (NOT THIS TIME) — once.
   * Called when a drop RESOLVES (settled / toppled), not per collision. Fails silently.
   */
  playCue(name: 'success' | 'collapse'): void {
    try {
      if (this.muted || this.volume <= 0) return;
      const def = UI_SOUNDS[name];
      const key = `ui-${name}`;
      if (!def || !this.scene.cache.audio.exists(key)) return;
      const volume = clamp(MASTER_UI * def.gain * this.volume, 0, 1);
      this.scene.sound.play(key, { volume });
    } catch {
      /* never let audio break the game */
    }
  }
}
