import { Effect, Option } from 'effect';
import { describe, expect, it } from 'vitest';

import { ProjectionCatchingUp, type ProjectedCondition, type ProjectedRowsQuery } from '../index.ts';
import { type RunFact, runFacts } from '../run-outcomes/run-tallies.ts';
import { memoryLedger, type MemoryLedger } from '../testing/memory-ledger.ts';
import {
  type AddressedStream,
  addressedStreamOf,
  addressOfStreamPrefix,
  advancedColumnsLeftBy,
  advancedColumnsOf,
  requireAdvancedColumns,
  rowKeyOf,
  type ProjectedKeyedRow,
  streamPrefixOfAddress,
} from './keyed-projection.ts';
import { addressOfTheRow, playbookRowsOf } from './playbook-rows.ts';
import { remarkRows } from './remark-rows.ts';
import { runTallyRows, tallyDueAfterMs } from './tally-rows.ts';
import { topicRows } from './topic-rows.ts';

describe('the rows of a projection of a playbook’s streams', () => {
  it('are answered as rows of their playbooks', () => {
    const row = { text: 'kept' };

    expect(
      playbookRowsOf('remarks', [
        { org: 'acme', playbook: 'alpha', key: 'r1', row },
        { org: 'acme', playbook: 'beta', key: 'r2', row },
      ]),
    ).toEqual([
      { org: 'acme', playbook: 'alpha', key: 'r1', row },
      { org: 'acme', playbook: 'beta', key: 'r2', row },
    ]);
  });

  it('are refused when one names no playbook, which no such projection folds', () => {
    const row = { text: 'kept' };

    expect(() =>
      playbookRowsOf('remarks', [
        { org: 'acme', playbook: 'alpha', key: 'r1', row },
        { org: 'acme', key: 'r2', row },
      ]),
    ).toThrow(
      "The projection remarks folds a playbook's streams alone, yet its row r2 names the org acme and no playbook",
    );
  });
});

describe('the address of a row read back', () => {
  it('is where the row lies: its definition, else its playbook, else its org', () => {
    const row = { text: 'kept' };

    expect(
      [
        { org: 'acme', playbook: 'alpha', definition: 'd1', key: 'r1', row },
        { org: 'acme', playbook: 'alpha', key: 'r2', row },
        { org: 'acme', key: 'r3', row },
      ].map((kept: Readonly<ProjectedKeyedRow>) => addressOfTheRow(kept)),
    ).toEqual([{ org: 'acme', definition: 'd1' }, { org: 'acme', playbook: 'alpha' }, { org: 'acme' }]);
  });
});

const alpha = { org: 'acme', playbook: 'alpha' };

const nine = Date.parse('2026-10-01T09:00:00.000Z');

const minute = 60_000;

const newestFirst: ProjectedRowsQuery = { where: [], orderBy: ['began_at'], order: 'desc', limit: 10 };

function began(fn: string, minutes: number): RunFact {
  return { type: 'run_began', data: { at: new Date(nine + minutes * minute).toISOString(), fn } };
}

const ended: RunFact = { type: 'run_ended', data: { status: 'succeeded', ms: 10, tokens: null } };

async function ledgerOfRuns(): Promise<MemoryLedger> {
  const ledger = memoryLedger(undefined, [runTallyRows]);
  const noted: readonly (readonly [string, readonly RunFact[]])[] = [
    ['playbook/acme/alpha/runs/r1', [began('triage', 0)]],
    ['playbook/acme/alpha/runs/r2', [began('triage', 1), ended]],
    ['playbook/acme/alpha/runs/r3', [began('review', 2)]],
    ['playbook/acme/beta/runs/r4', [began('triage', 3)]],
  ];
  await Effect.runPromise(Effect.forEach(noted, ([stream, facts]) => ledger.service.execute(stream, runFacts, facts)));
  return ledger;
}

async function runsWhere(ledger: MemoryLedger, ...where: readonly ProjectedCondition[]) {
  return (
    await Effect.runPromise(ledger.service.readProjectedRows('run_tallies', alpha, { ...newestFirst, where }))
  ).map(({ key }) => key);
}

const refusedConditions: readonly (readonly [ProjectedCondition, string])[] = [
  [{ column: 'state', equals: 'open' }, 'The projection run_tallies has no column state'],
  [{ column: 'open', after: 0 }, 'The projection run_tallies cannot compare its boolean column open with 0'],
  [
    { column: 'began_at', before: 'noon' },
    'The projection run_tallies cannot compare its integer column began_at with "noon"',
  ],
  [{ column: 'fn', after: 1 }, 'The projection run_tallies cannot compare its text column fn with 1'],
];

describe('a condition of a read of projected rows in the in-memory ledger', () => {
  it('reads the rows whose number or text column comes strictly after or before a value, and none whose column is not set', async () => {
    const ledger = await ledgerOfRuns();

    expect(await runsWhere(ledger, { column: 'began_at', after: nine })).toEqual(['r3', 'r2']);
    expect(await runsWhere(ledger, { column: 'began_at', before: nine + 2 * minute })).toEqual(['r2', 'r1']);
    expect(await runsWhere(ledger, { column: 'fn', before: 'triage' })).toEqual(['r3']);
    expect(await runsWhere(ledger, { column: 'fn', after: 'review' })).toEqual(['r2', 'r1']);
    expect(await runsWhere(ledger, { column: 'row_key', after: 'r1' }, { column: 'row_key', before: 'r3' })).toEqual([
      'r2',
    ]);
    expect(await runsWhere(ledger, { column: 'due_at', after: 0 })).toEqual(['r3', 'r1']);
    expect(await runsWhere(ledger, { column: 'due_at', before: nine + 2 * minute + tallyDueAfterMs })).toEqual(['r1']);
  });

  it('pages and counts by them beside equal columns', async () => {
    const ledger = await ledgerOfRuns();
    const triageAfterNine: readonly ProjectedCondition[] = [
      { column: 'fn', equals: 'triage' },
      { column: 'began_at', after: nine - 1 },
    ];

    expect(
      await Effect.runPromise(
        ledger.service.readProjectedRows('run_tallies', alpha, {
          ...newestFirst,
          where: triageAfterNine,
          after: [nine + minute, 'r2'],
        }),
      ),
    ).toMatchObject([{ key: 'r1' }]);
    expect(await Effect.runPromise(ledger.service.countProjectedRows('run_tallies', alpha, triageAfterNine))).toBe(2);
  });
});

describe('a condition the in-memory ledger refuses', () => {
  it.each(refusedConditions)(
    'refuses the condition %j in a read, a count and an advance',
    async (condition, refusal) => {
      const ledger = await ledgerOfRuns();

      await expect(
        Effect.runPromise(
          ledger.service.readProjectedRows('run_tallies', alpha, { ...newestFirst, where: [condition] }),
        ),
      ).rejects.toThrow(refusal);
      await expect(
        Effect.runPromise(ledger.service.countProjectedRows('run_tallies', alpha, [condition])),
      ).rejects.toThrow(refusal);
      await expect(
        Effect.runPromise(ledger.service.advanceRow('run_tallies', alpha, 'r1', { set: {}, when: [condition] })),
      ).rejects.toThrow(refusal);
    },
  );

  it('is not read for a projection the ledger does not keep', async () => {
    const ledger = await ledgerOfRuns();

    expect(
      await Effect.runPromise(ledger.service.countProjectedRows('nothing', alpha, [{ column: 'state', after: 1 }])),
    ).toBe(0);
    expect(
      await Effect.runPromise(
        ledger.service.readProjectedRows('nothing', alpha, { ...newestFirst, where: [{ column: 'state', after: 1 }] }),
      ),
    ).toEqual([]);
  });
});

const alphaRuns: AddressedStream = {
  scope: 'playbook',
  prefix: 'playbook/acme/alpha/',
  address: { org: 'acme', playbook: 'alpha' },
  kind: 'runs',
  id: 'r1',
};

const acmeRemarks: AddressedStream = {
  scope: 'org',
  prefix: 'org/acme/',
  address: { org: 'acme' },
  kind: 'remarks',
  id: 'r1',
};

describe('the stream a fact was appended to', () => {
  it('is read as the prefix, the playbook or the org, the kind and the id, an org’s one stream of a kind by that kind, and nothing else', () => {
    expect([
      addressedStreamOf('playbook/acme/alpha/runs/r1'),
      addressedStreamOf('org/acme/remarks/r1'),
      addressedStreamOf('playbook/acme/alpha/runs'),
      addressedStreamOf('playbook/acme/alpha/runs/r1/nested'),
      addressedStreamOf('org/acme/alpha/runs/r1'),
      addressedStreamOf('playbook/acme/alpha'),
      addressedStreamOf('org/acme/remarks'),
    ]).toEqual([alphaRuns, acmeRemarks, undefined, undefined, undefined, undefined, { ...acmeRemarks, id: 'remarks' }]);
  });

  it('is of neither a playbook nor an org outside them, though it names a kind and an id', () => {
    expect([addressedStreamOf('runs/acme/alpha/runs/r1'), addressedStreamOf('orgs/acme/remarks/r1')]).toEqual([
      undefined,
      undefined,
    ]);
  });
});

describe('the address of a projected row', () => {
  it('is the playbook or the org its prefix names, and names that prefix again', () => {
    const addresses = ['playbook/acme/alpha/', 'org/acme/', 'org/acme/alpha/', 'playbook/acme/'].map((prefix) =>
      addressOfStreamPrefix(prefix),
    );

    expect(addresses).toEqual([
      Option.some({ org: 'acme', playbook: 'alpha' }),
      Option.some({ org: 'acme' }),
      Option.none(),
      Option.none(),
    ]);
    expect([streamPrefixOfAddress({ org: 'acme', playbook: 'alpha' }), streamPrefixOfAddress({ org: 'acme' })]).toEqual(
      ['playbook/acme/alpha/', 'org/acme/'],
    );
  });
});

describe('the key of the row a fact changes', () => {
  const opened = {
    id: 'message-1',
    position: 1,
    type: 'topic_opened',
    data: { topic: 'spring', at: 0 },
    context: { at: '2026-10-05T09:00:00.000Z', by: 'topics' },
  };

  it('is the stream’s id by default, what the mapping says otherwise, and none for a kind it does not fold', () => {
    expect([
      rowKeyOf(runTallyRows, opened, alphaRuns),
      rowKeyOf(topicRows, opened, alphaRuns),
      rowKeyOf(topicRows, opened, { ...alphaRuns, kind: 'others' }),
    ]).toEqual(['r1', 'spring', undefined]);
  });

  it('is none for a stream of a scope the projection does not fold, a playbook’s streams alone when it names none', () => {
    expect([
      rowKeyOf(runTallyRows, opened, { ...alphaRuns, scope: 'org', prefix: 'org/acme/', address: { org: 'acme' } }),
      rowKeyOf(remarkRows, opened, acmeRemarks),
      rowKeyOf({ ...remarkRows, scopes: ['playbook'] }, opened, acmeRemarks),
    ]).toEqual([undefined, 'r1', undefined]);
  });
});

describe('the columns a reader advances', () => {
  it('are those a projection declares, each set by the fold only for the types it names for that column', () => {
    const noteOpens = {
      ...topicRows,
      advanced: [
        { column: 'open', setBy: ['topic_opened', 'topic_noted'] },
        { column: 'next_at', setBy: ['topic_opened'] },
      ],
    };

    expect([advancedColumnsOf(runTallyRows), advancedColumnsOf(topicRows)]).toEqual([
      [],
      ['open', 'next_at', 'due_at'],
    ]);
    expect([
      advancedColumnsLeftBy(topicRows, 'topic_opened'),
      advancedColumnsLeftBy(topicRows, 'topic_noted'),
      advancedColumnsLeftBy(noteOpens, 'topic_noted'),
      advancedColumnsLeftBy(runTallyRows, 'run_began'),
    ]).toEqual([[], ['open', 'next_at', 'due_at'], ['next_at'], []]);
  });

  it('refuse a column the projection does not let its reader advance', () => {
    expect(() => {
      requireAdvancedColumns(topicRows, { open: false });
    }).not.toThrow();
    expect(() => {
      requireAdvancedColumns(runTallyRows, { open: false });
    }).toThrow('The projection run_tallies does not let its reader advance the column open');
  });
});

describe('a projection catching up', () => {
  it('is a defect of its own class, which names the projection', () => {
    const catching = new ProjectionCatchingUp('topics');

    expect([catching instanceof Error, catching.name, catching.projection]).toEqual([
      true,
      'ProjectionCatchingUp',
      'topics',
    ]);
  });
});
