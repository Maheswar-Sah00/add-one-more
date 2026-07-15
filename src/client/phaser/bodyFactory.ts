import Phaser from 'phaser';
import type { ModifierPhysics } from '../../shared/modifiers';
import type { GameObjectDef, RectPart } from '../../shared/objects';

/**
 * The single object factory. Builds the Matter body + a synced view Container
 * for any catalogue shape (rect / circle / poly / compound). The same call is
 * used for a freshly spawned object and for reconstructing one from a persisted
 * transform — passing the saved (x, y, angle) recreates it identically because
 * every shape is centred on its area centroid.
 *
 * `mods` applies the day's modifier (Task 16): density and friction are scaled
 * consistently for every object so all players share the same physics.
 */
export type ObjectInstance = {
  body: MatterJS.BodyType;
  view: Phaser.GameObjects.Container;
};

/** Identity modifier — no scaling (Normal Day / callers that don't pass one). */
const IDENTITY_MODS: ModifierPhysics = { gravityScale: 1, densityScale: 1, frictionScale: 1 };

function physConfig(
  def: GameObjectDef,
  isStatic: boolean,
  mods: ModifierPhysics
): Phaser.Types.Physics.Matter.MatterBodyConfig {
  return {
    density: def.density * mods.densityScale,
    friction: def.friction * mods.frictionScale,
    frictionStatic: def.frictionStatic * mods.frictionScale,
    frictionAir: def.frictionAir,
    restitution: def.restitution,
    isStatic,
    slop: 0.02,
  };
}

/** Area-weighted centroid of rectangular compound parts. */
function rectCentroid(parts: ReadonlyArray<RectPart>): { x: number; y: number } {
  let area = 0;
  let cx = 0;
  let cy = 0;
  for (const p of parts) {
    const a = p.width * p.height;
    area += a;
    cx += a * p.offsetX;
    cy += a * p.offsetY;
  }
  return area > 0 ? { x: cx / area, y: cy / area } : { x: 0, y: 0 };
}

/** Area centroid of a polygon (matches Matter's fromVertices recentring). */
function polyCentroid(
  verts: ReadonlyArray<{ x: number; y: number }>
): { x: number; y: number } {
  let a = 0;
  let cx = 0;
  let cy = 0;
  for (let i = 0; i < verts.length; i++) {
    const p = verts[i]!;
    const q = verts[(i + 1) % verts.length]!;
    const cross = p.x * q.y - q.x * p.y;
    a += cross;
    cx += (p.x + q.x) * cross;
    cy += (p.y + q.y) * cross;
  }
  a *= 0.5;
  if (Math.abs(a) < 1e-6) return { x: 0, y: 0 };
  return { x: cx / (6 * a), y: cy / (6 * a) };
}

function rectGraphics(
  scene: Phaser.Scene,
  def: GameObjectDef,
  cx: number,
  cy: number,
  w: number,
  h: number
): Phaser.GameObjects.Graphics {
  const g = scene.add.graphics();
  g.fillStyle(def.fill, 1);
  g.lineStyle(3, def.stroke, 1);
  g.fillRoundedRect(cx - w / 2, cy - h / 2, w, h, 5);
  g.strokeRoundedRect(cx - w / 2, cy - h / 2, w, h, 5);
  return g;
}

export function createObject(
  scene: Phaser.Scene,
  def: GameObjectDef,
  x: number,
  y: number,
  angle: number,
  isStatic: boolean,
  mods: ModifierPhysics = IDENTITY_MODS
): ObjectInstance {
  const s = def.scale;
  const cfg = physConfig(def, isStatic, mods);
  const container = scene.add.container(x, y);
  let body: MatterJS.BodyType;

  const shape = def.shape;

  // Soft drop shadow behind the art so objects read on the light stage (added
  // first → always behind). Approximated to the bounding box; good enough for a
  // gentle 3D pop.
  const shadow = scene.add.graphics();
  shadow.fillStyle(0x3b3f77, 0.13);
  if (shape.kind === 'circle') {
    shadow.fillCircle(0, 6, shape.radius * s);
  } else {
    const sw = shape.width * s;
    const sh = shape.height * s;
    shadow.fillRoundedRect(-sw / 2, -sh / 2 + 6, sw, sh, 8);
  }
  container.add(shadow);

  switch (shape.kind) {
    case 'rect': {
      const w = shape.width * s;
      const h = shape.height * s;
      body = scene.matter.add.rectangle(x, y, w, h, cfg);
      container.add(rectGraphics(scene, def, 0, 0, w, h));
      break;
    }
    case 'circle': {
      const r = shape.radius * s;
      body = scene.matter.add.circle(x, y, r, cfg);
      const g = scene.add.graphics();
      g.fillStyle(def.fill, 1);
      g.lineStyle(3, def.stroke, 1);
      g.fillCircle(0, 0, r);
      g.strokeCircle(0, 0, r);
      g.fillStyle(0x181a20, 1);
      g.fillCircle(0, 0, r * 0.45); // hub cut-out (tyre look)
      container.add(g);
      break;
    }
    case 'poly': {
      const verts = shape.vertices.map((v) => ({ x: v.x * s, y: v.y * s }));
      const pc = polyCentroid(verts);
      body = scene.matter.add.fromVertices(x, y, [verts], cfg);
      const g = scene.add.graphics();
      g.fillStyle(def.fill, 1);
      g.lineStyle(3, def.stroke, 1);
      const pts = verts.map((v) => new Phaser.Math.Vector2(v.x - pc.x, v.y - pc.y));
      g.fillPoints(pts, true);
      g.strokePoints(pts, true, true);
      container.add(g);
      break;
    }
    case 'compound': {
      const c = rectCentroid(shape.parts);
      // Matter's raw Bodies factory takes its own definition type (not Phaser's
      // MatterBodyConfig), so build a plain options literal for the parts.
      const partOpts = {
        density: def.density * mods.densityScale,
        friction: def.friction * mods.frictionScale,
        frictionStatic: def.frictionStatic * mods.frictionScale,
        frictionAir: def.frictionAir,
        restitution: def.restitution,
        isStatic,
        slop: 0.02,
      };
      const matterParts = shape.parts.map((p) =>
        scene.matter.bodies.rectangle(
          x + (p.offsetX - c.x) * s,
          y + (p.offsetY - c.y) * s,
          p.width * s,
          p.height * s,
          partOpts
        )
      );
      body = scene.matter.body.create({
        parts: matterParts,
        isStatic,
        frictionAir: def.frictionAir,
      });
      scene.matter.world.add(body);
      for (const p of shape.parts) {
        container.add(
          rectGraphics(scene, def, (p.offsetX - c.x) * s, (p.offsetY - c.y) * s, p.width * s, p.height * s)
        );
      }
      break;
    }
  }

  scene.matter.body.setAngle(body, angle);
  container.setPosition(body.position.x, body.position.y);
  container.setRotation(angle);
  return { body, view: container };
}
