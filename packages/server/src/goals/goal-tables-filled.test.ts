import { goalsLedger, summaryRunIdOf } from '@on.auto/goals';
import { plainPoolsOn, postgresqlLedgerLayer } from '@on.auto/ledger/postgresql';
import { ledgerLayer } from '@on.auto/ledger/sqlite';
import { ContextSchema, Ledger, projectedTableOf, type Decider } from '@on.auto/operations';
import { Effect, ManagedRuntime, Result, Schema, type Layer } from 'effect';
import { Client } from 'pg';
import { describe, expect, it, onTestFinished } from 'vitest';

import { onTheLedgerIn, tableDropped } from '../testing/records/ledger-file.ts';
import { temporaryLedger } from '../testing/records/temporary-ledger.ts';

const postgresql = process.env['LEDGER_TEST_POSTGRESQL_URL'] ?? '';

const notice =
  postgresql === '' ? ', skipped: set LEDGER_TEST_POSTGRESQL_URL to the URL of a PostgreSQL server to run it' : '';

const { projections } = goalsLedger;

const tables = projections.map((projection) => projectedTableOf(projection));

const sales = { org: 'acme', playbook: 'sales' };

const prefix = 'playbook/acme/sales/';

const FactSchema = Schema.Struct({ type: Schema.String, data: Schema.Json, context: ContextSchema });

type Fact = typeof FactSchema.Type;

const verbatim: Decider<null, Fact, Fact> = {
  initialState: null,
  evolve: () => null,
  decide: ({ type, data }) => Result.succeed([{ type, data }]),
  context: ({ context }) => context,
  eventSchema: FactSchema,
};

const at = (moment: string) => ({ at: moment, by: 'playbook:sales' });

const daily = {
  id: 'controls-hold',
  statement: 'Keep every control holding each day.',
  window: { calendar: 'day' },
  success: {
    label: 'Failed controls',
    settles: 'on_crossing',
    target: { at_most: 0 },
    passed: 'Held',
    failed: 'Broke',
  },
  notify: { passed: 'quiet', failed: 'now', overdue: 'now', through: 'tell-owner', summary: { cron: '0 9 * * 5' } },
};

const monday = '6f1c7a2e-3b4d-5e6f-8a9b-0c1d2e3f4a5b';

const tuesday = '7a2d8b3f-4c5e-5f60-9b0a-1d2e3f4a5b6c';

const openedOn = (opens: string, closes: string, due: string): Fact => ({
  type: 'goal_assessment_opened',
  data: {
    goal: 'controls-hold',
    goals_version: 1,
    window: { opens, closes, due },
    rule: { settles: 'on_crossing', target: { at_most: 0 }, window: { calendar: 'day' } },
    milestones: [],
  },
  context: at(opens),
});

const history: readonly (readonly [string, Fact])[] = [
  [
    'goals/playbook',
    {
      type: 'playbook_goals_saved',
      data: { source: 'goals', goals: [daily], version: 1 },
      context: at('2026-11-08T12:00:00.000Z'),
    },
  ],
  [
    `assessments/${monday}`,
    openedOn('2026-11-09T00:00:00.000Z', '2026-11-10T00:00:00.000Z', '2026-11-10T01:00:00.000Z'),
  ],
  [
    `assessments/${monday}`,
    {
      type: 'goal_observed',
      data: {
        source: { record: 'record-1', run: 'run-1', workflow: 'check-controls', version: 1, entry: 0 },
        at: '2026-11-09T09:00:00.000Z',
        measurement: { value: 1, final: false, as_of: '2026-11-09T09:00:00.000Z' },
        says: 'One control broke',
      },
      context: at('2026-11-09T09:00:01.000Z'),
    },
  ],
  [
    `assessments/${monday}`,
    {
      type: 'goal_assessed',
      data: { verdict: 'failed', at: '2026-11-09T09:00:00.000Z', by: 'crossing', told: 'now' },
      context: at('2026-11-09T09:00:01.000Z'),
    },
  ],
  [
    `assessments/${monday}`,
    {
      type: 'goal_notice_refused',
      data: { change: 'failed', attempt: 1, detail: 'unavailable', retry_at: '2026-11-09T09:01:00.000Z' },
      context: at('2026-11-09T09:00:02.000Z'),
    },
  ],
  [
    `assessments/${tuesday}`,
    openedOn('2026-11-10T00:00:00.000Z', '2026-11-11T00:00:00.000Z', '2026-11-11T01:00:00.000Z'),
  ],
  [
    `assessments/${tuesday}`,
    {
      type: 'goal_overdue',
      data: { since: '2026-11-11T01:00:00.000Z', told: 'now' },
      context: at('2026-11-11T01:00:00.000Z'),
    },
  ],
  [
    `assessments/${tuesday}`,
    {
      type: 'goal_notice_started',
      data: { change: 'overdue', run: 'notice-1' },
      context: at('2026-11-11T01:00:05.000Z'),
    },
  ],
  [
    'goal-refusals/controls-hold.check-controls',
    {
      type: 'goal_observation_refused',
      data: { run: 'run-2', detail: 'The measure is not a number' },
      context: at('2026-11-10T09:00:00.000Z'),
    },
  ],
  [
    'goal-summaries/controls-hold',
    {
      type: 'goal_summary_started',
      data: {
        due: '2026-11-13T09:00:00.000Z',
        window: { from: '2026-11-08T12:00:00.000Z', to: '2026-11-13T09:00:00.000Z' },
        run: summaryRunIdOf('controls-hold', Date.parse('2026-11-13T09:00:00.000Z')),
      },
      context: at('2026-11-13T09:00:05.000Z'),
    },
  ],
  [
    'goal-summaries/controls-hold',
    {
      type: 'goal_notice_refused',
      data: { change: 'summary', attempt: 1, detail: 'unavailable', retry_at: '2026-11-20T09:05:00.000Z' },
      context: at('2026-11-20T09:00:01.000Z'),
    },
  ],
];

function ledgerOpened(layer: Layer.Layer<Ledger>): Promise<Ledger['Service']> {
  const runtime = ManagedRuntime.make(layer);
  onTestFinished(() => runtime.dispose());
  return runtime.runPromise(Ledger);
}

interface Place {
  readonly open: () => Promise<Ledger['Service']>;
  readonly dropTables: () => Promise<void>;
}

function onSQLite(): Promise<Place> {
  const ledger = temporaryLedger();
  onTestFinished(ledger.remove);
  return Promise.resolve({
    open: () => ledgerOpened(ledgerLayer({ fileName: ledger.fileName, projections })),
    dropTables: async () => {
      await onTheLedgerIn(ledger.fileName, (connection) =>
        Promise.all(tables.map((table) => connection.write(tableDropped(table)))),
      );
    },
  });
}

async function administer(connectionString: string, statement: string): Promise<void> {
  const client = new Client({ connectionString });
  await client.connect();
  try {
    await client.query(statement);
  } finally {
    await client.end();
  }
}

async function onPostgreSQL(): Promise<Place> {
  const name = `goals_${crypto.randomUUID().replaceAll('-', '')}`;
  await administer(postgresql, `CREATE DATABASE ${name}`);
  onTestFinished(() => administer(postgresql, `DROP DATABASE ${name} WITH (FORCE)`));
  const url = new URL(postgresql);
  url.pathname = `/${name}`;
  return {
    open: () => ledgerOpened(postgresqlLedgerLayer({ pools: plainPoolsOn(url.href), projections })),
    dropTables: () => administer(url.href, tables.map((table) => `DROP TABLE ${table}`).join('; ')),
  };
}

interface Store {
  readonly store: string;
  readonly skipped: boolean;
  readonly aPlace: () => Promise<Place>;
}

const stores: readonly Store[] = [
  { store: 'SQLite', skipped: false, aPlace: onSQLite },
  { store: `PostgreSQL${notice}`, skipped: postgresql === '', aPlace: onPostgreSQL },
];

function recorded(ledger: Ledger['Service']): Promise<void> {
  return Effect.runPromise(
    Effect.forEach(history, ([stream, fact]) => ledger.execute(`${prefix}${stream}`, verbatim, fact), {
      discard: true,
    }),
  );
}

async function rowsOf(ledger: Ledger['Service']) {
  const read = await Promise.all(
    projections.map((projection) =>
      Effect.runPromise(
        ledger.readProjectedRows(projection.name, sales, { where: [], orderBy: [], order: 'asc', limit: 50 }),
      ),
    ),
  );
  return Object.fromEntries(projections.map(({ name }, index) => [name, read[index]]));
}

async function duesOf(ledger: Ledger['Service']) {
  const next = (projection: string, column: string) => Effect.runPromise(ledger.nextDueOf(projection, column, 0));
  return {
    judging: await next('goal_assessments', 'judging_due_at'),
    notice: await next('goal_assessments', 'notice_due_at'),
    opens: await next('goal_clocks', 'opens_at'),
    summary: await next('goal_clocks', 'summary_at'),
    summaryRetry: await next('goal_summaries', 'retry_at'),
  };
}

const instant = (moment: string) => Date.parse(moment);

describe.each(stores)('the tables of goals on $store', ({ skipped, aPlace }) => {
  it.skipIf(skipped)(
    'are filled again from the facts of goals alone when their tables are new, every due as the facts folded it',
    async () => {
      const place = await aPlace();
      const ledger = await place.open();
      await recorded(ledger);
      const kept = { rows: await rowsOf(ledger), dues: await duesOf(ledger) };
      await Effect.runPromise(
        Effect.all([
          ledger.advanceRow('goal_clocks', sales, 'clock', {
            set: { opens_at: instant('2026-11-12T00:00:00.000Z') },
            when: [],
          }),
          ledger.advanceRow('goal_assessments', sales, monday, {
            set: { notice_due_at: instant('2026-11-12T00:00:00.000Z') },
            when: [],
          }),
          ledger.advanceRow('goal_summaries', sales, 'controls-hold', {
            set: { retry_at: instant('2026-11-21T00:00:00.000Z') },
            when: [],
          }),
        ]),
      );

      await place.dropTables();
      const filled = await place.open();

      expect(kept.dues).toEqual({
        judging: instant('2026-11-12T01:00:00.000Z'),
        notice: instant('2026-11-09T09:01:00.000Z'),
        opens: instant('2026-11-11T00:00:00.000Z'),
        summary: instant('2026-11-20T09:00:00.000Z'),
        summaryRetry: instant('2026-11-20T09:05:00.000Z'),
      });
      expect(Object.values(kept.rows).map((rows) => rows?.length)).toEqual([2, 1, 1, 2, 1, 1, 2, 2]);
      expect({ rows: await rowsOf(filled), dues: await duesOf(filled) }).toEqual(kept);
    },
  );
});
