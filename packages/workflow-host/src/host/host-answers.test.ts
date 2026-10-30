import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { runAt, startOf, workflow } from '../testing/host-documents.ts';
import { aSQLiteFile } from '../testing/host-files.ts';
import { hostedOn } from '../testing/host-runs.ts';
import { until } from '../testing/until.ts';
import { HostStopped } from './host-gate.ts';

const runId = '0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7a';

const run = runAt(runId);

const listening = workflow('do:\n  - approval: { listen: { to: { one: { with: { type: com.acme.approved } } } } }');

const notifying = workflow('do:\n  - notify: { call: notify, with: { to: ada } }');

const pausing = workflow('do:\n  - pause: { wait: PT1H }');

const approved = { id: 'approved-1', type: 'com.acme.approved' };

describe('the host asked to start a run', () => {
  it('answers that a run it already started is going, and starts nothing again', async () => {
    const hosted = await hostedOn({ store: 'sqlite', file: aSQLiteFile() });

    const together = await Effect.runPromise(
      Effect.all([hosted.host.start(run, startOf(listening)), hosted.host.start(run, startOf(listening))], {
        concurrency: 'unbounded',
      }),
    );
    const after = await Effect.runPromise(hosted.host.start(run, startOf(listening)));
    const state = await Effect.runPromise(hosted.host.stateOf(run));

    expect([together.toSorted(), after, state.inputs]).toEqual([['going', 'started'], 'going', 1]);
  });
});

describe('the host given an event', () => {
  it('answers that an event for a run not started yet waits for the start, and takes an event once', async () => {
    const hosted = await hostedOn({ store: 'sqlite', file: aSQLiteFile() });

    const early = await Effect.runPromise(hosted.host.deliver(run, approved));
    const notStartedIsNotStored = await Effect.runPromise(hosted.host.stateOf(run));
    await Effect.runPromise(hosted.host.start(run, startOf(pausing)));
    const first = await Effect.runPromise(hosted.host.deliver(run, approved));
    const again = await Effect.runPromise(hosted.host.deliver(run, approved));

    expect([early, notStartedIsNotStored.status, first, again]).toEqual([
      'not_started',
      'new',
      'delivered',
      'delivered',
    ]);
  });
});

describe('the host reporting to its operator', () => {
  it('reports a run whose run the playbook does not know, once it ends', async () => {
    const hosted = await hostedOn({ store: 'sqlite', file: aSQLiteFile() });

    await Effect.runPromise(hosted.host.start(run, startOf(listening)));
    await Effect.runPromise(hosted.host.deliver(run, approved));
    const troubles = await until(hosted.troubles, (reported) => reported.length > 0);

    expect(troubles).toEqual([`${runId} unknown_run`]);
  });

  it('reports a call that broke down before it could answer', async () => {
    const hosted = await hostedOn(
      { store: 'sqlite', file: aSQLiteFile() },
      { answer: () => Effect.die(new Error('The function broke down')), sweepEveryMs: 3_600_000 },
    );

    await Effect.runPromise(hosted.host.start(run, startOf(notifying)));
    const troubles = await until(hosted.troubles, (reported) => reported.length > 0);

    expect(troubles).toEqual(['A call could not record its answer']);
  });
});

describe('the host that is stopping', () => {
  it('refuses a start and an event, and stops once', async () => {
    const hosted = await hostedOn({ store: 'sqlite', file: aSQLiteFile() });

    await Promise.all([hosted.host.stop(), hosted.host.stop()]);
    const refusals = await Effect.runPromise(
      Effect.all([
        Effect.flip(hosted.host.start(run, startOf(listening))),
        Effect.flip(hosted.host.deliver(run, approved)),
      ]),
    );

    expect(refusals).toEqual([new HostStopped({ detail: 'The server is stopping' }), expect.any(HostStopped)]);
  });
});
