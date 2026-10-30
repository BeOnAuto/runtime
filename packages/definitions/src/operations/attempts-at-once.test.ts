import type { IncidentReporter } from '@on.auto/operations';
import { Deferred, Effect, Fiber, type Scope } from 'effect';
import { TestClock } from 'effect/testing';
import { describe, expect, it } from 'vitest';

import { LiveAttempts, liveAttemptsOf, type RunRefusal } from '../attempts/live-attempts.ts';
import { linksIn } from '../journal-testing/run-links.ts';
import type { RunDetail } from '../runs/run.ts';
import { quietMs } from '../testing/capabilities/resumer.ts';
import { momentAfter, startedAndLeft } from '../testing/resumed-runs.ts';

function bothArrived() {
  const arrived = { count: 0 };
  const together = Deferred.makeUnsafe<true>();
  return Effect.suspend(() => {
    arrived.count += 1;
    return arrived.count === 2 ? Deferred.succeed(together, true) : Deferred.await(together);
  });
}

describe('two attempts of a run that resumes, made at once by callers that each think the attempt before died', () => {
  it('never run at once: the one whose call is recorded second records nothing and says the run is still running', async () => {
    const definitions = await startedAndLeft({ beforeItsCall: bothArrived(), afterItsCall: Effect.sleep('1 second') });

    const { first, both } = await definitions.run(
      Effect.gen(function* () {
        const one = yield* Effect.forkChild(definitions.asking(true));
        const other = yield* Effect.forkChild(definitions.asking(true));
        const ended = yield* Effect.raceFirst(Fiber.join(one), Fiber.join(other));
        yield* TestClock.adjust('1 second');
        return { first: ended, both: [yield* Fiber.join(one), yield* Fiber.join(other)] };
      }),
      momentAfter(1000),
    );

    expect(first).toMatchObject({ status: 'rejected', reason: 'conflict', kind: 'taken' });
    expect(both.map(({ status }) => status).toSorted((one, other) => one.localeCompare(other))).toEqual([
      'rejected',
      'succeeded',
    ]);
    expect((await linksIn(definitions)).map(({ type }) => type)).toEqual([
      'run_started',
      'model_call_started',
      'model_call_started',
      'run_succeeded',
    ]);
  });
});

describe('two attempts of a run that resumes, made at once by callers that each think the attempt before died, each starting a tool call', () => {
  it('never both start it: the one whose start is recorded second records nothing and says the run is still running', async () => {
    const definitions = await startedAndLeft({
      beforeItsCall: bothArrived(),
      afterItsCall: Effect.sleep('1 second'),
      startsAToolCall: true,
    });

    const both = await definitions.run(
      Effect.gen(function* () {
        const one = yield* Effect.forkChild(definitions.asking(true));
        const other = yield* Effect.forkChild(definitions.asking(true));
        yield* Effect.raceFirst(Fiber.join(one), Fiber.join(other));
        yield* TestClock.adjust('1 second');
        return [yield* Fiber.join(one), yield* Fiber.join(other)];
      }),
      momentAfter(1000),
    );

    expect(both.map(({ status }) => status).toSorted((one, other) => one.localeCompare(other))).toEqual([
      'rejected',
      'succeeded',
    ]);
    expect((await linksIn(definitions)).map(({ type }) => type)).toEqual([
      'run_started',
      'model_call_started',
      'tool_call_started',
      'run_succeeded',
    ]);
  });
});

function noticingTheSecond(
  arrival: Effect.Effect<boolean>,
): Effect.Effect<LiveAttempts['Service'], never, Scope.Scope | IncidentReporter> {
  const seen = { count: 0 };
  return Effect.map(liveAttemptsOf<RunDetail, RunRefusal>(), (live) => ({
    attempt: live.attempt,
    interrupt: live.interrupt,
    close: live.close,
    outliving: (key, run) =>
      Effect.suspend(() => {
        seen.count += 1;
        return seen.count === 2 ? Effect.andThen(arrival, live.outliving(key, run)) : live.outliving(key, run);
      }),
  }));
}

describe('a request for a run whose attempt is live in this process', () => {
  it('waits for that attempt and answers what it answers, so a retry is answered once', async () => {
    const called = Deferred.makeUnsafe<true>();
    const arrived = Deferred.makeUnsafe<true>();
    const definitions = await startedAndLeft({
      afterItsCall: Effect.andThen(Deferred.succeed(called, true), Effect.sleep('1 second')),
    });

    const answers = await definitions.run(
      Effect.gen(function* () {
        const first = yield* Effect.forkChild(definitions.asking());
        yield* Deferred.await(called);
        const retry = yield* Effect.forkChild(definitions.asking());
        yield* Deferred.await(arrived);
        yield* TestClock.adjust('1 second');
        return [yield* Fiber.join(first), yield* Fiber.join(retry)];
      }).pipe(
        Effect.provideServiceEffect(LiveAttempts, noticingTheSecond(Deferred.succeed(arrived, true))),
        Effect.scoped,
      ),
      momentAfter(quietMs + 1),
    );

    expect(answers.map(({ status }) => status)).toEqual(['succeeded', 'succeeded']);
    expect(answers[1]).toEqual(answers[0]);
    expect(definitions.resuming.contexts()).toHaveLength(1);
  });
});
