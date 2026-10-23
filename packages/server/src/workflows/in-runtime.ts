import type { AppRuntime } from '@on.auto/api';
import { Effect, Exit, Option } from 'effect';

export function inRuntime<A, E, Services>(
  runtime: AppRuntime<Services>,
  work: Effect.Effect<A, E, Services>,
): Effect.Effect<A, E> {
  return Effect.gen(function* () {
    const parent = yield* Effect.option(Effect.currentParentSpan);
    const traced = Option.isSome(parent) ? Effect.withParentSpan(work, parent.value) : work;
    const ran = yield* Effect.promise((signal) => runtime.run(Effect.exit(traced), signal));
    if (!Exit.isExit(ran)) {
      return yield* Effect.die(new Error('The server stopped before the work could be done'));
    }
    return yield* ran;
  });
}
