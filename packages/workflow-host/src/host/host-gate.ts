import { Data, Effect } from 'effect';

export class HostStopped extends Data.TaggedError('host_stopped')<{ readonly detail: string }> {}

export interface Gate {
  readonly guarded: <A, E>(work: Effect.Effect<A, E>) => Effect.Effect<A, E | HostStopped>;
  readonly closed: () => Promise<void>;
}

export function gate(): Gate {
  const calls = { open: 0, stopping: false, drained: Promise.withResolvers<void>() };
  const left = (): void => {
    if (calls.stopping && calls.open === 0) {
      calls.drained.resolve();
    }
  };
  return {
    guarded: <A, E>(work: Effect.Effect<A, E>) =>
      Effect.suspend((): Effect.Effect<A, E | HostStopped> => {
        if (calls.stopping) {
          return Effect.fail(new HostStopped({ detail: 'The server is stopping' }));
        }
        calls.open += 1;
        return work.pipe(
          Effect.ensuring(
            Effect.sync(() => {
              calls.open -= 1;
              left();
            }),
          ),
        );
      }),
    closed: () => {
      calls.stopping = true;
      left();
      return calls.drained.promise;
    },
  };
}
