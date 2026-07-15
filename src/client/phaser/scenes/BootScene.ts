import Phaser from 'phaser';

/**
 * BootScene: the entry scene. Kept intentionally tiny — it exists so global
 * boot concerns (input, scale reference) have a home and to hand off to the
 * loading scene. No assets load here.
 */
export class BootScene extends Phaser.Scene {
  constructor() {
    super('boot');
  }

  create(): void {
    // Matter world config comes from the game config; nothing to do but proceed.
    this.scene.start('preload');
  }
}
