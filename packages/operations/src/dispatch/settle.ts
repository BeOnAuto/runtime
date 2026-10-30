import { Cause, Effect } from 'effect';

import { cancelled, type Answered, type Outcome, type Settled, type Succeeded } from '../outcome/outcome.ts';
import { failureOf } from './error-boundary.ts';
import type { IncidentReporter } from './incident-reporter.ts';

function stoppedWhenAborted(signal: AbortSignal): Effect.Effect<Settled<never>> {
  return Effect.callback<Settled<never>>((resume) => {
    const cancel = () => {
      resume(Effect.succeed(cancelled()));
    };
    signal.addEventListener('abort', cancel, { once: true });
    if (signal.aborted) {
      cancel();
    }
    return Effect.sync(() => {
      signal.removeEventListener('abort', cancel);
    });
  });
}

export function settle<R, A extends Succeeded = Answered>(
  call: Effect.Effect<Outcome<A>, never, R>,
  signal?: AbortSignal,
): Effect.Effect<Settled<A>, never, R | IncidentReporter> {
  const settled: Effect.Effect<Settled<A>, never, R | IncidentReporter> = call.pipe(
    Effect.catchCause((cause): Effect.Effect<Settled<never>, never, IncidentReporter> =>
      Cause.hasInterruptsOnly(cause) ? Effect.succeed(cancelled()) : failureOf(cause),
    ),
  );
  return signal === undefined ? settled : settled.pipe(Effect.raceFirst(stoppedWhenAborted(signal)));
}
