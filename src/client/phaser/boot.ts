import Phaser from 'phaser';
import { WORLD } from '../../shared/config';
import { GameBridge } from './bridge';
import { DebugModel } from './debug';
import { BootScene } from './scenes/BootScene';
import { PreloadScene } from './scenes/PreloadScene';
import { TowerScene } from './scenes/TowerScene';
import { UIScene } from './scenes/UIScene';

/**
 * Create the Phaser game inside `parent` and wire it to the bridge.
 *
 * Scene flow: BootScene (auto-starts, first in array) → PreloadScene (loading +
 * assets) → starts TowerScene and launches UIScene in parallel. TowerScene and
 * UIScene are instantiated here so they receive their dependencies (bridge,
 * shared debug model) without untyped cross-scene lookups.
 */
export function createGame(parent: HTMLElement, bridge: GameBridge): Phaser.Game {
  const debug = new DebugModel();
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
    scene: [
      new BootScene(),
      new PreloadScene(debug),
      new TowerScene(bridge, debug),
      new UIScene(debug),
    ],
  });
}
