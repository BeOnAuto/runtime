import { Effect, Fiber, Layer, Schema } from 'effect';
import { TestClock } from 'effect/testing';
import { describe, expect, it } from 'vitest';

import {
  type AccessDecision,
  type AccessRequest,
  type CallAsked,
  type CallerIdentity,
  defineCommand,
  makeDispatcher,
  type PolicyDecisionPoint,
  type Unavailable,
  busyMessage,
  CallPermission,
  callPermissionDecidedBy,
  mayCall,
  mayCallEach,
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
        connectionsManagement: false,
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
});

function silent(): PolicyDecisionPoint {
  return { decide: () => Effect.never, decideBatch: () => Effect.never };
}

const decisionsInTime: Readonly<Record<'allowed' | 'denied' | 'not decided in time', PolicyDecisionPoint>> = {
  allowed: answering(allowedByTheTest),
  denied: answering(deniedByTheTest),
  'not decided in time': silent(),
};

function dispatchedAgainstTheClock(decisionPoint: PolicyDecisionPoint, logs: ReturnType<typeof capturedLogs>) {
  const services = Layer.mergeAll(
    memoryLedger().layer,
    memoryPlaybookRegistry([{ org: 'acme', playbook: 'alpha' }]),
    recordingReporter().layer,
    TestClock.layer(),
    logs.layer,
  );
  const watched = Effect.gen(function* () {
    const call = yield* Effect.forkChild(
      makeDispatcher([], { decidedBy: decisionPoint }).dispatchToPlaybook(
        getNote.registration,
        onAlpha(ada, { name: 'anvil' }),
      ),
    );
    yield* TestClock.adjust('1 second');
    return yield* Fiber.join(call);
  });
  return Effect.runPromise(watched.pipe(Effect.provide(services)));
}

describe('a call whose decision is asked with a second to answer', () => {
  it.each([
    { decided: 'allowed', outcome: { status: 'rejected', reason: 'not_found' }, logged: [] },
    { decided: 'denied', outcome: { status: 'rejected', reason: 'forbidden', kind: 'permission_denied' }, logged: [] },
    {
      decided: 'not decided in time',
      outcome: { status: 'rejected', reason: 'unavailable', kind: 'busy', retry_after: 1 },
      logged: [busyMessage],
    },
  ] as const)('is $decided: answered as $outcome.reason', async ({ decided, outcome, logged }) => {
    const logs = capturedLogs();

    expect(await dispatchedAgainstTheClock(decisionsInTime[decided], logs)).toMatchObject(outcome);
    expect(logs.logged().map(({ message }) => message)).toEqual(logged);
  });
});

type Answer = 'allow' | 'deny' | 'silent';

function scripted(answers: readonly Answer[]): PolicyDecisionPoint {
  const left = [...answers];
  const answered: Readonly<Record<Answer, Effect.Effect<AccessDecision>>> = {
    allow: Effect.succeed(allowedByTheTest),
    deny: Effect.succeed(deniedByTheTest),
    silent: Effect.never,
  };
  return decidingEach(() => answered[left.shift() ?? 'silent']);
}

function eachAskedOf(decisionPoint: PolicyDecisionPoint, times: number) {
  const decided = callPermissionDecidedBy(decisionPoint);
  const asked = [{ operation: addNote.registration, caller: ada, org: 'acme', playbook: 'alpha' }];
  const once = Effect.gen(function* () {
    const fiber = yield* Effect.forkChild(
      Effect.match(decided(asked), {
        onSuccess: ([may]): unknown => may,
        onFailure: (busy: Pick<Unavailable, 'kind' | 'retry_after'>): unknown => [busy.kind, busy.retry_after],
      }),
    );
    yield* TestClock.adjust('1 second');
    return yield* Fiber.join(fiber);
  });
  return Effect.runPromise(
    Effect.forEach(Array.from({ length: times }), () => once).pipe(Effect.provide(TestClock.layer())),
  );
}

describe('whether a caller may call an operation, where the decision point is given a second to answer', () => {
  it.each([
    { decided: 'allowed', script: ['allow'], answers: [true] },
    { decided: 'denied', script: ['deny'], answers: [false] },
    { decided: 'not decided in time', script: ['silent'], answers: [['busy', 1]] },
  ] as const)('is $decided: never a denial where it is not decided', async ({ script, answers }) => {
    expect(await eachAskedOf(scripted(script), answers.length)).toEqual(answers);
  });

  it('is refused as busy with a wait that doubles on each refusal in a row, up to eight seconds, and starts again at one once it answers', async () => {
    const answers = await eachAskedOf(
      scripted(['silent', 'silent', 'silent', 'silent', 'silent', 'allow', 'silent']),
      7,
    );

    expect(answers).toEqual([['busy', 1], ['busy', 2], ['busy', 4], ['busy', 8], ['busy', 8], true, ['busy', 1]]);
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
  it('is refused as busy, never a denial, where it does not answer within a second, which the whole batch is given', async () => {
    const watched = Effect.gen(function* () {
      const asked = yield* Effect.forkChild(Effect.flip(callPermissionDecidedBy(silent())(askedOfAda)));
      yield* TestClock.adjust('1 second');
      return yield* Fiber.join(asked);
    });

    expect(await Effect.runPromise(watched.pipe(Effect.provide(TestClock.layer())))).toMatchObject({
      _tag: 'unavailable',
      kind: 'busy',
      retry_after: 1,
    });
  });
});

const readingUndecided = decidingEach(({ context: { granted } }) =>
  Effect.succeed(granted.permissions.length === 4 ? allowedByTheTest : withAnError),
);

type Refused = Pick<Unavailable, 'kind' | 'retry_after'>;

function listingAskedOf(decisionPoint: PolicyDecisionPoint, logs: ReturnType<typeof capturedLogs>) {
  const watched = Effect.gen(function* () {
    const asked = yield* Effect.forkChild(
      Effect.match(mayCallEach(askedOfAda), {
        onSuccess: (answers): unknown => answers,
        onFailure: ({ kind, retry_after }: Refused): unknown => ({ kind, retry_after }),
      }),
    );
    yield* TestClock.adjust('1 second');
    return yield* Fiber.join(asked);
  });
  const permission = callPermissionDecidedBy(decisionPoint);
  const provided = Layer.merge(TestClock.layer(), logs.layer);
  return Effect.runPromise(watched.pipe(Effect.provideService(CallPermission, permission), Effect.provide(provided)));
}

describe('what a listing asks a caller may call, where the decision point is given a second to answer', () => {
  it.each([
    ['decided', answering(allowedByTheTest), [true, true], []],
    ['not decided in time', silent(), { kind: 'busy', retry_after: 1 }, []],
    ['decided with an error', answering(withAnError), {}, [2]],
    ['dying', dying, {}, [2]],
    ['answering fewer decisions than asked', answeringShort, {}, [2]],
    ['deciding one with an error and allowing the other', readingUndecided, {}, [1]],
  ] as const)(
    'is answered, where %s: busy if not in time, plainly unavailable if it fails',
    async (_, decisionPoint, answered, undecidedLogged) => {
      const logs = capturedLogs();

      expect(await listingAskedOf(decisionPoint, logs)).toEqual(answered);
      expect(logs.logged().map(({ message, annotations }) => ({ message, annotations }))).toEqual(
        undecidedLogged.map((each) => ({ message: undecidedMessage, annotations: { operations: 2, undecided: each } })),
      );
    },
  );

  it('is no, and logs nothing, for a single question asked to offer or explain, where it fails', async () => {
    const logs = capturedLogs();
    const asked = { operation: addNote.registration, caller: adaReading, org: 'acme', playbook: 'alpha' };

    const permission = callPermissionDecidedBy(readingUndecided);

    const answered = await Effect.runPromise(
      mayCall(asked).pipe(Effect.provideService(CallPermission, permission), Effect.provide(logs.layer)),
    );

    expect({ answered, logged: logs.logged() }).toEqual({ answered: false, logged: [] });
  });
});
