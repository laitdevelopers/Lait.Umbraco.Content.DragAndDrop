import { describe, it, expect } from 'vitest';
import { reduceKey, type KbCandidate, type KbState } from '../src/keyboard';

// Tree:  A (parent null)
//        ├ B (parent A)
//        └ C (parent A)
//        D (parent null)
// Source being moved = B. Candidates in visual order, B marked blocked
// (can't target itself); descendants of B would also be blocked.
const candidates: KbCandidate[] = [
  { unique: 'A', parentUnique: null, blocked: false },
  { unique: 'B', parentUnique: 'A', blocked: true },
  { unique: 'C', parentUnique: 'A', blocked: false },
  { unique: 'D', parentUnique: null, blocked: false },
];

const start: KbState = { sourceUnique: 'B', targetIndex: 0, zone: 'before' };

describe('reduceKey', () => {
  it('ArrowDown advances to the next non-blocked candidate', () => {
    const r = reduceKey(start, 'ArrowDown', candidates);
    expect(r.type).toBe('none');
    // index 0 (A) → skip 1 (B, blocked) → land on 2 (C)
    expect(r.state?.targetIndex).toBe(2);
    expect(r.state?.zone).toBe('before');
  });

  it('ArrowUp moves to the previous non-blocked candidate, clamped at 0', () => {
    const mid: KbState = { sourceUnique: 'B', targetIndex: 2, zone: 'before' };
    expect(reduceKey(mid, 'ArrowUp', candidates).state?.targetIndex).toBe(0);
    // already at 0 → stays at 0
    expect(reduceKey(start, 'ArrowUp', candidates).state?.targetIndex).toBe(0);
  });

  it('ArrowDown clamps at the last index', () => {
    const last: KbState = { sourceUnique: 'B', targetIndex: 3, zone: 'before' };
    expect(reduceKey(last, 'ArrowDown', candidates).state?.targetIndex).toBe(3);
  });

  it('ArrowRight nests INTO the current target', () => {
    const r = reduceKey(start, 'ArrowRight', candidates);
    expect(r.state?.zone).toBe('into');
    expect(r.state?.targetIndex).toBe(0);
  });

  it('ArrowLeft pops OUT to the parent row (after it)', () => {
    // target C (index 2, parent A) + ArrowLeft → jump to A (index 0), zone after
    const onC: KbState = { sourceUnique: 'B', targetIndex: 2, zone: 'before' };
    const r = reduceKey(onC, 'ArrowLeft', candidates);
    expect(r.state?.targetIndex).toBe(0); // A
    expect(r.state?.zone).toBe('after');
  });

  it('ArrowLeft on a top-level row is a no-op (no parent)', () => {
    const onD: KbState = { sourceUnique: 'B', targetIndex: 3, zone: 'before' };
    const r = reduceKey(onD, 'ArrowLeft', candidates);
    expect(r.type).toBe('none');
    expect(r.state?.targetIndex).toBe(3);
    expect(r.state?.zone).toBe('before');
  });

  it('Space (or Enter) commits the current state', () => {
    expect(reduceKey(start, ' ', candidates).type).toBe('commit');
    expect(reduceKey(start, 'Enter', candidates).type).toBe('commit');
  });

  it('does not commit when the resolved target is blocked', () => {
    const onB: KbState = { sourceUnique: 'B', targetIndex: 1, zone: 'into' };
    expect(reduceKey(onB, ' ', candidates).type).toBe('none');
  });

  it('Escape cancels', () => {
    expect(reduceKey(start, 'Escape', candidates).type).toBe('cancel');
  });

  it('ignores unrelated keys', () => {
    const r = reduceKey(start, 'a', candidates);
    expect(r.type).toBe('none');
    expect(r.state).toEqual(start);
  });
});
