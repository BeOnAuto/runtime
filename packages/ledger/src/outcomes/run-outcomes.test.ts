import type { RunOutcomeMapping } from '@on.auto/operations';
import { definitionsPlaced, memoryLedgerWith, runTallies } from '@on.auto/operations/testing';
import { describe, expect, it, onTestFinished } from 'vitest';

import { plainPoolsOn, postgresqlLedgerLayer } from '../postgresql/postgresql-ledger.ts';
import { openLedgerWith } from '../testing/open-ledger.ts';
import { postgresqlConnected, postgresqlDatabasesOn, postgresqlQueried } from '../testing/postgresql-databases.ts';
import {
  began,
  ended,
  fourRuns,
  fourRunsKept,
  noting,
  reading,
  runOutcomesBehaviour,
} from './run-outcomes-behaviour.ts';

const server = process.env['LEDGER_TEST_POSTGRESQL_URL'] ?? '';

const { skipped, notice, anEmptyDatabase: aDatabase } = postgresqlDatabasesOn(server);

interface Counting {
  readonly mapping: RunOutcomeMapping;
  readonly count: () => number;
}

function counting(): Counting {
  const seen = { count: 0 };
  return {
    mapping: {
      ...runTallies,
      rowAfter: (row, event) => {
        seen.count += 1;
        return runTallies.rowAfter(row, event);
      },
    },
    count: () => seen.count,
  };
}

describe('The in-memory ledger of the application layer', () => {
  runOutcomesBehaviour((runOutcomes) =>
    Promise.resolve(memoryLedgerWith({ runOutcomes, definitionNames: definitionsPlaced }).service),
  );
});

describe.skipIf(skipped)(`The outcomes of runs on PostgreSQL${notice}`, () => {
  it('are filled once by ledgers that start together, the table made under the lock of the migration', async () => {
    const database = await aDatabase();
    const writing = await openLedgerWith(
      postgresqlLedgerLayer({ pools: plainPoolsOn(database), definitionNames: definitionsPlaced }),
    );
    await fourRuns(writing.ledger);
    await writing.dispose();
    const { mapping, count } = counting();

    const opened = await Promise.all(
      [1, 2, 3].map(() =>
        openLedgerWith(
          postgresqlLedgerLayer({
            pools: plainPoolsOn(database),
            runOutcomes: mapping,
            definitionNames: definitionsPlaced,
          }),
        ),
      ),
    );
    onTestFinished(async () => {
      await Promise.all(opened.map(({ dispose }) => dispose()));
    });

    expect(count()).toBe(7);
    expect(await Promise.all(opened.map(({ ledger }) => reading(ledger)))).toEqual([
      fourRunsKept,
      fourRunsKept,
      fourRunsKept,
    ]);
  });

  it('are caught up once by ledgers that start together, which take the pages in turn, a fact a page', async () => {
    const database = await aDatabase();
    const writing = await openLedgerWith(
      postgresqlLedgerLayer({ pools: plainPoolsOn(database), definitionNames: definitionsPlaced }),
    );
    await fourRuns(writing.ledger);
    await writing.dispose();
    const { mapping, count } = counting();

    const opened = await Promise.all(
      [1, 2].map(() =>
        openLedgerWith(
          postgresqlLedgerLayer({
            pools: plainPoolsOn(database),
            runOutcomes: mapping,
            mostBytesFilledAtOnce: 1,
            definitionNames: definitionsPlaced,
          }),
        ),
      ),
    );
    onTestFinished(async () => {
      await Promise.all(opened.map(({ dispose }) => dispose()));
    });

    expect(count()).toBe(7);
    expect(await Promise.all(opened.map(({ ledger }) => reading(ledger)))).toEqual([fourRunsKept, fourRunsKept]);
    expect(
      await postgresqlQueried(
        database,
        "SELECT folded_through FROM projection_checkpoints WHERE projection = 'run_outcomes'",
      ),
    ).toEqual([{ folded_through: null }]);
  });
});

const appendedAt = `SELECT success FROM emt_append_to_stream(ARRAY['first']::text[], ARRAY['{}']::jsonb[],
  ARRAY['{}']::jsonb[], ARRAY['1']::text[], ARRAY['run_noted']::text[], ARRAY['E']::text[], $1::text, 'runs'::text,
  $2::bigint, 'emt:default'::text)`;

describe.skipIf(skipped)(`The order of the facts of a stream on PostgreSQL${notice}`, () => {
  it('is the order of the store: a transaction that wrote first is refused the next fact of a stream another transaction appended to after it, since it expected the version it read before it began', async () => {
    const database = await aDatabase();
    const { ledger, dispose } = await openLedgerWith(postgresqlLedgerLayer({ pools: plainPoolsOn(database) }));
    onTestFinished(dispose);
    const [a, b] = ['playbook/acme/alpha/runs/a', 'playbook/acme/alpha/runs/b'] as const;
    await noting(ledger, a, began('triage'));
    await noting(ledger, b, began('triage'));
    const first = await postgresqlConnected(database);
    await first.query('BEGIN');

    const wroteFirst = await first.query(appendedAt, [a, 1]);
    await noting(ledger, b, ended('succeeded', 1));
    const thenTheOther = await first.query(appendedAt, [b, 1]);
    await first.query('ROLLBACK');

    expect([wroteFirst.rows, thenTheOther.rows]).toEqual([[{ success: true }], [{ success: false }]]);
    expect(
      await postgresqlQueried(
        database,
        'SELECT stream_id, stream_position::int AS position FROM emt_messages ORDER BY transaction_id, global_position',
      ),
    ).toEqual([
      { stream_id: a, position: 1 },
      { stream_id: b, position: 1 },
      { stream_id: b, position: 2 },
    ]);
  });
});
