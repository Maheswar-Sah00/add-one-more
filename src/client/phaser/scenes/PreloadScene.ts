import Phaser from 'phaser';
import { DebugModel } from '../debug';

/**
 * PreloadScene: shows a loading state and loads assets. The game uses temporary
 * geometric shapes (drawn in code) as its fallback, so a failed asset load is
 * non-fatal — it flips `assetsOk` and the game keeps rendering with primitives.
 */
export class PreloadScene extends Phaser.Scene {
  private readonly debug: DebugModel;

  constructor(debug: DebugModel) {
    super('preload');
    this.debug = debug;
  }

  preload(): void {
    const width = this.scale.width || 480;
    const height = this.scale.height || 800;
    const barW = Math.min(280, width * 0.6);
    const x = width / 2 - barW / 2;
    const y = height / 2;

    const box = this.add.graphics();
    box.fillStyle(0x2a2d38, 1);
    box.fillRoundedRect(x - 4, y - 4, barW + 8, 20, 6);
    this.add
      .text(width / 2, y - 26, 'Loading…', { color: '#e5e7eb', fontSize: '14px' })
      .setOrigin(0.5);

    const bar = this.add.graphics();
    this.load.on('progress', (p: number) => {
      bar.clear();
      bar.fillStyle(0xf97316, 1);
      bar.fillRoundedRect(x, y, barW * p, 12, 4);
    });

    // Any asset that fails to load drops us to geometric fallback rather than
    // breaking the shell.
    this.load.on('loaderror', () => {
      this.debug.assetsOk = false;
    });

    // Placeholder asset to exercise the loading pipeline (ships with template).
    this.load.image('snoo', '/snoo.png');
  }

  create(): void {
    this.scene.start('tower');
    this.scene.launch('ui'); // parallel overlay scene
  }
}
