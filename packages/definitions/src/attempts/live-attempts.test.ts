import { Conflict, IncidentReporter, type Incident } from '@on.auto/operations';
import { Deferred, Effect, Exit, Fiber, Scope } from 'effect';
import { describe, expect, it } from 'vitest';

import { attemptKeyOf, LiveAttempts, liveAttemptsClosed, liveAttemptsLayer, liveAttemptsOf } from './live-attempts.ts';

const refused = new Conflict({ detail: 'The run is refused' });

const key = attemptKeyOf({ org: 'acme', playbook: 'alpha' }, 'run');

function reported() {
  const incidents: Incident[] = [];
  const reporter = IncidentReporter.of({ report: (incident) => Effect.sync(() => incidents.push(incident)) });
  return { incidents, reporting: Effect.provideService(IncidentReporter, reporter) };
}

const { reporting } = reported();

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
