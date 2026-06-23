import { describe, it, expect } from 'vitest';
import { computeDropZone } from '../src/drop-zone';

// Row at top=100, height=30 → thirds are 10px each:
//   offset < 10            → 'before'
//   10 <= offset <= 20     → 'into'
//   offset > 20            → 'after'
describe('computeDropZone', () => {
  it('top third → before', () => {
    expect(computeDropZone(100, 30, 100)).toBe('before'); // offset 0
    expect(computeDropZone(100, 30, 109)).toBe('before'); // offset 9
  });

  it('middle → into', () => {
    expect(computeDropZone(100, 30, 110)).toBe('into'); // offset 10 (== third)
    expect(computeDropZone(100, 30, 115)).toBe('into'); // offset 15
    expect(computeDropZone(100, 30, 120)).toBe('into'); // offset 20 (== height-third)
  });

  it('bottom third → after', () => {
    expect(computeDropZone(100, 30, 121)).toBe('after'); // offset 21
    expect(computeDropZone(100, 30, 130)).toBe('after'); // offset 30
  });

  it('boundaries are inclusive toward "into"', () => {
    // offset === third is NOT < third → not before
    expect(computeDropZone(0, 30, 10)).toBe('into');
    // offset === height-third is NOT > height-third → not after
    expect(computeDropZone(0, 30, 20)).toBe('into');
  });
});
