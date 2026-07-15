import type { SubmittedBody } from '../../shared/api';
import type { TowerState } from '../../shared/types';
import type { StabilityLabel } from './stability';

/** Scene phase surfaced to React so the HUD can show the right controls. */
export type ScenePhase = 'idle' | 'placing' | 'settling' | 'collapsing' | 'done';

/** Result of a resolved drop, handed back to React to commit or record failure. */
export type SettleResult = {
  stable: boolean;
  newBodyId: string;
  selectedObjectId: string;
  baseTowerVersion: number;
  bodies: SubmittedBody[];
  /** Humorous collapse line (null on success). */
  message: string | null;
};

/** Commands the scene implements; React calls them through the bridge. */
export type SceneCommands = {
  loadTower(tower: TowerState): void;
  beginPlacement(objectId: string, newBodyId: string, baseTowerVersion: number): void;
  rotate(dir: -1 | 1): void;
  drop(): void;
  cancelActive(): void;
  /** Identify the local player so the scene can mark their own bodies. */
  setLocalUser(userId: string | null): void;
  /** Highlight (or clear, with null) the inspected body. */
  highlightBody(bodyId: string | null): void;
};

/**
 * Thin, typed conduit between the React shell and the Phaser scene. React owns
 * UI + server calls; the scene owns physics. Neither imports the other.
 */
export class GameBridge {
  private scene: SceneCommands | null = null;
  private pendingReady = false;

  onReady: (() => void) | null = null;
  onSettle: ((result: SettleResult) => void) | null = null;
  onPhaseChange: ((phase: ScenePhase) => void) | null = null;
  onStabilityLabel: ((label: StabilityLabel) => void) | null = null;
  /** Fired when the player taps an accepted body (null = tapped empty space). */
  onInspect: ((bodyId: string | null) => void) | null = null;

  registerScene(scene: SceneCommands): void {
    this.scene = scene;
    if (this.onReady) this.onReady();
    else this.pendingReady = true;
  }

  /** Called by React once its onReady handler is attached. */
  flushReady(): void {
    if (this.pendingReady && this.onReady) {
      this.pendingReady = false;
      this.onReady();
    }
  }

  emitSettle(result: SettleResult): void {
    if (this.onSettle) this.onSettle(result);
  }

  emitPhase(phase: ScenePhase): void {
    if (this.onPhaseChange) this.onPhaseChange(phase);
  }

  emitStabilityLabel(label: StabilityLabel): void {
    if (this.onStabilityLabel) this.onStabilityLabel(label);
  }

  emitInspect(bodyId: string | null): void {
    if (this.onInspect) this.onInspect(bodyId);
  }

  loadTower(tower: TowerState): void {
    this.scene?.loadTower(tower);
  }

  beginPlacement(objectId: string, newBodyId: string, baseTowerVersion: number): void {
    this.scene?.beginPlacement(objectId, newBodyId, baseTowerVersion);
  }

  rotate(dir: -1 | 1): void {
    this.scene?.rotate(dir);
  }

  drop(): void {
    this.scene?.drop();
  }

  cancelActive(): void {
    this.scene?.cancelActive();
  }

  setLocalUser(userId: string | null): void {
    this.scene?.setLocalUser(userId);
  }

  highlightBody(bodyId: string | null): void {
    this.scene?.highlightBody(bodyId);
  }
}
