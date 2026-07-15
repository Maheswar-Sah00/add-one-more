/**
 * Object-selection visual previews (Task 11). Turns a catalogue object's
 * collision geometry into simple, centered SVG primitives so each choice card
 * can show what the object LOOKS like — never its physics numbers. Pure and
 * DOM-free: it emits geometry + colours the React card renders as an <svg>.
 */
import { getObjectDef } from '../../shared/objects';

export type PreviewPrim =
  | { readonly kind: 'rect'; readonly x: number; readonly y: number; readonly w: number; readonly h: number }
  | { readonly kind: 'circle'; readonly cx: number; readonly cy: number; readonly r: number }
  | { readonly kind: 'poly'; readonly points: string };

export type ObjectPreview = {
  readonly size: number;
  readonly fill: string;
  readonly stroke: string;
  readonly prims: readonly PreviewPrim[];
};

/** 0xRRGGBB integer → CSS hex string. */
export function hexColor(value: number): string {
  return `#${(value & 0xffffff).toString(16).padStart(6, '0')}`;
}

/**
 * Build a preview fitted into a `size`×`size` box with `pad` breathing room.
 * The object origin maps to the box centre; compound parts and polygon vertices
 * are offset from there, mirroring how the physics factory lays them out.
 */
export function buildPreview(objectId: string, size = 64, pad = 8): ObjectPreview | null {
  const def = getObjectDef(objectId);
  if (!def) return null;

  const shape = def.shape;
  const span = Math.max(shape.width, shape.height) || 1;
  const scale = (size - pad * 2) / span;
  const c = size / 2;
  const prims: PreviewPrim[] = [];

  const addRect = (ox: number, oy: number, w: number, h: number): void => {
    prims.push({
      kind: 'rect',
      x: c + (ox - w / 2) * scale,
      y: c + (oy - h / 2) * scale,
      w: w * scale,
      h: h * scale,
    });
  };

  switch (shape.kind) {
    case 'rect':
      addRect(0, 0, shape.width, shape.height);
      break;
    case 'circle':
      prims.push({ kind: 'circle', cx: c, cy: c, r: shape.radius * scale });
      break;
    case 'compound':
      for (const part of shape.parts) addRect(part.offsetX, part.offsetY, part.width, part.height);
      break;
    case 'poly': {
      const points = shape.vertices
        .map((v) => `${(c + v.x * scale).toFixed(2)},${(c + v.y * scale).toFixed(2)}`)
        .join(' ');
      prims.push({ kind: 'poly', points });
      break;
    }
  }

  return { size, fill: hexColor(def.fill), stroke: hexColor(def.stroke), prims };
}
