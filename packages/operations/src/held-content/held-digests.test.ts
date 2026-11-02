import { describe, expect, it } from 'vitest';

import type { ContentDeclaration, ContentHolders } from './content-declaration.ts';
import {
  digestsChanged,
  digestsNamed,
  digestsTouchedBy,
  heldAfter,
  heldOver,
  releasesEverything,
} from './held-digests.ts';

const [first, second] = ['a'.repeat(64), 'b'.repeat(64)];

const holders: ContentHolders = new Map<string, ContentDeclaration>([
  ['kept', { holds: ['/sha256', '/parts/1/sha256', '/a~1b', '/c~0d'] }],
  ['let_go', { releases: ['/sha256'] }],
  ['closed', { releases: 'all' }],
  ['swapped', { holds: ['/to'], releases: ['/from'] }],
]);

describe('the digests a fact names', () => {
  it('are the digests at its pointers, through arrays and escaped names, and nothing at a pointer that names no digest', () => {
    const data = { sha256: first, parts: [{}, { sha256: second }], 'a/b': first, 'c~d': second, other: first };

    expect(digestsNamed(data, ['/sha256', '/parts/1/sha256', '/a~1b', '/c~0d', '/parts/0/sha256'])).toEqual([
      first,
      second,
      first,
      second,
    ]);
    expect(digestsNamed({ sha256: 'A'.repeat(64) }, ['/sha256'])).toEqual([]);
    expect(digestsNamed({ sha256: 12 }, ['/sha256', '/sha256/deeper'])).toEqual([]);
    expect(digestsNamed('not an object', ['/sha256'])).toEqual([]);
  });
});

describe('the holds of a stream, folded over its facts', () => {
  it('count a hold for each digest a holding fact names, and let one go for each a release names, never below none', () => {
    const held = heldOver(holders, [
      { type: 'let_go', data: { sha256: first } },
      { type: 'kept', data: { sha256: first, parts: [{}, { sha256: first }] } },
      { type: 'kept', data: { sha256: second } },
      { type: 'let_go', data: { sha256: first } },
      { type: 'noted', data: { sha256: second } },
    ]);

    expect([...held]).toEqual([
      [first, 1],
      [second, 1],
    ]);
  });

  it('let go of every hold for a release of all of them, and of the digests released before those held by a fact that does both', () => {
    const before = new Map([[first, 2]]);

    expect([...heldAfter(holders, before, { type: 'closed', data: {} })]).toEqual([]);
    expect([...heldAfter(holders, before, { type: 'swapped', data: { from: first, to: first } })]).toEqual([
      [first, 2],
    ]);
  });
});

describe('the digests a fact changes', () => {
  it('are those it holds and releases by name, none for a release of all of them, which says it releases all', () => {
    expect(digestsTouchedBy(holders, { type: 'swapped', data: { from: first, to: second } })).toEqual([second, first]);
    expect(digestsTouchedBy(holders, { type: 'closed', data: {} })).toEqual([]);
    expect(digestsTouchedBy(holders, { type: 'noted', data: { sha256: first } })).toEqual([]);
    expect([
      releasesEverything(holders, { type: 'closed', data: {} }),
      releasesEverything(holders, { type: 'kept', data: {} }),
    ]).toEqual([true, false]);
  });

  it('change the digests whose count differs, in order', () => {
    expect(
      digestsChanged(
        new Map([
          [second, 1],
          [first, 1],
        ]),
        new Map([
          [first, 1],
          [second, 2],
          ['c'.repeat(64), 1],
        ]),
      ),
    ).toEqual([second, 'c'.repeat(64)]);
  });
});
