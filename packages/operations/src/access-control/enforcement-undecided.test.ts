import { Effect, Fiber, Layer } from 'effect';
import { TestClock } from 'effect/testing';
import { describe, expect, it } from 'vitest';

import {
  makeDispatcher,
  undecidedMessage,
  type AccessDecision,
  type AccessRequest,
  type CallerIdentity,
  type PolicyDecisionPoint,
} from '../index.ts';
import { capturedLogs } from '../testing/captured-logs.ts';
import { deniedByTheTest } from '../testing/decision-points.ts';
import { harness } from '../testing/harness.ts';
import { memoryLedger, memoryPlaybookRegistry, recordingReporter } from '../testing/index.ts';
import { addNote, getNote } from '../testing/notes.ts';
import { ada, answering, dying, onAlpha, throwing } from '../testing/report-only-calls.ts';

const adaReading: CallerIdentity = { ...ada, permissions: ['org:read', 'playbook:read'] };

const undecided = {
  status: 'rejected',
  reason: 'unavailable',
  detail: 'Whether this call is allowed could not be decided just now; nothing was done',
};

const withAnError: AccessDecision = { decision: 'allow', determiningPolicies: [], errors: ['the engine did not load'] };

function liftedWithAnError({ context: { granted } }: AccessRequest): AccessDecision {
  return granted.permissions.length === 4 ? withAnError : deniedByTheTest;
}

const undecidingPoints: readonly PolicyDecisionPoint[] = [
  answering(withAnError),
  { decide: (request) => Effect.succeed(liftedWithAnError(request)) },
  dying,
  throwing,
];

const loggedUndecided = {
  message: undecidedMessage,
  level: 'WARN',
  annotations: {
    operation: 'add_note',
    org: 'acme',
    playbook: 'alpha',
    caller: 'person:user_ada',
    scope: 'playbook',
    errors: 1,
  },
};

async function answeredBy(decisionPoint: PolicyDecisionPoint, logs: ReturnType<typeof capturedLogs>) {
  const { dispatcher, ledger, run } = harness({ decidedBy: decisionPoint });
  const outcome = await run(
    dispatcher
      .dispatchToPlaybook(addNote.registration, onAlpha(adaReading, { name: 'anvil', text: 'a secret' }))
      .pipe(Effect.provide(logs.layer)),
  );
  return { outcome, streams: ledger.streamNames() };
}

describe('a call the decision point cannot decide', () => {
  it('is refused as unavailable, never as a refusal of the person, records nothing, and is logged with ids alone', async () => {
    const logs = capturedLogs();

    const answers = await Promise.all(undecidingPoints.map((decisionPoint) => answeredBy(decisionPoint, logs)));

    expect(answers).toEqual(undecidingPoints.map(() => ({ outcome: undecided, streams: [] })));
    expect(logs.logged().map(({ message, level, annotations }) => ({ message, level, annotations }))).toEqual(
      undecidingPoints.map(() => loggedUndecided),
    );
    expect(logs.text()).not.toContain('a secret');
  });

  it('is refused as unavailable when the decision point does not answer within a second', async () => {
    const silent: PolicyDecisionPoint = { decide: () => Effect.never };
    const services = Layer.mergeAll(
      memoryLedger().layer,
      memoryPlaybookRegistry([{ org: 'acme', playbook: 'alpha' }]),
      recordingReporter().layer,
      TestClock.layer(),
    );
    const watched = Effect.gen(function* () {
      const call = yield* Effect.forkChild(
        makeDispatcher([], { decidedBy: silent }).dispatchToPlaybook(
          getNote.registration,
          onAlpha(ada, { name: 'anvil' }),
        ),
      );
      yield* TestClock.adjust('1 second');
      return yield* Fiber.join(call);
    });

    expect(await Effect.runPromise(watched.pipe(Effect.provide(services)))).toEqual(undecided);
  });
});
