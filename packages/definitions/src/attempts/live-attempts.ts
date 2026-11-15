import {
  IncidentReporter,
  playbookCallerOf,
  randomUUIDv7,
  streamPrefixOfPlaybook,
  type Conflict,
  type InvalidInput,
  type Lineage,
  type NotFound,
  PlaybookContext,
  type PlaybookAddress,
  type RunCancelled,
  type RunUnanswered,
  type StreamWriter,
  type Unavailable,
} from '@on.auto/operations';
import { Cause, Context, DateTime, Deferred, Effect, Exit, Fiber, Layer, Option, Scope } from 'effect';

import type { RunCommand } from '../runs/run-commands.ts';
import { runDecider, runStreamNameOf } from '../runs/run-decider.ts';
import { isOutlivingItsCall, isTaken } from '../runs/run-decisions.ts';
import type { RunStreamAddress } from '../runs/run-settler.ts';
import type { RunDetail } from '../runs/run.ts';

export interface Attempts<A, E> {
  readonly attempt: <R>(key: string, run: Effect.Effect<A, E, R>) => Effect.Effect<A, E, R>;
  readonly outliving: <R>(key: string, run: Effect.Effect<A, E, R>) => Effect.Effect<A, E, R>;
  readonly interrupt: (key: string) => Effect.Effect<void>;
  readonly close: Effect.Effect<void>;
  readonly acquired: (key: string, fencingToken: number) => Effect.Effect<void>;
}

interface Going {
  readonly ended: Effect.Effect<true>;
  readonly stop: Effect.Effect<void>;
}

interface Registry {
  readonly going: (key: string) => Going | undefined;
  readonly hold: (key: string, going: Going) => void;
  readonly drop: (key: string) => void;
  readonly stopping: () => boolean;
  readonly fork: <A, E, R>(run: Effect.Effect<A, E, R>) => Effect.Effect<Fiber.Fiber<A, E>, never, R>;
  readonly report: IncidentReporter['Service']['report'];
}

export function attemptKeyOf({ org, playbook }: PlaybookAddress, id: string): string {
  return `${org}/${playbook}/${id}`;
}

function inItsCall<A, E, R>(registry: Registry, key: string, run: Effect.Effect<A, E, R>): Effect.Effect<A, E, R> {
  return Effect.uninterruptibleMask((restore) => {
    const going = registry.going(key);
    if (going !== undefined) {
      return restore(Effect.andThen(going.ended, inItsCall(registry, key, run)));
    }
    const ended = Deferred.makeUnsafe<true>();
    registry.hold(key, { ended: Deferred.await(ended), stop: Effect.void });
    const ending = Effect.suspend(() => {
      registry.drop(key);
      return Deferred.succeed(ended, true);
    });
    return Effect.ensuring(restore(run), ending);
  });
}

function outlivingIts<A, E, R>(registry: Registry, key: string, run: Effect.Effect<A, E, R>): Effect.Effect<A, E, R> {
  return Effect.uninterruptibleMask((restore) => {
    const going = registry.going(key);
    if (going !== undefined) {
      return restore(Effect.andThen(going.ended, outlivingIts(registry, key, run)));
    }
    if (registry.stopping()) {
      return Effect.interrupt;
    }
    const ended = Deferred.makeUnsafe<true>();
    const forked = Deferred.makeUnsafe<Fiber.Fiber<A, E>>();
    registry.hold(key, { ended: Deferred.await(ended), stop: Effect.flatMap(Deferred.await(forked), Fiber.interrupt) });
    return Effect.gen(function* () {
      const fiber = yield* registry.fork(Effect.interruptible(run));
      fiber.addObserver(() => {
        registry.drop(key);
        Deferred.doneUnsafe(ended, Exit.succeed(true));
      });
      yield* Deferred.succeed(forked, fiber);
      const reportedIfItDies = Fiber.join(fiber).pipe(
        Effect.catchCauseIf(Cause.hasDies, (cause) =>
          registry.report({ id: randomUUIDv7(), original: Cause.squash(cause) }),
        ),
        Effect.ignore,
      );
      return yield* restore(Fiber.join(fiber)).pipe(
        Effect.onInterrupt(() => Effect.asVoid(registry.fork(reportedIfItDies))),
      );
    });
  });
}

export function liveAttemptsOf<A, E>(): Effect.Effect<Attempts<A, E>, never, Scope.Scope | IncidentReporter> {
  return Effect.gen(function* () {
    const own = yield* Scope.fork(yield* Effect.scope);
    const { report } = yield* IncidentReporter;
    const live = new Map<string, Going>();
    const process = { stopping: false };
    const registry: Registry = {
      going: (key) => live.get(key),
      hold: (key, going) => {
        live.set(key, going);
      },
      drop: (key) => {
        live.delete(key);
      },
      stopping: () => process.stopping,
      fork: (run) => Effect.forkIn(run, own),
      report,
    };
    return {
      attempt: (key, run) => inItsCall(registry, key, run),
      outliving: (key, run) => outlivingIts(registry, key, run),
      interrupt: (key) => Effect.suspend(() => live.get(key)?.stop ?? Effect.void),
      close: Effect.suspend(() => {
        process.stopping = true;
        return Scope.close(own, Exit.void);
      }),
      acquired: () => Effect.void,
    };
  });
}

export type RunRefusal = NotFound | InvalidInput | Unavailable | Conflict | RunCancelled | RunUnanswered;

export class LiveAttempts extends Context.Service<LiveAttempts, Attempts<RunDetail, RunRefusal>>()(
  '@on.auto/definitions/LiveAttempts',
) {}

export const liveAttemptsLayer: Layer.Layer<LiveAttempts, never, IncidentReporter> = Layer.effect(
  LiveAttempts,
  liveAttemptsOf(),
);

export const acquiredHere = Effect.fnUntraced(function* (id: string, fencingToken: number) {
  const live = yield* Effect.serviceOption(LiveAttempts);
  if (Option.isSome(live)) {
    yield* live.value.acquired(attemptKeyOf(yield* PlaybookContext, id), fencingToken);
  }
});

export const liveAttemptsClosed: Effect.Effect<void> = Effect.flatMap(
  Effect.serviceOption(LiveAttempts),
  Option.match({ onNone: () => Effect.void, onSome: ({ close }) => close }),
);

interface AttemptThatDied {
  readonly run: RunStreamAddress;
  readonly lineage: Lineage;
  readonly fencingToken: number;
}

type DeadAttemptReceipt = 'ended' | 'not_running' | 'outlives_its_call';

type EndDeadAttempt = (attempt: AttemptThatDied) => Effect.Effect<DeadAttemptReceipt>;

export function deadAttemptEnder(ledger: StreamWriter): EndDeadAttempt {
  return ({ run, lineage, fencingToken }) =>
    Effect.gen(function* () {
      const stream = `${streamPrefixOfPlaybook(run)}${runStreamNameOf(run.id)}`;
      const at = DateTime.formatIso(yield* DateTime.now);
      const command: RunCommand = {
        type: 'attempt_died',
        fencingToken,
        runId: run.id,
        by: playbookCallerOf(run).id,
        at,
      };
      return yield* ledger.execute(stream, runDecider, command, lineage).pipe(
        Effect.as<DeadAttemptReceipt>('ended'),
        Effect.catchIf(isOutlivingItsCall, () => Effect.succeed<DeadAttemptReceipt>('outlives_its_call')),
        Effect.catchIf(isTaken, () => Effect.succeed<DeadAttemptReceipt>('not_running')),
        Effect.orDie,
      );
    });
}
