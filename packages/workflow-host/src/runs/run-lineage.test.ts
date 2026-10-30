import { messageIdOf } from '@on.auto/operations';
import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { runAt, startOf, workflow } from '../testing/host-documents.ts';
import { aSQLiteFile, openedOn } from '../testing/host-files.ts';
import { hostedOn } from '../testing/host-runs.ts';
import { until } from '../testing/until.ts';
import { runLogStreamOf, runKeyOf } from './run-address.ts';
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
