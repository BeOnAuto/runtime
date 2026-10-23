import { randomUUID } from 'node:crypto';

import {
  ContextSchema,
  Ledger,
  type Context,
  type Decided,
  type Decider,
  type RunOutcomeGroup,
} from '@on.auto/operations';
import { Effect, ManagedRuntime, Result, Schema, type Layer } from 'effect';
import { Client } from 'pg';
import { describe, expect, it, onTestFinished } from 'vitest';

import { ledgerLayerOf } from '../composition/ledger-store.ts';
import { ledgerDatabaseOf, type LedgerDatabase } from '../database/ledger-database.ts';
import { secretsKey } from '../testing/databases/secrets-key.ts';
import { temporaryLedger } from '../testing/records/temporary-ledger.ts';
import { readSettingsOf } from '../testing/settings/shipped-settings.ts';

const postgresql = process.env['LEDGER_TEST_POSTGRESQL_URL'] ?? '';

const notice =
  postgresql === '' ? ', skipped: set LEDGER_TEST_POSTGRESQL_URL to the URL of a PostgreSQL server to run it' : '';

const FactSchema = Schema.Struct({ type: Schema.String, data: Schema.JsonObject, context: ContextSchema });

type Fact = typeof FactSchema.Type;

interface Written {
  readonly fact: Decided<Fact>;
  readonly context: Context;
}

const facts: Decider<null, Written, Fact> = {
  initialState: null,
  evolve: () => null,
  decide: ({ fact }) => Result.succeed([fact]),
  context: ({ context }) => context,
  eventSchema: FactSchema,
};

async function administer(statement: string): Promise<void> {
  const client = new Client({ connectionString: postgresql });
  await client.connect();
  try {
    await client.query(statement);
  } finally {
    await client.end();
  }
}

async function aPostgreSQLLedger(): Promise<LedgerDatabase> {
  const name = `outcomes_${randomUUID().replaceAll('-', '')}`;
  await administer(`CREATE DATABASE ${name}`);
  onTestFinished(() => administer(`DROP DATABASE ${name} WITH (FORCE)`));
  const url = new URL(postgresql);
  url.pathname = `/${name}`;
  return ledgerDatabaseOf(readSettingsOf({ DATABASE_URL: url.href, SECRETS_KEY: secretsKey }));
}

function anSQLiteLedger(): Promise<LedgerDatabase> {
  const ledger = temporaryLedger();
  onTestFinished(ledger.remove);
  return ledgerDatabaseOf(readSettingsOf({ LEDGER_FILE: ledger.fileName }));
}

function opened(layer: Layer.Layer<Ledger>): Promise<Ledger['Service']> {
  const runtime = ManagedRuntime.make(layer);
  onTestFinished(() => runtime.dispose());
  return runtime.runPromise(Ledger);
}

const usage = { input: { total: 1200, cache_read: 1000 }, output: { total: 300 } };

function ofTheRun(name: string, type: string, at: string): Context {
  return { by: 'acme-admin', at, definitionType: type, definitionName: name, definitionVersion: 1 };
}

function started(name: string, at: string, type = 'reasoning'): Written {
  return { fact: { type: 'run_started', data: { input: {} } }, context: ofTheRun(name, type, at) };
}

function finished(
  type: string,
  at: string,
  data: Schema.JsonObject = {},
  [name, kind]: readonly [string, string] = ['triage', 'reasoning'],
): Written {
  return { fact: { type, data }, context: ofTheRun(name, kind, at) };
}

const runs: readonly (readonly [string, readonly Written[]])[] = [
  [
    'started-twice',
    [
      started('triage', '2026-10-01T09:00:00.000Z'),
      finished('run_failed', '2026-10-01T09:00:01.000Z'),
      started('triage', '2026-10-01T10:00:00.000Z'),
      finished('tool_call_started', '2026-10-01T10:00:00.100Z', { number: 1 }),
      finished('run_succeeded', '2026-10-01T10:00:00.250Z', { output: 'ok', record: { usage } }),
    ],
  ],
  [
    'without-usage',
    [
      started('triage', '2026-10-01T11:00:00.000Z'),
      finished('run_succeeded', '2026-10-01T11:00:00.500Z', { output: 'ok', record: {} }),
    ],
  ],
  [
    'not-an-object',
    [
      started('triage', '2026-10-01T12:00:00.000Z'),
      finished('run_succeeded', '2026-10-01T12:00:00.100Z', { output: 'ok', record: 'text' }),
    ],
  ],
  [
    'rejected-with-usage',
    [
      started('triage', '2026-10-01T13:00:00.000Z'),
      finished('run_rejected', '2026-10-01T13:00:01.000Z', { rejection: {}, record: { usage } }),
    ],
  ],
  [
    'rejected',
    [
      started('triage', '2026-10-01T14:00:00.000Z'),
      finished('run_rejected', '2026-10-01T14:00:01.000Z', { rejection: {} }),
    ],
  ],
  [
    'workflow',
    [
      started('approval', '2026-10-01T15:00:00.000Z', 'workflow'),
      finished('run_deferred', '2026-10-01T15:00:00.010Z', { record: {} }, ['approval', 'workflow']),
      finished('run_succeeded', '2026-10-02T15:00:00.000Z', { output: {}, record: {} }, ['approval', 'workflow']),
    ],
  ],
  ['finish-alone', [finished('run_failed', '2026-10-02T09:00:00.000Z')]],
  ['still-going', [started('draft', '2026-10-02T10:00:00.000Z')]],
];

function written(ledger: Ledger['Service']): Promise<void> {
  return Effect.runPromise(
    Effect.forEach(
      runs,
      ([run, given]) =>
        Effect.forEach(given, (each) => ledger.execute(`playbook/acme/alpha/runs/${run}`, facts, each), {
          discard: true,
        }),
      { discard: true },
    ),
  );
}

function withoutTheProjection(database: LedgerDatabase): Layer.Layer<Ledger> {
  return database.ledgerLayer({});
}

function lineOf(group: RunOutcomeGroup): string {
  const { day, definitionType: type, name, status, inputTokens, outputTokens, cachedTokens } = group;
  const durations = group.durations.toSorted((left, right) => left - right).join(' ');
  const tokens = `${inputTokens} ${outputTokens} ${cachedTokens}`;
  return `${day} ${type}/${name} ${status} ${group.runs} [${durations}] ${tokens}`;
}

async function outcomesIn(ledger: Ledger['Service']): Promise<readonly string[]> {
  const groups = await Effect.runPromise(
    ledger.readRunOutcomes({ org: 'acme', playbook: 'alpha' }, { from: '2026-10-01', to: '2026-10-02' }, {}),
  );
  return groups.map((group) => lineOf(group)).toSorted();
}

const kept = [
  '2026-10-01 reasoning/triage rejected 2 [] 1200 300 1000',
  '2026-10-01 reasoning/triage succeeded 3 [100 250 500] 1200 300 1000',
  '2026-10-01 workflow/approval succeeded 1 [86400000] 0 0 0',
  '2026-10-02 / failed 1 [] 0 0 0',
  '2026-10-02 reasoning/draft started 1 [] 0 0 0',
];

interface Store {
  readonly store: string;
  readonly skipped: boolean;
  readonly aLedger: () => Promise<LedgerDatabase>;
}

const stores: readonly Store[] = [
  { store: 'SQLite', skipped: false, aLedger: anSQLiteLedger },
  { store: `PostgreSQL${notice}`, skipped: postgresql === '', aLedger: aPostgreSQLLedger },
];

describe.each(stores)('the outcomes of runs the composed ledger keeps, on $store', ({ skipped, aLedger }) => {
  it.skipIf(skipped)(
    'are one row per run for every shape of run, as each append keeps it and as a fill replays it',
    async () => {
      const appended = await aLedger();
      const replayed = await aLedger();
      await written(await opened(ledgerLayerOf(appended)));
      await written(await opened(withoutTheProjection(replayed)));

      const inline = await outcomesIn(await opened(ledgerLayerOf(appended)));
      const filled = await outcomesIn(await opened(ledgerLayerOf(replayed)));

      expect([inline, filled]).toEqual([kept, kept]);
    },
  );
});
