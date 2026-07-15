import { describe, expect, it } from 'vitest';
import type { ObjectChoice } from '../../shared/types';
import { buildPreview, hexColor } from './objectPreview';
import {
  difficultyLabel,
  initialSelection,
  isSelected,
  selectionCards,
  tapCard,
} from './selection';

const CHOICES: ObjectChoice[] = [
  { objectId: 'box', name: 'Cardboard Box', difficulty: 'safe', baseScore: 100 },
  { objectId: 'tyre', name: 'Rubber Tyre', difficulty: 'risky', baseScore: 175 },
  { objectId: 'fridge', name: 'Refrigerator', difficulty: 'absurd', baseScore: 275 },
];

describe('selection cards', () => {
  it('maps each server choice to a player-facing card with a blurb and tier label', () => {
    const cards = selectionCards(CHOICES);
    expect(cards).toHaveLength(3);
    expect(cards[0]).toMatchObject({
      objectId: 'box',
      name: 'Cardboard Box',
      difficulty: 'safe',
      difficultyLabel: 'Safe',
      baseScore: 100,
      blurb: 'An honest box. Nothing to prove.',
    });
    expect(cards[1]?.difficultyLabel).toBe('Risky');
    expect(cards[2]?.difficultyLabel).toBe('Absurd');
    expect(cards[2]?.blurb.length).toBeGreaterThan(0);
  });

  it('labels every difficulty tier', () => {
    expect(difficultyLabel('safe')).toBe('Safe');
    expect(difficultyLabel('risky')).toBe('Risky');
    expect(difficultyLabel('absurd')).toBe('Absurd');
  });

  it('NEVER leaks mass / friction / physics numbers into a card', () => {
    const serialized = JSON.stringify(selectionCards(CHOICES));
    for (const banned of ['density', 'friction', 'frictionStatic', 'frictionAir', 'restitution', 'mass']) {
      expect(serialized).not.toContain(banned);
    }
  });

  it('falls back to an empty blurb for an unknown object id', () => {
    const cards = selectionCards([
      { objectId: 'does-not-exist', name: 'Mystery', difficulty: 'safe', baseScore: 100 },
    ]);
    expect(cards[0]?.blurb).toBe('');
  });
});

describe('tap-to-select interaction (mobile)', () => {
  it('first tap selects a card but does not confirm it', () => {
    const { state, confirmedId } = tapCard(initialSelection(), 'box');
    expect(state.selectedId).toBe('box');
    expect(confirmedId).toBeNull();
    expect(isSelected(state, 'box')).toBe(true);
    expect(isSelected(state, 'tyre')).toBe(false);
  });

  it('tapping the already-selected card confirms it (transition to placement)', () => {
    const first = tapCard(initialSelection(), 'tyre');
    const second = tapCard(first.state, 'tyre');
    expect(second.confirmedId).toBe('tyre');
    expect(second.state.selectedId).toBe('tyre');
  });

  it('tapping a different card switches selection without confirming', () => {
    const first = tapCard(initialSelection(), 'box');
    const switched = tapCard(first.state, 'fridge');
    expect(switched.state.selectedId).toBe('fridge');
    expect(switched.confirmedId).toBeNull();
  });
});

describe('object preview geometry', () => {
  it('formats colours as CSS hex', () => {
    expect(hexColor(0xc8a45a)).toBe('#c8a45a');
    expect(hexColor(0x000000)).toBe('#000000');
    expect(hexColor(0xffffff)).toBe('#ffffff');
  });

  it('renders a single rect for a rectangular object', () => {
    const preview = buildPreview('box');
    expect(preview).not.toBeNull();
    expect(preview?.prims).toHaveLength(1);
    expect(preview?.prims[0]?.kind).toBe('rect');
    expect(preview?.fill).toBe('#c8a45a');
  });

  it('renders a circle for a round object', () => {
    expect(buildPreview('tyre')?.prims[0]?.kind).toBe('circle');
  });

  it('renders one rect per part for a compound object', () => {
    // The wooden chair is a 4-part compound (seat, back, two legs).
    const preview = buildPreview('chair');
    expect(preview?.prims).toHaveLength(4);
    expect(preview?.prims.every((p) => p.kind === 'rect')).toBe(true);
  });

  it('renders a polygon for a poly object', () => {
    const preview = buildPreview('canoe');
    expect(preview?.prims[0]?.kind).toBe('poly');
    const first = preview?.prims[0];
    if (first?.kind === 'poly') {
      expect(first.points.split(' ').length).toBeGreaterThanOrEqual(3);
    }
  });

  it('keeps all preview coordinates inside the box bounds', () => {
    const size = 64;
    const preview = buildPreview('sofa', size, 8);
    for (const prim of preview?.prims ?? []) {
      if (prim.kind === 'rect') {
        expect(prim.x).toBeGreaterThanOrEqual(-0.01);
        expect(prim.x + prim.w).toBeLessThanOrEqual(size + 0.01);
      }
    }
  });

  it('returns null for an unknown object id', () => {
    expect(buildPreview('nope')).toBeNull();
  });
});
