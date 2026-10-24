import { toolEnded } from '@on.auto/definitions';
import type { Conflict } from '@on.auto/operations';
import { failureReply, type ToolReply } from '@on.auto/tool-servers/policy';
import { Clock, Deferred, Effect, Ref, Result, Semaphore } from 'effect';

import type { ToolCallAnswer } from '../jobs/jobs.ts';
import type { AdmittedCall } from './asked-calls.ts';
import type { StepFact } from './attempt-facts.ts';
import { runBoundWords, type ToolCallsNext } from './step-decision.ts';
import {
  interruptedOn,
  recordedOn,
  startedOn,
  StepCancelled,
  withinTheBound,
  type CancelledEnding,
  type StepRefusal,
  type StepRun,
} from './step-run.ts';
import type { StepState } from './step-state.ts';

type Fold = <A>(
  step: (state: StepState) => Effect.Effect<readonly [StepState, A], StepRefusal>,
) => Effect.Effect<A, StepRefusal>;

interface Ending {
  readonly fact: StepFact;
  readonly reply: ToolReply;
}

interface Calling {
  readonly number: number;
  readonly server: string;
  readonly began: number;
}

type Sent = Result.Result<ToolCallAnswer, string>;

interface Step {
  readonly fold: Fold;
  readonly serversStopped: Effect.Effect<true>;
  readonly stopServers: Effect.Effect<boolean>;
}

const stoppedWithTheOthers = 'The run stopped its calls once its tool servers failed too often';

function stoppedEnd({ number, server, began }: Calling, now: number, detail: string): Ending {
  const data = { number, because: 'cancelled' as const, detail, duration_ms: now - began, jsonrpc_id: null };
  return { fact: { type: 'tool_call_failed', data }, reply: failureReply(data, server) };
}

function endRecorded(run: StepRun, { fold, stopServers }: Step, { fact, reply }: Ending) {
  return fold((state) => Effect.map(recordedOn(run, state, fact, { reply }), (after) => [after, after] as const)).pipe(
    Effect.flatMap((after) => (after.serversEnded === null ? Effect.void : stopServers)),
  );
}

function answeredWithin(run: StepRun, step: Step, job: Effect.Effect<ToolCallAnswer>, calling: Calling) {
  return Effect.gen(function* () {
    const answered: Effect.Effect<Sent> = Effect.map(job, Result.succeed);
    const stopped: Effect.Effect<Sent> = Effect.as(step.serversStopped, Result.fail(stoppedWithTheOthers));
    const answer = yield* withinTheBound(run, Effect.raceFirst(answered, stopped));
    const now = yield* Clock.currentTimeMillis;
    const ending = Result.match(answer, {
      onFailure: ({ runBoundMs }) => stoppedEnd(calling, now, runBoundWords(runBoundMs)),
      onSuccess: Result.match({
        onFailure: (detail: string) => stoppedEnd(calling, now, detail),
        onSuccess: ({ ended, reply }): Ending => ({ fact: toolEnded(calling.number, ended), reply }),
      }),
    });
    return yield* endRecorded(run, step, ending);
  });
}

function toolCallMade(
  run: StepRun,
  step: Step,
  { callId, tool, input, offer }: AdmittedCall,
  room?: number,
): Effect.Effect<CancelledEnding | null, Conflict> {
  const made = Effect.gen(function* () {
    const data = yield* Effect.promise(() => offer.start({ callId, input }));
    const number = yield* step.fold((state) =>
      Effect.map(startedOn(run, state, data), ({ state: after, number: opened }) => [after, opened] as const),
    );
    const { server } = offer.reference;
    const job = run.perform.toolCall({ callId, tool, server, input, ...(room === undefined ? {} : { room }) });
    const began = yield* Clock.currentTimeMillis;
    return yield* answeredWithin(run, step, job, { number, server, began });
  });
  return made.pipe(
    Effect.as(null),
    Effect.catchTag('step_cancelled', ({ ending }: Pick<StepCancelled, 'ending'>) => Effect.succeed(ending)),
  );
}

export function toolCallsMade(
  run: StepRun,
  state: StepState,
  next: ToolCallsNext,
): Effect.Effect<StepState, StepRefusal> {
  return Effect.gen(function* () {
    const current = yield* Ref.make(yield* interruptedOn(run, state));
    const permit = yield* Semaphore.make(1);
    const fold: Fold = (step) =>
      permit.withPermits(1)(
        Effect.flatMap(Ref.get(current), step).pipe(
          Effect.flatMap(([after, value]) => Effect.as(Ref.set(current, after), value)),
        ),
      );
    const serversEnded = yield* Deferred.make<true>();
    const step: Step = {
      fold,
      serversStopped: Deferred.await(serversEnded),
      stopServers: Deferred.succeed(serversEnded, true),
    };
    const endings = yield* Effect.forEach(next.calls, (call) => toolCallMade(run, step, call, next.room), {
      concurrency: 'unbounded',
    });
    const after = yield* Ref.get(current);
    const cancelled = endings.find((ending): ending is CancelledEnding => ending !== null);
    return cancelled === undefined ? after : yield* Effect.fail(new StepCancelled({ state: after, ending: cancelled }));
  });
}
