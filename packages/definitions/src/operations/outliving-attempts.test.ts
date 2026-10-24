import { Deferred, Effect, Fiber } from 'effect';
import { describe, expect, it } from 'vitest';

import { liveAttemptsLayer } from '../attempts/live-attempts.ts';
import { runCanceller } from '../cancellation/run-cancels.ts';
import { endingIn, linksIn } from '../journal-testing/run-links.ts';
import {
  answeredOnceMeanwhile,
  cancelRecordedIn,
  endedIn,
  heldAfterItsCall,
  momentAfter,
  startedAndLeft,
} from '../testing/resumed-runs.ts';
import { testRunId } from '../testing/run-facts.ts';

const run = { org: 'acme', playbook: 'alpha', id: testRunId };

const lineage = { causationId: '5d0e9f6a-1b2c-5d3e-8f4a-6b7c8d9e0f1a', correlationId: testRunId };

describe('an attempt of a run of a capability that resumes, whose caller goes away', () => {
  it('goes on to its end and records it, and a request asked again answers what it recorded', async () => {
    const held = heldAfterItsCall();
    const definitions = await startedAndLeft({ afterItsCall: held.afterItsCall });

    const again = await definitions.run(
      Effect.gen(function* () {
        const caller = yield* Effect.forkChild(definitions.asking(true));
        yield* Deferred.await(held.called);
        yield* Fiber.interrupt(caller);
        const retry = yield* Effect.forkChild(definitions.asking());
        yield* Deferred.succeed(held.released, true);
        return yield* Fiber.join(retry);
      }).pipe(Effect.provide(liveAttemptsLayer)),
      momentAfter(1000),
    );

    expect(again).toMatchObject({ status: 'succeeded' });
    expect((await linksIn(definitions)).map(({ type }) => type)).toEqual([
      'run_started',
      'model_call_started',
      'model_call_started',
      'run_succeeded',
    ]);
    expect(definitions.resuming.contexts()).toHaveLength(1);
  });
});

describe('an attempt of a run of a capability that resumes, whose caller goes away and that then dies', () => {
  it('records the run as failed', async () => {
    const held = heldAfterItsCall();
    const definitions = await startedAndLeft({
      afterItsCall: Effect.andThen(held.afterItsCall, Effect.die(new Error('The capability broke'))),
    });

    await definitions.run(
      Effect.gen(function* () {
        const caller = yield* Effect.forkChild(definitions.asking(true));
        yield* Deferred.await(held.called);
        yield* Fiber.interrupt(caller);
        yield* Deferred.succeed(held.released, true);
        yield* endedIn(definitions);
      }).pipe(Effect.provide(liveAttemptsLayer)),
      momentAfter(1000),
    );

    expect((await linksIn(definitions)).map(({ type }) => type)).toEqual([
      'run_started',
      'model_call_started',
      'model_call_started',
      'run_failed',
    ]);
  });
});

describe('an attempt of a run of a capability that resumes, whose caller cancels it', () => {
  it('is stopped by the cancel, ends its open calls as interrupted, and ends rejected as cancelled with its spending', async () => {
    const held = heldAfterItsCall();
    const definitions = await startedAndLeft({ afterItsCall: held.afterItsCall });

    const ended = await definitions.run(
      Effect.gen(function* () {
        const caller = yield* Effect.forkChild(Effect.exit(definitions.asking(true)));
        yield* Deferred.await(held.called);
        yield* Effect.orDie(
          runCanceller(definitions.ledger.service)(
            run,
            { kind: 'deadline', reason: 'The step ran out of time' },
            lineage,
          ),
        );
        yield* Fiber.join(caller);
        return yield* definitions.asking();
      }).pipe(Effect.provide(liveAttemptsLayer)),
      momentAfter(1000),
    );

    expect(ended).toMatchObject({
      status: 'rejected',
      reason: 'cancelled',
      kind: 'deadline',
    });
    expect((await linksIn(definitions)).map(({ type }) => type)).toEqual([
      'run_started',
      'model_call_started',
      'model_call_started',
      'run_cancel_requested',
      'model_call_failed',
      'model_call_failed',
      'run_rejected',
    ]);
    expect(await endingIn(definitions)).toMatchObject({
      rejection: { reason: 'cancelled', kind: 'deadline' },
      record: { answered: 0 },
    });
  });
});

describe('an attempt of a run of a capability that finishes when cancelled, whose caller cancels it', () => {
  it('is not stopped by the cancel: it goes on to its end and records its answer', async () => {
    const held = heldAfterItsCall();
    const definitions = await startedAndLeft({ afterItsCall: held.afterItsCall, whenCancelled: 'finish' });

    const ended = await definitions.run(
      Effect.gen(function* () {
        const caller = yield* Effect.forkChild(Effect.exit(definitions.asking(true)));
        yield* Deferred.await(held.called);
        const cancelling = yield* Effect.forkChild(
          Effect.orDie(
            runCanceller(definitions.ledger.service)(
              run,
              { kind: 'deadline', reason: 'The step ran out of time' },
              lineage,
            ),
          ),
        );
        yield* cancelRecordedIn(definitions);
        yield* Deferred.succeed(held.released, true);
        yield* Fiber.join(cancelling);
        yield* Fiber.join(caller);
        return yield* definitions.asking();
      }).pipe(Effect.provide(liveAttemptsLayer)),
      momentAfter(1000),
    );

    expect(ended).toMatchObject({ status: 'succeeded' });
    expect((await linksIn(definitions)).map(({ type }) => type)).toEqual([
      'run_started',
      'model_call_started',
      'model_call_started',
      'run_cancel_requested',
      'run_succeeded',
    ]);
  });
});

describe('an attempt of a run of a capability that resumes, cancelled with cancel_run in this process', () => {
  it('is stopped, ends its open calls and then the run cancelled with its spending, and cancel_run answers the run as it then stands', async () => {
    const held = heldAfterItsCall();
    const definitions = await startedAndLeft({ afterItsCall: held.afterItsCall, startsAToolCall: true });

    const { cancelled, asked } = await definitions.run(
      Effect.gen(function* () {
        const caller = yield* Effect.forkChild(Effect.exit(definitions.asking(true)));
        yield* Deferred.await(held.called);
        const answer = yield* definitions.cancelling;
        yield* Fiber.join(caller);
        return { cancelled: answer, asked: yield* definitions.asking() };
      }).pipe(Effect.provide(liveAttemptsLayer)),
      momentAfter(1000),
    );

    expect(cancelled).toMatchObject({
      status: 'succeeded',
      output: { status: 'rejected', rejection: { reason: 'cancelled', kind: 'requested' } },
    });
    expect(asked).toMatchObject({ status: 'rejected', reason: 'cancelled', kind: 'requested' });
    expect((await linksIn(definitions)).map(({ type }) => type)).toEqual([
      'run_started',
      'model_call_started',
      'tool_call_started',
      'run_cancel_requested',
      'model_call_failed',
      'tool_call_failed',
      'run_rejected',
    ]);
    expect(await endingIn(definitions)).toMatchObject({ rejection: { kind: 'requested' }, record: { answered: 0 } });
  });
});

describe('an attempt of a run of a capability that resumes, cancelled while the answer of its model call is recorded', () => {
  it('ends only what is still open, and its ending keeps the spending of the answer recorded meanwhile', async () => {
    const held = heldAfterItsCall();
    const meanwhile = answeredOnceMeanwhile();
    const definitions = await startedAndLeft({
      afterItsCall: held.afterItsCall,
      beforeItsEnds: meanwhile.beforeItsEnds,
    });
    meanwhile.over(definitions);

    await definitions.run(
      Effect.gen(function* () {
        const caller = yield* Effect.forkChild(Effect.exit(definitions.asking(true)));
        yield* Deferred.await(held.called);
        yield* definitions.cancelling;
        yield* Fiber.join(caller);
      }).pipe(Effect.provide(liveAttemptsLayer)),
      momentAfter(1000),
    );

    expect((await linksIn(definitions)).map(({ type }) => type)).toEqual([
      'run_started',
      'model_call_started',
      'model_call_started',
      'run_cancel_requested',
      'model_call_answered',
      'model_call_failed',
      'run_rejected',
    ]);
    expect(await endingIn(definitions)).toMatchObject({ rejection: { kind: 'requested' }, record: { answered: 1 } });
  });
});
