import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import type { KeyedProjection, ProjectedRowsQuery } from '../projections/keyed-projection.ts';
import { labelFacts, labelRows, type LabelFact } from '../projections/label-rows.ts';
import { memoryLedger, type MemoryLedger } from '../testing/memory-ledger.ts';
import { labelNotes, labelReadModelOf, labelSets } from './label-read-model.ts';
import {
  checkedStreamProjection,
  checkpointsOf,
  typesOf,
  type GroupwiseMaximum,
  type StreamProjection,
} from './stream-projection.ts';

const alpha = { org: 'acme', playbook: 'alpha' };

const everyRow: ProjectedRowsQuery = { where: [], orderBy: [], order: 'asc', limit: 100 };

function labelled(ledger: MemoryLedger, stream: string, ...facts: readonly LabelFact[]): Promise<unknown> {
  return Effect.runPromise(ledger.service.execute(stream, labelFacts, facts));
}

function set(note: string, ...labels: readonly string[]): LabelFact {
  return { type: 'labels_set', data: { note, labels } };
}

async function keysOf(ledger: MemoryLedger, projection: string) {
  const rows = await Effect.runPromise(ledger.service.readProjectedRows(projection, alpha, everyRow));
  return rows.map(({ key, child }) => (child === undefined ? key : `${key}:${child}`));
}

describe('a stream projection', () => {
  it('names its checkpoints and the types its tables fold', () => {
    const projection = labelReadModelOf();

    expect([checkpointsOf(projection), typesOf(projection)]).toEqual([
      { name: 'labelled_checkpoints', version: 1 },
      ['labels_set', 'label_added', 'labels_cleared'],
    ]);
  });
});

describe('the declaration of a stream projection', () => {
  it.each<readonly [string, StreamProjection, string]>([
    [
      'a table of another version',
      { ...labelReadModelOf(), tables: [labelSets, { ...labelRows, version: 2 }] },
      "The table labels of the stream projection labelled takes version 2, not the projection's 1",
    ],
    [
      'a table of another kind of stream',
      { ...labelReadModelOf(), tables: [{ ...labelSets, kinds: ['runs'] }] },
      "The table label_sets of the stream projection labelled folds other streams than a playbook's notes",
    ],
    [
      'a table of an org’s streams',
      { ...labelReadModelOf(), tables: [{ ...labelSets, scopes: ['playbook', 'org'] }] },
      "The table label_sets of the stream projection labelled folds other streams than a playbook's notes",
    ],
    [
      'a count of facts its table does not fold',
      { ...labelReadModelOf(), counted: [{ projection: 'label_sets', facts: ['label_added'] }] },
      'The stream projection labelled counts the facts label_added against label_sets, which none of its tables of that name folds',
    ],
    [
      'a count against no table of its own',
      { ...labelReadModelOf(), counted: [{ projection: 'nothing', facts: ['labels_set'] }] },
      'The stream projection labelled counts the facts labels_set against nothing, which none of its tables of that name folds',
    ],
    [
      'a malformed stream',
      { ...labelReadModelOf(), streams: ['n/1'] },
      'The stream projection labelled names the stream n/1, which is malformed',
    ],
    ['a malformed kind', { ...labelReadModelOf(), kind: 'Notes' }, 'The stream kind name Notes is malformed'],
  ])('refuses %s', (_case, refused, said) => {
    expect(() => checkedStreamProjection(refused)).toThrow(said);
  });
});

const latestSet: GroupwiseMaximum = {
  projection: 'label_notes',
  groups: 'label_sets',
  groupedBy: ['note'],
  greatest: 'set_at',
  matching: [{ column: 'last_set_at', equals: 'set_at' }],
};

describe('the group-wise maximum a stream projection declares', () => {
  it.each<readonly [string, GroupwiseMaximum, string]>([
    ['by a column the groups lack', { ...latestSet, greatest: 'labels_at' }, 'in label_sets by labels_at'],
    ['of a table it does not keep', { ...latestSet, groups: 'nothing' }, 'in nothing by note'],
    ['that matches nothing', { ...latestSet, matching: [] }, 'in label_sets by nothing it matches'],
  ])('is refused %s', (_case, maximum, said) => {
    expect(() => checkedStreamProjection({ ...labelReadModelOf(), groupwiseMaxima: [maximum] })).toThrow(
      `The stream projection labelled matches label_notes to the greatest of its group ${said}, which is no column of theirs`,
    );
  });
});

describe('a stream projection in the in-memory ledger', () => {
  it('folds every fact of its streams as it is appended, and none of a stream it does not name', async () => {
    const ledger = memoryLedger(undefined, [labelReadModelOf()]);
    await labelled(ledger, 'playbook/acme/alpha/notes/n1', set('n1', 'urgent'), set('n1', 'billing', 'urgent'));
    await labelled(ledger, 'playbook/acme/alpha/notes/n3', set('n3', 'ignored'));
    await labelled(ledger, 'playbook/acme/alpha/others/n2', set('n2', 'ignored'));

    expect([await keysOf(ledger, 'label_sets'), await keysOf(ledger, 'labelled_rows')]).toEqual([
      ['n1/1', 'n1/2'],
      ['n1:billing', 'n1:urgent'],
    ]);
  });

  it('builds the rows of a playbook again from its facts when it is reset, and leaves the rows of another playbook', async () => {
    const ledger = memoryLedger(undefined, [labelReadModelOf()]);
    await labelled(ledger, 'playbook/acme/alpha/notes/n1', set('n1', 'urgent'));
    await labelled(ledger, 'playbook/acme/beta/notes/n2', set('n2', 'later'));

    await Effect.runPromise(ledger.service.resetStreamProjection('labelled', alpha));
    await Effect.runPromise(ledger.service.resetStreamProjection('nothing', alpha));

    expect([
      await keysOf(ledger, 'labelled_rows'),
      (
        await Effect.runPromise(
          ledger.service.readProjectedRows('labelled_rows', { org: 'acme', playbook: 'beta' }, everyRow),
        )
      ).map(({ child }) => child),
    ]).toEqual([['n1:urgent'], ['later']]);
  });
});

function failingRead(ledger: MemoryLedger) {
  return Effect.runPromise(ledger.service.countProjectedRows('label_sets', alpha, []));
}

const firstSetAlone: KeyedProjection = {
  ...labelNotes,
  rowAfter: (row, message) => row ?? labelNotes.rowAfter(row, message),
};

function staleAtTheSecondFold(): KeyedProjection {
  let folds = 0;
  return {
    ...labelNotes,
    rowAfter: (row, message) => {
      folds += 1;
      return folds === 2 ? row : labelNotes.rowAfter(row, message);
    },
  };
}

const disagreeing =
  'The rows of the read model labelled of playbook/acme/alpha disagree with its facts after it was built again';

describe('the checks of a stream projection in the in-memory ledger', () => {
  it('fail a read whose rows do not count the facts they stand for, even once built again', async () => {
    const ledger = memoryLedger(undefined, [labelReadModelOf(1, [{ ...labelSets, keyOf: () => 'one' }, labelNotes])]);
    await labelled(ledger, 'playbook/acme/alpha/notes/n1', set('n1', 'a'), set('n1', 'b'));

    await expect(failingRead(ledger)).rejects.toThrow(disagreeing);
  });

  it('fail a read whose row is not the greatest of its group, even once built again', async () => {
    const ledger = memoryLedger(undefined, [labelReadModelOf(1, [labelSets, firstSetAlone])]);
    await labelled(ledger, 'playbook/acme/alpha/notes/n1', set('n1', 'a'), set('n1', 'b'));

    await expect(failingRead(ledger)).rejects.toThrow(disagreeing);
  });

  it('answer a read once its rows are built again and agree, and check nothing under an org', async () => {
    const ledger = memoryLedger(undefined, [labelReadModelOf(1, [labelSets, staleAtTheSecondFold()])]);
    await labelled(ledger, 'playbook/acme/alpha/notes/n1', set('n1', 'a'), set('n1', 'b'));

    expect([
      await failingRead(ledger),
      await Effect.runPromise(ledger.service.countProjectedRows('label_sets', { org: 'acme' }, [])),
    ]).toEqual([2, 0]);
  });
});
