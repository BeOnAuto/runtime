import { Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import type { Presenter } from '../reading/presenter.ts';
import { changeCatalogOf, presentedChangeCatalogOf } from './change-catalog.ts';
import {
  changeKindOf,
  changingEvents,
  changingNothing,
  changingOne,
  type ChangeNaming,
  type PlacedFact,
} from './change-naming.ts';

const shelfChanged = changeKindOf(
  'shelf',
  'A shelf that changed',
  { shelf: 'The id of the shelf' },
  { permittedBy: ['org:read', 'playbook:read'], playbook: 'shelf' },
);

const noteChanged = changeKindOf(
  'note',
  'A note that changed',
  { shelf: 'Its shelf', note: 'Its name' },
  { permittedBy: ['org:read'] },
);

function idOf({ stream }: PlacedFact): string {
  return stream.slice(stream.indexOf('/') + 1);
}

const shelves: ChangeNaming = {
  streamKind: 'shelves',
  changes: {
    kinds: [shelfChanged, noteChanged],
    named: {
      shelf_filled: (fact) => [shelfChanged.of({ shelf: idOf(fact) })],
      note_added: (fact) => [
        shelfChanged.of({ shelf: idOf(fact) }),
        noteChanged.of({ shelf: idOf(fact), note: fact.context.by }),
      ],
      shelf_dusted: null,
    },
  },
};

const labels: ChangeNaming = {
  streamKind: 'labels',
  changes: changingOne(shelfChanged, ['label_added'], (fact) => [shelfChanged.of({ shelf: idOf(fact) })]),
};

const context = { at: '2026-10-05T09:00:00.000Z', by: 'ada' };

function factOf(stream: string, type: string): PlacedFact {
  return { id: `${stream}/${type}`, stream, type, context };
}

function presenterOf(publicNames: Presenter['publicNames'], changes: Presenter['changes']): Presenter {
  return { streamKind: 'shelves', publicNames, present: () => [], changes };
}

describe('a kind of change', () => {
  it('names a resource by its kind and the fields of its identity, which its schema describes', () => {
    expect(noteChanged.of({ shelf: 'top', note: 'milk' })).toEqual({ kind: 'note', shelf: 'top', note: 'milk' });
    expect([
      Schema.is(noteChanged.schema)({ kind: 'note', shelf: 'top', note: 'milk' }),
      Schema.is(noteChanged.schema)({ kind: 'shelf', shelf: 'top', note: 'milk' }),
      Schema.is(noteChanged.schema)({ kind: 'note', shelf: 'top' }),
    ]).toEqual([true, false, false]);
  });

  it('is read by a caller of a permission it names, and of the playbook it names where it names one', () => {
    const top = shelfChanged.of({ shelf: 'top' });
    const reader = { permissions: ['playbook:read'], playbooks: ['top'] } as const;

    expect([
      shelfChanged.readableBy(reader, top),
      shelfChanged.readableBy(reader, shelfChanged.of({ shelf: 'low' })),
      shelfChanged.readableBy({ permissions: ['org:write'], playbooks: '*' }, top),
      noteChanged.readableBy(reader, noteChanged.of({ shelf: 'top', note: 'milk' })),
      noteChanged.readableBy({ permissions: ['org:read'], playbooks: [] }, noteChanged.of({ shelf: 'x', note: 'y' })),
      changeKindOf('any', 'Any', { id: 'Its id' }).readableBy({ permissions: [], playbooks: [] }, { kind: 'any' }),
    ]).toEqual([true, false, false, false, true, true]);
  });
});

describe('the catalogue of changes', () => {
  const catalog = changeCatalogOf([shelves, labels, { streamKind: 'tellings', changes: changingEvents(['told']) }]);

  it('names the changes each fact makes by the kind of its stream, and none for a fact that changes nothing', () => {
    expect([
      catalog.changesOf(factOf('shelves/top', 'shelf_filled')),
      catalog.changesOf(factOf('shelves/top', 'note_added')),
      catalog.changesOf(factOf('labels/top', 'label_added')),
      catalog.changesOf(factOf('tellings/t1', 'told')),
      catalog.changesOf(factOf('shelves/top', 'shelf_dusted')),
      catalog.changesOf(factOf('shelves/top', 'shelf_burned')),
      catalog.changesOf(factOf('shelves/top', 'toString')),
      catalog.changesOf(factOf('drawers/top', 'shelf_filled')),
    ]).toEqual([
      [{ kind: 'shelf', shelf: 'top' }],
      [
        { kind: 'shelf', shelf: 'top' },
        { kind: 'note', shelf: 'top', note: 'ada' },
      ],
      [{ kind: 'shelf', shelf: 'top' }],
      [{ kind: 'event', event_id: 'tellings/t1/told' }],
      [],
      [],
      [],
      [],
    ]);
  });

  it('holds each kind of change once, the stream kinds it names, the types that name a change, and who reads each', () => {
    const readable = catalog.readableBy({ permissions: ['playbook:read'], playbooks: ['top'] });

    expect(catalog.kinds.map(({ kind }) => kind)).toEqual(['shelf', 'note', 'event']);
    expect(catalog.streamKinds).toEqual(['shelves', 'labels', 'tellings']);
    expect(catalog.namedTypes).toEqual(['shelf_filled', 'note_added', 'label_added', 'told']);
    expect([
      readable({ kind: 'shelf', shelf: 'top' }),
      readable({ kind: 'note', shelf: 'top', note: 'milk' }),
      readable({ kind: 'event', event_id: 'e1' }),
      readable({ kind: 'drawer', drawer: 'top' }),
    ]).toEqual([true, false, true, false]);
  });
});

describe('the catalogue of changes, composed', () => {
  it('refuses two namings of one stream kind, two kinds under one name and namings that name no kind', () => {
    const otherShelf = changeKindOf('shelf', 'Another shelf', { id: 'Its id' });

    expect(() => changeCatalogOf([shelves, { ...labels, streamKind: 'shelves' }])).toThrow(
      'More than one naming names the changes of the stream kind shelves',
    );
    expect(() =>
      changeCatalogOf([shelves, { ...labels, changes: { ...labels.changes, kinds: [otherShelf] } }]),
    ).toThrow('The change kind shelf is declared twice, and one declaration alone may give it');
    expect(() => changeCatalogOf([{ streamKind: 'dust', changes: changingNothing(['dusted']) }])).toThrow(
      'The changes a client learns of need a naming that names at least one kind of change',
    );
  });
});

describe('the catalogue of the changes of presented facts', () => {
  it('takes a presenter that says what each fact it presents changes', () => {
    const presenter = presenterOf({ shelf_filled: ['filled'], shelf_dusted: [] }, shelves.changes);

    expect(() => presentedChangeCatalogOf([presenter])).toThrow(
      'The presenter of the stream kind shelves must say what its fact note_added changes, and of no fact it does not present',
    );
    expect(() =>
      presentedChangeCatalogOf([
        presenterOf({ shelf_filled: [], note_added: [], shelf_dusted: [], shelf_burned: [] }, shelves.changes),
      ]),
    ).toThrow('must say what its fact shelf_burned changes');
    expect(
      presentedChangeCatalogOf([presenterOf({ shelf_filled: [], note_added: [], shelf_dusted: [] }, shelves.changes)])
        .streamKinds,
    ).toEqual(['shelves']);
  });
});
