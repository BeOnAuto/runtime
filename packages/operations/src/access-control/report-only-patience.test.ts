import { Effect, Fiber, Layer, Logger } from 'effect';
import { TestClock } from 'effect/testing';
import { describe, expect, it } from 'vitest';

import { makeDispatcher, type PolicyDecisionPoint } from '../index.ts';
import { capturedLogs } from '../testing/captured-logs.ts';
import { deniedByTheTest } from '../testing/decision-points.ts';
import { harness } from '../testing/harness.ts';
import { memoryLedger, memoryPlaybookRegistry, recordingReporter } from '../testing/index.ts';
import { getNote } from '../testing/notes.ts';
import { ada, answering, fieldsOf, onAlpha } from '../testing/report-only-calls.ts';

const silent: PolicyDecisionPoint = { decide: () => Effect.never };

const noteAnvilMissing = { status: 'rejected', reason: 'not_found', detail: 'There is no note anvil' };

const throwingLogger = Logger.make(() => {
  throw new Error('the log is full');
});

describe('a decision point that never answers', () => {
  it('is given a second, after which its silence is a deny, and the call answers as it would without it', async () => {
    const logs = capturedLogs();
    const services = Layer.mergeAll(
      memoryLedger().layer,
      memoryPlaybookRegistry([{ org: 'acme', playbook: 'alpha' }]),
      recordingReporter().layer,
      TestClock.layer(),
      logs.layer,
    );
    const watched = Effect.gen(function* () {
      const call = yield* Effect.forkChild(
        makeDispatcher([], { reportOnly: silent }).dispatchToPlaybook(
          getNote.registration,
          onAlpha(ada, { name: 'anvil' }),
        ),
      );
      yield* TestClock.adjust('1 second');
      return yield* Fiber.join(call);
    });

    const outcome = await Effect.runPromise(watched.pipe(Effect.provide(services)));

    expect(outcome).toEqual(noteAnvilMissing);
    expect(fieldsOf(logs.logged(), 'decision', 'errors')).toEqual([['deny', 1]]);
  });

  it('leaves a call that is cancelled while it waits cancelled', async () => {
    const { dispatcher, settleWithin } = harness({ reportOnly: silent });

    expect(
      await settleWithin(50, dispatcher.dispatchToPlaybook(getNote.registration, onAlpha(ada, { name: 'anvil' }))),
    ).toEqual({ status: 'cancelled' });
  });
});

describe('a logger that throws while a difference is reported', () => {
  it('changes no outcome', async () => {
    const { dispatcher, run } = harness({ reportOnly: answering(deniedByTheTest) });

    const outcome = await run(
      dispatcher
        .dispatchToPlaybook(getNote.registration, onAlpha(ada, { name: 'anvil' }))
        .pipe(Effect.provide(Logger.layer([throwingLogger]))),
    );

    expect(outcome).toEqual(noteAnvilMissing);
  });
});
