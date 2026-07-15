import Phaser from 'phaser';
import { WORLD } from '../../../shared/config';
import { getObjectDef, type GameObjectDef } from '../../../shared/objects';
import { createObject } from '../bodyFactory';
import { SHOW_DEBUG } from '../debug';
import {
  SANDBOX_OBJECT_IDS,
  type SandboxCommands,
  type SandboxController,
  type SandboxPhase,
} from '../sandbox';

type Entry = {
  def: GameObjectDef;
  body: MatterJS.BodyType;
  view: Phaser.GameObjects.Container;
};

const ROTATE_STEP = Phaser.Math.DEG_TO_RAD * 9;
const MAX_LINEAR_VELOCITY = 34;
const MAX_ANGULAR_VELOCITY = 0.9;
const IMPACT_SHAKE_SPEED = 12;

/**
 * Local, resettable physics playground. Spawn → position → rotate → drop, with
 * dropped objects remaining physical. Everything here is client-only.
 */
export class SandboxScene extends Phaser.Scene implements SandboxCommands {
  private readonly controller: SandboxController;

  private placed: Entry[] = [];
  private active: Entry | null = null;
  private phase: SandboxPhase = 'empty';
  private index = 0;
  private debugText: Phaser.GameObjects.Text | null = null;

  constructor(controller: SandboxController) {
    super('sandbox');
    this.controller = controller;
  }

  create(): void {
    this.matter.world.setGravity(0, WORLD.gravityY);
    this.drawBackdrop();
    this.drawTowerArea();
    this.buildPlatform();
    this.applyZoom();

    this.scale.on(Phaser.Scale.Events.RESIZE, () => this.applyZoom());

    // Collision handling: nudge the camera on hard impacts (heavy objects).
    this.matter.world.on(
      'collisionstart',
      (event: Phaser.Physics.Matter.Events.CollisionStartEvent) => {
        let impact = 0;
        for (const pair of event.pairs) {
          impact = Math.max(
            impact,
            Math.hypot(pair.bodyA.velocity.x, pair.bodyA.velocity.y),
            Math.hypot(pair.bodyB.velocity.x, pair.bodyB.velocity.y)
          );
        }
        if (impact > IMPACT_SHAKE_SPEED) {
          this.cameras.main.shake(120, Math.min(0.012, impact * 0.0005));
        }
      }
    );

    // Pointer drag: mouse + touch, horizontal only, before release.
    this.input.on('pointermove', (pointer: Phaser.Input.Pointer) => {
      if (this.phase !== 'placing' || !this.active || !pointer.isDown) return;
      const world = this.cameras.main.getWorldPoint(pointer.x, pointer.y);
      const halfW = this.active.def.shape.width / 2;
      const x = Phaser.Math.Clamp(world.x, WORLD.minX + halfW, WORLD.maxX - halfW);
      this.matter.body.setPosition(this.active.body, { x, y: this.active.body.position.y });
    });

    // Secondary desktop keyboard shortcuts (never required).
    const keyboard = this.input.keyboard;
    if (keyboard) {
      keyboard.on('keydown-A', () => this.rotate(-1));
      keyboard.on('keydown-LEFT', () => this.rotate(-1));
      keyboard.on('keydown-D', () => this.rotate(1));
      keyboard.on('keydown-RIGHT', () => this.rotate(1));
      keyboard.on('keydown-SPACE', () => this.drop());
      keyboard.on('keydown-N', () => this.spawnNext());
      keyboard.on('keydown-R', () => this.reset());
    }

    if (SHOW_DEBUG) {
      this.debugText = this.add
        .text(8, 100, '', { color: '#8b93a7', fontFamily: 'monospace', fontSize: '11px' })
        .setScrollFactor(0)
        .setDepth(1000);
    }

    this.controller.registerScene(this);
    this.spawnNext();
  }

  // ---- commands (called via controller) ----------------------------------

  spawnNext(): void {
    // Replace an undropped object; otherwise spawn a fresh one.
    if (this.active) {
      this.clearEntry(this.active);
      this.active = null;
    }
    const id = SANDBOX_OBJECT_IDS[this.index % SANDBOX_OBJECT_IDS.length];
    this.index += 1;
    const def = id ? getObjectDef(id) : undefined;
    if (!def) return;

    const spawnY = Math.max(
      WORLD.ceilingY + def.shape.height,
      this.currentTopY() - WORLD.spawnGap - def.spawnOffsetY
    );
    const inst = createObject(this, def, WORLD.centerX, spawnY, 0, true); // static = gravity off
    this.active = { def, body: inst.body, view: inst.view };
    this.setPhase('placing');
    this.emitNext();
  }

  rotate(dir: -1 | 1): void {
    if (this.phase !== 'placing' || !this.active) return;
    this.matter.body.setAngle(this.active.body, this.active.body.angle + dir * ROTATE_STEP);
  }

  drop(): void {
    if (this.phase !== 'placing' || !this.active) return;
    // Enable gravity; the object becomes permanent and can no longer be moved.
    this.matter.body.setStatic(this.active.body, false);
    this.placed.push(this.active);
    this.active = null;
    this.setPhase('dropped');
    this.emitNext();
  }

  reset(): void {
    if (this.active) this.clearEntry(this.active);
    for (const e of this.placed) this.clearEntry(e);
    this.active = null;
    this.placed = [];
    this.index = 0;
    this.setPhase('empty');
    this.spawnNext();
  }

  // ---- per-frame ----------------------------------------------------------

  override update(): void {
    this.syncViews();
    this.clampVelocities();
    this.updateCamera();
    if (this.debugText) {
      this.debugText.setText(
        `sandbox | placed ${this.placed.length} | ${this.phase} | fps ${Math.round(this.game.loop.actualFps)}`
      );
    }
  }

  private syncViews(): void {
    for (const e of this.placed) {
      e.view.setPosition(e.body.position.x, e.body.position.y);
      e.view.setRotation(e.body.angle);
    }
    if (this.active) {
      this.active.view.setPosition(this.active.body.position.x, this.active.body.position.y);
      this.active.view.setRotation(this.active.body.angle);
    }
  }

  /** Keep extreme velocities in check so objects can't tunnel or explode. */
  private clampVelocities(): void {
    for (const e of this.placed) {
      const b = e.body;
      if (b.isStatic || b.isSleeping) continue;
      const speed = Math.hypot(b.velocity.x, b.velocity.y);
      if (speed > MAX_LINEAR_VELOCITY) {
        const s = MAX_LINEAR_VELOCITY / speed;
        this.matter.body.setVelocity(b, { x: b.velocity.x * s, y: b.velocity.y * s });
      }
      if (Math.abs(b.angularVelocity) > MAX_ANGULAR_VELOCITY) {
        this.matter.body.setAngularVelocity(b, Math.sign(b.angularVelocity) * MAX_ANGULAR_VELOCITY);
      }
    }
  }

  private currentTopY(): number {
    let top: number = WORLD.platformTopY;
    for (const e of this.placed) {
      if (e.body.position.y < top) top = e.body.position.y;
    }
    return top;
  }

  private updateCamera(): void {
    const interest = this.active ? this.active.body.position.y : this.currentTopY();
    const target = Phaser.Math.Clamp(interest, WORLD.ceilingY + 120, WORLD.platformTopY - 160);
    const focus = Phaser.Math.Linear(this.cameras.main.midPoint.y - 140, target, 0.12);
    this.cameras.main.centerOn(WORLD.centerX, focus + 140);
  }

  // ---- helpers ------------------------------------------------------------

  private setPhase(phase: SandboxPhase): void {
    this.phase = phase;
    this.controller.emitPhase(phase);
  }

  private emitNext(): void {
    const id = SANDBOX_OBJECT_IDS[this.index % SANDBOX_OBJECT_IDS.length];
    const def = id ? getObjectDef(id) : undefined;
    this.controller.emitObject(def ? def.name : '');
  }

  private clearEntry(entry: Entry): void {
    this.matter.world.remove(entry.body);
    entry.view.destroy();
  }

  private drawBackdrop(): void {
    const g = this.add.graphics();
    g.setDepth(-10);
    g.fillStyle(0x2a2d38, 1);
    g.fillCircle(WORLD.centerX, WORLD.platformTopY - 120, 520);
    g.fillStyle(0x20222b, 1);
    g.fillCircle(WORLD.centerX, WORLD.platformTopY - 120, 360);
  }

  private drawTowerArea(): void {
    const g = this.add.graphics();
    g.setDepth(-6);
    g.lineStyle(2, 0x3a3f4d, 0.5);
    g.lineBetween(WORLD.minX, WORLD.ceilingY, WORLD.minX, WORLD.platformTopY);
    g.lineBetween(WORLD.maxX, WORLD.ceilingY, WORLD.maxX, WORLD.platformTopY);
    g.lineStyle(1, 0x3a3f4d, 0.35);
    g.lineBetween(WORLD.minX, WORLD.ceilingY, WORLD.maxX, WORLD.ceilingY);
  }

  private buildPlatform(): void {
    const y = WORLD.platformTopY + WORLD.platformHeight / 2;
    this.matter.add.rectangle(WORLD.centerX, y, WORLD.platformWidth, WORLD.platformHeight, {
      isStatic: true,
      friction: 1,
      frictionStatic: 1,
    });
    const g = this.add.graphics();
    g.setDepth(-5);
    g.fillStyle(0x3b3f4d, 1);
    g.lineStyle(4, 0x555b6e, 1);
    g.fillRoundedRect(
      WORLD.centerX - WORLD.platformWidth / 2,
      WORLD.platformTopY,
      WORLD.platformWidth,
      WORLD.platformHeight,
      6
    );
    g.strokeRoundedRect(
      WORLD.centerX - WORLD.platformWidth / 2,
      WORLD.platformTopY,
      WORLD.platformWidth,
      WORLD.platformHeight,
      6
    );
  }

  private applyZoom(): void {
    const w = this.scale.width;
    const h = this.scale.height;
    if (w === 0 || h === 0) return;
    this.cameras.main.setZoom(Math.min(w / WORLD.width, h / 900));
  }
}
