import { recordingTracer, type RecordedSpan } from '@on.auto/operations/testing';
import { Effect, Metric, Tracer } from 'effect';
import { describe, expect, it } from 'vitest';

import { pooledJob } from './pooled-jobs.ts';

interface Duration {
  readonly attributes: Metric.Metric.AttributeSet | undefined;
  readonly state: unknown;
}

interface Measured {
  readonly spans: readonly RecordedSpan[];
  readonly durations: readonly Duration[];
}

async function measured<Outcome>(job: Effect.Effect<Outcome>): Promise<Measured> {
  const recording = recordingTracer();
  const snapshots = await Effect.runPromise(
    Effect.andThen(job, Metric.snapshot).pipe(
      Effect.provideService(Tracer.Tracer, recording.tracer),
      Effect.provideService(Metric.MetricRegistry, new Map()),
    ),
  );
  const durations: Duration[] = [];
  for (const { id, attributes, state } of snapshots) {
    if (id === 'auto.on.pool.job.duration') {
      durations.push({ attributes, state });
    }
  }
  return { spans: recording.spans(), durations };
}

describe('a job run in a pool of workers', () => {
  it('is a span named for its pool and its kind, saying how it ended and how long it ran', async () => {
    const { spans, durations } = await measured(
      pooledJob('program', 'computation', () => Promise.resolve({ ran: 'answered', text: 'null', milliseconds: 120 })),
    );

    expect(spans).toMatchObject([
      {
        name: 'program computation',
        ending: 'succeeded',
        attributes: {
          'auto.on.pool': 'program',
          'auto.on.pool.kind': 'computation',
          'auto.on.pool.ending': 'answered',
          'auto.on.pool.milliseconds': 120,
        },
      },
    ]);
    expect(durations.map(({ attributes }) => attributes)).toEqual([
      { 'auto.on.pool': 'program', 'auto.on.pool.kind': 'computation', 'auto.on.pool.ending': 'answered' },
    ]);
    expect(durations.map(({ state }) => state)).toMatchObject([{ count: 1, sum: 0.12 }]);
  });
});

describe('a job run in a pool of processes', () => {
  it('names how its process ended', async () => {
    const { spans } = await measured(
      pooledJob('model', 'walk', () => Promise.resolve({ ended: 'timed_out', milliseconds: 5 })),
    );

    expect(spans.map(({ name, attributes }) => [name, attributes['auto.on.pool.ending']])).toEqual([
      ['model walk', 'timed_out'],
    ]);
  });
});
