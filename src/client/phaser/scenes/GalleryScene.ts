import Phaser from 'phaser';
import { OBJECT_LIBRARY, validateCatalogue, type GameObjectDef } from '../../../shared/objects';
import { createObject } from '../bodyFactory';
import { GalleryController, type GalleryCommands } from '../gallery';

type Cell = { def: GameObjectDef; body: MatterJS.BodyType; view: Phaser.GameObjects.Container };

const COLS = 3;
const CELL_W = 160;
const CELL_H = 168;
const GRID_TOP = 150;
const TIER_COLOR: Record<string, string> = {
  safe: '#6ee7b7',
  risky: '#fcd34d',
  absurd: '#fca5a5',
};

/**
 * Object gallery: renders every catalogue entry (static, gravity off) in a
 * labelled grid so all shapes/compound alignment can be eyeballed. Tapping an
 * object drops it (enables gravity) onto a floor to test its physics. Reset
 * rebuilds the grid.
 */
export class GalleryScene extends Phaser.Scene implements GalleryCommands {
  private readonly controller: GalleryController;
  private cells: Cell[] = [];
  private labels: Phaser.GameObjects.Text[] = [];

  constructor(controller: GalleryController) {
    super('gallery');
    this.controller = controller;
  }

  create(): void {
    const rows = Math.ceil(OBJECT_LIBRARY.length / COLS);
    const worldW = COLS * CELL_W;
    const floorY = GRID_TOP + rows * CELL_H + 40;

    this.matter.world.setGravity(0, 1);
    this.add.graphics().setDepth(-10).fillStyle(0x181a20, 1).fillRect(0, 0, worldW, floorY + 200);

    // Floor spanning the grid.
    this.matter.add.rectangle(worldW / 2, floorY, worldW, 40, { isStatic: true, friction: 1 });
    this.add
      .graphics()
      .setDepth(-5)
      .fillStyle(0x2a2d38, 1)
      .fillRect(0, floorY - 20, worldW, 40);

    this.buildGrid();

    // Tap an object to drop it.
    this.input.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
      const wp = this.cameras.main.getWorldPoint(pointer.x, pointer.y);
      for (const cell of this.cells) {
        const b = cell.body.bounds;
        if (wp.x >= b.min.x && wp.x <= b.max.x && wp.y >= b.min.y && wp.y <= b.max.y) {
          if (cell.body.isStatic) this.matter.body.setStatic(cell.body, false);
          break;
        }
      }
    });

    // Frame the whole grid.
    const zoom = Math.min(this.scale.width / worldW, this.scale.height / (floorY + 120));
    this.cameras.main.setZoom(zoom);
    this.cameras.main.centerOn(worldW / 2, (GRID_TOP + floorY) / 2 - 40);
    this.scale.on(Phaser.Scale.Events.RESIZE, () => {
      const z = Math.min(this.scale.width / worldW, this.scale.height / (floorY + 120));
      this.cameras.main.setZoom(z);
      this.cameras.main.centerOn(worldW / 2, (GRID_TOP + floorY) / 2 - 40);
    });

    this.controller.registerScene(this);
    this.controller.emitValidation(validateCatalogue());
  }

  private buildGrid(): void {
    OBJECT_LIBRARY.forEach((def, i) => {
      const col = i % COLS;
      const row = Math.floor(i / COLS);
      const x = col * CELL_W + CELL_W / 2;
      const y = GRID_TOP + row * CELL_H + CELL_H / 2 - 20;

      const inst = createObject(this, def, x, y, 0, true);
      this.cells.push({ def, body: inst.body, view: inst.view });

      this.labels.push(
        this.add
          .text(x, y + CELL_H / 2 - 30, `${def.name}\n${def.difficulty} · ${def.baseScore}`, {
            color: TIER_COLOR[def.difficulty] ?? '#e5e7eb',
            fontSize: '15px',
            align: 'center',
            fontFamily: 'monospace',
          })
          .setOrigin(0.5, 0)
          .setDepth(5)
      );
    });
  }

  override update(): void {
    for (const cell of this.cells) {
      cell.view.setPosition(cell.body.position.x, cell.body.position.y);
      cell.view.setRotation(cell.body.angle);
    }
  }

  reset(): void {
    for (const cell of this.cells) {
      this.matter.world.remove(cell.body);
      cell.view.destroy();
    }
    for (const label of this.labels) label.destroy();
    this.cells = [];
    this.labels = [];
    this.buildGrid();
  }
}
