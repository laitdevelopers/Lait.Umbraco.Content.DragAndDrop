import { describe, it, expect } from 'vitest';
import { computeReorder } from '../src/siblings';

describe('computeReorder', () => {
  it('inserts before the target', () => {
    expect(computeReorder(['a', 'b', 'c', 'd'], 'a', 'c', 'before')).toEqual(['b', 'a', 'c', 'd']);
  });

  it('inserts after the target', () => {
    expect(computeReorder(['a', 'b', 'c', 'd'], 'a', 'c', 'after')).toEqual(['b', 'c', 'a', 'd']);
  });

  it('excludes the source before indexing the target', () => {
    expect(computeReorder(['a', 'b', 'c'], 'b', 'a', 'before')).toEqual(['b', 'a', 'c']);
  });

  it('inserts at the end', () => {
    expect(computeReorder(['a', 'b', 'c'], 'a', 'c', 'after')).toEqual(['b', 'c', 'a']);
  });

  it('inserts at the start', () => {
    expect(computeReorder(['a', 'b', 'c'], 'c', 'a', 'before')).toEqual(['c', 'a', 'b']);
  });

  it('returns null when the target is not among the siblings', () => {
    expect(computeReorder(['a', 'b'], 'a', 'z', 'before')).toBeNull();
  });

  it('returns null when the target is the source itself', () => {
    expect(computeReorder(['a', 'b'], 'a', 'a', 'before')).toBeNull();
  });
});
