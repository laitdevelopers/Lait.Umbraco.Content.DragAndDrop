import { describe, it, expect } from 'vitest';
import { parseEditHrefUnique } from '../src/collection';

const GUID = 'a1b2c3d4-1111-2222-3333-444455556666';

describe('parseEditHrefUnique', () => {
  it('reads the unique from a relative collection edit href', () => {
    expect(parseEditHrefUnique(`section/content/workspace/document/edit/${GUID}`)).toBe(GUID);
  });

  it('reads the unique from an absolute URL', () => {
    expect(
      parseEditHrefUnique(`https://my.site/umbraco/section/content/workspace/document/edit/${GUID}`),
    ).toBe(GUID);
  });

  it('stops at a trailing path segment (e.g. a sub-view)', () => {
    expect(parseEditHrefUnique(`.../document/edit/${GUID}/view/collection`)).toBe(GUID);
  });

  it('stops at a query string', () => {
    expect(parseEditHrefUnique(`.../document/edit/${GUID}?culture=en-US`)).toBe(GUID);
  });

  it('stops at a hash', () => {
    expect(parseEditHrefUnique(`.../document/edit/${GUID}#tab`)).toBe(GUID);
  });

  it('returns null for a non-edit href (e.g. a create link)', () => {
    expect(parseEditHrefUnique('section/content/workspace/document/create/parent/x/y')).toBeNull();
  });

  it('returns null for media edit links (only document edits are collection items here)', () => {
    expect(parseEditHrefUnique(`section/media/workspace/media/edit/${GUID}`)).toBeNull();
  });

  it('returns null for empty / nullish input', () => {
    expect(parseEditHrefUnique('')).toBeNull();
    expect(parseEditHrefUnique(null)).toBeNull();
    expect(parseEditHrefUnique(undefined)).toBeNull();
  });
});
