import { LiveAttempts, liveAttemptsLayer } from '@on.auto/definitions';
import { LedgerConnection } from '@on.auto/ledger';
import { IncidentReporter, randomUUIDv7 } from '@on.auto/operations';
import { attemptLeasesOver, type AttemptLeases, type DatabaseFailed } from '@on.auto/workflow-host';
import { Cause, Effect, Layer } from 'effect';

import type { AttemptHolding, ProcessStopping } from './attempt-holding.ts';

type Attempts = LiveAttempts['Service'];

type Reported = (leasing: Effect.Effect<void, DatabaseFailed>) => Effect.Effect<void>;

type AttemptEnd = 'run_ended' | 'run_left_started' | 'cut_short';

function endOfAttemptIn(cause: Cause.Cause<unknown>): AttemptEnd {
  return Cause.hasFails(cause) ? 'run_left_started' : 'cut_short';
}

function closedOnceItsStopBegan(close: Attempts['close'], stopping: ProcessStopping): Attempts['close'] {
  return Effect.andThen(
    Effect.sync(() => {
      stopping.began();
    }),
    close,
  );
}

export function leasedOver(
  attempts: Attempts,
  leases: AttemptLeases,
  reported: Reported,
  stopping: ProcessStopping,
): Attempts {
  const tokens = new Map<string, number>();
  const letGo = (key: string, end: AttemptEnd) =>
    Effect.suspend(() => {
      const named = tokens.has(key);
      tokens.delete(key);
      const handedOver = end === 'cut_short' || (named && end === 'run_left_started');
      return reported(handedOver ? leases.handedOver(key) : leases.released(key));
    });
  const leased: Attempts['attempt'] = (key, run) =>
    Effect.uninterruptibleMask((restore) =>
      Effect.andThen(
        reported(leases.taken(key)),
        restore(run).pipe(
          Effect.tap(({ status }) => letGo(key, status === 'started' ? 'run_left_started' : 'run_ended')),
          Effect.tapCause((cause: Cause.Cause<unknown>) => letGo(key, endOfAttemptIn(cause))),
        ),
      ),
    );
  return LiveAttempts.of({
    ...attempts,
    attempt: (key, run) => attempts.attempt(key, leased(key, run)),
    outliving: (key, run) => attempts.outliving(key, leased(key, run)),
    acquired: (key, fencingToken) =>
      Effect.andThen(
        Effect.sync(() => {
          tokens.set(key, fencingToken);
        }),
        reported(leases.named(key, fencingToken)),
      ),
    close: closedOnceItsStopBegan(attempts.close, stopping),
  });
}

export function reportedBy(report: IncidentReporter['Service']['report']): Reported {
  return (leasing) =>
    Effect.catchCause(leasing, (cause: Cause.Cause<unknown>) =>
      report({ id: randomUUIDv7(), original: Cause.squash(cause) }),
    );
}

export function leasedAttemptsLayer(
  holding: AttemptHolding,
): Layer.Layer<LiveAttempts, never, IncidentReporter | LedgerConnection> {
  return Layer.effect(
    LiveAttempts,
    Effect.gen(function* () {
      const attempts = yield* LiveAttempts;
      const connection = yield* LedgerConnection;
      const { report } = yield* IncidentReporter;
      return leasedOver(attempts, attemptLeasesOver(connection, holding), reportedBy(report), holding.stopping);
    }),
  ).pipe(Layer.provide(liveAttemptsLayer));
}
