import { recordingTracer, type RecordedSpan } from '@on.auto/operations/testing';
import { Context, Effect, Tracer } from 'effect';
import { describe, expect, it } from 'vitest';

import { runAt, startOf, workflow } from '../testing/host-documents.ts';
import { aSQLiteFile } from '../testing/host-files.ts';
import { hostedOn } from '../testing/host-runs.ts';
import { until } from '../testing/until.ts';

const runId = '0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7a';

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
