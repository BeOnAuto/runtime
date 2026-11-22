import { Effect, Logger, type Context } from 'effect';
import { TestClock } from 'effect/testing';

/** Enough turns of the fibers for what a message or a round starts to run to its end. */
export const settled = Effect.repeat(Effect.yieldNow, { times: 20 });

/** A test of the sockets on a clock it steps, each line logged handed to `logged` as JSON. */
export function inTestTime(
  test: (context: Context.Context<never>) => Effect.Effect<void>,
  logged: (line: string) => void = () => {},
): Promise<void> {
  return Effect.runPromise(
    Effect.flatMap(Effect.context(), test).pipe(
      Effect.provide(TestClock.layer()),
      Effect.provide(Logger.layer([Logger.map(Logger.formatJson, logged)])),
    ),
  );
}
