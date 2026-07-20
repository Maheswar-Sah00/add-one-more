/**
 * Shared object rendering + helpers for the gameplay stage.
 *
 * The same object-shape data (`src/shared/objects.ts`) drives BOTH the Phaser
 * physics/render textures and the small HTML tray icons, so a "Book" looks the
 * same whether it's stacked in the tower or shown as a choice. Art is the
 * catalogue's coherent flat-shaded style: one dark outline + flat fill, matching
 * the warm, playful illustration language of the splash.
 */
import Phaser from 'phaser';
import { OBJECT_LIBRARY, objectsByTier, type GameObjectDef } from '../../shared/objects';
import type { Difficulty } from '../../shared/types';

/** Warm palette shared with the CSS overlay (kept in sync with the splash). */
export const PALETTE = {
  cream: 0xf6efdd,
  creamDeep: 0xefe6d0,
  ink: 0x2f2540,
  outline: 0x3a2b20,
  platform: 0xcdb890,
  platformTop: 0xdcc9a3,
  safe: 0x6ea8d8,
  risky: 0xe6a91e,
  absurd: 0xe8794a,
  star: [0xf4c02c, 0xe8794a, 0x6ea8d8, 0xfbf3df] as const,
} as const;

export const hex = (n: number): string => '#' + (n & 0xffffff).toString(16).padStart(6, '0');

export const CATEGORY_LABEL: Record<Difficulty, string> = {
  safe: 'SAFE',
  risky: 'RISKY',
  absurd: 'ABSURD',
};
export const CATEGORY_HEX: Record<Difficulty, string> = {
  safe: hex(PALETTE.safe),
  risky: hex(PALETTE.risky),
  absurd: hex(PALETTE.absurd),
};

// ---- object geometry (used by both Phaser + SVG) ---------------------------

export type Prim =
  | { t: 'rect'; x: number; y: number; w: number; h: number }
  | { t: 'circle'; x: number; y: number; r: number }
  | { t: 'poly'; pts: { x: number; y: number }[] };

/** Local-space (centred) drawing primitives + bounding box for an object def. */
export function objectPrims(def: GameObjectDef): { prims: Prim[]; w: number; h: number } {
  const s = def.shape;
  if (s.kind === 'rect') return { prims: [{ t: 'rect', x: 0, y: 0, w: s.width, h: s.height }], w: s.width, h: s.height };
  if (s.kind === 'circle') return { prims: [{ t: 'circle', x: 0, y: 0, r: s.radius }], w: s.width, h: s.height };
  if (s.kind === 'poly') return { prims: [{ t: 'poly', pts: s.vertices.map((v) => ({ x: v.x, y: v.y })) }], w: s.width, h: s.height };
  return { prims: s.parts.map((p) => ({ t: 'rect' as const, x: p.offsetX, y: p.offsetY, w: p.width, h: p.height })), w: s.width, h: s.height };
}

/** Build an SVG string for a tray icon that fits within `size`×`size`. */
export function objectIconSvg(def: GameObjectDef, size = 40): string {
  const { prims, w, h } = objectPrims(def);
  const pad = 6;
  const k = (size - pad * 2) / Math.max(w, h);
  const fill = hex(def.fill);
  const stroke = hex(def.stroke);
  const sw = Math.max(2.2, 3 / k);
  const tx = size / 2;
  const ty = size / 2;
  const parts = prims
    .map((p) => {
      if (p.t === 'rect') {
        const rx = Math.min(6, p.w / 4, p.h / 4);
        return `<rect x="${(p.x - p.w / 2).toFixed(1)}" y="${(p.y - p.h / 2).toFixed(1)}" width="${p.w}" height="${p.h}" rx="${rx.toFixed(1)}" fill="${fill}" stroke="${stroke}" stroke-width="${sw.toFixed(2)}"/>`;
      }
      if (p.t === 'circle') {
        return `<circle cx="${p.x}" cy="${p.y}" r="${p.r}" fill="${fill}" stroke="${stroke}" stroke-width="${sw.toFixed(2)}"/>`;
      }
      const pts = p.pts.map((v) => `${v.x},${v.y}`).join(' ');
      return `<polygon points="${pts}" fill="${fill}" stroke="${stroke}" stroke-width="${sw.toFixed(2)}" stroke-linejoin="round"/>`;
    })
    .join('');
  return `<svg viewBox="0 0 ${size} ${size}" width="${size}" height="${size}" xmlns="http://www.w3.org/2000/svg"><g transform="translate(${tx} ${ty}) scale(${k.toFixed(3)})" stroke-linejoin="round">${parts}</g></svg>`;
}

// ---- Phaser textures -------------------------------------------------------

/** Texture key + pixel size for an object, generated on first use. */
export function ensureObjectTexture(scene: Phaser.Scene, def: GameObjectDef): { key: string; w: number; h: number } {
  const { prims, w, h } = objectPrims(def);
  const scale = def.scale;
  const pad = 4;
  const texW = Math.ceil(w * scale) + pad * 2;
  const texH = Math.ceil(h * scale) + pad * 2;
  const key = `obj-${def.id}`;
  if (scene.textures.exists(key)) return { key, w: texW, h: texH };

  const g = scene.add.graphics();
  const cx = texW / 2;
  const cy = texH / 2;
  g.lineStyle(3, def.stroke, 1);
  g.fillStyle(def.fill, 1);
  for (const p of prims) {
    if (p.t === 'rect') {
      const pw = p.w * scale;
      const ph = p.h * scale;
      const x = cx + p.x * scale - pw / 2;
      const y = cy + p.y * scale - ph / 2;
      const r = Math.min(7, pw / 4, ph / 4);
      g.fillRoundedRect(x, y, pw, ph, r);
      g.strokeRoundedRect(x, y, pw, ph, r);
    } else if (p.t === 'circle') {
      g.fillCircle(cx + p.x * scale, cy + p.y * scale, p.r * scale);
      g.strokeCircle(cx + p.x * scale, cy + p.y * scale, p.r * scale);
    } else {
      const pts = p.pts.map((v) => new Phaser.Math.Vector2(cx + v.x * scale, cy + v.y * scale));
      g.fillPoints(pts, true);
      g.strokePoints(pts, true, true);
    }
  }
  g.generateTexture(key, texW, texH);
  g.destroy();
  return { key, w: texW, h: texH };
}

/** A small 4-point star texture for impact particles. */
export function ensureStarTexture(scene: Phaser.Scene, key: string, color: number, size = 14): string {
  if (scene.textures.exists(key)) return key;
  const g = scene.add.graphics();
  g.fillStyle(color, 1);
  const c = size / 2;
  const o = size / 2;
  const i = size / 6;
  const pts = [
    new Phaser.Math.Vector2(c, c - o),
    new Phaser.Math.Vector2(c + i, c - i),
    new Phaser.Math.Vector2(c + o, c),
    new Phaser.Math.Vector2(c + i, c + i),
    new Phaser.Math.Vector2(c, c + o),
    new Phaser.Math.Vector2(c - i, c + i),
    new Phaser.Math.Vector2(c - o, c),
    new Phaser.Math.Vector2(c - i, c - i),
  ];
  g.fillPoints(pts, true);
  g.generateTexture(key, size, size);
  g.destroy();
  return key;
}

/** A soft round dust texture. */
export function ensureDustTexture(scene: Phaser.Scene, key = 'dust', color = 0xd8c9a6, size = 10): string {
  if (scene.textures.exists(key)) return key;
  const g = scene.add.graphics();
  g.fillStyle(color, 1);
  g.fillCircle(size / 2, size / 2, size / 2);
  g.generateTexture(key, size, size);
  g.destroy();
  return key;
}

// ---- choices ---------------------------------------------------------------

export type Choice = { id: string; name: string; category: Difficulty };

const TIERS: Difficulty[] = ['safe', 'risky', 'absurd'];

/** Pick one object per tier — the SAFE / RISKY / ABSURD trio. */
export function pickChoices(): Choice[] {
  return TIERS.map((tier) => {
    const pool = objectsByTier(tier);
    const def = pool[Math.floor(Math.random() * pool.length)] ?? OBJECT_LIBRARY[0]!;
    return { id: def.id, name: def.name, category: tier };
  });
}
