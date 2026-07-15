import Phaser from 'phaser';
import { WORLD } from '../../shared/config';
import { SandboxController } from './sandbox';
import { SandboxScene } from './scenes/SandboxScene';

/** TASK 3 — boot a standalone local physics game (no Boot/Preload, no assets). */
export function createSandboxGame(
  parent: HTMLElement,
  controller: SandboxController
): Phaser.Game {
  return new Phaser.Game({
    type: Phaser.AUTO,
    parent,
    backgroundColor: '#181a20',
    scale: {
      mode: Phaser.Scale.RESIZE,
      autoCenter: Phaser.Scale.CENTER_BOTH,
      width: parent.clientWidth || 480,
      height: parent.clientHeight || 800,
    },
    physics: {
      default: 'matter',
      matter: {
        gravity: { x: 0, y: WORLD.gravityY },
        enableSleeping: true,
      },
    },
    scene: [new SandboxScene(controller)],
  });
}
