import { Effect, Fiber, Layer } from 'effect';
import { TestClock } from 'effect/testing';
import { describe, expect, it } from 'vitest';

import { makeDispatcher, type AccessRequest, type PolicyDecisionPoint } from '../index.ts';
import { memoryLedger, memoryPlaybookRegistry, recordingReporter } from '../testing/index.ts';
import { getNote } from '../testing/notes.ts';
import { ada, onAlpha } from '../testing/report-only-calls.ts';
import { batchAskedInTime, DecisionPointPatience } from './asked-in-time.ts';

const silent: PolicyDecisionPoint = { decide: () => Effect.never, decideBatch: () => Effect.never };

const services = Layer.mergeAll(
  memoryLedger().layer,
  memoryPlaybookRegistry([{ org: 'acme', playbook: 'alpha' }]),
  recordingReporter().layer,
  TestClock.layer(),
);

describe('the patience a call has with a decision point that never answers', () => {
  it('is the one the shell gives: the call is still waiting a second in, and is refused as unavailable at it', async () => {
    const answered = { yet: false };
    const watched = Effect.gen(function* () {
      const call = yield* Effect.forkChild(
        makeDispatcher([], { decidedBy: silent })
          .dispatchToPlaybook(getNote.registration, onAlpha(ada, { name: 'anvil' }))
          .pipe(
            Effect.tap(() =>
              Effect.sync(() => {
                answered.yet = true;
              }),
            ),
          ),
      );
      yield* TestClock.adjust('1 second');
      const aSecondIn = answered.yet;
      yield* TestClock.adjust('4 seconds');
      return { aSecondIn, atThePatience: yield* Fiber.join(call) };
    });

    expect(
      await Effect.runPromise(
        watched.pipe(Effect.provideService(DecisionPointPatience, 5000), Effect.provide(services)),
      ),
    ).toMatchObject({ aSecondIn: false, atThePatience: { status: 'rejected', reason: 'unavailable' } });
  });
});

const request: AccessRequest = {
  principal: { type: 'person', id: 'ada' },
  action: { scope: 'playbook', name: 'get_note' },
  resource: { type: 'playbook', id: 'alpha', org: 'acme' },
  context: {
    via: 'agent',
    granted: { org: 'acme', permissions: [], playbooks: '*' },
    operation: {
      kind: 'query',
      targetsPlaybook: true,
      readsOnly: true,
      reachesOutside: false,
      mayChangeOutside: false,
      irreversible: false,
      permissionsManagement: false,
      enrolment: false,
      connectionsManagement: false,
    },
  },
};

function batchWatchedFor(patience: number) {
  return Effect.gen(function* () {
    const batch = yield* Effect.forkChild(batchAskedInTime(silent, [request, request]));
    yield* TestClock.adjust(patience - 1);
    const justBefore = batch.pollUnsafe() !== undefined;
    yield* TestClock.adjust(1);
    return { justBefore, atThePatience: yield* Fiber.join(batch) };
  });
}

describe('the patience a batch of calls has with a decision point that never answers', () => {
  it.each([20, 250])('is the %i ms the shell gives: each call is denied at it and not before', async (patience) => {
    const watched = await Effect.runPromise(
      batchWatchedFor(patience).pipe(
        Effect.provideService(DecisionPointPatience, patience),
        Effect.provide(TestClock.layer()),
      ),
    );

    expect(watched.justBefore).toBe(false);
    expect(watched.atThePatience.map(({ decision }) => decision)).toEqual(['deny', 'deny']);
  });

  it('is a second when the shell gives none', async () => {
    const watched = await Effect.runPromise(batchWatchedFor(1000).pipe(Effect.provide(TestClock.layer())));

    expect(watched.justBefore).toBe(false);
    expect(watched.atThePatience.map(({ decision }) => decision)).toEqual(['deny', 'deny']);
  });
});
