import { Effect, Metric } from 'effect';

type JobPool = 'program' | 'model';

type Ended = { readonly ran: string } | { readonly ended: string };

type Timed = Ended & { readonly milliseconds: number };

const jobSeconds = Metric.histogram('auto.on.pool.job.duration', {
  description: 'How long a job ran in a pool of workers or processes, in seconds',
  boundaries: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, 30, 60, 300],
});

function endingOf(outcome: Ended): string {
  return 'ran' in outcome ? outcome.ran : outcome.ended;
}

export function pooledJob<Outcome extends Timed>(
  pool: JobPool,
  kind: string,
  job: (signal: Readonly<AbortSignal>) => Promise<Outcome>,
): Effect.Effect<Outcome> {
  return Effect.promise(job).pipe(
    Effect.tap((outcome: Outcome) => {
      const attributes = { 'auto.on.pool': pool, 'auto.on.pool.kind': kind, 'auto.on.pool.ending': endingOf(outcome) };
      return Effect.andThen(
        Effect.annotateCurrentSpan({ ...attributes, 'auto.on.pool.milliseconds': outcome.milliseconds }),
        Metric.update(Metric.withAttributes(jobSeconds, attributes), outcome.milliseconds / 1000),
      );
    }),
    Effect.withSpan(`${pool} ${kind}`),
  );
}
