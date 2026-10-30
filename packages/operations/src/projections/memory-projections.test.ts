import { Effect, Exit } from 'effect';
import { describe, expect, it } from 'vitest';

import { messageIdOf, projectedTableOf, type KeyedProjection, type ProjectedRowsQuery } from '../index.ts';
import { runFacts, type RunFact } from '../run-outcomes/run-tallies.ts';
import { memoryLedger, type MemoryLedger } from '../testing/memory-ledger.ts';
import { runTallyRows, tallyDueAfterMs, tallyRowsOf } from './tally-rows.ts';
import { topicFacts, topicRows, topicWaitMs, type TopicFact } from './topic-rows.ts';

const alpha = { org: 'acme', playbook: 'alpha' };

const nine = Date.parse('2026-10-01T09:00:00.000Z');

function noting(ledger: MemoryLedger, stream: string, ...facts: readonly RunFact[]): Promise<unknown> {
  return Effect.runPromise(ledger.service.execute(stream, runFacts, facts));
}

function began(fn: string, minute = 0): RunFact {
  return { type: 'run_began', data: { at: new Date(nine + minute * 60_000).toISOString(), fn } };
}

const ended: RunFact = { type: 'run_ended', data: { status: 'succeeded', ms: 10, tokens: null } };

const newestFirst: ProjectedRowsQuery = { where: [], orderBy: ['began_at'], order: 'desc', limit: 10 };

function read(ledger: MemoryLedger, query: ProjectedRowsQuery = newestFirst) {
  return Effect.runPromise(ledger.service.readProjectedRows('run_tallies', alpha, query));
}

describe('a projection of runs in the in-memory ledger', () => {
  it('keeps one row a run from the facts of its types, with the id of the message it last took', async () => {
    const ledger = memoryLedger(undefined, [runTallyRows]);
    await noting(ledger, 'playbook/acme/alpha/runs/r1', began('triage'), { type: 'run_noted', data: {} });
    await noting(ledger, 'playbook/acme/alpha/runs/r1', ended);
    await noting(ledger, 'playbook/acme/alpha/run-logs/r1', began('ignored'));

    expect(await read(ledger)).toEqual([
      {
        org: 'acme',
        playbook: 'alpha',
        key: 'r1',
        row: {
          fn: 'triage',
          began_at: nine,
          status: 'succeeded',
          facts: 3,
          open: false,
          due_at: null,
          last_message: messageIdOf('playbook/acme/alpha/runs/r1', 3),
        },
      },
    ]);
  });
});

describe('a read of the rows of a projection in the in-memory ledger', () => {
  it('reads the rows of one playbook by their columns, in order, from where a page ended', async () => {
    const ledger = memoryLedger(undefined, [runTallyRows]);
    await noting(ledger, 'playbook/acme/alpha/runs/r1', began('triage', 0));
    await noting(ledger, 'playbook/acme/alpha/runs/r2', began('triage', 1), ended);
    await noting(ledger, 'playbook/acme/alpha/runs/r3', began('review', 2));
    await noting(ledger, 'playbook/acme/beta/runs/r4', began('triage', 3));

    const runsOf = async (query: ProjectedRowsQuery) => (await read(ledger, query)).map(({ key }) => key);
    const open = { column: 'open', equals: true };

    expect(await runsOf(newestFirst)).toEqual(['r3', 'r2', 'r1']);
    expect(await runsOf({ ...newestFirst, order: 'asc' })).toEqual(['r1', 'r2', 'r3']);
    expect(await runsOf({ ...newestFirst, where: [open] })).toEqual(['r3', 'r1']);
    expect(await runsOf({ ...newestFirst, where: [open, { column: 'fn', equals: 'triage' }] })).toEqual(['r1']);
    expect(await runsOf({ ...newestFirst, where: [{ column: 'row_key', equals: 'r2' }] })).toEqual(['r2']);
    expect(await runsOf({ ...newestFirst, limit: 1 })).toEqual(['r3']);
    expect(await runsOf({ ...newestFirst, after: [nine + 120_000, 'r3'] })).toEqual(['r2', 'r1']);
    expect(await Effect.runPromise(ledger.service.countProjectedRows('run_tallies', alpha, [open]))).toBe(2);
    expect(await Effect.runPromise(ledger.service.countProjectedRows('nothing', alpha, []))).toBe(0);
  });

  it('reads the rows due by a time across playbooks, none outside them, the soonest first, and the next due time', async () => {
    const ledger = memoryLedger(undefined, [runTallyRows]);
    await noting(ledger, 'playbook/acme/alpha/runs/r1', began('triage', 2));
    await noting(ledger, 'playbook/globex/gamma/runs/r2', began('triage', 0));
    await noting(ledger, 'playbook/acme/beta/runs/r3', began('triage', 1), ended);
    await noting(ledger, 'org/acme/alpha/runs/r4', began('triage', 0));
    const due = (through: number, limit = 10) =>
      Effect.runPromise(ledger.service.readDueRows('run_tallies', { column: 'due_at', through, limit }));

    expect((await due(nine + 3 * 60_000)).map(({ org, playbook, key }) => `${org}/${playbook}/${key}`)).toEqual([
      'globex/gamma/r2',
      'acme/alpha/r1',
    ]);
    expect((await due(nine + tallyDueAfterMs)).map(({ key }) => key)).toEqual(['r2']);
    expect((await due(nine + 3 * 60_000, 1)).map(({ key }) => key)).toEqual(['r2']);
    expect(await Effect.runPromise(ledger.service.nextDueOf('run_tallies', 'due_at', 0))).toBe(nine + tallyDueAfterMs);
    expect(await Effect.runPromise(ledger.service.nextDueOf('run_tallies', 'due_at', nine + tallyDueAfterMs))).toBe(
      nine + 3 * 60_000,
    );
    expect(await Effect.runPromise(ledger.service.nextDueOf('run_tallies', 'due_at', nine + 3 * 60_000))).toBeNull();
    expect(await Effect.runPromise(ledger.service.nextDueOf('nothing', 'due_at', 0))).toBeNull();
  });
});

describe('an append to a run of which a projection keeps a row, in the in-memory ledger', () => {
  it('keeps nothing of an append whose projection breaks down, and records nothing of it', async () => {
    const breaking: KeyedProjection = tallyRowsOf(2, (row) => row['status'] !== 'started');
    const ledger = memoryLedger(undefined, [breaking]);
    await noting(ledger, 'playbook/acme/alpha/runs/r1', began('triage'));

    const failed = await Effect.runPromiseExit(
      ledger.service.execute('playbook/acme/alpha/runs/r1', runFacts, [ended]),
    );

    expect(Exit.isFailure(failed)).toBe(true);
    expect((await read(ledger)).map(({ row }) => row['status'])).toEqual(['started']);
    expect((await Effect.runPromise(ledger.service.load('playbook/acme/alpha/runs/r1', runFacts))).version).toBe(1);
  });

  it('keeps nothing for a run whose facts its mapping does not take', async () => {
    const ledger = memoryLedger(undefined, [runTallyRows]);
    await noting(ledger, 'playbook/acme/alpha/runs/r1', ended, { type: 'run_noted', data: {} });

    expect(await read(ledger)).toEqual([]);
  });

  it('hands its mapping only the facts of the types it names', async () => {
    const ledger = memoryLedger(undefined, [{ ...runTallyRows, types: ['run_began', 'run_ended'] }]);
    await noting(ledger, 'playbook/acme/alpha/runs/r1', began('triage'), { type: 'run_noted', data: {} });

    expect((await read(ledger)).map(({ row }) => row['facts'])).toEqual([1]);
  });

  it('orders a column that is not set before every value that is', async () => {
    const ledger = memoryLedger(undefined, [runTallyRows]);
    await noting(ledger, 'playbook/acme/alpha/runs/r1', began('triage', 0));
    await noting(ledger, 'playbook/acme/alpha/runs/r2', began('triage', 1), ended);
    const byDue = { where: [], orderBy: ['due_at'], limit: 10 };

    expect((await read(ledger, { ...byDue, order: 'asc' })).map(({ key }) => key)).toEqual(['r2', 'r1']);
    expect((await read(ledger, { ...byDue, order: 'desc' })).map(({ key }) => key)).toEqual(['r1', 'r2']);
  });
});

describe('the table of a projection', () => {
  it('is named for the projection and its version, so a new version is a new table', () => {
    expect([projectedTableOf(runTallyRows), projectedTableOf(tallyRowsOf(3))]).toEqual([
      'run_tallies_2',
      'run_tallies_3',
    ]);
  });
});

const malformed: readonly (readonly [string, KeyedProjection])[] = [
  ['The projection name Tallies is malformed', { ...runTallyRows, name: 'Tallies' }],
  ['The projection run_tallies has a version that is not a whole number from 1', { ...runTallyRows, version: 0 }],
  ['The column name Fn is malformed', { ...runTallyRows, columns: [{ name: 'Fn', kind: 'text' }] }],
  [
    'The projection run_tallies may not name a column row_key, which keys every row',
    { ...runTallyRows, columns: [{ name: 'row_key', kind: 'text' }] },
  ],
  ['The index name By-status is malformed', { ...runTallyRows, indexes: [{ name: 'By-status', columns: ['status'] }] }],
  [
    'The projection run_tallies has no column state',
    { ...runTallyRows, indexes: [{ name: 'by_state', columns: ['state'] }] },
  ],
  [
    'The projection run_tallies has no column due',
    { ...runTallyRows, indexes: [{ name: 'due', columns: ['due_at'], whereSet: 'due' }] },
  ],
  ['The projection run_tallies names no stream kind it folds', { ...runTallyRows, kinds: [] }],
  ['The stream kind name Runs is malformed', { ...runTallyRows, kinds: ['Runs'] }],
  [
    'The projection topics has no column closed',
    { ...topicRows, advanced: [{ column: 'closed', setBy: ['topic_opened'] }] },
  ],
  [
    'The projection topics does not fold topic_closed, which it says sets its advanced column open',
    { ...topicRows, advanced: [{ column: 'open', setBy: ['topic_closed'] }] },
  ],
  [
    'The projection topics declares its advanced column open more than once',
    {
      ...topicRows,
      advanced: [
        { column: 'open', setBy: ['topic_opened'] },
        { column: 'open', setBy: ['topic_noted'] },
      ],
    },
  ],
];

describe('a projection declared with names a table cannot hold', () => {
  it.each(malformed)('is refused: %s', (message, projection) => {
    expect(() => memoryLedger(undefined, [projection])).toThrow(message);
  });

  it('is kept with an index that ends with the row key, which every ordered read ends with, though no partial index is on it', () => {
    const endingWithTheKey = { name: 'by_status', columns: ['status', 'began_at', 'row_key'] };

    expect(() => memoryLedger(undefined, [{ ...runTallyRows, indexes: [endingWithTheKey] }])).not.toThrow();
    expect(() =>
      memoryLedger(undefined, [{ ...runTallyRows, indexes: [{ ...endingWithTheKey, whereSet: 'row_key' }] }]),
    ).toThrow('The projection run_tallies has no column row_key');
  });
});

function topics(ledger: MemoryLedger, stream: string, ...facts: readonly TopicFact[]): Promise<unknown> {
  return Effect.runPromise(ledger.service.execute(stream, topicFacts, facts));
}

function notedOn(topic: string, note: string): TopicFact {
  return { type: 'topic_noted', data: { topic, note } };
}

function topicsOf(ledger: MemoryLedger) {
  return Effect.runPromise(
    ledger.service.readProjectedRows('topics', alpha, { where: [], orderBy: [], order: 'asc', limit: 10 }),
  );
}

describe('a projection keyed by what its mapping says, over the stream kinds it names', () => {
  it('keeps one row a key from the facts of every stream of its kinds, and none of another kind', async () => {
    const ledger = memoryLedger(undefined, [topicRows]);
    await topics(ledger, 'playbook/acme/alpha/runs/r1', { type: 'topic_opened', data: { topic: 'spring', at: nine } });
    await topics(ledger, 'playbook/acme/alpha/notes/n1', notedOn('spring', 'first'));
    await topics(ledger, 'playbook/acme/alpha/notes/n2', notedOn('autumn', 'none'));
    await topics(ledger, 'playbook/acme/alpha/others/o1', notedOn('spring', 'ignored'));
    await topics(ledger, 'playbook/acme/alpha/notes', notedOn('spring', 'not a stream'));

    expect(await topicsOf(ledger)).toEqual([
      {
        org: 'acme',
        playbook: 'alpha',
        key: 'spring',
        row: {
          topic: 'spring',
          note: 'first',
          last_message: messageIdOf('playbook/acme/alpha/notes/n1', 1),
          open: true,
          next_at: nine + topicWaitMs,
          due_at: nine + topicWaitMs,
        },
      },
    ]);
  });

  it('lets its reader advance the columns it declares on one row, and no other column', async () => {
    const ledger = memoryLedger(undefined, [topicRows]);
    await topics(ledger, 'playbook/acme/alpha/runs/r1', { type: 'topic_opened', data: { topic: 'spring', at: nine } });

    await Effect.runPromise(
      ledger.service.advanceRow('topics', alpha, 'spring', {
        set: { open: false, next_at: null, due_at: null },
        when: [],
      }),
    );
    await Effect.runPromise(ledger.service.advanceRow('topics', alpha, 'autumn', { set: { open: false }, when: [] }));
    await Effect.runPromise(ledger.service.advanceRow('nothing', alpha, 'spring', { set: { open: false }, when: [] }));
    const refused = await Effect.runPromiseExit(
      ledger.service.advanceRow('topics', alpha, 'spring', { set: { note: 'advanced' }, when: [] }),
    );
    await topics(ledger, 'playbook/acme/alpha/notes/n1', notedOn('spring', 'after'));

    expect(Exit.isFailure(refused)).toBe(true);
    expect((await topicsOf(ledger)).map(({ key, row }) => [key, row['open'], row['due_at'], row['note']])).toEqual([
      ['spring', false, null, 'after'],
    ]);
  });
});

describe('the advance of a row of the in-memory ledger that its fold changed since its reader read it', () => {
  it('advances a row only while the columns it is told to compare still hold what its reader read', async () => {
    const ledger = memoryLedger(undefined, [topicRows]);
    await topics(ledger, 'playbook/acme/alpha/runs/r1', { type: 'topic_opened', data: { topic: 'spring', at: nine } });
    const readAt = messageIdOf('playbook/acme/alpha/runs/r1', 1);
    await topics(ledger, 'playbook/acme/alpha/notes/n1', notedOn('spring', 'meanwhile'));

    await Effect.runPromise(
      ledger.service.advanceRow('topics', alpha, 'spring', {
        set: { open: false },
        when: [{ column: 'last_message', equals: readAt }],
      }),
    );

    expect((await topicsOf(ledger)).map(({ row }) => row['open'])).toEqual([true]);
  });
});
