import { messageIdOf } from '@on.auto/operations';
import { callKeyText } from '@on.auto/workflow-engine';
import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { startedRow } from '../calls/call-rows.ts';
import { insertedListener } from '../listeners/listener-rows.ts';
import { runAt, startOf, workflow } from '../testing/host-documents.ts';
import { aSQLiteFile, openedOn } from '../testing/host-files.ts';
import { hostedOn } from '../testing/host-runs.ts';
import { until } from '../testing/until.ts';
import { runKeyOf, runLogStreamOf } from './run-address.ts';
import { lineageOfRecord } from './run-lineage.ts';

const runId = '0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7a';

const run = runAt(runId);

const stream = runLogStreamOf(runKeyOf(run));

const start = '5d0e9f6a-1b2c-5d3e-8f4a-6b7c8d9e0f1a';

const given = { lineage: { start, correlation: 'root' } };

async function lineagesOf(file: string): Promise<readonly unknown[]> {
  const database = await openedOn({ store: 'sqlite', file });
  const { messages } = await database.store.read(stream);
  return messages.map(({ lineage }) => lineage);
}

const runResumedLineage = runAt('0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7a');

const streamResumedLineage = runLogStreamOf(runKeyOf(runResumedLineage));

const givenResumedLineage = { lineage: { start: '5d0e9f6a-1b2c-5d3e-8f4a-6b7c8d9e0f1a', correlation: 'root' } };

const waited = { reference: '/do/0/ask', run: 1, outcome: 'waiting', times: 1 } as const;

const waitKey = callKeyText({ runId: runKeyOf(runResumedLineage), reference: '/do/0/ask', run: 1 });

function resumedLineage(database: Awaited<ReturnType<typeof openedOn>>) {
  return Effect.runPromise(
    lineageOfRecord(database, runKeyOf(runResumedLineage), {
      cause: { kind: 'resumed', step: waited },
      attributes: givenResumedLineage,
    }),
  );
}

describe('the lineage the host writes with each record of a run', () => {
  it('is the start it was given for the first, the record that armed the timer of a wait, and the root as correlation', async () => {
    const file = aSQLiteFile();
    const hosted = await hostedOn({ store: 'sqlite', file });
    hosted.know(runId);
    const document = workflow('do:\n  - pause: { wait: PT0.05S }');
    await Effect.runPromise(hosted.host.start(run, { ...startOf(document), attributes: given }));
    await until(hosted.settlements, (settled) => settled.size > 0);

    expect(await lineagesOf(file)).toEqual([
      { id: messageIdOf(stream, 1), causationId: start, correlationId: 'root' },
      { id: messageIdOf(stream, 2), causationId: messageIdOf(stream, 1), correlationId: 'root' },
    ]);
    expect(hosted.settledWith().get(runId)).toEqual({ causationId: messageIdOf(stream, 2), correlationId: 'root' });
  });
});

describe('the lineage of the fire of a timer', () => {
  it('is the record that armed a timer for its fire, after the host started again, and none for a run given no lineage', async () => {
    const file = aSQLiteFile();
    const first = await hostedOn({ store: 'sqlite', file });
    const document = workflow('do:\n  - slow: { timeout: { after: PT0.3S }, wait: PT1H }');
    await Effect.runPromise(first.host.start(run, startOf(document)));
    await first.host.stop();
    const second = await hostedOn({ store: 'sqlite', file });
    second.know(runId);
    await until(second.settlements, (settled) => settled.size > 0);

    expect(await lineagesOf(file)).toEqual([
      { id: messageIdOf(stream, 1), causationId: null, correlationId: runId },
      { id: messageIdOf(stream, 2), causationId: messageIdOf(stream, 1), correlationId: runId },
    ]);
    expect(second.settledWith().get(runId)).toEqual({ causationId: messageIdOf(stream, 2), correlationId: runId });
  });
});

describe('the lineage of a record nothing waited for', () => {
  it('is nothing for an event no step took, and the record that ended a run with no step settles it', async () => {
    const file = aSQLiteFile();
    const hosted = await hostedOn({ store: 'sqlite', file });
    hosted.know(runId);
    const waiting = { ...startOf(workflow('do:\n  - pause: { wait: PT1H }')), attributes: given };
    await Effect.runPromise(hosted.host.start(run, waiting));
    await Effect.runPromise(
      Effect.forEach(
        Array.from({ length: 65 }, (_, index) => index),
        (index) => hosted.host.deliver(run, { id: `e${index}`, type: 'nobody listens' }),
      ),
    );
    await until(hosted.settlements, (settled) => settled.size > 0);
    const lineages = await lineagesOf(file);

    expect([lineages[1], lineages.length]).toEqual([
      { id: messageIdOf(stream, 2), causationId: null, correlationId: 'root' },
      66,
    ]);
    expect(hosted.settledWith().get(runId)).toEqual({
      causationId: messageIdOf(stream, 66),
      correlationId: 'root',
    });
  });

  it('is nothing for the fire of a timer the host keeps no arming record of, as one a sweep armed again', async () => {
    const database = await openedOn({ store: 'sqlite', file: aSQLiteFile() });

    expect(
      await Effect.runPromise(
        lineageOfRecord(database, runKeyOf(run), { cause: { kind: 'timer', timerId: '9' }, attributes: given }),
      ),
    ).toEqual({ causationId: null, correlationId: 'root' });
  });
});

describe('the lineage of a record a waiting step resumed', () => {
  it('is the record that started the call the step waited for', async () => {
    const database = await openedOn({ store: 'sqlite', file: aSQLiteFile() });
    const call = {
      kind: 'start_call',
      key: { runId: runKeyOf(runResumedLineage), reference: '/do/0/ask', run: 1 },
      function: 'notify',
      arguments: {},
      longestMs: 1000,
    } as const;
    await Effect.runPromise(
      startedRow(database, waitKey, {
        call,
        run: { runId: runKeyOf(runResumedLineage), attributes: givenResumedLineage },
        origin: { version: 4 },
        child: null,
        root: 'root',
      }),
    );

    expect(await resumedLineage(database)).toEqual({
      causationId: messageIdOf(streamResumedLineage, 4),
      correlationId: 'root',
    });
  });

  it('is the record that armed the listener the step waited with, and nothing when the host keeps neither', async () => {
    const database = await openedOn({ store: 'sqlite', file: aSQLiteFile() });
    const nothing = await resumedLineage(database);
    await Effect.runPromise(
      insertedListener(database, {
        runKey: runKeyOf(runResumedLineage),
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
      { causationId: messageIdOf(streamResumedLineage, 3), correlationId: 'root' },
    ]);
  });
});
