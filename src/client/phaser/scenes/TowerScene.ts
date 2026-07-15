import Phaser from 'phaser';
import { WORLD } from '../../../shared/config';
import { getObjectDef, type GameObjectDef } from '../../../shared/objects';
import type { SubmittedBody } from '../../../shared/api';
import type { PersistedBodyState, TowerState } from '../../../shared/types';
import type { GameBridge, ScenePhase } from '../bridge';
import { playImpact } from '../audio';
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

  private stability: StabilityState = createStabilityState();
  private debugGfx: Phaser.GameObjects.Graphics | null = null;
  private focusY = WORLD.platformTopY - 220;

  /** Local player id — used only to mark the viewer's own bodies (never shown). */
  private localUserId: string | null = null;
  private highlightedBodyId: string | null = null;
  private highlightGfx: Phaser.GameObjects.Graphics | null = null;

  /** Local pre-attempt snapshot captured before each drop, for restore. */
  private preAttemptSnapshot: PersistedBodyState[] = [];
  private reducedMotion = false;

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

    // First meaningful collision starts the stability evaluation window (§12.1).
    this.matter.world.on(
      'collisionstart',
      (event: Phaser.Physics.Matter.Events.CollisionStartEvent) => {
        if (this.phase !== 'settling' || !this.active || this.stability.startedAt !== null) return;
        for (const pair of event.pairs) {
          if (this.involvesActive(pair)) {
            this.stability = beginEvaluation(this.stability, this.time.now);
            break;
          }
        }
      }
    );

    if (SHOW_DEBUG) {
      this.debugGfx = this.add.graphics().setDepth(900);
    }

    // Small round texture for collapse particles.
    const spark = this.make.graphics({ x: 0, y: 0 });
    spark.fillStyle(0xffffff, 1);
    spark.fillCircle(4, 4, 4);
    spark.generateTexture('spark', 8, 8);
    spark.destroy();

    this.reducedMotion =
      typeof window !== 'undefined' && typeof window.matchMedia === 'function'
        ? window.matchMedia('(prefers-reduced-motion: reduce)').matches
        : false;

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
    // Warm spotlight pool on the platform.
    g.fillStyle(0x2a2d38, 1);
    g.fillCircle(WORLD.centerX, WORLD.platformTopY - 120, 520);
    g.fillStyle(0x20222b, 1);
    g.fillCircle(WORLD.centerX, WORLD.platformTopY - 120, 360);
  }

  /** Faint boundary framing the empty play space above the platform. */
  private drawTowerArea(): void {
    const g = this.add.graphics();
    g.setDepth(-6);
    g.lineStyle(2, 0x3a3f4d, 0.5);
    g.lineBetween(WORLD.minX, WORLD.ceilingY, WORLD.minX, WORLD.platformTopY);
    g.lineBetween(WORLD.maxX, WORLD.ceilingY, WORLD.maxX, WORLD.platformTopY);
    g.lineStyle(1, 0x3a3f4d, 0.35);
    g.lineBetween(WORLD.minX, WORLD.ceilingY, WORLD.maxX, WORLD.ceilingY);
    this.add
      .text(WORLD.centerX, WORLD.ceilingY - 24, 'tower area', {
        color: '#4b5162',
        fontSize: '16px',
      })
      .setOrigin(0.5, 0)
      .setDepth(-6);
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
    // Fit the world width, but never so zoomed-in that we lose vertical context.
    const zoom = Math.min(w / WORLD.width, h / 900);
    this.cameras.main.setZoom(zoom);
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
        const inst = createObject(this, def, state.x, state.y, state.angle, false);
        this.addOwnershipMarker(inst.view, def, state);
        this.accepted.push({ bodyId: state.bodyId, def, body: inst.body, view: inst.view, state });
      } catch (e) {
        console.error('failed to rebuild body', state.bodyId, e);
      }
    }
  }

  private rebuild(tower: TowerState): void {
    this.baseTowerVersion = tower.meta.version;
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
    const inst = createObject(this, def, WORLD.centerX, spawnY, 0, true);
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
  }

  cancelActive(): void {
    if (this.active) {
      this.clearEntry(this.active);
      this.active = null;
    }
    this.setPhase('idle');
  }

  drop(): void {
    if (this.phase !== 'placing' || !this.active) return;
    // Capture the pre-attempt snapshot (positions + ownership) for restore.
    this.preAttemptSnapshot = this.accepted.map((e) => ({ ...e.state }));
    this.resetTimeScale();
    this.matter.body.setStatic(this.active.body, false);
    this.stability = createStabilityState();
    this.setPhase('settling');
    this.bridge.emitStabilityLabel('hold');
  }

  // ---- per-frame ----------------------------------------------------------

  override update(): void {
    this.syncViews();
    this.updateCamera();
    this.drawHighlight();

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
    if (!this.reducedMotion) this.cameras.main.flash(200, 90, 200, 150);
    this.bridge.emitSettle({
      stable: true,
      newBodyId: this.active.bodyId,
      selectedObjectId: this.selectedObjectId,
      baseTowerVersion: this.baseTowerVersion,
      bodies: this.snapshotBodies(),
      message: null,
    });
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

    const impact = this.impactInfo();
    if (!this.reducedMotion) {
      this.setTimeScale(SLOWMO_SCALE); // brief slow motion
      this.cameras.main.shake(340, Math.min(0.02, 0.005 + impact.speed * 0.0006));
      this.spawnCollapseParticles(impact.x, impact.y, impact.speed);
    }
    playImpact(impact.speed, this.active?.def.material);

    // Let the collapse play, then ALWAYS restore + return control.
    const delay = this.reducedMotion ? 250 : 1500;
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
  }
}
