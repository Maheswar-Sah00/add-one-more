import type { Difficulty } from './types';

/** Audio material category — drives collision sound selection later (§8). */
export type ObjectMaterial =
  | 'wood'
  | 'metal'
  | 'plastic'
  | 'glass'
  | 'fabric'
  | 'rubber'
  | 'ceramic';

/** One convex rectangular part of a compound body, offset from the object origin. */
export type RectPart = {
  readonly offsetX: number;
  readonly offsetY: number;
  readonly width: number;
  readonly height: number;
};

/**
 * Collision shape. Polygons must be CONVEX. Compound bodies are built from
 * rectangular parts (kept rect-only so the factory can compute an exact
 * area-weighted centroid, which keeps reconstruction from persisted transforms
 * stable). `width`/`height` are the bounding box (used for spawn + drag clamp).
 */
export type ObjectShape =
  | { readonly kind: 'rect'; readonly width: number; readonly height: number }
  | { readonly kind: 'circle'; readonly width: number; readonly height: number; readonly radius: number }
  | {
      readonly kind: 'poly';
      readonly width: number;
      readonly height: number;
      readonly vertices: ReadonlyArray<{ readonly x: number; readonly y: number }>;
    }
  | {
      readonly kind: 'compound';
      readonly width: number;
      readonly height: number;
      readonly parts: ReadonlyArray<RectPart>;
    };

export type GameObjectDef = {
  readonly id: string;
  readonly name: string;
  readonly difficulty: Difficulty;
  readonly baseScore: number;
  readonly shape: ObjectShape;
  /** Geometry multiplier baked into the body + art at creation. */
  readonly scale: number;
  /** Placeholder-art fill / stroke colours (0xRRGGBB). */
  readonly fill: number;
  readonly stroke: number;
  /** Physics — Matter derives mass from area * density. */
  readonly density: number;
  readonly friction: number;
  readonly frictionStatic: number;
  /** Air friction (linear drag). */
  readonly frictionAir: number;
  readonly restitution: number;
  readonly material: ObjectMaterial;
  /** Suggested +/- rotation range (degrees), surfaced as a hint. */
  readonly safeRotationDeg: number;
  /** Extra vertical gap above the current tower top when spawning. */
  readonly spawnOffsetY: number;
  readonly blurb: string;
};

// --- helpers for concise, DRY definitions ----------------------------------

type Phys = Pick<
  GameObjectDef,
  'density' | 'friction' | 'frictionStatic' | 'frictionAir' | 'restitution'
>;

const WOOD: Phys = { density: 0.0014, friction: 0.7, frictionStatic: 0.9, frictionAir: 0.01, restitution: 0.06 };
const METAL: Phys = { density: 0.002, friction: 0.55, frictionStatic: 0.75, frictionAir: 0.01, restitution: 0.05 };
const PLASTIC: Phys = { density: 0.0011, friction: 0.6, frictionStatic: 0.8, frictionAir: 0.012, restitution: 0.1 };
const GLASS: Phys = { density: 0.0018, friction: 0.5, frictionStatic: 0.7, frictionAir: 0.01, restitution: 0.03 };
const FABRIC: Phys = { density: 0.0009, friction: 0.95, frictionStatic: 1.15, frictionAir: 0.02, restitution: 0.02 };
const RUBBER: Phys = { density: 0.001, friction: 0.9, frictionStatic: 1.0, frictionAir: 0.015, restitution: 0.35 };
const CERAMIC: Phys = { density: 0.0026, friction: 0.9, frictionStatic: 1.15, frictionAir: 0.01, restitution: 0.02 };

/**
 * The playable catalogue — 15 objects, 5 per risk tier (§8). Placeholder art is
 * one coherent flat-shaded style (no mixed third-party assets).
 */
export const OBJECT_LIBRARY: readonly GameObjectDef[] = [
  // ---------- SAFE ----------
  {
    id: 'box', name: 'Cardboard Box', difficulty: 'safe', baseScore: 100,
    shape: { kind: 'rect', width: 54, height: 40 },
    scale: 1, fill: 0xc8a45a, stroke: 0x8a6d33, material: 'fabric',
    safeRotationDeg: 22, spawnOffsetY: 0, ...FABRIC,
    blurb: 'An honest box. Nothing to prove.',
  },
  {
    id: 'book', name: 'Hardback Book', difficulty: 'safe', baseScore: 100,
    shape: { kind: 'rect', width: 64, height: 37 },
    scale: 1, fill: 0x3f7d6e, stroke: 0x1f3f38, material: 'fabric',
    safeRotationDeg: 20, spawnOffsetY: 0, ...FABRIC, restitution: 0.02,
    blurb: 'Wide, flat, forgiving. The responsible choice.',
  },
  {
    id: 'brick', name: 'Clay Brick', difficulty: 'safe', baseScore: 100,
    shape: { kind: 'rect', width: 66, height: 28 },
    scale: 1, fill: 0xb5613b, stroke: 0x6e3722, material: 'ceramic',
    safeRotationDeg: 25, spawnOffsetY: 0, ...CERAMIC,
    blurb: 'Heavy and honest. A good foundation stone.',
  },
  {
    id: 'cushion', name: 'Sofa Cushion', difficulty: 'safe', baseScore: 100,
    shape: { kind: 'rect', width: 83, height: 38 },
    scale: 1, fill: 0x9d6ea3, stroke: 0x5f3f64, material: 'fabric',
    safeRotationDeg: 24, spawnOffsetY: 0, ...FABRIC, friction: 1.1, frictionStatic: 1.3,
    blurb: 'Soft, grippy, and weirdly reliable.',
  },
  {
    id: 'tray', name: 'Cafeteria Tray', difficulty: 'safe', baseScore: 100,
    shape: { kind: 'rect', width: 66, height: 22 },
    scale: 1, fill: 0x7d97a8, stroke: 0x465967, material: 'plastic',
    safeRotationDeg: 18, spawnOffsetY: 0, ...PLASTIC, restitution: 0.06,
    blurb: 'A flat little bridge for braver things.',
  },

  // ---------- RISKY ----------
  {
    id: 'chair', name: 'Wooden Chair', difficulty: 'risky', baseScore: 175,
    shape: {
      kind: 'compound', width: 59, height: 68,
      parts: [
        { offsetX: 0, offsetY: -6, width: 48, height: 12 }, // seat
        { offsetX: -18, offsetY: -32, width: 12, height: 44 }, // back
        { offsetX: -16, offsetY: 20, width: 8, height: 30 }, // front leg
        { offsetX: 16, offsetY: 20, width: 8, height: 30 }, // back leg
      ],
    },
    scale: 1, fill: 0xc98a3c, stroke: 0x7a4f1d, material: 'wood',
    safeRotationDeg: 15, spawnOffsetY: 10, ...WOOD,
    blurb: 'Tall and top-heavy. It has opinions about balance.',
  },
  {
    id: 'lamp', name: 'Desk Lamp', difficulty: 'risky', baseScore: 175,
    shape: {
      kind: 'compound', width: 60, height: 69,
      parts: [
        { offsetX: 0, offsetY: 32, width: 46, height: 10 }, // base
        { offsetX: 0, offsetY: 2, width: 8, height: 52 }, // stem
        { offsetX: 8, offsetY: -30, width: 34, height: 16 }, // shade
      ],
    },
    scale: 1, fill: 0x6c7ac9, stroke: 0x3a4585, material: 'metal',
    safeRotationDeg: 12, spawnOffsetY: 10, ...METAL,
    blurb: 'Broad base, wobbly ambitions.',
  },
  {
    id: 'tyre', name: 'Rubber Tyre', difficulty: 'risky', baseScore: 175,
    shape: { kind: 'circle', width: 64, height: 64, radius: 32 },
    scale: 1, fill: 0x2f333c, stroke: 0x14161b, material: 'rubber',
    safeRotationDeg: 30, spawnOffsetY: 6, ...RUBBER,
    blurb: 'It bounces. It rolls. It regrets nothing.',
  },
  {
    id: 'television', name: 'Old Television', difficulty: 'risky', baseScore: 175,
    shape: { kind: 'rect', width: 75, height: 55 },
    scale: 1, fill: 0x4b5563, stroke: 0x262b33, material: 'glass',
    safeRotationDeg: 14, spawnOffsetY: 4, ...GLASS,
    blurb: 'A cube of pure center-of-gravity anxiety.',
  },
  {
    id: 'plant', name: 'Potted Plant', difficulty: 'risky', baseScore: 175,
    shape: {
      kind: 'compound', width: 55, height: 72,
      parts: [
        { offsetX: 0, offsetY: 20, width: 40, height: 34 }, // pot
        { offsetX: 0, offsetY: -2, width: 50, height: 10 }, // rim
        { offsetX: 0, offsetY: -26, width: 30, height: 32 }, // foliage
      ],
    },
    scale: 1, fill: 0x5b8c53, stroke: 0x35522f, material: 'ceramic',
    safeRotationDeg: 16, spawnOffsetY: 8, ...CERAMIC, density: 0.0016,
    blurb: 'Photosynthesis will not save it now.',
  },

  // ---------- ABSURD ----------
  {
    id: 'fridge', name: 'Refrigerator', difficulty: 'absurd', baseScore: 275,
    shape: { kind: 'rect', width: 92, height: 104 },
    scale: 1, fill: 0xd8dbe2, stroke: 0x8a8f9c, material: 'metal',
    safeRotationDeg: 8, spawnOffsetY: 12, ...METAL, density: 0.0022,
    blurb: 'Absolutely not. And yet — the community demands it.',
  },
  {
    id: 'sofa', name: 'Two-Seat Sofa', difficulty: 'absurd', baseScore: 275,
    shape: {
      kind: 'compound', width: 130, height: 67,
      parts: [
        { offsetX: 0, offsetY: 14, width: 120, height: 28 }, // base
        { offsetX: 0, offsetY: -14, width: 104, height: 26 }, // backrest
        { offsetX: -58, offsetY: -2, width: 16, height: 44 }, // left arm
        { offsetX: 58, offsetY: -2, width: 16, height: 44 }, // right arm
      ],
    },
    scale: 1, fill: 0xb5654f, stroke: 0x6e3a2c, material: 'fabric',
    safeRotationDeg: 10, spawnOffsetY: 14, ...FABRIC, density: 0.0012,
    blurb: 'It seats two and endangers everyone.',
  },
  {
    id: 'bathtub', name: 'Cast-Iron Bathtub', difficulty: 'absurd', baseScore: 275,
    shape: {
      kind: 'compound', width: 122, height: 55,
      parts: [
        { offsetX: 0, offsetY: 24, width: 96, height: 16 }, // floor
        { offsetX: -47, offsetY: 2, width: 14, height: 48 }, // left wall
        { offsetX: 47, offsetY: 2, width: 14, height: 48 }, // right wall
      ],
    },
    scale: 1, fill: 0xe4e7ec, stroke: 0x9aa0ad, material: 'metal',
    safeRotationDeg: 9, spawnOffsetY: 12, ...METAL, density: 0.0024,
    blurb: 'An open invitation for smaller objects to nap inside.',
  },
  {
    id: 'canoe', name: 'Fibreglass Canoe', difficulty: 'absurd', baseScore: 275,
    shape: {
      kind: 'poly', width: 137, height: 30,
      vertices: [
        { x: -64, y: -6 },
        { x: -44, y: -18 },
        { x: 44, y: -18 },
        { x: 64, y: -6 },
        { x: 40, y: 12 },
        { x: -40, y: 12 },
      ],
    },
    scale: 1, fill: 0x3f7fae, stroke: 0x224b6a, material: 'plastic',
    safeRotationDeg: 12, spawnOffsetY: 10, ...PLASTIC, density: 0.0012,
    blurb: 'Perfectly stable on water. This is not water.',
  },
  {
    id: 'duck', name: 'Giant Rubber Duck', difficulty: 'absurd', baseScore: 275,
    shape: {
      kind: 'compound', width: 99, height: 96,
      parts: [
        { offsetX: -6, offsetY: 12, width: 72, height: 60 }, // body
        { offsetX: 30, offsetY: -28, width: 34, height: 34 }, // head
        { offsetX: -44, offsetY: -2, width: 22, height: 18 }, // tail
      ],
    },
    scale: 1, fill: 0xf4c430, stroke: 0xb8891a, material: 'rubber',
    safeRotationDeg: 14, spawnOffsetY: 12, ...RUBBER, density: 0.0009,
    blurb: 'The community has been waiting for this. God help us.',
  },
];

const BY_ID: ReadonlyMap<string, GameObjectDef> = new Map(
  OBJECT_LIBRARY.map((o) => [o.id, o])
);

export function getObjectDef(id: string): GameObjectDef | undefined {
  return BY_ID.get(id);
}

export function objectsByTier(tier: Difficulty): readonly GameObjectDef[] {
  return OBJECT_LIBRARY.filter((o) => o.difficulty === tier);
}

export const DIFFICULTY_ORDER: readonly Difficulty[] = ['safe', 'risky', 'absurd'];

/**
 * Validate every definition: finite numbers, positive sizes, well-formed shapes,
 * unique ids, and at least one object per tier. Returns a list of problems
 * (empty when the catalogue is sound). Used by the dev gallery and can back a
 * dev-time assertion.
 */
export function validateCatalogue(): string[] {
  const errors: string[] = [];
  const seen = new Set<string>();
  const finite = (label: string, ...vals: number[]) => {
    for (const v of vals) if (!Number.isFinite(v)) errors.push(`${label}: non-finite value`);
  };

  for (const o of OBJECT_LIBRARY) {
    if (seen.has(o.id)) errors.push(`duplicate id: ${o.id}`);
    seen.add(o.id);
    finite(o.id, o.baseScore, o.scale, o.density, o.friction, o.frictionStatic, o.frictionAir, o.restitution, o.safeRotationDeg, o.spawnOffsetY);
    if (o.scale <= 0) errors.push(`${o.id}: scale must be > 0`);
    if (o.density <= 0) errors.push(`${o.id}: density must be > 0`);

    const s = o.shape;
    if (s.width <= 0 || s.height <= 0) errors.push(`${o.id}: non-positive bounds`);
    if (s.kind === 'poly') {
      if (s.vertices.length < 3) errors.push(`${o.id}: poly needs >= 3 vertices`);
      for (const v of s.vertices) finite(`${o.id} vertex`, v.x, v.y);
    } else if (s.kind === 'circle') {
      if (s.radius <= 0) errors.push(`${o.id}: radius must be > 0`);
    } else if (s.kind === 'compound') {
      if (s.parts.length < 1) errors.push(`${o.id}: compound needs >= 1 part`);
      for (const p of s.parts) {
        finite(`${o.id} part`, p.offsetX, p.offsetY, p.width, p.height);
        if (p.width <= 0 || p.height <= 0) errors.push(`${o.id}: non-positive part size`);
      }
    }
  }
  for (const tier of DIFFICULTY_ORDER) {
    if (objectsByTier(tier).length === 0) errors.push(`no objects in tier: ${tier}`);
  }
  return errors;
}
