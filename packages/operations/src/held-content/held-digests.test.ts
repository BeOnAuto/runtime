import { describe, expect, it } from 'vitest';

import type { ContentDeclaration, ContentHolders } from './content-declaration.ts';
import {
  digestsChanged,
  digestsNamed,
  digestsTouchedBy,
  heldAfter,
  heldOver,
  payloadBytesOf,
  payloadDigestsNamed,
  payloadsNamed,
  releasesEverything,
} from './held-digests.ts';

const [first, second, third] = ['a'.repeat(64), 'b'.repeat(64), 'c'.repeat(64)];

const listed: ContentDeclaration = {
  holds: ['/attached/sha256'],
  payloads: [
    { sha256: '/input_sha256', bytes: '/input_bytes' },
    { sha256: '/kept/*/sha256', bytes: '/kept/*/bytes' },
  ],
};

function named(data: unknown): () => readonly unknown[] {
  return () => payloadsNamed(data, listed);
}

const holders: ContentHolders = new Map<string, ContentDeclaration>([
  ['kept', { holds: ['/sha256', '/parts/1/sha256', '/a~1b', '/c~0d'] }],
  ['let_go', { releases: ['/sha256'] }],
  ['closed', { releases: 'all' }],
  ['swapped', { holds: ['/to'], releases: ['/from'] }],
  ['listed', listed],
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

  it('are the digest of every element of a list where a pointer holds *, and none where * meets anything but a list', () => {
    const data = { parts: [{ sha256: first }, {}, { sha256: second }], one: { '*': { sha256: third } } };

    expect(digestsNamed(data, ['/parts/*/sha256', '/one/*/sha256', '/missing/*/sha256'])).toEqual([first, second]);
  });
});

describe('the payloads a fact names', () => {
  it('are each digest a payload pointer names, with the size beside it, matched element by element through a list', () => {
    const data = {
      input_sha256: first,
      input_bytes: 4096,
      kept: [
        { sha256: second, bytes: 3000 },
        { sha256: third, bytes: 2049 },
      ],
    };

    expect(payloadsNamed(data, listed)).toEqual([
      { sha256: first, bytes: 4096 },
      { sha256: second, bytes: 3000 },
      { sha256: third, bytes: 2049 },
    ]);
    expect(payloadBytesOf(holders, { type: 'listed', data })).toBe(9145);
    expect([
      payloadDigestsNamed(holders, { type: 'listed', data }),
      payloadDigestsNamed(holders, { type: 'noted', data }),
    ]).toEqual([[first, second, third], []]);
  });

  it('are none where the payload is inline, the fact declares none or its type holds nothing', () => {
    expect([
      payloadsNamed({ input: { lead: 'lead-1' }, kept: [] }, listed),
      payloadsNamed({ input_sha256: first, input_bytes: 1 }, { holds: ['/input_sha256'] }),
      payloadBytesOf(holders, { type: 'kept', data: { sha256: first } }),
      payloadBytesOf(holders, { type: 'noted', data: { input_sha256: first, input_bytes: 1 } }),
    ]).toEqual([[], [], 0, 0]);
  });

  it('fail, as a defect of the writer, where a digest has no whole number of bytes beside it or is no digest', () => {
    expect(named({ input_sha256: first })).toThrow(
      `A payload of the fact is named by "${first}" at /input_sha256 beside undefined at /input_bytes, where a SHA-256 in lowercase hex and a whole number of bytes were expected`,
    );
    expect(named({ input_sha256: first, input_bytes: 1.5 })).toThrow('beside 1.5 at /input_bytes');
    expect(named({ input_sha256: first, input_bytes: -1 })).toThrow('beside -1 at /input_bytes');
    expect(named({ kept: [{ sha256: 'A'.repeat(64), bytes: 1 }] })).toThrow(`named by "${'A'.repeat(64)}"`);
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

  it('count a hold for each payload a fact keeps outside, beside the content it holds, and the release of a content leaves the payload of the same digest held', () => {
    const held = heldOver(holders, [
      { type: 'listed', data: { input_sha256: first, input_bytes: 1, attached: { sha256: first } } },
      { type: 'listed', data: { input: 'inline', kept: [{ sha256: second, bytes: 2 }] } },
      { type: 'let_go', data: { sha256: first } },
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
    expect(
      digestsTouchedBy(holders, {
        type: 'listed',
        data: {
          attached: { sha256: third },
          input_sha256: first,
          input_bytes: 1,
          kept: [{ sha256: second, bytes: 2 }],
        },
      }),
    ).toEqual([third, first, second]);
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
