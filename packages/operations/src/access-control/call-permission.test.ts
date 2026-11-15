import { Effect, Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import {
  Caller,
  PlaybookContext,
  callPermissionDecidedBy,
  defineQuery,
  mayCall,
  type AccessDecision,
  type AccessRequest,
  type CallAsked,
  type CallerIdentity,
  type PolicyDecisionPoint,
} from '../index.ts';
import { acmeAlphaReader } from '../testing/callers.ts';
import { allowedByTheTest, deniedByTheTest, recordingDecisionPoint } from '../testing/decision-points.ts';
import { harness } from '../testing/harness.ts';
import { addNote, getNote } from '../testing/notes.ts';
import { labelPlaybook, listPlaybookLabels } from '../testing/playbook-labels.ts';
import { ada, answering, onAlpha } from '../testing/report-only-calls.ts';

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

  it('asks as the caller arrives, through Studio or an agent, never as a run', async () => {
    const asking = recordingDecisionPoint(() => allowedByTheTest);
    const adasAgent: CallerIdentity = { ...ada, client: { id: 'client-7', name: 'An agent', domain: null } };

    await Effect.runPromise(
      Effect.forEach([ada, adasAgent], (caller) => callPermissionDecidedBy(asking.decisionPoint)(askedOf(caller))),
    );

    expect(asking.asked().map(({ context }) => context.via)).toEqual(['studio', 'agent']);
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
