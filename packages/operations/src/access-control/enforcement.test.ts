import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import {
  roleRefusalDetail,
  tokenTypeRefusalDetail,
  type AccessDecision,
  type AccessRequest,
  type CallerIdentity,
  type PlaybookRequest,
  type PolicyDecisionPoint,
} from '../index.ts';
import { acmeAdmin } from '../testing/callers.ts';
import { allowedByTheTest, deniedByTheTest, recordingDecisionPoint } from '../testing/decision-points.ts';
import { harness, toOrg } from '../testing/harness.ts';
import { addNote } from '../testing/notes.ts';
import { labelPlaybook, listPlaybookLabels } from '../testing/playbook-labels.ts';
import { ada, answering, onAlpha } from '../testing/report-only-calls.ts';

const adaReading: CallerIdentity = { ...ada, permissions: ['org:read', 'playbook:read'] };

const mailer: CallerIdentity = { ...acmeAdmin, id: 'service:mailer', name: 'The mailer' };

function deniedThenAllowed(): PolicyDecisionPoint {
  let asked = 0;
  return {
    decide: () =>
      Effect.sync(() => {
        asked += 1;
        return asked === 1 ? deniedByTheTest : allowedByTheTest;
      }),
  };
}

function grantedEverything({ context: { granted } }: AccessRequest): boolean {
  return granted.permissions.length === 4 && granted.playbooks === '*';
}

function deniedUnlessGrantedEverything(request: AccessRequest): AccessDecision {
  return grantedEverything(request) ? allowedByTheTest : deniedByTheTest;
}

const refusedForTheRole = {
  status: 'rejected',
  reason: 'forbidden',
  detail: roleRefusalDetail,
  kind: 'permission_denied',
};

async function decidedBy(decisionPoint: PolicyDecisionPoint, request: PlaybookRequest) {
  const { dispatcher, ledger, run } = harness({ decidedBy: decisionPoint });
  const outcome = await run(dispatcher.dispatchToPlaybook(addNote.registration, request));
  return { outcome, streams: ledger.streamNames() };
}

describe('a dispatcher the policy decision point decides', () => {
  it('runs a call the decision point allows, whatever the credential holds', async () => {
    const { outcome, streams } = await decidedBy(
      answering(allowedByTheTest),
      onAlpha(adaReading, { name: 'anvil', text: 'a' }),
    );

    expect(outcome).toEqual({ status: 'succeeded', output: { added: { name: 'anvil', text: 'a' }, version: 1 } });
    expect(streams).toHaveLength(1);
  });

  it('refuses for the role a call it denies that a credential granted everything would still be denied, and records nothing', async () => {
    const { outcome, streams } = await decidedBy(
      answering(deniedByTheTest),
      onAlpha(ada, { name: 'anvil', text: 'a' }),
    );

    expect(outcome).toEqual(refusedForTheRole);
    expect(streams).toEqual([]);
  });

  it('refuses in the words of the credential a call it denies that a credential granted everything would be allowed', async () => {
    const asking = recordingDecisionPoint(deniedUnlessGrantedEverything);

    const { outcome, streams } = await decidedBy(
      asking.decisionPoint,
      onAlpha(adaReading, { name: 'anvil', text: 'a' }),
    );

    expect(outcome).toEqual({
      status: 'rejected',
      reason: 'forbidden',
      detail: 'The caller lacks the playbook:write permission',
    });
    expect(streams).toEqual([]);
    expect(asking.asked().map(({ context: { granted } }) => granted)).toEqual([
      { org: 'acme', permissions: ['org:read', 'playbook:read'], playbooks: '*' },
      { org: 'acme', permissions: ['org:read', 'org:write', 'playbook:read', 'playbook:write'], playbooks: '*' },
    ]);
  });
});

describe('a call the policy decision point denies, refused in the words of its cause', () => {
  it('asks again with the credential granted everything in the org of the call, so another org’s credential is no cause of its own', async () => {
    const asking = recordingDecisionPoint(() => deniedByTheTest);
    const { dispatcher, run } = harness({ decidedBy: asking.decisionPoint });

    const ofGlobex = { ...ada, org: 'globex' };

    const outcomes = await run(
      Effect.all([
        dispatcher.dispatchToOrg(labelPlaybook.registration, toOrg('acme')(ofGlobex, { playbook: 'beta' })),
        dispatcher.dispatchToOrg(listPlaybookLabels.registration, toOrg('acme')(ofGlobex)),
      ]),
    );

    expect(outcomes).toEqual([refusedForTheRole, refusedForTheRole]);
    expect(asking.asked().map(({ context: { granted } }) => granted.org)).toEqual(['globex', 'acme', 'globex', 'acme']);
  });

  it('refuses, where the credential is the cause but today’s check would allow, in words of its own', async () => {
    const { outcome, streams } = await decidedBy(deniedThenAllowed(), onAlpha(ada, { name: 'anvil', text: 'a' }));

    expect(outcome).toEqual({ status: 'rejected', reason: 'forbidden', detail: 'The caller may not make this call' });
    expect(streams).toEqual([]);
  });
});

describe('a call a run makes, which the decision point denies', () => {
  it('is refused in the words of the credential, never for a role, since a run acts on the grant it started with', async () => {
    const asking = recordingDecisionPoint(() => deniedByTheTest);
    const byAStep: PlaybookRequest = {
      ...onAlpha(ada, { name: 'anvil', text: 'a' }),
      calledBy: { run_id: 'run-1', reference: 'steps/0', run: 1 },
    };

    const { outcome, streams } = await decidedBy(asking.decisionPoint, byAStep);

    expect(outcome).toEqual({ status: 'rejected', reason: 'forbidden', detail: 'The caller may not make this call' });
    expect(streams).toEqual([]);
    expect(asking.asked()).toHaveLength(1);
  });
});

describe('a caller whose id names no kind of principal', () => {
  it('is refused without asking the decision point', async () => {
    const asking = recordingDecisionPoint(() => allowedByTheTest);

    const { outcome } = await decidedBy(asking.decisionPoint, onAlpha(mailer, { name: 'anvil', text: 'a' }));

    expect(outcome).toEqual({ status: 'rejected', reason: 'forbidden', detail: 'The caller may not make this call' });
    expect(asking.asked()).toEqual([]);
  });
});

const adaThroughAnAgent: CallerIdentity = {
  ...ada,
  client: { id: 'client-of-an-agent', name: 'An agent', domain: null },
};

const refusedForTheTokenType = {
  status: 'rejected',
  reason: 'forbidden',
  detail: tokenTypeRefusalDetail,
  kind: 'not_allowed_token_type',
};

function allowedInStudioAlone({ context: { via } }: AccessRequest): AccessDecision {
  return via === 'studio' ? allowedByTheTest : deniedByTheTest;
}

const undecidedInStudio = recordingDecisionPoint(({ context: { via } }) =>
  via === 'studio'
    ? { decision: 'deny', determiningPolicies: [], errors: ['The roles could not be read'] }
    : deniedByTheTest,
);

describe('a call no grant would let through, refused for what it came through or for the role', () => {
  it('refuses a person’s agent, where the same person signed in to Studio would be allowed, for the type of credential, and asks a third time as in Studio', async () => {
    const asking = recordingDecisionPoint(allowedInStudioAlone);

    const { outcome, streams } = await decidedBy(
      asking.decisionPoint,
      onAlpha(adaThroughAnAgent, { name: 'anvil', text: 'a' }),
    );

    expect(outcome).toEqual(refusedForTheTokenType);
    expect(streams).toEqual([]);
    expect(asking.asked().map(({ context }) => [context.via, context.granted.permissions.length])).toEqual([
      ['agent', 4],
      ['agent', 4],
      ['studio', 4],
    ]);
  });

  it('refuses a person’s agent for the role where the same person signed in to Studio would be denied too', async () => {
    const asking = recordingDecisionPoint(() => deniedByTheTest);

    const { outcome } = await decidedBy(asking.decisionPoint, onAlpha(adaThroughAnAgent, { name: 'anvil', text: 'a' }));

    expect(outcome).toEqual(refusedForTheRole);
    expect(asking.asked()).toHaveLength(3);
  });

  it('refuses a person signed in to Studio for the role without asking a third time', async () => {
    const asking = recordingDecisionPoint(() => deniedByTheTest);

    const { outcome } = await decidedBy(asking.decisionPoint, onAlpha(ada, { name: 'anvil', text: 'a' }));

    expect(outcome).toEqual(refusedForTheRole);
    expect(asking.asked()).toHaveLength(2);
  });
});

describe('a call no grant would let through, of a principal that holds no role or that the decision point cannot decide', () => {
  it('refuses a key, which holds no role, for the type of credential without asking a third time', async () => {
    const asking = recordingDecisionPoint(() => deniedByTheTest);

    const { outcome } = await decidedBy(asking.decisionPoint, onAlpha(acmeAdmin, { name: 'anvil', text: 'a' }));

    expect(outcome).toEqual(refusedForTheTokenType);
    expect(asking.asked().map(({ principal }) => principal.type)).toEqual(['key', 'key']);
  });

  it('refuses as unavailable where the question asked as in Studio could not be decided', async () => {
    const { outcome } = await decidedBy(
      undecidedInStudio.decisionPoint,
      onAlpha(adaThroughAnAgent, { name: 'anvil', text: 'a' }),
    );

    expect(outcome).toMatchObject({ status: 'rejected', reason: 'unavailable' });
  });
});
