import { DatabaseSync, type SQLInputValue } from 'node:sqlite';

import { SQL } from '@event-driven-io/dumbo';
import { sqliteFormatter } from '@event-driven-io/dumbo/sqlite';
import { Schema } from 'effect';
import { describe, expect, it, onTestFinished } from 'vitest';

import { mostValuesTheLedgerBindsOnSQLite } from '../connection/bound-values.ts';
import { nodeSqliteEventStoreDriver } from '../connection/node-sqlite-event-store-driver.ts';
import type { MessageLane } from '../projections/projection-dialect.ts';
import { sqliteProjectionsOf } from '../projections/sqlite-projections.ts';
import { executedOn } from '../recorded/sqlite-checks.ts';
import { sqliteEventStore } from '../sqlite-event-store.ts';
import { ledgerLayer } from '../sqlite.ts';
import { boundedExecutor } from '../testing/bounded-executor.ts';
import { openLedgerWith } from '../testing/open-ledger.ts';
import { temporaryDatabase } from '../testing/temporary-database.ts';
import {
  madeWithANumber,
  ofTheFirstKind,
  ofTheLastKind,
  projectionOfTwentyOneKinds,
  remarked,
  remarksRowsOf,
} from './fact-scrub-on-stores-behaviour.ts';
import { scrubWithin } from './scrubbed-facts.ts';

async function aLedgerOfTwentyOneKinds() {
  const { fileName, remove } = temporaryDatabase();
  onTestFinished(remove);
  const { ledger, dispose } = await openLedgerWith(
    ledgerLayer({ fileName, projections: [projectionOfTwentyOneKinds] }),
  );
  onTestFinished(dispose);
  return { fileName, ledger };
}

const decodeBound = Schema.decodeUnknownSync(Schema.Array(Schema.Union([Schema.String, Schema.Number])));

async function aMigratedFile(): Promise<string> {
  const { fileName, remove } = temporaryDatabase();
  onTestFinished(remove);
  const store = sqliteEventStore(() => ({ driver: nodeSqliteEventStoreDriver, fileName }));
  await store.migrate();
  await store.close();
  return fileName;
}

function planOf(fileName: string, statement: SQL): string {
  const { query, params } = SQL.format(statement, sqliteFormatter);
  const database = new DatabaseSync(fileName, { readOnly: true });
  onTestFinished(() => {
    database.close();
  });
  const bound: readonly SQLInputValue[] = decodeBound(params);
  return database
    .prepare(`EXPLAIN QUERY PLAN ${query}`)
    .all(...bound)
    .map((row: Readonly<Record<string, unknown>>) => String(row['detail']))
    .join(' ');
}

describe('the work of a scrub inside its append, on a SQLite that binds at most 100 values in a statement', () => {
  it('folds a row of twenty-one kinds again from the facts of every kind, in the order they were appended', async () => {
    const { fileName, ledger } = await aLedgerOfTwentyOneKinds();
    await remarked(ledger, ofTheFirstKind, { type: 'remark_made', data: { text: 'earlier' } });
    await remarked(ledger, ofTheLastKind, madeWithANumber);
    const scrub = scrubWithin(sqliteProjectionsOf({ projections: [projectionOfTwentyOneKinds] }), ofTheLastKind, {
      position: 1,
      data: { text: '' },
    });

    await executedOn(fileName, (execute) => scrub(boundedExecutor(execute, mostValuesTheLedgerBindsOnSQLite)));

    expect(await remarksRowsOf(ledger)).toMatchObject([{ text: '', remarks: 2, erasures: 0 }]);
  });
});

describe('the read of the facts of a row a scrub folds again, on SQLite', () => {
  it('reads each lane through the index of its key, from the position after the cursor', async () => {
    const fileName = await aMigratedFile();
    const { dialect } = sqliteProjectionsOf({});
    const planOfALane = (lane: MessageLane) =>
      planOf(fileName, dialect.messagesInOrderAfter('41', 256, { of: 'lane', lane }, ['topic_noted']));

    expect(planOfALane({ by: 'prefix', key: 'playbook/acme/alpha/' })).toMatch(
      /^SEARCH emt_messages USING INDEX ledger_messages_by_playbook \(<expr>=\? AND global_position>\?\)/u,
    );
    expect(planOfALane({ by: 'stream', key: 'playbook/acme/alpha/notes/n1' })).toMatch(
      /^SEARCH emt_messages USING INDEX ledger_messages_by_stream \(stream_id=\? AND global_position>\?\)/u,
    );
  });
});
