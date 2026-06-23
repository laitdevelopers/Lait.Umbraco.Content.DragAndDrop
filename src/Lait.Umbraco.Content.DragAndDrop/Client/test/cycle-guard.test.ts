import { describe, it, expect } from 'vitest';
import { isBlockedTarget } from '../src/cycle-guard';

describe('isBlockedTarget', () => {
  it('blocks dropping a node onto itself', () => {
    expect(isBlockedTarget('x', 'x', new Set())).toBe(true);
  });

  it('blocks dropping a node into one of its descendants', () => {
    expect(isBlockedTarget('child', 'parent', new Set(['child', 'grandchild']))).toBe(true);
  });

  it('allows an unrelated target', () => {
    expect(isBlockedTarget('other', 'src', new Set(['a', 'b']))).toBe(false);
  });

  it('allows when there are no descendants and target differs from source', () => {
    expect(isBlockedTarget('t', 's', new Set())).toBe(false);
  });
});
