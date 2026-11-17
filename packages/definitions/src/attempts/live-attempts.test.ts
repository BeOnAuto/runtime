import { Conflict, type Incident, IncidentReporter } from '@on.auto/operations';
import { Deferred, Effect, Exit, Fiber, Scope } from 'effect';
import { describe, expect, it } from 'vitest';

import { modelCallAnswered, modelCallSent } from '../journal-testing/model-calls.ts';
import type { RecordedRunEvent } from '../runs/run-events.ts';
import { recordedAdmin } from '../testing/callers.ts';
import { quietMs } from '../testing/capabilities/resumer.ts';
import { acted, momentAfter, startedAndLeft } from '../testing/resumed-runs.ts';
import { recordedOnTheRun, recordedWith, testRunId } from '../testing/run-facts.ts';
import { deadAttemptEnder, holdingAttemptIn } from './index.ts';
import { attemptKeyOf, LiveAttempts, liveAttemptsClosed, liveAttemptsLayer, liveAttemptsOf } from './live-attempts.ts';
import { recordedAttempt } from './recorded-attempt.ts';

const refused = new Conflict({ detail: 'The run is refused' });

const key = attemptKeyOf({ org: 'acme', playbook: 'alpha' }, 'run');

function reported() {
  const incidents: Incident[] = [];
  const reporter = IncidentReporter.of({ report: (incident) => Effect.sync(() => incidents.push(incident)) });
  return { incidents, reporting: Effect.provideService(IncidentReporter, reporter) };
}

const { reporting } = reported();

const run = { org: 'acme', playbook: 'alpha', id: acted.runId };

const context = {
  runId: testRunId,
  by: 'acme-admin',
  at: '2026-10-01T09:00:00.000Z',
  definitionType: 'tool-user',
  definitionName: 'caller',
  definitionVersion: 1,
};

const started = recordedWith(context)({ type: 'run_started', data: { started_by: recordedAdmin, input: {} } });

const startedAgain = recordedWith({ ...context, at: '2026-10-01T09:05:00.000Z' })({
  type: 'run_started',
  data: { started_by: recordedAdmin, input: {} },
});

const failed = recordedWith(context)({ type: 'run_failed', data: {} });

const answered = recordedOnTheRun({ type: 'model_call_answered', data: { number: 1, ...modelCallAnswered(0) } });

const firstCall = recordedOnTheRun({ type: 'model_call_started', data: { number: 1, ...modelCallSent() } });

const secondCall = recordedOnTheRun(
  { type: 'model_call_started', data: { number: 2, ...modelCallSent() } },
  '2026-10-01T09:05:01.000Z',
);

function foldedOf(events: readonly RecordedRunEvent[]) {
  return events.reduce((attempt, event) => recordedAttempt.evolve(attempt, event), recordedAttempt.initialState);
}

describe('the attempts live in a process', () => {
  it('make an attempt asked for while one under its key is live only once that one has ended, failure and all', async () => {
    const held = Deferred.makeUnsafe<true>();
    const made: string[] = [];

    const { whileLive, answers } = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const live = yield* liveAttemptsOf<string, Conflict>();
          const attempt = (name: string) =>
            live.attempt(
              key,
              Effect.andThen(
                Effect.sync(() => made.push(name)),
                Effect.andThen(Deferred.await(held), Effect.fail(refused)),
              ),
            );
          const first = yield* Effect.forkChild(Effect.exit(attempt('first')));
          const second = yield* Effect.forkChild(Effect.exit(attempt('second')));
          yield* Effect.yieldNow;
          const madeWhileLive = [...made];
          yield* Deferred.succeed(held, true);
          return { whileLive: madeWhileLive, answers: [yield* Fiber.join(first), yield* Fiber.join(second)] };
        }),
      ).pipe(reporting),
    );

    expect(whileLive).toEqual(['first']);
    expect(answers).toEqual([Exit.fail(refused), Exit.fail(refused)]);
    expect(made).toEqual(['first', 'second']);
  });
});

describe('the attempts live in a process, one of which was interrupted', () => {
  it('make the attempt themselves once the live one was interrupted, and anew once it ended', async () => {
    const held = Deferred.makeUnsafe<true>();

    const answers = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const live = yield* liveAttemptsOf<string, never>();
          const first = yield* Effect.forkChild(
            live.attempt(key, Effect.andThen(Deferred.await(held), Effect.succeed('first'))),
          );
          yield* Effect.yieldNow;
          const second = yield* Effect.forkChild(live.attempt(key, Effect.succeed('second')));
          yield* Effect.yieldNow;
          yield* Fiber.interrupt(first);
          const later = yield* live.attempt(key, Effect.succeed('later'));
          return [yield* Fiber.join(second), later];
        }),
      ).pipe(reporting),
    );

    expect(answers).toEqual(['second', 'later']);
  });
});

describe('an attempt that outlives its caller', () => {
  it('goes on to its end when its caller is interrupted, so a later caller waits for it and then makes its own', async () => {
    const held = Deferred.makeUnsafe<true>();
    const made: string[] = [];

    const later = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const live = yield* liveAttemptsOf<string, never>();
          const outliving = (name: string) =>
            live.outliving(
              key,
              Effect.andThen(
                Deferred.await(held),
                Effect.sync(() => made.push(name)),
              ).pipe(Effect.as(name)),
            );
          const caller = yield* Effect.forkChild(outliving('first'));
          yield* Effect.yieldNow;
          yield* Fiber.interrupt(caller);
          const next = yield* Effect.forkChild(outliving('second'));
          yield* Effect.yieldNow;
          yield* Deferred.succeed(held, true);
          return yield* Fiber.join(next);
        }),
      ).pipe(reporting),
    );

    expect([later, made]).toEqual(['second', ['first', 'second']]);
  });
});

describe('an attempt that outlives its caller and dies', () => {
  it('is reported once as an incident when its caller left, and left to the caller that waits for it otherwise', async () => {
    const { incidents, reporting: reportingHere } = reported();
    const held = Deferred.makeUnsafe<true>();
    const broken = new Error('A step broke');

    const waited = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const live = yield* liveAttemptsOf<string, never>();
          const caller = yield* Effect.forkChild(
            live.outliving(key, Effect.andThen(Deferred.await(held), Effect.die(broken))),
          );
          yield* Effect.yieldNow;
          yield* Fiber.interrupt(caller);
          yield* Deferred.succeed(held, true);
          const after = yield* Effect.exit(live.outliving(key, Effect.die(broken)));
          yield* Effect.yieldNow;
          return after;
        }),
      ).pipe(reportingHere),
    );

    expect(Exit.hasDies(waited)).toBe(true);
    expect(incidents.map(({ original }) => original)).toEqual([broken]);
  });
});

describe('the attempts of a process that stops, or whose run is cancelled', () => {
  it('stop an attempt that outlives its caller, make none once the process stops, and leave one in its call to its caller', async () => {
    const held = Deferred.makeUnsafe<true>();

    const outcomes = await Effect.runPromise(
      Effect.gen(function* () {
        const scope = yield* Scope.make();
        const live = yield* liveAttemptsOf<string, never>().pipe(Scope.provide(scope));
        const closing = yield* Effect.forkChild(Effect.exit(live.outliving(key, Effect.never)));
        yield* Effect.yieldNow;
        yield* live.close;
        const afterTheStop = yield* Effect.exit(live.outliving(key, Effect.succeed('made')));
        const other = yield* Effect.scoped(liveAttemptsOf<string, never>());
        const cancelled = yield* Effect.forkChild(Effect.exit(other.outliving(key, Effect.never)));
        const inItsCall = yield* Effect.forkChild(
          other.attempt('acme/alpha/other', Effect.as(Deferred.await(held), 'answered')),
        );
        yield* Effect.yieldNow;
        yield* other.interrupt(key);
        yield* other.interrupt('acme/alpha/other');
        yield* other.interrupt('acme/alpha/none');
        yield* Deferred.succeed(held, true);
        return [
          Exit.hasInterrupts(yield* Fiber.join(closing)),
          Exit.hasInterrupts(afterTheStop),
          Exit.hasInterrupts(yield* Fiber.join(cancelled)),
          yield* Fiber.join(inItsCall),
        ];
      }).pipe(reporting),
    );

    expect(outcomes).toEqual([true, true, true, 'answered']);
  });
});

describe('the close of the attempts a process holds, as the process stops', () => {
  it('stops every attempt that outlives its caller, and asks nothing of a process that holds none', async () => {
    const stopped = await Effect.runPromise(
      Effect.gen(function* () {
        const outliving = yield* Effect.forkChild(
          Effect.exit(LiveAttempts.use((live) => live.outliving(key, Effect.never))),
        );
        yield* Effect.yieldNow;
        yield* liveAttemptsClosed;
        return Exit.hasInterrupts(yield* Fiber.join(outliving));
      }).pipe(Effect.provide(liveAttemptsLayer), reporting),
    );

    expect(stopped).toBe(true);
    await expect(Effect.runPromise(liveAttemptsClosed)).resolves.toBeUndefined();
  });
});

describe('the attempt that holds a run, as the run reads', () => {
  it('names its token and what its start recorded of whom the run is for and how it goes on', async () => {
    const startedHoldingAttempts = await startedAndLeft();

    expect(
      await Effect.runPromise(
        holdingAttemptIn(startedHoldingAttempts.ledger.service, { ...run, id: run.id.toUpperCase() }),
      ),
    ).toEqual({
      fencingToken: 1,
      type: 'resumer',
      startedBy: 'acme-admin',
      resumes: true,
      calledBy: null,
      trigger: null,
      actsFor: null,
      depth: 0,
      callDepth: 0,
    });
  });

  it('is nothing for a run that ended, one there is not, or an address no playbook holds', async () => {
    const startedHoldingAttempts = await startedAndLeft();
    await startedHoldingAttempts.running(momentAfter(quietMs + 1));
    const holding = (address: Readonly<typeof run>) =>
      Effect.runPromise(holdingAttemptIn(startedHoldingAttempts.ledger.service, address));

    expect([
      await holding(run),
      await holding({ ...run, id: '0199a3c4-7d2e-7c1a-9b3f-000000000000' }),
      await holding({ ...run, id: 'not-a-run' }),
    ]).toEqual([undefined, undefined, undefined]);
  });
});

describe('the attempt that holds a run that resumes, named dead by a shell that makes no next attempt of it', () => {
  it('is ended, as the attempt of a run within its call is, while a shell that would resume it is told so', async () => {
    const startedHoldingAttempts = await startedAndLeft();
    const lineage = { causationId: null, correlationId: run.id };
    const ender = deadAttemptEnder(startedHoldingAttempts.ledger.service);

    const resumedElsewhere = await Effect.runPromise(ender({ run, lineage, fencingToken: 1 }));
    const ended = await Effect.runPromise(ender({ run, lineage, fencingToken: 1, noNextAttempt: true }));

    expect([resumedElsewhere, ended]).toEqual(['outlives_its_call', 'ended']);
    expect(await Effect.runPromise(holdingAttemptIn(startedHoldingAttempts.ledger.service, run))).toBeUndefined();
  });
});

describe('the attempt a run goes on from, folded from its stream', () => {
  it('holds the calls since its latest start, after the model calls of the attempts before it', () => {
    expect(foldedOf([started, firstCall, answered, failed, startedAgain, secondCall])).toEqual({
      startedAt: '2026-10-01T09:05:00.000Z',
      modelCallsBefore: 1,
      lastModelCall: 2,
      calls: [secondCall],
    });
  });
});
