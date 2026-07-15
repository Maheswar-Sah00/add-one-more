import Phaser from 'phaser';
import { GalleryController } from './gallery';
import { GalleryScene } from './scenes/GalleryScene';

/** TASK 4 — boot the standalone object-gallery game. */
export function createGalleryGame(
  parent: HTMLElement,
  controller: GalleryController
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
      matter: { gravity: { x: 0, y: 1 }, enableSleeping: true },
    },
    scene: [new GalleryScene(controller)],
  });
}
