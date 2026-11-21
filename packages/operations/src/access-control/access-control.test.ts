import { Effect, Fiber, Layer, Schema } from 'effect';
import { TestClock } from 'effect/testing';
import { describe, expect, it } from 'vitest';

import {
  type AccessDecision,
  type AccessRequest,
  type CallAsked,
  type CallerIdentity,
  callPermissionDecidedBy,
  defineCommand,
  makeDispatcher,
  type PolicyDecisionPoint,
  undecidedMessage,
} from '../index.ts';
import { capturedLogs } from '../testing/captured-logs.ts';
import { allowedByTheTest, decidingEach, deniedByTheTest, recordingDecisionPoint } from '../testing/decision-points.ts';
import { harness, toOrg } from '../testing/harness.ts';
import { memoryLedger, memoryPlaybookRegistry, recordingReporter } from '../testing/index.ts';
import { addNote, getNote } from '../testing/notes.ts';
import { ada, answering, dying, onAlpha, throwing } from '../testing/report-only-calls.ts';

const joinTheNotes = defineCommand('org', {
  name: 'join_the_notes',
  title: 'Join the notes',
  description: 'Makes the caller one of the people who keep the org’s notes.',
  route: { method: 'POST', path: '/notes/keepers' },
  inputSchema: Schema.Record(Schema.String, Schema.Never),
  outputSchema: Schema.Struct({ joined: Schema.Boolean }),
  reasons: [],
  enrolment: true,
  handle: () => Effect.succeed({ joined: true }),
});

describe('an operation of the org that makes its caller a member', () => {
  it('says so in the question the dispatcher asks, beside everything else it declares', async () => {
    const recording = recordingDecisionPoint(() => allowedByTheTest);
    const { dispatcher, run } = harness({ reportOnly: recording.decisionPoint });

    await run(dispatcher.dispatchToOrg(joinTheNotes.registration, toOrg('acme')(ada, {})));

    expect(recording.asked().map(({ context }) => context.operation)).toEqual([
      {
        kind: 'command',
        targetsPlaybook: false,
        readsOnly: false,
        reachesOutside: false,
        mayChangeOutside: false,
        irreversible: false,
        permissionsManagement: false,
        enrolment: true,
      },
    ]);
  });
});

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
  decidingEach((request) => Effect.succeed(liftedWithAnError(request))),
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
    const silent: PolicyDecisionPoint = { decide: () => Effect.never, decideBatch: () => Effect.never };
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

const answeringShort: PolicyDecisionPoint = {
  ...answering(allowedByTheTest),
  decideBatch: (requests) => Effect.succeed(requests.slice(1).map(() => allowedByTheTest)),
};

const askedOfAda: readonly CallAsked[] = [ada, adaReading].map((caller) => ({
  operation: addNote.registration,
  caller,
  org: 'acme',
  playbook: 'alpha',
}));

describe('whether a caller may call operations, where the decision point cannot decide them', () => {
  it('is never so, where it answers with an error, dies, throws, or answers another number of decisions than it was asked', async () => {
    const decisionPoints = [answering(withAnError), dying, throwing, answeringShort];

    const answers = await Effect.runPromise(
      Effect.forEach(decisionPoints, (decisionPoint) => callPermissionDecidedBy(decisionPoint)(askedOfAda)),
    );

    expect(answers).toEqual(decisionPoints.map(() => [false, false]));
  });

  it('is never so, where it does not answer within a second, which the whole batch is given', async () => {
    const silent: PolicyDecisionPoint = { decide: () => Effect.never, decideBatch: () => Effect.never };
    const watched = Effect.gen(function* () {
      const asked = yield* Effect.forkChild(callPermissionDecidedBy(silent)(askedOfAda));
      yield* TestClock.adjust('1 second');
      return yield* Fiber.join(asked);
    });

    expect(await Effect.runPromise(watched.pipe(Effect.provide(TestClock.layer())))).toEqual([false, false]);
  });
});
