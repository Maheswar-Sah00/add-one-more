/**
 * The gameplay physics stage. Owns the state machine
 *   LOADING → CHOOSING → PLACING → DROPPING → CHECKING → SUCCESS | COLLAPSE
 * and everything visual/physical: the live community tower, the hovering
 * selected object, drag/rotate/drop, impact star+dust particles, camera framing
 * and shake, stability evaluation and the collapse-and-restore.
 *
 * All buttons/text live in the React/HTML overlay — nothing is drawn as UI
 * inside the canvas. The scene talks to React through a shared EventEmitter
 * ("bridge"): it EMITS phase/choices/count/hint/result and LISTENS for the
 * user intents select/rotate/drop/back.
 */
import Phaser from 'phaser';
import { WORLD } from '../../shared/config';
import { CATEGORY_POINTS, getObjectDef, type GameObjectDef } from '../../shared/objects';
import type { Difficulty, PersistedBodyState } from '../../shared/types';
import { DropAudio } from '../audio/dropSounds';
import { OBJECT_ART } from '../objectArt';
import {
  ensureDustTexture,
  ensureObjectTexture,
  ensureStarTexture,
  PALETTE,
  pickChoices,
} from './gameObjects';

export type Phase = 'LOADING' | 'CHOOSING' | 'PLACING' | 'DROPPING' | 'CHECKING' | 'SUCCESS' | 'COLLAPSE';

type Accepted = { defId: string; x: number; y: number; angle: number; scaleX: number; scaleY: number };

type MatterImage = Phaser.Physics.Matter.Image;

const PLATFORM_TOP = WORLD.platformTopY; // the ground surface objects rest on
const PLATFORM_THICK = 20; // the ground is a thick line, not a tall box
const MIN_VISIBLE_SPAN = 440; // fixed window of world height the camera frames; taller towers follow the top
const HOVER_GAP = 190; // how far above the tower the object hovers — a real, visible fall
const STABLE_HOLD = 380; // ms the object must stay genuinely at rest before it commits
const MIN_SETTLE = 320; // ms minimum before we can call success
const MAX_SETTLE = 5000; // ms hard cap — give the object real time to stop rolling/settling
const REST_SPEED = 0.32; // Matter linear speed below which the body counts as "stopped"
const REST_SPIN = 0.03; // Matter angular speed below which the body counts as "not turning"
const IMPACT_MIN_SPEED = 1.6; // matter speed to spawn impact stars
const SHAKE_MIN_SPEED = 4.5;
const ART_TARGET_PX = 512; // supersample art textures to ~this many px on the long side for crisp zoom

/** Vivid per-tier colours for the floating "+points" pop (kept in sync with the overlay). */
const CATEGORY_TEXT: Record<Difficulty, string> = {
  safe: '#2f8fd8',
  risky: '#e6a91e',
  absurd: '#e8794a',
};

export class TowerScene extends Phaser.Scene {
  private bridge!: Phaser.Events.EventEmitter;
  private initialBodies: PersistedBodyState[] = [];

  private phase: Phase = 'LOADING';
  private accepted: Accepted[] = [];
  private towerImages: MatterImage[] = [];

  private newObj: MatterImage | null = null;
  private newDef: GameObjectDef | null = null;

  private dropAudio!: DropAudio;
  private guide!: Phaser.GameObjects.Graphics;
  private starEmitters: Phaser.GameObjects.Particles.ParticleEmitter[] = [];
  private dustEmitter!: Phaser.GameObjects.Particles.ParticleEmitter;

  private dragging = false;
  private firstAttempt = true;
  private hintShown = false;

  private dropAt = 0;
  private calmSince = 0;
  private lastImpact = 0;
  private squashed = false;

  constructor() {
    super('tower');
  }

  init(data: { bridge: Phaser.Events.EventEmitter; bodies: PersistedBodyState[] }): void {
    this.bridge = data.bridge;
    this.initialBodies = data.bodies ?? [];
  }

  create(): void {
    this.matter.world.autoUpdate = true;
    this.cameras.main.setBackgroundColor(PALETTE.cream);

    this.dropAudio = new DropAudio(this);
    this.buildPlatform();
    this.buildParticles();

    this.guide = this.add.graphics().setDepth(5);

    // Accepted tower = the real community bodies. A brand-new tower starts
    // completely empty — just the ground.
    this.accepted = this.initialBodies
      .map(bodyToAccepted)
      .filter((a): a is Accepted => a !== null);

    this.setupInput();
    this.setupCollisions();

    // Bridge commands from the React overlay.
    this.bridge.on('select', (p: { id: string }) => this.onSelect(p.id));
    this.bridge.on('rotate', (p: { dir: -1 | 1 }) => this.onRotate(p.dir));
    this.bridge.on('drop', () => this.onDrop());
    // Sound-effects mute toggle from the overlay (does not play anything).
    this.bridge.on('sfxMuted', (m: boolean) => this.dropAudio.setMuted(m));
    this.bridge.on('sfxVolume', (v: number) => this.dropAudio.setVolume(v));

    this.scale.on('resize', () => this.frameTower(this.phase === 'PLACING', false));

    // Preload bundled artwork + drop sounds, THEN build the tower + start play.
    // Preloading NEVER plays audio.
    this.loadAssets(() => {
      this.rebuildTower();
      this.time.delayedCall(250, () => this.enterChoosing());
    });
  }

  /** Queue the per-object PNGs (`art-<id>`) and drop sounds (`drop-<id>`), then build. */
  private loadAssets(done: () => void): void {
    for (const [id, url] of Object.entries(OBJECT_ART)) {
      if (!this.textures.exists(`art-${id}`)) this.load.image(`art-${id}`, url);
    }
    this.dropAudio.preload();
    if (this.load.list.size === 0) {
      done();
      return;
    }
    this.load.once(Phaser.Loader.Events.COMPLETE, () => done());
    this.load.start();
  }

  // ---- construction --------------------------------------------------------

  private buildPlatform(): void {
    // The ground is a thick, rounded horizontal line — not a big box.
    const w = WORLD.platformWidth + 20;
    const h = PLATFORM_THICK;
    const pad = 4;
    const x = WORLD.centerX;
    const y = PLATFORM_TOP + h / 2; // top edge sits exactly at the ground surface
    if (!this.textures.exists('platform')) {
      const g = this.add.graphics();
      g.fillStyle(PALETTE.platform, 1);
      g.lineStyle(4, PALETTE.outline, 1);
      g.fillRoundedRect(pad, pad, w, h, h / 2);
      g.strokeRoundedRect(pad, pad, w, h, h / 2);
      g.generateTexture('platform', w + pad * 2, h + pad * 2);
      g.destroy();
    }
    this.matter.add
      .image(x, y, 'platform', undefined, {
        isStatic: true,
        friction: 1,
        shape: { type: 'rectangle', width: w, height: h },
      })
      .setDepth(1);
  }

  private buildParticles(): void {
    this.starEmitters = PALETTE.star.map((c, i) => {
      const key = ensureStarTexture(this, `star${i}`, c);
      return this.add
        .particles(0, 0, key, {
          lifespan: { min: 260, max: 520 },
          speed: { min: 50, max: 170 },
          angle: { min: 0, max: 360 },
          scale: { start: 1, end: 0 },
          rotate: { min: 0, max: 360 },
          gravityY: 320,
          quantity: 0,
          emitting: false,
        })
        .setDepth(20);
    });
    ensureDustTexture(this);
    this.dustEmitter = this.add
      .particles(0, 0, 'dust', {
        lifespan: { min: 240, max: 460 },
        speed: { min: 10, max: 55 },
        scale: { start: 1.1, end: 0 },
        alpha: { start: 0.55, end: 0 },
        tint: 0xd8c9a6,
        quantity: 0,
        emitting: false,
      })
      .setDepth(19);
  }

  private makeImage(a: Accepted, dynamic: boolean): MatterImage | null {
    const def = getObjectDef(a.defId);
    if (!def) return null;
    const bw = def.shape.width * def.scale;
    const bh = def.shape.height * def.scale;

    // Real artwork (`art-<id>`) is supersampled so it stays crisp when the camera
    // zooms in on a high-DPI screen: we build the body k× larger, render the
    // texture at k× resolution, then setScale(1/k). setScale on a Matter image
    // ALSO scales its body, so this leaves a correctly-sized body with a
    // high-resolution texture. Procedural fallback stays at k = 1.
    const hasArt = this.textures.exists(`art-${def.id}`);
    const ss = hasArt ? Math.min(8, Math.max(1, Math.ceil(ART_TARGET_PX / Math.max(bw, bh)))) : 1;
    const artKey = hasArt ? this.ensureScaledArt(def, ss) : null;
    const usingArt = artKey !== null;
    const k = usingArt ? ss : 1;
    const key = artKey ?? ensureObjectTexture(this, def).key;

    const opts: Phaser.Types.Physics.Matter.MatterBodyConfig = {
      density: def.density,
      friction: def.friction,
      frictionStatic: def.frictionStatic,
      frictionAir: def.frictionAir,
      restitution: def.restitution,
      isStatic: !dynamic,
      shape:
        def.shape.kind === 'circle'
          ? { type: 'circle', radius: def.shape.radius * def.scale * k }
          : { type: 'rectangle', width: bw * k, height: bh * k },
    };
    const img = this.matter.add.image(a.x, a.y, key, undefined, opts);
    if (k !== 1) img.setScale(1 / k); // shrinks body + display back to footprint; texture stays k× dense
    img.setAngle(Phaser.Math.RadToDeg(a.angle));
    img.setDepth(3);
    img.setData('defId', def.id);
    img.setData('art', usingArt);
    return img;
  }

  /**
   * Draw the bundled art into a texture `ss`× the object's footprint (`arts-<id>-<ss>`)
   * so it can be displayed at footprint size while carrying enough pixels to stay
   * sharp under camera zoom + device pixel ratio. Returns the key, or null if no art.
   */
  private ensureScaledArt(def: GameObjectDef, ss: number): string | null {
    const rawKey = `art-${def.id}`;
    if (!this.textures.exists(rawKey)) return null;
    const scaledKey = `arts-${def.id}-${ss}`;
    if (this.textures.exists(scaledKey)) return scaledKey;
    const bw = Math.max(1, Math.round(def.shape.width * def.scale * ss));
    const bh = Math.max(1, Math.round(def.shape.height * def.scale * ss));
    const src = this.textures.get(rawKey).getSourceImage() as CanvasImageSource;
    const canvas = this.textures.createCanvas(scaledKey, bw, bh);
    if (!canvas) return null;
    canvas.context.clearRect(0, 0, bw, bh);
    canvas.context.imageSmoothingEnabled = true;
    canvas.context.imageSmoothingQuality = 'high';
    canvas.context.drawImage(src, 0, 0, bw, bh);
    canvas.refresh();
    return scaledKey;
  }

  private rebuildTower(): void {
    for (const img of this.towerImages) img.destroy();
    this.towerImages = [];
    for (const a of this.accepted) {
      // The accepted tower is STATIC — rock-solid, no jitter. Only the object
      // being dropped is dynamic; the tower is unfrozen only for a collapse.
      const img = this.makeImage(a, false);
      if (img) this.towerImages.push(img);
    }
  }

  // ---- state machine -------------------------------------------------------

  private setPhase(p: Phase): void {
    this.phase = p;
    this.bridge.emit('phase', p);
  }

  private enterChoosing(): void {
    if (this.newObj) {
      this.newObj.destroy();
      this.newObj = null;
      this.newDef = null;
    }
    this.guide.clear();
    this.bridge.emit('count', this.accepted.length);
    this.bridge.emit('choices', pickChoices());
    this.setPhase('CHOOSING');
    this.frameTower(false, true);
  }

  private onSelect(id: string): void {
    if (this.phase !== 'CHOOSING') return;
    const def = getObjectDef(id);
    if (!def) return;
    this.newDef = def;

    const top = this.towerTopY();
    const oh = def.shape.height * def.scale;
    const spawnY = top - HOVER_GAP - oh / 2;
    // Dynamic body held in place with gravity ignored (toggling isStatic drops
    // the Matter body reference in this build, so we never do that).
    this.newObj = this.makeImage({ defId: id, x: WORLD.centerX, y: spawnY, angle: 0, scaleX: 1, scaleY: 1 }, true);
    if (this.newObj) {
      this.newObj.setIgnoreGravity(true);
      this.newObj.setVelocity(0, 0);
      this.newObj.setDepth(6);
    }
    this.squashed = false;
    this.setPhase('PLACING');
    this.frameTower(true, true);

    if (this.firstAttempt && !this.hintShown) {
      this.hintShown = true;
      this.bridge.emit('hint', true);
    }
  }

  private onRotate(dir: -1 | 1): void {
    if (this.phase !== 'PLACING' || !this.newObj) return;
    this.newObj.setAngle(this.newObj.angle + dir * 7);
    this.consumeHint();
  }

  private onDrop(): void {
    // THE drop-sound trigger. Reached only from the DROP command while actively
    // placing a real object; the phase immediately flips to DROPPING below, so
    // this body runs EXACTLY ONCE per drop. Nothing about selection, dragging,
    // hovering, collisions, tower loading, or server sync passes through here.
    if (this.phase !== 'PLACING' || !this.newObj || !this.newDef) return;
    this.consumeHint();
    this.guide.clear();
    // A small "let go" puff of dust so the release reads as a deliberate action;
    // then gravity does the rest — a real accelerating fall from the hover height.
    this.dustEmitter.emitParticleAt(this.newObj.x, this.newObj.getBounds().bottom, 4);
    this.newObj.setIgnoreGravity(false);
    this.newObj.setVelocity(0, 1); // nudge it off rest so gravity accelerates it in
    this.setPhase('DROPPING');
    // Play this object's unique drop sound — once, here at the commit. Deliberately
    // NOT in the collision handler (which fires repeatedly). Fails silently.
    this.dropAudio.play(this.newDef.id);
    this.dropAt = this.time.now;
    this.calmSince = 0;
    this.squashed = false;
  }

  private onStable(): void {
    if (!this.newObj || !this.newDef) return;
    const b = this.newObj.body as MatterJS.BodyType;
    const rest: Accepted = {
      defId: this.newDef.id,
      x: b.position.x,
      y: b.position.y,
      angle: this.newObj.rotation,
      scaleX: 1,
      scaleY: 1,
    };
    this.accepted.push(rest);
    // Rebuild the whole tower as fresh static bodies (includes the new one) —
    // avoids toggling isStatic on the live body.
    this.newObj.destroy();
    this.newObj = null;
    this.newDef = null;
    this.rebuildTower();

    this.setPhase('SUCCESS');
    const landed = this.towerImages[this.towerImages.length - 1];
    // The pop tween scales the sprite — skip it for supersampled art (its base
    // scale is 1/k and scaling would also re-scale the body). Sparkle covers the juice.
    if (landed && !landed.getData('art')) {
      this.tweens.add({ targets: landed, scaleX: 1.1, scaleY: 1.1, duration: 140, yoyo: true, ease: 'Quad.easeOut' });
    }
    this.sparkle(rest.x, rest.y);
    this.dropAudio.playCue('success'); // IT'S IN — plays once, with the banner

    // Award points for the placement — by risk tier (safe 100 / risky 250 /
    // absurd 500). A "+N" pops up from the landed object and floats away, and the
    // overlay HUD/leaderboard learn the delta via the bridge.
    const def = getObjectDef(rest.defId);
    const difficulty: Difficulty = def ? def.difficulty : 'safe';
    const points = CATEGORY_POINTS[difficulty];
    const landedTop = landed ? landed.getBounds().top : rest.y;
    this.floatPoints(rest.x, landedTop, points, difficulty);
    // A resolved SUCCESSFUL drop: award points and persist the settled body.
    // (Event name is 'resolved' — NOT 'drop', which is the React→scene command.)
    this.bridge.emit('resolved', {
      success: true,
      points,
      body: {
        objectId: rest.defId,
        x: rest.x,
        y: rest.y,
        angle: rest.angle,
        scaleX: rest.scaleX,
        scaleY: rest.scaleY,
      },
    });

    this.bridge.emit('count', this.accepted.length);
    this.bridge.emit('result', { success: true });
    this.time.delayedCall(1050, () => this.enterChoosing());
  }

  /**
   * A "+N" points burst that rises from the landing spot and fades — drawn in
   * world space so it stays pinned to the object as the camera settles. Purely
   * cosmetic; the authoritative tally lives in the React overlay.
   */
  private floatPoints(x: number, y: number, points: number, difficulty: Difficulty): void {
    const color = CATEGORY_TEXT[difficulty];
    const label = this.add
      .text(x, y - 8, `+${points}`, {
        fontFamily: '"Baloo 2", "Nunito", system-ui, sans-serif',
        fontSize: '38px',
        fontStyle: '900',
        color,
        stroke: '#ffffff',
        strokeThickness: 6,
      })
      .setOrigin(0.5, 1)
      .setDepth(30)
      .setScale(0.4);

    this.tweens.add({
      targets: label,
      scale: 1,
      duration: 220,
      ease: 'Back.easeOut',
    });
    this.tweens.add({
      targets: label,
      y: y - 96,
      alpha: 0,
      duration: 1000,
      delay: 240,
      ease: 'Cubic.easeIn',
      onComplete: () => label.destroy(),
    });
  }

  private onCollapse(): void {
    if (this.phase === 'COLLAPSE') return;
    this.setPhase('COLLAPSE');
    this.cameras.main.shake(240, 0.007);
    this.dropAudio.playCue('collapse'); // NOT THIS TIME — plays once, with the banner
    // A failed drop still spends one of the day's drops (0 points, nothing saved).
    this.bridge.emit('resolved', { success: false, points: 0 });
    this.bridge.emit('result', { success: false });
    // The failed object (dynamic) tumbles away; then restore the last stable tower.
    this.time.delayedCall(1250, () => {
      if (this.newObj) {
        this.newObj.destroy();
        this.newObj = null;
        this.newDef = null;
      }
      this.rebuildTower();
      this.frameTower(false, true);
    });
    this.time.delayedCall(2500, () => this.enterChoosing());
  }

  // ---- per-frame -----------------------------------------------------------

  override update(): void {
    if (this.phase === 'PLACING' && this.newObj) {
      this.newObj.setVelocity(0, 0); // hold the hovering object dead-still
      this.drawGuide();
      return;
    }
    if (this.phase !== 'DROPPING' && this.phase !== 'CHECKING') return;
    if (!this.newObj) return;

    const now = this.time.now;
    const elapsed = now - this.dropAt;
    const b = this.newObj.body as MatterJS.BodyType;

    // Fell off entirely → immediate collapse.
    if (b.position.y > WORLD.failLineY + 40 || Math.abs(b.position.x - WORLD.centerX) > WORLD.width / 2 + 120) {
      this.resolveDrop(false);
      return;
    }

    if (this.phase === 'DROPPING' && elapsed > 240) this.setPhase('CHECKING');

    // Wait for the object to GENUINELY come to rest before committing — not just
    // "barely moving". We require its real linear AND angular speed to stay below
    // a small threshold continuously (sleeping is disabled, so body.speed is
    // accurate). A still-falling, sliding, rolling or wobbling object never meets
    // this, so "IT'S IN" only fires once physics has actually settled it.
    const speed = b.speed ?? Math.hypot(b.velocity.x, b.velocity.y);
    const spin = Math.abs(b.angularSpeed ?? b.angularVelocity ?? 0);
    const atRest = speed < REST_SPEED && spin < REST_SPIN;
    if (atRest) {
      if (this.calmSince === 0) this.calmSince = now;
    } else {
      this.calmSince = 0; // any renewed motion resets the timer
    }

    const restedLongEnough = this.calmSince > 0 && now - this.calmSince > STABLE_HOLD;
    if (elapsed > MIN_SETTLE && restedLongEnough) {
      // It stopped moving while still on the tower → success. (It can't be
      // floating: a body in mid-air is never at rest under gravity.)
      this.resolveDrop(true);
      return;
    }
    if (elapsed > MAX_SETTLE) {
      // Safety cap: if it still hasn't settled after this long, only accept it if
      // it happens to be momentarily at rest now, otherwise treat as a failure.
      this.resolveDrop(atRest);
    }
  }

  private resolveDrop(success: boolean): void {
    if (this.phase !== 'DROPPING' && this.phase !== 'CHECKING') return;
    if (success) this.onStable();
    else this.onCollapse();
  }

  // ---- input ---------------------------------------------------------------

  private setupInput(): void {
    this.input.on('pointerdown', (p: Phaser.Input.Pointer) => {
      if (this.phase === 'PLACING') this.dragging = true;
      this.dragTo(p);
    });
    this.input.on('pointermove', (p: Phaser.Input.Pointer) => {
      if (this.dragging) this.dragTo(p);
    });
    this.input.on('pointerup', () => (this.dragging = false));
    this.input.on('gameout', () => (this.dragging = false));

    const kb = this.input.keyboard;
    if (kb) {
      kb.on('keydown-A', () => this.onRotate(-1));
      kb.on('keydown-LEFT', () => this.onRotate(-1));
      kb.on('keydown-D', () => this.onRotate(1));
      kb.on('keydown-RIGHT', () => this.onRotate(1));
      kb.on('keydown-SPACE', () => this.onDrop());
    }
  }

  private dragTo(p: Phaser.Input.Pointer): void {
    if (this.phase !== 'PLACING' || !this.newObj || !this.newDef) return;
    const half = (this.newDef.shape.width * this.newDef.scale) / 2;
    // Clamp to the intersection of the world bounds and what's actually on screen,
    // so the object stays visible while aiming (the camera keeps a constant zoom).
    const wv = this.cameras.main.worldView;
    const lo = Math.max(WORLD.minX + half, wv.left + half + 6);
    const hi = Math.min(WORLD.maxX - half, wv.right - half - 6);
    const x = Phaser.Math.Clamp(p.worldX, Math.min(lo, hi), Math.max(lo, hi));
    this.newObj.setPosition(x, this.newObj.y);
    this.consumeHint();
  }

  private consumeHint(): void {
    if (this.hintShown) {
      this.hintShown = false;
      this.firstAttempt = false;
      this.bridge.emit('hint', false);
    }
  }

  // ---- collisions + effects ------------------------------------------------

  private setupCollisions(): void {
    this.matter.world.on('collisionstart', (event: { pairs: MatterJS.IPair[] }) => {
      if (this.phase !== 'DROPPING' && this.phase !== 'CHECKING' && this.phase !== 'COLLAPSE') return;
      for (const pair of event.pairs) {
        const a = pair.bodyA as MatterJS.BodyType;
        const b = pair.bodyB as MatterJS.BodyType;
        const speed = Math.max(a.speed ?? 0, b.speed ?? 0);
        if (speed < IMPACT_MIN_SPEED) continue;
        const now = this.time.now;
        if (now - this.lastImpact < 55) continue;
        this.lastImpact = now;

        const support = (pair as unknown as { collision?: { supports?: { x: number; y: number }[] } }).collision
          ?.supports?.[0];
        const cx = support?.x ?? (a.position.x + b.position.x) / 2;
        const cy = support?.y ?? (a.position.y + b.position.y) / 2;
        this.impactBurst(cx, cy, Phaser.Math.Clamp(speed / 7, 0.25, 1));

        if (speed > SHAKE_MIN_SPEED) {
          this.cameras.main.shake(110, 0.0016 * Phaser.Math.Clamp(speed / 5, 1, 2.4));
        }
        this.squash();
      }
    });
  }

  private impactBurst(x: number, y: number, strength: number): void {
    const count = 2 + Math.round(strength * 4);
    // two random star colours + a little dust
    const shuffled = Phaser.Utils.Array.Shuffle([...this.starEmitters]);
    shuffled[0]?.emitParticleAt(x, y, count);
    shuffled[1]?.emitParticleAt(x, y, Math.max(1, count - 2));
    this.dustEmitter.emitParticleAt(x, y, 2 + Math.round(strength * 2));
  }

  private squash(): void {
    // Skip the squash scale-tween for supersampled art (scaling it would disturb
    // its 1/k base scale + body); the impact particles carry the feedback.
    if (this.squashed || !this.newObj || this.newObj.getData('art')) return;
    this.squashed = true;
    const img = this.newObj;
    this.tweens.add({
      targets: img,
      scaleX: 1.08,
      scaleY: 0.9,
      duration: 80,
      yoyo: true,
      ease: 'Quad.easeOut',
      onComplete: () => img.setScale(1, 1),
    });
  }

  private sparkle(x: number, y: number): void {
    for (let i = 0; i < this.starEmitters.length; i++) {
      this.starEmitters[i]?.emitParticleAt(
        x + Phaser.Math.Between(-24, 24),
        y + Phaser.Math.Between(-24, 24),
        3
      );
    }
  }

  // ---- camera framing ------------------------------------------------------

  private towerTopY(): number {
    let top: number = WORLD.platformTopY;
    for (const img of this.towerImages) {
      const b = img.getBounds();
      top = Math.min(top, b.top);
    }
    return top;
  }

  /**
   * Horizontal + top extent to frame (platform + tower). Deliberately does NOT
   * widen to the full play area during aiming — that would force a zoom-out and
   * lose focus on the top. The visible width already spans the platform, and the
   * drag is clamped to what's on screen (see dragTo).
   */
  private contentBounds(): { left: number; right: number; top: number } {
    let left = WORLD.centerX - (WORLD.platformWidth + 40) / 2;
    let right = WORLD.centerX + (WORLD.platformWidth + 40) / 2;
    let top: number = WORLD.platformTopY;
    for (const img of this.towerImages) {
      const b = img.getBounds();
      left = Math.min(left, b.left);
      right = Math.max(right, b.right);
      top = Math.min(top, b.top);
    }
    return { left, right, top };
  }

  private frameTower(placing: boolean, animate: boolean): void {
    const cam = this.cameras.main;
    const vw = this.scale.width;
    const vh = this.scale.height;
    if (vw < 2 || vh < 2) return;

    const { left, right, top: rawTop } = this.contentBounds();
    const platformBottom = PLATFORM_TOP + PLATFORM_THICK;
    const headroom = placing && this.newDef ? this.newDef.shape.height * this.newDef.scale + HOVER_GAP + 50 : 46;
    const top = rawTop - headroom;
    const fullSpan = platformBottom - top; // true height of everything to show
    const contentW = right - left + 30;

    // Reserve screen space for the HTML top bar and the compact bottom tray.
    const topInset = Math.min(58, vh * 0.08);
    const bottomInset = placing ? Math.min(104, vh * 0.13) : Math.min(140, vh * 0.19);
    const availH = Math.max(120, vh - topInset - bottomInset);

    // Constant, comfortable zoom: we frame a FIXED window of world height
    // (MIN_VISIBLE_SPAN) rather than the whole tower. A short tower fits inside
    // this window; once it grows taller we keep the same zoom and follow the top,
    // letting the bottom scroll off-screen so the action stays big and focused.
    const zoom = Math.min((vw * 0.94) / contentW, availH / MIN_VISIBLE_SPAN);
    const centerX = (left + right) / 2;
    // Phaser zooms around the camera centre, so the world point shown at screen
    // centre is (scroll + viewport/2), independent of zoom.
    const scrollX = centerX - vw / 2;
    const platformScreenY = vh - bottomInset - 8;

    const follow = fullSpan * zoom > platformScreenY - topInset;
    let scrollY: number;
    if (!follow) {
      // Everything fits above the platform → keep the platform near the bottom.
      scrollY = platformBottom - vh / 2 - (platformScreenY - vh / 2) / zoom;
    } else {
      // Tall tower → anchor the top just under the top bar; the bottom (and the
      // platform) slide off the bottom of the screen, keeping focus up top.
      scrollY = top - vh / 2 - (topInset - vh / 2) / zoom;
    }
    if (animate) {
      this.tweens.add({ targets: cam, zoom, scrollX, scrollY, duration: 400, ease: 'Cubic.easeInOut' });
    } else {
      cam.setZoom(zoom);
      cam.setScroll(scrollX, scrollY);
    }
  }

  // ---- placement guide -----------------------------------------------------

  private drawGuide(): void {
    if (!this.newObj || !this.newDef) return;
    const g = this.guide;
    g.clear();
    const x = this.newObj.x;
    const objBottom = this.newObj.getBounds().bottom;
    const top = this.towerTopY();

    // dashed vertical guide from the object down to the tower top
    g.lineStyle(2, PALETTE.absurd, 0.5);
    const step = 14;
    for (let yy = objBottom + 6; yy < top; yy += step) {
      g.beginPath();
      g.moveTo(x, yy);
      g.lineTo(x, Math.min(yy + 7, top));
      g.strokePath();
    }
    // soft landing shadow on the tower top
    const w = this.newDef.shape.width * this.newDef.scale;
    g.fillStyle(PALETTE.outline, 0.14);
    g.fillEllipse(x, top - 2, w * 0.9, 12);
  }
}

// ---- helpers ---------------------------------------------------------------

function bodyToAccepted(b: PersistedBodyState): Accepted | null {
  if (!getObjectDef(b.objectId)) return null;
  return { defId: b.objectId, x: b.x, y: b.y, angle: b.angle, scaleX: b.scaleX || 1, scaleY: b.scaleY || 1 };
}
