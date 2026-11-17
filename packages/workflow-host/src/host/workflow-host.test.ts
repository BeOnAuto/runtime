import type { CallResult } from '@on.auto/operations';
import { type RecordedSpan, recordingTracer } from '@on.auto/operations/testing';
import { Context, Effect, Tracer } from 'effect';
import { describe, expect, it } from 'vitest';

import { runAt, startOf, workflow } from '../testing/host-documents.ts';
import { aSQLiteFile, leaseHoldersOn, onSQLite, openedOn } from '../testing/host-files.ts';
import { hostedOn } from '../testing/host-runs.ts';
import { until } from '../testing/until.ts';
import { steppedClock } from '../views-testing/stepped-sweeps.ts';

const runId = '0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7a';

const pausedASecond = workflow('do:\n  - pause: { wait: PT1S }');

describe('a host opened whole', () => {
  it('opens its parts, takes the claim, wakes them by its loop and lets go of the claim when it stops', async () => {
    const clock = steppedClock(Date.now());
    const settings = await onSQLite();
    const hosted = await hostedOn(settings, { clock, holder: 'whole', sweepEveryMs: 1000 });
    hosted.know(runId);
    const leases = await openedOn(settings);
    const holdersWhileOpen = await leaseHoldersOn(leases);

    const started = await Effect.runPromise(hosted.host.start(runAt(runId), startOf(pausedASecond)));
    clock.step(1000);
    const settled = await until(hosted.settlements, (settlements) => settlements.size > 0);
    await hosted.host.stop();

    expect([holdersWhileOpen, started, [...settled.keys()], await leaseHoldersOn(leases)]).toEqual([
      ['whole'],
      'started',
      [runId],
      [],
    ]);
  });
});

const run = runAt(runId);

const notifying = workflow('do:\n  - notify: { call: notify, with: { to: ada } }');

const runAttributes = { 'auto.on.org': 'acme', 'auto.on.playbook': 'alpha', 'auto.on.run_id': runId };

function named(spans: readonly RecordedSpan[], name: string): RecordedSpan | undefined {
  return spans.find((span) => span.name === name);
}

function settledIn(spans: readonly RecordedSpan[]): boolean {
  return spans.some(({ name, ending }) => name === 'settle' && ending !== 'open');
}

describe('the host given the context of its server', () => {
  it('traces a start as its input, with the call it makes, the answer and the settlement each beneath the last', async () => {
    const recording = recordingTracer();
    const hosted = await hostedOn(
      { store: 'sqlite', file: aSQLiteFile() },
      { context: Context.make(Tracer.Tracer, recording.tracer) },
    );
    hosted.know(runId);

    await Effect.runPromise(Effect.withTracer(hosted.host.start(run, startOf(notifying)), recording.tracer));
    const spans = await until(recording.spans, settledIn);
    const started = named(spans, 'started');
    const call = named(spans, 'call notify');
    const answered = named(spans, 'call_answered');
    const settled = named(spans, 'settle');

    expect(started?.attributes).toMatchObject({ ...runAttributes, 'auto.on.submission': 'applied' });
    expect(call?.attributes).toMatchObject({ ...runAttributes, 'auto.on.call.function': 'notify' });
    expect(settled?.attributes).toMatchObject({
      ...runAttributes,
      'auto.on.settlement.status': 'succeeded',
      'auto.on.settle.receipt': 'recorded',
    });
    expect([call?.parentSpanId, answered?.parentSpanId, settled?.parentSpanId]).toEqual([
      started?.spanId,
      call?.spanId,
      answered?.spanId,
    ]);
  });
});

describe('the host told to stop just after it admitted a start', () => {
  it('lets the start finish, then stops the call it began, so nothing outlives the stop', async () => {
    const answers = { begun: 0, stopped: 0 };
    const answeredOnlyWhenStopped: Effect.Effect<CallResult> = Effect.sync(() => {
      answers.begun += 1;
    }).pipe(
      Effect.andThen(Effect.never),
      Effect.onInterrupt(() =>
        Effect.sync(() => {
          answers.stopped += 1;
        }),
      ),
    );
    const hosted = await hostedOn(
      { store: 'sqlite', file: aSQLiteFile() },
      { answer: () => answeredOnlyWhenStopped, sweepEveryMs: 3_600_000 },
    );

    const starting = Effect.runPromise(
      hosted.host.start(runAt('0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7a'), startOf(notifying)),
    );
    const stopping = hosted.host.stop();
    const started = await starting;
    await stopping;

    expect(started).toBe('started');
    expect(answers).toEqual({ begun: 1, stopped: 1 });
    expect(hosted.troubles()).toEqual([]);
  });
});
