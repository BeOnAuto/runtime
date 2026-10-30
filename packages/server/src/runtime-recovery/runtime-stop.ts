import { Effect, Option } from 'effect';

import type { StartedRuntime } from '../background-start/started-runtimes.ts';

export interface StopBounds {
  readonly stopWithinMs: number;
  readonly killWithinMs: number;
  readonly pingTries: number;
}

function endedWithin(runtime: StartedRuntime, milliseconds: number): Effect.Effect<boolean> {
  return Effect.promise(() => runtime.ended).pipe(Effect.timeoutOption(milliseconds), Effect.map(Option.isSome));
}

function killed(runtime: StartedRuntime, bounds: StopBounds, log: (line: string) => void): Effect.Effect<boolean> {
  const named = `Auto Runtime, process ${String(runtime.pid)}`;
  if (!runtime.signal('SIGKILL')) {
    return Effect.succeed(true);
  }
  log(`${named}, did not end within ${bounds.stopWithinMs / 1000} s of SIGTERM, so this connection sent it SIGKILL`);
  return endedWithin(runtime, bounds.killWithinMs).pipe(
    Effect.tap((ended) =>
      Effect.sync(() => {
        if (!ended) {
          log(`${named}, did not end even after SIGKILL`);
        }
      }),
    ),
  );
}

export function stoppedRuntime(
  runtime: StartedRuntime,
  bounds: StopBounds,
  log: (line: string) => void,
): Effect.Effect<boolean> {
  return Effect.gen(function* () {
    if (!runtime.signal('SIGTERM')) {
      return true;
    }
    log(
      `Auto Runtime, process ${String(runtime.pid)}, did not answer ${bounds.pingTries} pings, so this connection, which started it, sent it SIGTERM`,
    );
    return (yield* endedWithin(runtime, bounds.stopWithinMs)) || (yield* killed(runtime, bounds, log));
  });
}
