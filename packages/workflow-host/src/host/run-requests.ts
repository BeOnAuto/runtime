import { statement } from '@on.auto/ledger';
import type { Conflict } from '@on.auto/operations';
import { loadedRunOf, type ReceivedEvent, type RunState, type Started } from '@on.auto/workflow-engine';
import { Data, Effect, Schema } from 'effect';

import { rowsOf, type HostDatabase } from '../database/host-database.ts';
import { ledgerRunLogStore } from '../runs/ledger-run-store.ts';
import { runKeyOf, type RunAddress } from '../runs/run-address.ts';
import { backOffLifted } from '../settlement/settle-attempts.ts';
import { cancelledIfAsked } from '../waiting/pending-cancels.ts';
import type { HostParts } from './host-parts.ts';

export type RunStart = Omit<Started, 'kind' | 'runId' | 'at'>;

export type StartAnswer = 'started' | 'going' | 'settled';

export type DeliveryAnswer = 'delivered' | 'not_started' | 'ended';

export class HostElsewhere extends Data.TaggedError('host_elsewhere')<{ readonly detail: string }> {}

export interface RunRequests {
  readonly start: (run: RunAddress, start: RunStart) => Effect.Effect<StartAnswer, Conflict | HostElsewhere>;
  readonly deliver: (run: RunAddress, event: ReceivedEvent) => Effect.Effect<DeliveryAnswer, Conflict | HostElsewhere>;
  readonly stateOf: (runKey: string) => Effect.Effect<RunState>;
}

type ServingEngine = Pick<HostParts, 'engine' | 'submitted'>;

export interface RequestParts {
  readonly database: HostDatabase;
  readonly clock: { readonly now: () => number };
  readonly serving: () => ServingEngine | undefined;
}

const elsewhere = new HostElsewhere({
  detail:
    'The workflows of this database run in another server; this server serves everything else, and takes the workflows over if that server stops',
});

const SettlementRow = Schema.Struct({ settlement: Schema.NullOr(Schema.String) });

function settledOf(database: HostDatabase, runKey: string): Effect.Effect<boolean> {
  return Effect.orDie(
    rowsOf(
      SettlementRow,
      database.read(statement`SELECT settlement FROM workflow_settlements WHERE run_key = ${runKey}`),
    ),
  ).pipe(Effect.map((rows) => rows.some(({ settlement }) => settlement !== null)));
}

function servingIn({ serving }: RequestParts): Effect.Effect<ServingEngine, HostElsewhere> {
  return Effect.suspend(() => {
    const engine = serving();
    return engine === undefined ? Effect.fail(elsewhere) : Effect.succeed(engine);
  });
}

function settledAgain(parts: RequestParts, engine: ServingEngine, runKey: string): Effect.Effect<StartAnswer> {
  return Effect.gen(function* () {
    yield* Effect.orDie(backOffLifted(parts.database, runKey));
    yield* engine.engine.wake(runKey);
    if (yield* settledOf(parts.database, runKey)) {
      return 'settled';
    }
    yield* Effect.orDie(backOffLifted(parts.database, runKey));
    return 'going';
  });
}

export function runRequests(parts: RequestParts): RunRequests {
  const { database, clock } = parts;
  const runStore = ledgerRunLogStore(database);
  const stateOf = (runKey: string): Effect.Effect<RunState> =>
    Effect.map(runStore.load(runKey), (stored) => loadedRunOf(stored).state);
  return {
    stateOf,
    start: (run, start) =>
      Effect.gen(function* () {
        const engine = yield* servingIn(parts);
        const runKey = runKeyOf(run);
        if (yield* settledOf(database, runKey)) {
          return 'settled';
        }
        const { status } = yield* stateOf(runKey);
        if (status === 'ended') {
          return yield* settledAgain(parts, engine, runKey);
        }
        if (status !== 'new') {
          return 'going';
        }
        const { outcome } = yield* engine.submitted({ ...start, kind: 'started', runId: runKey, at: clock.now() });
        if (outcome !== 'applied') {
          return 'going';
        }
        yield* cancelledIfAsked({ database, submitted: engine.submitted, now: clock.now }, run);
        return 'started';
      }),
    deliver: (run, event) =>
      Effect.gen(function* () {
        const engine = yield* servingIn(parts);
        const runKey = runKeyOf(run);
        const { outcome } = yield* engine.submitted({
          kind: 'event_received',
          runId: runKey,
          at: clock.now(),
          event,
        });
        if (outcome !== 'stale') {
          return outcome === 'applied' ? 'delivered' : 'not_started';
        }
        return (yield* stateOf(runKey)).status === 'ended' ? 'ended' : 'delivered';
      }),
  };
}
