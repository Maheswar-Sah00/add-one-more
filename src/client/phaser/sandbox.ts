/**
 * TASK 3 — local physics sandbox controller. Thin conduit between the React
 * control bar and SandboxScene, mirroring the GameBridge pattern. No server,
 * no persistence, no scoring/attempts.
 */

/** The five test objects, in spawn-cycle order (all exist in OBJECT_LIBRARY). */
export const SANDBOX_OBJECT_IDS = ['box', 'book', 'brick', 'chair', 'fridge'] as const;

export type SandboxPhase = 'empty' | 'placing' | 'dropped';

export type SandboxCommands = {
  spawnNext(): void;
  rotate(dir: -1 | 1): void;
  drop(): void;
  reset(): void;
};

export class SandboxController {
  private scene: SandboxCommands | null = null;

  onReady: (() => void) | null = null;
  onPhase: ((phase: SandboxPhase) => void) | null = null;
  /** Fires when the next object to spawn changes (name + count placed). */
  onObject: ((nextName: string) => void) | null = null;

  registerScene(scene: SandboxCommands): void {
    this.scene = scene;
    if (this.onReady) this.onReady();
  }

  emitPhase(phase: SandboxPhase): void {
    if (this.onPhase) this.onPhase(phase);
  }

  emitObject(nextName: string): void {
    if (this.onObject) this.onObject(nextName);
  }

  spawnNext(): void {
    this.scene?.spawnNext();
  }
  rotate(dir: -1 | 1): void {
    this.scene?.rotate(dir);
  }
  drop(): void {
    this.scene?.drop();
  }
  reset(): void {
    this.scene?.reset();
  }
}
