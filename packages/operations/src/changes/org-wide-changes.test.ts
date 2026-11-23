import { Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import { changeCatalogAcrossTheOrgOf } from './change-catalog.ts';
import { acrossTheOrgOf, changeKindOf, changingOne, type ChangeNaming, type PlacedFact } from './change-naming.ts';

const context = { at: '2026-10-05T09:00:00.000Z', by: 'ada' };

function idOf({ stream }: PlacedFact): string {
  return stream.slice(stream.indexOf('/') + 1);
}

function factOf(stream: string, type: string): PlacedFact {
  return { id: `${stream}/${type}`, stream, type, context };
}

const binChanged = changeKindOf('bin', 'A bin of the org', { bin: 'The id of the bin' }, { permittedBy: ['org:read'] });

const crateChanged = changeKindOf('crate', 'A crate of a playbook', { crate: 'The id of the crate' });

const wholeShelf = changeKindOf(
  'shelf',
  'A shelf of the org, or of one of its playbooks',
  { shelf: 'The id of the shelf', playbook: 'Its playbook' },
  { playbook: 'playbook', optional: ['playbook'] },
);

const shelfOfAPlaybook = changeKindOf(
  'shelf',
  'A shelf of a playbook',
  { shelf: 'The id of the shelf' },
  { acrossTheOrg: wholeShelf },
);

const shelfOfTheOrg = changeKindOf(
  'shelf',
  'A shelf of the org',
  { shelf: 'The id of the shelf' },
  { acrossTheOrg: wholeShelf },
);

const ofTheOrg: readonly ChangeNaming[] = [
  {
    streamKind: 'bins',
    changes: changingOne(binChanged, ['bin_filled'], (fact) => [binChanged.of({ bin: idOf(fact) })]),
  },
  {
    streamKind: 'shelves',
    changes: changingOne(shelfOfTheOrg, ['shelf_filled'], (fact) => [shelfOfTheOrg.of({ shelf: idOf(fact) })]),
  },
];

const ofAPlaybook: readonly ChangeNaming[] = [
  {
    streamKind: 'crates',
    changes: changingOne(crateChanged, ['crate_packed'], (fact) => [crateChanged.of({ crate: idOf(fact) })]),
  },
  {
    streamKind: 'shelves',
    changes: changingOne(shelfOfAPlaybook, ['shelf_filled'], (fact) => [shelfOfAPlaybook.of({ shelf: idOf(fact) })]),
  },
];

function inAPlaybook(stream: string, type: string, playbook: string): PlacedFact {
  return { ...factOf(stream, type), playbook };
}

describe('a kind of change, across the org', () => {
  it('names a change from inside a playbook with its playbook, read by a caller of that playbook who may read playbooks', () => {
    const crate = acrossTheOrgOf(crateChanged).of({ crate: 'c1', playbook: 'alpha' });
    const reader = { permissions: ['playbook:read'], playbooks: ['alpha'] } as const;

    expect(crate).toEqual({ kind: 'crate', crate: 'c1', playbook: 'alpha' });
    expect([
      Schema.is(acrossTheOrgOf(crateChanged).schema)(crate),
      Schema.is(acrossTheOrgOf(crateChanged).schema)({ kind: 'crate', crate: 'c1' }),
      acrossTheOrgOf(crateChanged).readableBy(reader, crate),
      acrossTheOrgOf(crateChanged).readableBy(reader, { ...crate, playbook: 'beta' }),
      acrossTheOrgOf(crateChanged).readableBy({ permissions: ['org:read'], playbooks: '*' }, crate),
    ]).toEqual([true, false, true, false, false]);
    expect(acrossTheOrgOf(crateChanged)).toBe(acrossTheOrgOf(crateChanged));
  });

  it('takes the form a kind declares across the org, whose playbook may be left out, read by anyone where it is', () => {
    const reader = { permissions: ['playbook:read'], playbooks: ['alpha'] } as const;

    expect(acrossTheOrgOf(shelfOfAPlaybook)).toBe(wholeShelf);
    expect([
      Schema.is(wholeShelf.schema)({ kind: 'shelf', shelf: 's1' }),
      wholeShelf.readableBy(reader, { kind: 'shelf', shelf: 's1' }),
      wholeShelf.readableBy(reader, { kind: 'shelf', shelf: 's1', playbook: 'beta' }),
    ]).toEqual([true, true, false]);
  });
});

describe('the catalogue of changes across the org', () => {
  const catalog = changeCatalogAcrossTheOrgOf(ofTheOrg, ofAPlaybook);

  it("names a fact of the org by the org's namings and a fact of a playbook by the playbook's, with its playbook", () => {
    expect([
      catalog.changesOf(factOf('bins/b1', 'bin_filled')),
      catalog.changesOf(factOf('shelves/s1', 'shelf_filled')),
      catalog.changesOf(inAPlaybook('shelves/s2', 'shelf_filled', 'alpha')),
      catalog.changesOf(inAPlaybook('crates/c1', 'crate_packed', 'alpha')),
      catalog.changesOf(inAPlaybook('bins/b1', 'bin_filled', 'alpha')),
      catalog.changesOf(factOf('crates/c1', 'crate_packed')),
    ]).toEqual([
      [{ kind: 'bin', bin: 'b1' }],
      [{ kind: 'shelf', shelf: 's1' }],
      [{ kind: 'shelf', shelf: 's2', playbook: 'alpha' }],
      [{ kind: 'crate', crate: 'c1', playbook: 'alpha' }],
      [],
      [],
    ]);
  });

  it("holds each kind once, made one across the org, the org's stream kinds and the types of both that name a change", () => {
    expect(catalog.kinds.map(({ kind }) => kind)).toEqual(['bin', 'shelf', 'crate']);
    expect(catalog.streamKinds).toEqual(['bins', 'shelves']);
    expect(catalog.namedTypes).toEqual(['bin_filled', 'shelf_filled', 'crate_packed']);
    expect(
      catalog.readableBy({ permissions: ['playbook:read'], playbooks: ['alpha'] })({
        kind: 'crate',
        crate: 'c1',
        playbook: 'beta',
      }),
    ).toBe(false);
  });

  it('refuses a kind named two ways across the org', () => {
    const twice = changeKindOf('bin', 'A bin of a playbook', { bin: 'The id of the bin' });
    const binsOfAPlaybook: ChangeNaming = {
      streamKind: 'bins',
      changes: changingOne(twice, ['bin_filled'], (fact) => [twice.of({ bin: idOf(fact) })]),
    };

    expect(() => changeCatalogAcrossTheOrgOf(ofTheOrg, [binsOfAPlaybook])).toThrow('declared twice');
  });
});
