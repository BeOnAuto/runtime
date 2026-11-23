import { Context, Deferred, Effect } from 'effect';

export interface Together {
  readonly asked: 'together';
}

export const AskedTogether = Context.Reference<Together | undefined>('@on.auto/operations/AskedTogether', {
  defaultValue: () => {},
});

export function togetherAsked(): Together {
  return { asked: 'together' };
}

export function askedTogether<A, E, R>(work: Effect.Effect<A, E, R>): Effect.Effect<A, E, R> {
  return Effect.gen(function* () {
    const together = yield* AskedTogether;
    return yield* together === undefined ? Effect.provideService(work, AskedTogether, togetherAsked()) : work;
  });
}

export interface ReadOnceTogether<A, E> {
  readonly read: <R>(key: string, read: Effect.Effect<A, E, R>) => Effect.Effect<A, E, R>;
}

export function readOnceTogether<A, E = never>(): ReadOnceTogether<A, E> {
  const held = new WeakMap<Together, Map<string, Deferred.Deferred<A, E>>>();
  const readsOf = (together: Together) => {
    const reads = held.get(together) ?? new Map<string, Deferred.Deferred<A, E>>();
    held.set(together, reads);
    return reads;
  };
  return {
    read: (key, read) =>
      Effect.gen(function* () {
        const together = yield* AskedTogether;
        if (together === undefined) return yield* read;
        const reads = readsOf(together);
        const reading = reads.get(key);
        if (reading !== undefined) return yield* Deferred.await(reading);
        const answer = Deferred.makeUnsafe<A, E>();
        reads.set(key, answer);
        yield* Deferred.into(read, answer);
        return yield* Deferred.await(answer);
      }),
  };
}
