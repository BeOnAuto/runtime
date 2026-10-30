import { Effect, Metric } from 'effect';

interface Timed {
  readonly ran: string;
  readonly milliseconds: number;
}

const pool = 'program';

const jobSeconds = Metric.histogram('auto.on.pool.job.duration', {
  description: 'How long a job ran in the pool of workers that runs programs, in seconds',
  boundaries: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, 30, 60, 300],
});

export function pooledJob<Outcome extends Timed>(
  kind: string,
  job: (signal: Readonly<AbortSignal>) => Promise<Outcome>,
): Effect.Effect<Outcome> {
  return Effect.promise(job).pipe(
    Effect.tap((outcome: Outcome) => {
      const attributes = { 'auto.on.pool': pool, 'auto.on.pool.kind': kind, 'auto.on.pool.ending': outcome.ran };
      return Effect.andThen(
        Effect.annotateCurrentSpan({ ...attributes, 'auto.on.pool.milliseconds': outcome.milliseconds }),
        Metric.update(Metric.withAttributes(jobSeconds, attributes), outcome.milliseconds / 1000),
      );
    }),
    Effect.withSpan(`${pool} ${kind}`),
  );
}
