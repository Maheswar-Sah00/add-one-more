import type { SubmittedBody } from '../../shared/api';
import { RULES, VALIDATION, WORLD } from '../../shared/config';
import { getObjectDef } from '../../shared/objects';
import type { PersistedBodyState } from '../../shared/types';

export type ValidationResult = { ok: true } | { ok: false; message: string };

function fail(message: string): ValidationResult {
  return { ok: false, message };
}

function isFinite5(b: SubmittedBody): boolean {
  return [b.x, b.y, b.angle, b.scaleX, b.scaleY].every(
    (n) => typeof n === 'number' && Number.isFinite(n)
  );
}

/**
 * Structural commit validation (§18). The server cannot re-run Matter.js, so it
 * enforces every invariant it *can* verify: exactly one new body, no dropped or
 * injected bodies, in-bounds finite transforms, and no implausible teleports of
 * previously-accepted bodies.
 */
export function validateCommit(params: {
  existing: readonly PersistedBodyState[];
  submitted: readonly SubmittedBody[];
  newBodyId: string;
  selectedObjectId: string;
  issuedObjectIds: readonly string[];
}): ValidationResult {
  const { existing, submitted, newBodyId, selectedObjectId, issuedObjectIds } = params;

  if (!issuedObjectIds.includes(selectedObjectId)) {
    return fail('object was not offered for this attempt');
  }
  if (!getObjectDef(selectedObjectId)) return fail('unknown object');

  if (submitted.length !== existing.length + 1) {
    return fail('snapshot must add exactly one body');
  }
  if (submitted.length > RULES.maxObjectsPerTower) return fail('tower is full');

  const ids = new Set<string>();
  for (const b of submitted) {
    if (ids.has(b.bodyId)) return fail('duplicate body id in snapshot');
    ids.add(b.bodyId);
    if (!isFinite5(b)) return fail('non-finite transform');
    if (b.x < WORLD.minX || b.x > WORLD.maxX) return fail('body left horizontal bounds');
    if (b.y < WORLD.ceilingY || b.y > WORLD.failLineY) return fail('body left vertical bounds');
    if (b.scaleX < VALIDATION.minScale || b.scaleX > VALIDATION.maxScale) return fail('bad scaleX');
    if (b.scaleY < VALIDATION.minScale || b.scaleY > VALIDATION.maxScale) return fail('bad scaleY');
  }
  if (!ids.has(newBodyId)) return fail('new body missing from snapshot');

  const existingById = new Map(existing.map((e) => [e.bodyId, e]));
  if (existingById.has(newBodyId)) return fail('new body id collides with an accepted body');

  const newBody = submitted.find((b) => b.bodyId === newBodyId);
  if (!newBody) return fail('new body missing');
  if (newBody.objectId !== selectedObjectId) return fail('new body object mismatch');
  if (newBody.y > WORLD.failLineY) return fail('new body is below the fail line');

  for (const b of submitted) {
    if (b.bodyId === newBodyId) continue;
    const prev = existingById.get(b.bodyId);
    if (!prev) return fail('unexpected body id in snapshot');
    if (prev.objectId !== b.objectId) return fail('accepted body object id changed');
    if (Math.hypot(b.x - prev.x, b.y - prev.y) > VALIDATION.maxDisplacement) {
      return fail('an accepted body moved implausibly');
    }
  }

  for (const e of existing) {
    if (!ids.has(e.bodyId)) return fail('an accepted body is missing from the snapshot');
  }

  return { ok: true };
}
