import { Effect, Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import {
  Caller,
  InAConversation,
  PlaybookContext,
  callAdmittedBy,
  callPermissionDecidedBy,
  callPermissionReportedTo,
  defineQuery,
  roleRefusalDetail,
  tokenTypeRefusalDetail,
  mayCall,
  type AccessDecision,
  type AccessRequest,
  type CallAsked,
  type CallerIdentity,
  type OperationDeclaration,
  type PolicyDecisionPoint,
} from '../index.ts';
import { acmeAlphaReader } from '../testing/callers.ts';
import { capturedLogs } from '../testing/captured-logs.ts';
import { allowedByTheTest, deniedByTheTest, recordingDecisionPoint } from '../testing/decision-points.ts';
import { harness } from '../testing/harness.ts';
import { addNote, getNote } from '../testing/notes.ts';
import { labelPlaybook, listPlaybookLabels } from '../testing/playbook-labels.ts';
import { ada, answering, differenceOf, dying, onAlpha, throwing } from '../testing/report-only-calls.ts';

const adaReading: CallerIdentity = { ...ada, permissions: ['org:read', 'playbook:read'] };

const mayAddNotes = defineQuery('playbook', {
  name: 'may_add_notes',
  title: 'May add notes',
  description: 'Answers whether the caller may add a note to the playbook.',
  route: { method: 'GET', path: '/notes/addable' },
  inputSchema: Schema.Record(Schema.String, Schema.Never),
  outputSchema: Schema.Struct({ may: Schema.Boolean }),
  reasons: [],
  handle: Effect.fnUntraced(function* () {
    const { org, playbook } = yield* PlaybookContext;
    return { may: yield* mayCall({ operation: addNote.registration, caller: yield* Caller, org, playbook }) };
  }),
});

function askedOf(caller: CallerIdentity): CallAsked {
  return { operation: addNote.registration, caller, org: 'acme', playbook: 'alpha' };
}

const withAnError: AccessDecision = { decision: 'allow', determiningPolicies: [], errors: ['no roles'] };

const askedOfAcmeAlphaReader: readonly CallAsked[] = [
  { operation: getNote.registration, caller: acmeAlphaReader, org: 'acme', playbook: 'alpha' },
  { operation: getNote.registration, caller: acmeAlphaReader, org: 'acme' },
  { operation: labelPlaybook.registration, caller: acmeAlphaReader, org: 'acme', playbook: 'alpha' },
  { operation: labelPlaybook.registration, caller: acmeAlphaReader, org: 'acme' },
  { operation: listPlaybookLabels.registration, caller: acmeAlphaReader, org: 'acme', playbook: 'alpha' },
];

describe('whether a caller may call an operation, where no decision point decides', () => {
  it('is what the credential grants: any one of the permissions the operation declares', async () => {
    const answers = await Effect.runPromise(
      Effect.forEach([ada, adaReading, acmeAlphaReader], (caller) => mayCall(askedOf(caller))),
    );

    expect(answers).toEqual([true, false, false]);
  });
});

describe('whether a caller may call an operation, where a decision point decides', () => {
  it('is that the decision point allows it, and never so where it denies or cannot decide', async () => {
    const answers = await Effect.runPromise(
      Effect.forEach([allowedByTheTest, deniedByTheTest, withAnError], (decision) =>
        callPermissionDecidedBy(answering(decision))(askedOf(adaReading)),
      ),
    );

    expect(answers).toEqual([true, false, false]);
  });

  it('asks about the playbook named, with the credential as it is, and about the org where none is named, as of a credential that names whichever playbook the call will', async () => {
    const asking = recordingDecisionPoint(() => allowedByTheTest);
    const decided = callPermissionDecidedBy(asking.decisionPoint);

    await Effect.runPromise(Effect.forEach(askedOfAcmeAlphaReader, (each) => decided(each)));

    expect(
      asking.asked().map(({ action, resource, context }) => [action.name, resource, context.granted.playbooks]),
    ).toEqual([
      ['get_note', { type: 'playbook', id: 'alpha', org: 'acme' }, ['alpha']],
      ['get_note', { type: 'org', id: 'acme' }, '*'],
      ['label_playbook', { type: 'playbook', id: 'alpha', org: 'acme' }, ['alpha']],
      ['label_playbook', { type: 'org', id: 'acme' }, '*'],
      ['list_playbook_labels', { type: 'org', id: 'acme' }, '*'],
    ]);
  });

  it('asks as the caller arrives, through Studio, an agent or a conversation, never as a run', async () => {
    const asking = recordingDecisionPoint(() => allowedByTheTest);
    const adasAgent: CallerIdentity = { ...ada, client: { id: 'client-7', name: 'An agent', domain: null } };
    const decided = callPermissionDecidedBy(asking.decisionPoint);

    await Effect.runPromise(
      Effect.forEach([ada, adasAgent], (caller) => decided(askedOf(caller))).pipe(
        Effect.andThen(Effect.provideService(decided(askedOf(adasAgent)), InAConversation, true)),
      ),
    );

    expect(asking.asked().map(({ context }) => context.via)).toEqual(['studio', 'agent', 'conversation']);
  });
});

const askAuto: OperationDeclaration = {
  scope: 'org',
  name: 'ask_auto',
  kind: 'command',
  permissions: ['playbook:write'],
  targetsPlaybook: false,
  readsOnly: false,
  reachesOutside: true,
  mayChangeOutside: false,
  irreversible: false,
  permissionsManagement: false,
};

async function reportedOf(decision: AccessDecision, asked: readonly CallAsked[]) {
  const asking = recordingDecisionPoint(() => decision);
  const logs = capturedLogs();
  const reported = callPermissionReportedTo(asking.decisionPoint);
  const answers = await Effect.runPromise(
    Effect.forEach(asked, (each) => reported(each)).pipe(
      Effect.provideService(InAConversation, true),
      Effect.provide(logs.layer),
    ),
  );
  return { answers, asked: asking.asked(), logged: logs.logged() };
}

const allowedByTheCheckDeniedForAda = { caller: 'person:user_ada', check: 'allow', decision: 'deny', errors: 0 };

const differencesOfAda = [
  differenceOf({
    operation: 'ask_auto',
    org: 'acme',
    ...allowedByTheCheckDeniedForAda,
    scope: 'org',
    determining_policies: 'test-deny',
  }),
  differenceOf({
    operation: 'get_note',
    org: 'acme',
    playbook: 'alpha',
    ...allowedByTheCheckDeniedForAda,
    scope: 'playbook',
    determining_policies: 'test-deny',
  }),
];

describe('whether a caller may call an operation, where a decision point is asked in report-only mode', () => {
  it('is what the credential grants, the decision point asked beside it about a declaration that need not be served, a difference logged with ids alone', async () => {
    const { answers, asked, logged } = await reportedOf(deniedByTheTest, [
      { operation: askAuto, caller: ada, org: 'acme' },
      { operation: askAuto, caller: adaReading, org: 'acme' },
      { operation: getNote.registration, caller: ada, org: 'acme', playbook: 'alpha' },
    ]);

    expect(answers).toEqual([true, false, true]);
    expect(asked.map(({ action, resource, context }) => [action.name, resource.type, context.via])).toEqual([
      ['ask_auto', 'org', 'conversation'],
      ['ask_auto', 'org', 'conversation'],
      ['get_note', 'playbook', 'conversation'],
    ]);
    expect(logged).toEqual(differencesOfAda);
  });

  it('logs nothing where the decision point answers as the credential does', async () => {
    const { answers, logged } = await reportedOf(allowedByTheTest, [{ operation: askAuto, caller: ada, org: 'acme' }]);

    expect([answers, logged]).toEqual([[true], []]);
  });

  it('answers as the credential does whatever the decision point does, dying or throwing among it', async () => {
    const answers = await Effect.runPromise(
      Effect.forEach([dying, throwing], (decisionPoint) =>
        callPermissionReportedTo(decisionPoint)({ operation: askAuto, caller: ada, org: 'acme' }),
      ).pipe(Effect.provide(capturedLogs().layer)),
    );

    expect(answers).toEqual([true, true]);
  });
});

function answeredBy(options: { readonly decidedBy?: PolicyDecisionPoint }, caller: CallerIdentity) {
  const { dispatcher, run } = harness(options);
  return run(dispatcher.dispatchToPlaybook(mayAddNotes.registration, onAlpha(caller)));
}

const allowingAll = answering(allowedByTheTest);

const denyingTheNote = answering(deniedByTheTest);

function denyingNotesAlone(request: AccessRequest) {
  return request.action.name === 'add_note' ? denyingTheNote.decide(request) : allowingAll.decide(request);
}

describe('an operation that asks whether its caller may call another', () => {
  it('is answered by the decision point of the dispatcher that runs it, where that dispatcher decides', async () => {
    expect(await answeredBy({ decidedBy: allowingAll }, adaReading)).toEqual({
      status: 'succeeded',
      output: { may: true },
    });
    expect(await answeredBy({ decidedBy: { decide: denyingNotesAlone } }, ada)).toEqual({
      status: 'succeeded',
      output: { may: false },
    });
  });

  it('is answered by the credential where the dispatcher does not decide', async () => {
    expect(await answeredBy({}, adaReading)).toEqual({ status: 'succeeded', output: { may: false } });
    expect(await answeredBy({}, ada)).toEqual({ status: 'succeeded', output: { may: true } });
  });
});

function allowedWithEverythingGranted({ context }: AccessRequest): AccessDecision {
  return context.granted.permissions.length === 4 ? allowedByTheTest : deniedByTheTest;
}

function allowedInStudio({ context }: AccessRequest): AccessDecision {
  return context.via === 'studio' ? allowedByTheTest : deniedByTheTest;
}

function refusalOf(decide: (request: AccessRequest) => AccessDecision, asked: CallAsked) {
  return Effect.runPromise(Effect.flip(callAdmittedBy(recordingDecisionPoint(decide).decisionPoint)(asked)));
}

const adaThroughAnAgent: CallerIdentity = {
  ...ada,
  client: { id: 'client-of-an-agent', name: 'An agent', domain: null },
};

describe('a call a host admits by the decision point, outside every dispatcher', () => {
  it('is let through where the decision point allows it, whatever the credential grants', async () => {
    const admitted = callAdmittedBy(recordingDecisionPoint(() => allowedByTheTest).decisionPoint)(askedOf(adaReading));

    await expect(Effect.runPromise(admitted)).resolves.toBeUndefined();
  });

  it('is refused in the credential’s words where the credential is the cause, for the role, or for the type of credential', async () => {
    const refusals = await Promise.all([
      refusalOf(allowedWithEverythingGranted, askedOf(adaReading)),
      refusalOf(() => deniedByTheTest, askedOf(ada)),
      refusalOf(allowedInStudio, askedOf(adaThroughAnAgent)),
    ]);

    expect(refusals.map(({ detail, kind }) => [detail, kind])).toEqual([
      ['The caller lacks the playbook:write permission', undefined],
      [roleRefusalDetail, 'permission_denied'],
      [tokenTypeRefusalDetail, 'not_allowed_token_type'],
    ]);
  });

  it('is asked about as arriving through a conversation where it is made within one', async () => {
    const asking = recordingDecisionPoint(() => allowedByTheTest);

    await Effect.runPromise(
      callAdmittedBy(asking.decisionPoint)(
        askedOf({ ...ada, client: { id: 'client-of-an-agent', name: 'An agent', domain: null } }),
      ).pipe(Effect.provideService(InAConversation, true)),
    );

    expect(asking.asked().map(({ context }) => context.via)).toEqual(['conversation']);
  });
});
