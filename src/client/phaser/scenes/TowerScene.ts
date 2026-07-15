import Phaser from 'phaser';
import { WORLD } from '../../../shared/config';
import { modifierPhysics, type ModifierPhysics } from '../../../shared/modifiers';
import { getObjectDef, type GameObjectDef } from '../../../shared/objects';
import type { SubmittedBody } from '../../../shared/api';
import type { PersistedBodyState, TowerState } from '../../../shared/types';
import type { GameBridge, ScenePhase } from '../bridge';
import { playCollapse, playImpact, playSuccess, type Material } from '../audio';
import { prefersReducedMotion } from '../../state/settings';
import { DebugModel, SHOW_DEBUG } from '../debug';
import { createObject } from '../bodyFactory';
import {
  DEFAULT_STABILITY_CONFIG,
  beginEvaluation,
  createStabilityState,
  isBodyStable,
  stepStability,
  type BodyMotion,
  type StabilityState,
} from '../stability';

type Entry = {
  bodyId: string;
  def: GameObjectDef;
  body: MatterJS.BodyType;
  view: Phaser.GameObjects.Container;
  /** Authoritative source state — kept so a collapse can restore it exactly. */
  state: PersistedBodyState;
};

const ROTATE_STEP = Phaser.Math.DEG_TO_RAD * 9;
const SLOWMO_SCALE = 0.4;

const COLLAPSE_MESSAGES = [
  'Physics has reviewed your proposal.',
  'The tower respectfully declined.',
  'Ambitious. Structurally questionable.',
  'That was one thing too many.',
  'The community will remember the confidence.',
  'Good news: the last stable version survived.',
];

export class TowerScene extends Phaser.Scene {
  private readonly bridge: GameBridge;
  private readonly debug: DebugModel;

  private accepted: Entry[] = [];
  private active: Entry | null = null;

  private phase: ScenePhase = 'idle';
  private selectedObjectId = '';
  private baseTowerVersion = 0;
  /** The day's modifier physics, derived from the tower meta (Task 16). */
  private mods: ModifierPhysics = { gravityScale: 1, densityScale: 1, frictionScale: 1 };

  private stability: StabilityState = createStabilityState();
  private debugGfx: Phaser.GameObjects.Graphics | null = null;
  private focusY = WORLD.platformTopY - 220;

  /** Local player id — used only to mark the viewer's own bodies (never shown). */
  private localUserId: string | null = null;
  private highlightedBodyId: string | null = null;
  private highlightGfx: Phaser.GameObjects.Graphics | null = null;

  /** Local pre-attempt snapshot captured before each drop, for restore. */
  private preAttemptSnapshot: PersistedBodyState[] = [];

  // --- feel/polish (Task 18) ---
  /** Escalating "tension" ring drawn on the active body while it settles. */
  private tensionGfx: Phaser.GameObjects.Graphics | null = null;
  /** Throttle collision SFX/particles so a busy collapse can't spam them. */
  private lastImpactAt = 0;
  /** Smoothed camera zoom target (controlled zoom-out as the tower grows). */
  private zoomLevel = 1;

  private isReducedMotion(): boolean {
    return prefersReducedMotion();
  }

  constructor(bridge: GameBridge, debug: DebugModel) {
    super('tower');
    this.bridge = bridge;
    this.debug = debug;
  }

  create(): void {
    this.matter.world.setGravity(0, WORLD.gravityY);

    this.drawBackdrop();
    this.drawTowerArea();
    this.buildPlatform();
    this.applyZoom();

    this.scale.on(Phaser.Scale.Events.RESIZE, () => this.applyZoom());

    this.input.on('pointermove', (pointer: Phaser.Input.Pointer) => {
      if (this.phase !== 'placing' || !this.active || !pointer.isDown) return;
      const world = this.cameras.main.getWorldPoint(pointer.x, pointer.y);
      const halfW = this.active.def.shape.width / 2;
      const x = Phaser.Math.Clamp(world.x, WORLD.minX + halfW, WORLD.maxX - halfW);
      this.matter.body.setPosition(this.active.body, { x, y: this.active.body.position.y });
    });

    // Tap/click an accepted body while idle to inspect it (§ Task 10). Tapping
    // empty space clears the selection.
    this.input.on('pointerup', (pointer: Phaser.Input.Pointer) => {
      if (this.phase !== 'idle') return;
      const world = this.cameras.main.getWorldPoint(pointer.x, pointer.y);
      const hits = this.matter.intersectPoint(world.x, world.y);
      let found: Entry | null = null;
      for (const e of this.accepted) {
        if (hits.some((h) => Object.is(h, e.body))) {
          found = e;
          break;
        }
      }
      this.highlightedBodyId = found ? found.bodyId : null;
      this.bridge.emitInspect(found ? found.bodyId : null);
    });

    this.highlightGfx = this.add.graphics().setDepth(800);

    const keyboard = this.input.keyboard;
    if (keyboard) {
      keyboard.on('keydown-A', () => this.rotate(-1));
      keyboard.on('keydown-LEFT', () => this.rotate(-1));
      keyboard.on('keydown-D', () => this.rotate(1));
      keyboard.on('keydown-RIGHT', () => this.rotate(1));
      keyboard.on('keydown-SPACE', () => this.drop());
    }

    // First meaningful collision starts the stability evaluation window (§12.1)
    // and drives material-based impact feedback (audio + dust/sparks).
    this.matter.world.on(
      'collisionstart',
      (event: Phaser.Physics.Matter.Events.CollisionStartEvent) => {
        if (this.phase !== 'settling' || !this.active) return;
        for (const pair of event.pairs) {
          if (this.involvesActive(pair)) {
            if (this.stability.startedAt === null) {
              this.stability = beginEvaluation(this.stability, this.time.now);
            }
            this.onActiveImpact();
            break;
          }
        }
      }
    );

    if (SHOW_DEBUG) {
      this.debugGfx = this.add.graphics().setDepth(900);
    }

    // Small round texture for collapse/spark particles.
    const spark = this.make.graphics({ x: 0, y: 0 });
    spark.fillStyle(0xffffff, 1);
    spark.fillCircle(4, 4, 4);
    spark.generateTexture('spark', 8, 8);
    spark.destroy();

    // Soft, low-contrast puff for dust (deliberately faint — never hides the tower).
    const dust = this.make.graphics({ x: 0, y: 0 });
    dust.fillStyle(0xffffff, 0.5);
    dust.fillCircle(8, 8, 8);
    dust.generateTexture('dust', 16, 16);
    dust.destroy();

    this.tensionGfx = this.add.graphics().setDepth(700);

    // Slow motion must ALWAYS return to normal, even on teardown.
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.resetTimeScale());

    this.bridge.registerScene(this);
  }

  private setTimeScale(value: number): void {
    this.matter.world.engine.timing.timeScale = value;
  }

  private resetTimeScale(): void {
    this.matter.world.engine.timing.timeScale = 1;
  }

  /** True if a collision pair involves the active body (or one of its compound parts). */
  private involvesActive(pair: { bodyA: MatterJS.BodyType; bodyB: MatterJS.BodyType }): boolean {
    const active = this.active?.body;
    if (!active) return false;
    const { bodyA: a, bodyB: b } = pair;
    return a === active || b === active || a.parent === active || b.parent === active;
  }

  // ---- backdrop / platform ------------------------------------------------

  private drawBackdrop(): void {
    const g = this.add.graphics();
    g.setDepth(-10);
    const cx = WORLD.centerX;
    const cy = WORLD.platformTopY - 250;
    // Soft concentric "stage" pool behind the tower (light lavender).
    g.fillStyle(0xeceefb, 1);
    g.fillCircle(cx, cy, 470);
    g.fillStyle(0xe4e8fb, 1);
    g.fillCircle(cx, cy, 350);

    // Friendly clouds flanking the stage.
    this.drawCloud(cx - 300, cy + 120, 1.1);
    this.drawCloud(cx + 300, cy + 170, 0.95);
    this.drawCloud(cx - 250, cy - 190, 0.7);

    // A couple of sparkles for life (static, never flashing).
    this.drawSparkle(cx - 170, cy - 120, 13);
    this.drawSparkle(cx + 190, cy - 70, 10);
    this.drawSparkle(cx + 120, cy - 210, 7);
  }

  /** A soft, rounded pastel cloud built from overlapping circles. */
  private drawCloud(x: number, y: number, scale: number): void {
    const g = this.add.graphics();
    g.setDepth(-9);
    g.fillStyle(0xdfe4f8, 1);
    const r = 34 * scale;
    g.fillCircle(x, y, r);
    g.fillCircle(x - r * 0.9, y + r * 0.25, r * 0.75);
    g.fillCircle(x + r * 0.95, y + r * 0.2, r * 0.8);
    g.fillRoundedRect(x - r * 1.4, y + r * 0.2, r * 2.8, r * 0.9, r * 0.45);
  }

  /** A soft four-point sparkle. */
  private drawSparkle(x: number, y: number, size: number): void {
    const g = this.add.graphics();
    g.setDepth(-8);
    g.fillStyle(0xc7cff6, 1);
    g.beginPath();
    g.moveTo(x, y - size);
    g.lineTo(x + size * 0.28, y - size * 0.28);
    g.lineTo(x + size, y);
    g.lineTo(x + size * 0.28, y + size * 0.28);
    g.lineTo(x, y + size);
    g.lineTo(x - size * 0.28, y + size * 0.28);
    g.lineTo(x - size, y);
    g.lineTo(x - size * 0.28, y - size * 0.28);
    g.closePath();
    g.fillPath();
  }

  /** Repurposed: a soft ground shadow beneath the platform (light theme). */
  private drawTowerArea(): void {
    const g = this.add.graphics();
    g.setDepth(-6);
    g.fillStyle(0x9aa3d6, 0.18);
    g.fillEllipse(WORLD.centerX, WORLD.platformTopY + WORLD.platformHeight + 18, WORLD.platformWidth + 70, 40);
  }

  private buildPlatform(): void {
    const y = WORLD.platformTopY + WORLD.platformHeight / 2;
    this.matter.add.rectangle(
      WORLD.centerX,
      y,
      WORLD.platformWidth,
      WORLD.platformHeight,
      { isStatic: true, friction: 1, frictionStatic: 1 }
    );
    const left = WORLD.centerX - WORLD.platformWidth / 2;
    const g = this.add.graphics();
    g.setDepth(-5);
    // Soft drop shadow.
    g.fillStyle(0x8b93c7, 0.16);
    g.fillRoundedRect(left + 4, WORLD.platformTopY + 8, WORLD.platformWidth, WORLD.platformHeight, 14);
    // A pale indigo "side" for a subtle 3D slab feel.
    g.fillStyle(0xd9def6, 1);
    g.fillRoundedRect(left, WORLD.platformTopY + 10, WORLD.platformWidth, WORLD.platformHeight, 14);
    // White top face.
    g.fillStyle(0xffffff, 1);
    g.lineStyle(2, 0xe6e9f8, 1);
    g.fillRoundedRect(left, WORLD.platformTopY, WORLD.platformWidth, WORLD.platformHeight - 6, 14);
    g.strokeRoundedRect(left, WORLD.platformTopY, WORLD.platformWidth, WORLD.platformHeight - 6, 14);
  }

  private baseZoom = 1;

  private applyZoom(): void {
    const w = this.scale.width;
    const h = this.scale.height;
    if (w === 0 || h === 0) return;
    // Fit the world width, but keep enough vertical context that the platform +
    // roughly the top three objects and the incoming object stay in frame.
    this.baseZoom = Math.min(w / WORLD.width, h / 1000);
    this.cameras.main.setZoom(this.baseZoom * this.zoomLevel);
  }

  // ---- tower reconstruction ----------------------------------------------

  loadTower(tower: TowerState): void {
    this.rebuild(tower);
  }

  private setPhase(phase: ScenePhase): void {
    this.phase = phase;
    this.bridge.emitPhase(phase);
  }

  private clearEntry(entry: Entry): void {
    try {
      this.matter.world.remove(entry.body);
      entry.view.destroy();
    } catch (e) {
      console.error('clearEntry failed', e);
    }
  }

  /** Remove every body (active + accepted) so nothing is ever duplicated. */
  private forceClearAll(): void {
    if (this.active) {
      this.clearEntry(this.active);
      this.active = null;
    }
    for (const e of this.accepted) this.clearEntry(e);
    this.accepted = [];
  }

  /** Rebuild the accepted tower from authoritative body states. */
  private buildAccepted(states: readonly PersistedBodyState[]): void {
    this.forceClearAll();
    for (const state of states) {
      const def = getObjectDef(state.objectId);
      if (!def) continue;
      try {
        const inst = createObject(this, def, state.x, state.y, state.angle, false, this.mods);
        this.addOwnershipMarker(inst.view, def, state);
        this.accepted.push({ bodyId: state.bodyId, def, body: inst.body, view: inst.view, state });
      } catch (e) {
        console.error('failed to rebuild body', state.bodyId, e);
      }
    }
  }

  private rebuild(tower: TowerState): void {
    this.baseTowerVersion = tower.meta.version;
    // Apply the day's modifier: gravity now, density/friction per body on build.
    this.mods = modifierPhysics(tower.meta.modifierId);
    this.matter.world.setGravity(0, WORLD.gravityY * this.mods.gravityScale);
    this.buildAccepted(tower.bodies);
    this.setPhase('idle');
  }

  /** A subtle golden pip above the viewer's own objects — no text, no id. */
  private addOwnershipMarker(
    view: Phaser.GameObjects.Container,
    def: GameObjectDef,
    state: PersistedBodyState
  ): void {
    if (!this.localUserId || state.ownerUserId !== this.localUserId) return;
    const y = -def.shape.height / 2 - 9;
    const pip = this.add.graphics();
    pip.fillStyle(0xffd479, 0.95);
    pip.fillCircle(0, y, 3.5);
    pip.lineStyle(1.5, 0x000000, 0.35);
    pip.strokeCircle(0, y, 3.5);
    view.add(pip);
  }

  setLocalUser(userId: string | null): void {
    this.localUserId = userId;
  }

  highlightBody(bodyId: string | null): void {
    this.highlightedBodyId = bodyId;
  }

  /** Draw a ring around the inspected body; follows it every frame. */
  private drawHighlight(): void {
    const g = this.highlightGfx;
    if (!g) return;
    g.clear();
    if (!this.highlightedBodyId) return;
    const e = this.accepted.find((x) => x.bodyId === this.highlightedBodyId);
    if (!e) return;
    const r = Math.max(e.def.shape.width, e.def.shape.height) / 2 + 9;
    g.lineStyle(2.5, 0xffd479, 0.9);
    g.strokeCircle(e.body.position.x, e.body.position.y, r);
  }

  // ---- placement ----------------------------------------------------------

  private currentTopY(): number {
    let top: number = WORLD.platformTopY;
    for (const e of this.accepted) {
      if (e.body.position.y < top) top = e.body.position.y;
    }
    return top;
  }

  beginPlacement(objectId: string, newBodyId: string, baseTowerVersion: number): void {
    const def = getObjectDef(objectId);
    if (!def) return;
    if (this.active) {
      this.clearEntry(this.active);
      this.active = null;
    }
    this.selectedObjectId = objectId;
    this.baseTowerVersion = baseTowerVersion;

    const spawnY = Math.max(
      WORLD.ceilingY + def.shape.height,
      this.currentTopY() - WORLD.spawnGap - def.spawnOffsetY
    );
    const inst = createObject(this, def, WORLD.centerX, spawnY, 0, true, this.mods);
    // The active object isn't persisted yet; its state is a placeholder and is
    // never written into the pre-attempt snapshot (only accepted bodies are).
    const state: PersistedBodyState = {
      bodyId: newBodyId,
      objectId,
      ownerUserId: '',
      ownerUsername: '',
      sequenceNumber: 0,
      x: WORLD.centerX,
      y: spawnY,
      angle: 0,
      scaleX: 1,
      scaleY: 1,
    };
    this.active = { bodyId: newBodyId, def, body: inst.body, view: inst.view, state };

    this.setPhase('placing');
  }

  rotate(dir: -1 | 1): void {
    if (this.phase !== 'placing' || !this.active) return;
    this.matter.body.setAngle(this.active.body, this.active.body.angle + dir * ROTATE_STEP);
    this.rotationFeedback();
  }

  /** A quick scale pulse on the active object so a rotate visibly registers. */
  private rotationFeedback(): void {
    if (!this.active || this.isReducedMotion()) return;
    const view = this.active.view;
    this.tweens.killTweensOf(view);
    view.setScale(1);
    this.tweens.add({ targets: view, scale: 1.08, duration: 70, yoyo: true, ease: 'Quad.easeOut' });
  }

  cancelActive(): void {
    if (this.active) {
      this.clearEntry(this.active);
      this.active = null;
    }
    this.setPhase('idle');
  }

  /**
   * Practice only: promote the settled active body into the accepted tower using
   * its current transform, so the next practice object stacks on it. No server
   * write happens — this only mutates local scene state.
   */
  commitLocal(): void {
    if (!this.active) return;
    const entry = this.active;
    entry.state = {
      ...entry.state,
      x: entry.body.position.x,
      y: entry.body.position.y,
      angle: entry.body.angle,
      sequenceNumber: this.accepted.length + 1,
    };
    this.accepted.push(entry);
    this.active = null;
    this.setPhase('idle');
  }

  drop(): void {
    if (this.phase !== 'placing' || !this.active) return;
    // Capture the pre-attempt snapshot (positions + ownership) for restore.
    this.preAttemptSnapshot = this.accepted.map((e) => ({ ...e.state }));
    this.resetTimeScale();
    this.dropFeedback(this.active.body.position.x, this.active.body.position.y);
    this.matter.body.setStatic(this.active.body, false);
    this.stability = createStabilityState();
    this.lastImpactAt = 0;
    this.setPhase('settling');
    this.bridge.emitStabilityLabel('hold');
  }

  /** A brief expanding ring at the drop point — a clear "released" cue. */
  private dropFeedback(x: number, y: number): void {
    if (this.isReducedMotion()) return;
    const ring = this.add.graphics().setDepth(650);
    ring.lineStyle(2, 0xf59e0b, 0.8);
    ring.strokeCircle(x, y, 6);
    this.tweens.add({
      targets: ring,
      scale: 2.4,
      alpha: 0,
      duration: 280,
      ease: 'Quad.easeOut',
      onComplete: () => ring.destroy(),
    });
  }

  // ---- per-frame ----------------------------------------------------------

  override update(): void {
    this.syncViews();
    this.updateCamera();
    this.drawHighlight();
    this.drawTension();

    if (this.phase === 'settling') {
      this.evaluate();
    }

    if (SHOW_DEBUG) {
      const cam = this.cameras.main;
      this.debug.fps = Math.round(this.game.loop.actualFps);
      this.debug.viewW = Math.round(this.scale.width);
      this.debug.viewH = Math.round(this.scale.height);
      this.debug.zoom = cam.zoom;
      this.debug.cameraScrollY = Math.round(cam.scrollY);
      this.debug.bodyCount = this.accepted.length + (this.active ? 1 : 0);
      this.debug.phase = this.phase;
      this.debug.stability =
        this.phase === 'settling' ? `${this.stability.status}/${this.stability.label}` : '';
      this.drawStabilityDebug();
    }
  }

  private syncViews(): void {
    for (const e of this.accepted) {
      e.view.setPosition(e.body.position.x, e.body.position.y);
      e.view.setRotation(e.body.angle);
    }
    if (this.active) {
      this.active.view.setPosition(this.active.body.position.x, this.active.body.position.y);
      this.active.view.setRotation(this.active.body.angle);
    }
  }

  private motionOf(id: string, body: MatterJS.BodyType): BodyMotion {
    return {
      id,
      isStatic: body.isStatic,
      isSleeping: body.isSleeping,
      vx: body.velocity.x,
      vy: body.velocity.y,
      angularVelocity: body.angularVelocity,
    };
  }

  /** Sample motion for the whole tower (accepted bodies + the active one). */
  private sampleMotions(): BodyMotion[] {
    const out = this.accepted.map((e) => this.motionOf(e.bodyId, e.body));
    if (this.active) out.push(this.motionOf(this.active.bodyId, this.active.body));
    return out;
  }

  /** Hard-failure detection: fall, out-of-bounds, invalid state, foundation cleared. */
  private hasFallen(): boolean {
    for (const e of [...this.accepted, ...(this.active ? [this.active] : [])]) {
      const p = e.body.position;
      // Invalid physics state (NaN / Infinity).
      if (!Number.isFinite(p.x) || !Number.isFinite(p.y) || !Number.isFinite(e.body.angle)) {
        return true;
      }
      // New OR existing object below the fail line.
      if (p.y > WORLD.failLineY) return true;
      // Left the horizontal world bounds.
      if (p.x < WORLD.minX - 80 || p.x > WORLD.maxX + 80) return true;
    }
    // Foundation cleared: there were accepted objects but every one was knocked
    // off the tower (also caught per-body above, kept explicit for clarity).
    if (this.accepted.length > 0 && this.accepted.every((e) => e.body.position.y > WORLD.failLineY)) {
      return true;
    }
    return false;
  }

  private evaluate(): void {
    const prevLabel = this.stability.label;
    this.stability = stepStability(
      this.stability,
      { bodies: this.sampleMotions(), hardFail: this.hasFallen(), now: this.time.now },
      DEFAULT_STABILITY_CONFIG
    );

    if (this.stability.status === 'pending') {
      if (this.stability.label !== prevLabel) this.bridge.emitStabilityLabel(this.stability.label);
      return;
    }
    if (this.stability.status === 'stable') {
      this.bridge.emitStabilityLabel('locked');
      this.finishSuccess();
    } else {
      this.finishCollapse();
    }
  }

  /** Dev-only: green/red dot per body showing live stability (§12.10). */
  private drawStabilityDebug(): void {
    const g = this.debugGfx;
    if (!g) return;
    g.clear();
    if (this.phase !== 'settling') return;
    const mark = (id: string, body: MatterJS.BodyType) => {
      const stable = isBodyStable(this.motionOf(id, body), DEFAULT_STABILITY_CONFIG);
      g.fillStyle(stable ? 0x34d399 : 0xf87171, 0.9);
      g.fillCircle(body.position.x, body.position.y, 6);
    };
    for (const e of this.accepted) mark(e.bodyId, e.body);
    if (this.active) mark(this.active.bodyId, this.active.body);
  }

  private snapshotBodies(): SubmittedBody[] {
    const entries = [...this.accepted, ...(this.active ? [this.active] : [])];
    return entries.map((e) => ({
      bodyId: e.bodyId,
      objectId: e.def.id,
      x: e.body.position.x,
      y: e.body.position.y,
      angle: e.body.angle,
      scaleX: 1,
      scaleY: 1,
    }));
  }

  private finishSuccess(): void {
    if (!this.active) return;
    this.setPhase('done');
    const b = this.active.body;
    playSuccess();
    // Localized success particles (a soft rise), never a full-screen flash.
    if (!this.isReducedMotion()) this.spawnSuccessParticles(b.position.x, b.position.y);
    this.bridge.emitSettle({
      stable: true,
      newBodyId: this.active.bodyId,
      selectedObjectId: this.selectedObjectId,
      baseTowerVersion: this.baseTowerVersion,
      bodies: this.snapshotBodies(),
      message: null,
    });
  }

  // ---- particle helpers (all count-limited; faint enough to never hide the tower) ----

  /** Material impact from a collision: audio + dust (heavy) or sparks (metal/glass). */
  private onActiveImpact(): void {
    if (!this.active) return;
    const now = this.time.now;
    if (now - this.lastImpactAt < 90) return; // throttle → limits sound + particles
    const b = this.active.body;
    const speed = Math.hypot(b.velocity.x, b.velocity.y);
    if (speed < 3) return; // ignore gentle settling contacts
    this.lastImpactAt = now;

    const material: Material = this.active.def.material;
    playImpact(speed, material);
    if (this.isReducedMotion()) return;
    if (material === 'metal' || material === 'glass') {
      this.spawnSparks(b.position.x, b.position.y, speed);
    } else if (speed > 6) {
      this.spawnDust(b.position.x, b.position.y, speed);
    }
  }

  private spawnSparks(x: number, y: number, speed: number): void {
    if (!this.textures.exists('spark')) return;
    const emitter = this.add.particles(x, y, 'spark', {
      speed: { min: 40, max: 70 + speed * 4 },
      lifespan: 300,
      scale: { start: 0.5, end: 0 },
      gravityY: 300,
      tint: [0xfff3c4, 0xffd479],
      emitting: false,
    });
    emitter.explode(Math.min(8, 3 + Math.round(speed / 3)), x, y);
    this.time.delayedCall(500, () => emitter.destroy());
  }

  private spawnDust(x: number, y: number, speed: number): void {
    if (!this.textures.exists('dust')) return;
    const emitter = this.add.particles(x, y, 'dust', {
      speed: { min: 10, max: 26 + speed * 2 },
      lifespan: 520,
      scale: { start: 0.7, end: 0 },
      alpha: { start: 0.35, end: 0 },
      gravityY: -8,
      tint: [0x9aa0ad, 0x767c8a],
      emitting: false,
    });
    emitter.explode(Math.min(6, 2 + Math.round(speed / 5)), x, y);
    this.time.delayedCall(700, () => emitter.destroy());
  }

  private spawnSuccessParticles(x: number, y: number): void {
    if (!this.textures.exists('spark')) return;
    const emitter = this.add.particles(x, y, 'spark', {
      speed: { min: 20, max: 60 },
      angle: { min: 240, max: 300 }, // upward fan
      lifespan: 600,
      scale: { start: 0.6, end: 0 },
      gravityY: -30,
      tint: [0x86efac, 0x34d399, 0xfff3c4],
      emitting: false,
    });
    emitter.explode(14, x, y);
    this.time.delayedCall(800, () => emitter.destroy());
  }

  /** Public celebration burst (community milestone) — driven from React. */
  celebrate(): void {
    if (this.isReducedMotion()) return;
    const y = this.currentTopY() - 40;
    this.spawnSuccessParticles(WORLD.centerX, y);
  }

  /** Position + speed of the fastest-moving body (the "impact"). */
  private impactInfo(): { speed: number; x: number; y: number } {
    let speed = 0;
    let x: number = WORLD.centerX;
    let y: number = WORLD.platformTopY;
    for (const e of [...this.accepted, ...(this.active ? [this.active] : [])]) {
      const s = Math.hypot(e.body.velocity.x, e.body.velocity.y);
      if (s > speed && Number.isFinite(e.body.position.x) && Number.isFinite(e.body.position.y)) {
        speed = s;
        x = e.body.position.x;
        y = e.body.position.y;
      }
    }
    return { speed, x, y };
  }

  private spawnCollapseParticles(x: number, y: number, intensity: number): void {
    if (!this.textures.exists('spark')) return;
    const emitter = this.add.particles(x, y, 'spark', {
      speed: { min: 30, max: 60 + intensity * 6 },
      lifespan: 600,
      scale: { start: 0.9, end: 0 },
      gravityY: 400,
      tint: [0xd8b48a, 0x9aa0ad, 0x8a8f9c],
      emitting: false,
    });
    emitter.explode(Math.min(24, 8 + Math.round(intensity)), x, y);
    this.time.delayedCall(900, () => emitter.destroy());
  }

  private pickCollapseMessage(): string {
    const i = Math.floor(Math.random() * COLLAPSE_MESSAGES.length) % COLLAPSE_MESSAGES.length;
    return COLLAPSE_MESSAGES[i] ?? 'The tower respectfully declined.';
  }

  private finishCollapse(): void {
    const newBodyId = this.active ? this.active.bodyId : '';
    this.setPhase('collapsing'); // input stays disabled through restore

    const reduced = this.isReducedMotion();
    const impact = this.impactInfo();
    if (!reduced) {
      this.setTimeScale(SLOWMO_SCALE); // brief slow motion
      this.cameras.main.shake(340, Math.min(0.02, 0.005 + impact.speed * 0.0006));
      this.spawnCollapseParticles(impact.x, impact.y, impact.speed);
    }
    // Layered collapse audio (rumble + crack + material impact).
    playCollapse(impact.speed, this.active?.def.material);

    // Let the collapse play, then ALWAYS restore + return control.
    const delay = reduced ? 250 : 1500;
    this.time.delayedCall(delay, () => {
      try {
        this.resetTimeScale();
        this.buildAccepted(this.preAttemptSnapshot); // clears everything first (no dupes)
      } catch (e) {
        console.error('collapse restore failed', e);
        this.forceClearAll();
      } finally {
        this.resetTimeScale();
        this.setPhase('idle');
        this.bridge.emitSettle({
          stable: false,
          newBodyId,
          selectedObjectId: this.selectedObjectId,
          baseTowerVersion: this.baseTowerVersion,
          bodies: this.snapshotBodies(),
          message: this.pickCollapseMessage(),
        });
      }
    });
  }

  private updateCamera(): void {
    const interest = this.active ? this.active.body.position.y : this.currentTopY();
    const target = Phaser.Math.Clamp(
      interest,
      WORLD.ceilingY + 120,
      WORLD.platformTopY - 160
    );
    this.focusY = Phaser.Math.Linear(this.focusY, target, 0.08);
    this.cameras.main.centerOn(WORLD.centerX, this.focusY + 140);

    // Controlled zoom: ease outward as the tower grows so the whole build stays
    // in frame, capped so it never becomes tiny. Smoothed to avoid any lurch.
    const towerHeight = Math.max(0, WORLD.platformTopY - this.currentTopY());
    const targetZoom = Phaser.Math.Clamp(1 - towerHeight / 2600, 0.72, 1);
    this.zoomLevel = Phaser.Math.Linear(this.zoomLevel, targetZoom, 0.05);
    this.cameras.main.setZoom(this.baseZoom * this.zoomLevel);
  }

  /**
   * Stability "tension" feedback: while the tower settles, draw a ring on the
   * active body whose intensity tracks how much the tower is still moving —
   * calmer as it stabilises. Faint by design so it never obscures the tower.
   */
  private drawTension(): void {
    const g = this.tensionGfx;
    if (!g) return;
    g.clear();
    if (this.phase !== 'settling' || !this.active || this.isReducedMotion()) return;

    let motion = 0;
    for (const m of this.sampleMotions()) {
      motion += Math.abs(m.vx) + Math.abs(m.vy) + Math.abs(m.angularVelocity) * 6;
    }
    const tension = Phaser.Math.Clamp(motion / 24, 0, 1);
    if (tension < 0.05) return;
    const b = this.active.body;
    const r = Math.max(this.active.def.shape.width, this.active.def.shape.height) / 2 + 6;
    // Warm (calm) → hot (wobbly), low alpha throughout.
    const color = tension > 0.6 ? 0xf87171 : tension > 0.3 ? 0xfbbf24 : 0x86efac;
    g.lineStyle(2, color, 0.25 + tension * 0.4);
    g.strokeCircle(b.position.x, b.position.y, r + tension * 5);
  }
}
