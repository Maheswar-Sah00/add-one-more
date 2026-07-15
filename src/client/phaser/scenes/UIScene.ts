import Phaser from 'phaser';
import { DebugModel, SHOW_DEBUG } from '../debug';

/**
 * UIScene: a transparent scene layered above TowerScene for CANVAS-space overlay.
 *
 * Architecture note: the game's real HUD (buttons, screens) lives in React/DOM
 * over the canvas — that's faster to build responsively and accessibly than
 * Phaser text. So UIScene's job is narrow: dev-only debug readout + the
 * asset-fallback banner. Keeping it a separate scene means it survives
 * TowerScene restarts and renders on its own unzoomed camera.
 */
export class UIScene extends Phaser.Scene {
  private readonly debug: DebugModel;
  private readout: Phaser.GameObjects.Text | null = null;
  private banner: Phaser.GameObjects.Text | null = null;

  constructor(debug: DebugModel) {
    super('ui');
    this.debug = debug;
  }

  create(): void {
    if (SHOW_DEBUG) {
      this.readout = this.add
        .text(8, 100, '', {
          color: '#8b93a7',
          fontFamily: 'monospace',
          fontSize: '11px',
        })
        .setScrollFactor(0)
        .setDepth(1000);
    }
    this.scale.on(Phaser.Scale.Events.RESIZE, () => this.reposition());
  }

  override update(): void {
    if (this.readout) {
      const stability = this.debug.stability ? ` | ${this.debug.stability}` : '';
      this.readout.setText(
        `fps ${this.debug.fps} | view ${this.debug.viewW}x${this.debug.viewH} | ` +
          `zoom ${this.debug.zoom.toFixed(2)} | bodies ${this.debug.bodyCount} | ${this.debug.phase}${stability}`
      );
    }
    if (!this.debug.assetsOk && !this.banner) {
      this.banner = this.add
        .text(this.scale.width / 2, 8, 'assets: using geometric fallback', {
          color: '#fca5a5',
          fontSize: '11px',
          backgroundColor: '#00000066',
        })
        .setOrigin(0.5, 0)
        .setScrollFactor(0)
        .setDepth(1000);
    }
  }

  private reposition(): void {
    this.readout?.setPosition(8, 100);
    this.banner?.setPosition(this.scale.width / 2, 8);
  }
}
