import { statementOf, type Statement } from '@on.auto/ledger';
import { Effect, Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import { rowsOf, type HostDatabase } from '../database/host-database.ts';
import { queuedStartsSuite } from '../suite-testing/queued-starts-suite.ts';
import { onSQLite, openedOn } from '../testing/host-files.ts';
import { queuedStartsOn } from './queued-starts.ts';

const close = { org: 'acme', definition: '0199a3c4-7d2e-7c1a-9b3f-0000000c105e' };

const PlanRow = Schema.Struct({ detail: Schema.String });

function explained({ strings, values }: Statement): Statement {
  const [first = '', ...rest] = strings;
  return statementOf([`EXPLAIN QUERY PLAN ${first}`, ...rest], values);
}

function readsRecorded(database: HostDatabase): { readonly recording: HostDatabase; readonly asked: Statement[] } {
  const asked: Statement[] = [];
  const read: HostDatabase['read'] = (statement) =>
    Effect.suspend(() => {
      asked.push(statement);
      return database.read(statement);
    });
  return { recording: { ...database, read }, asked };
}

describe('the starts of a workflow queued for a later minute, on SQLite', () => {
  queuedStartsSuite(onSQLite);
});

describe('the reads of the starts a workflow queued, as SQLite plans them', () => {
  it('seek the index of the queue by workflow and walk it in the order the starts are taken up, with no sort', async () => {
    const database = await openedOn(await onSQLite());
    const { recording, asked } = readsRecorded(database);
    const queue = queuedStartsOn(recording);

    await Effect.runPromise(queue.queuedStartsOf(close));
    await Effect.runPromise(queue.queuedStartsPage(close, { limit: 20 }));
    await Effect.runPromise(queue.queuedStartsPage(close, { after: { dueAt: 1, runId: 'run-1' }, limit: 20 }));
    const plans = await Effect.runPromise(
      Effect.forEach(asked, (statement) => rowsOf(PlanRow, database.read(explained(statement)))),
    );

    const planned = plans.map((rows) => JSON.stringify(rows));

    expect(planned).toHaveLength(3);
    expect(planned.filter((plan) => !plan.includes('workflow_reaction_backlog_by_definition'))).toEqual([]);
    expect(planned.filter((plan) => plan.includes('TEMP B-TREE'))).toEqual([]);
  });
});
