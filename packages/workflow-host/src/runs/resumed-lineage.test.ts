import { messageIdOf } from '@on.auto/operations';
import { callKeyText } from '@on.auto/workflow-engine';
import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { startedRow } from '../calls/call-rows.ts';
import { insertedListener } from '../listeners/listener-rows.ts';
import { runAt } from '../testing/host-documents.ts';
import { aSQLiteFile, openedOn } from '../testing/host-files.ts';
import { runLogStreamOf, runKeyOf } from './run-address.ts';
import { lineageOfRecord } from './run-lineage.ts';

const run = runAt('0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7a');

const stream = runLogStreamOf(runKeyOf(run));

const given = { lineage: { start: '5d0e9f6a-1b2c-5d3e-8f4a-6b7c8d9e0f1a', correlation: 'root' } };

const waited = { reference: '/do/0/ask', run: 1, outcome: 'waiting', times: 1 } as const;

const waitKey = callKeyText({ runId: runKeyOf(run), reference: '/do/0/ask', run: 1 });

function resumedLineage(database: Awaited<ReturnType<typeof openedOn>>) {
  return Effect.runPromise(
    lineageOfRecord(database, runKeyOf(run), { cause: { kind: 'resumed', step: waited }, attributes: given }),
  );
}

describe('the lineage of a record a waiting step resumed', () => {
  it('is the record that started the call the step waited for', async () => {
    const database = await openedOn({ store: 'sqlite', file: aSQLiteFile() });
    const call = {
      kind: 'start_call',
      key: { runId: runKeyOf(run), reference: '/do/0/ask', run: 1 },
      function: 'notify',
      arguments: {},
      longestMs: 1000,
    } as const;
    await Effect.runPromise(
      startedRow(database, waitKey, {
        call,
        run: { runId: runKeyOf(run), attributes: given },
        origin: { version: 4 },
        child: null,
        root: 'root',
      }),
    );

    expect(await resumedLineage(database)).toEqual({ causationId: messageIdOf(stream, 4), correlationId: 'root' });
  });

  it('is the record that armed the listener the step waited with, and nothing when the host keeps neither', async () => {
    const database = await openedOn({ store: 'sqlite', file: aSQLiteFile() });
    const nothing = await resumedLineage(database);
    await Effect.runPromise(
      insertedListener(database, {
        runKey: runKeyOf(run),
        listener: waitKey,
        playbookKey: 'playbook/acme/alpha/',
        streamId: 'playbook/acme/alpha/events',
        armedBy: 3,
        filters: '[]',
        workflow: 'close',
        version: 1,
        passed: false,
      }),
    );

    expect([nothing, await resumedLineage(database)]).toEqual([
      { causationId: null, correlationId: 'root' },
      { causationId: messageIdOf(stream, 3), correlationId: 'root' },
    ]);
  });
});
