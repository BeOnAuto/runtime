import type { AccessDecision, CallerIdentity, PolicyDecisionPoint } from '@on.auto/operations';
import { decidingEach } from '@on.auto/operations/testing';
import { Effect, Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import { added, adding, notes } from '../testing/additions.ts';
import { acmeReader, ada, harness, operationNamed, type Harness } from '../testing/harness.ts';

const allowed: AccessDecision = { decision: 'allow', determiningPolicies: ['by-the-test'], errors: [] };

const denied: AccessDecision = { decision: 'deny', determiningPolicies: [], errors: [] };

const approvingDeniedToGrace: PolicyDecisionPoint = decidingEach((request) =>
  Effect.succeed(request.action.name === 'approve' && request.principal.id === 'grace' ? denied : allowed),
);

const grace: CallerIdentity = { ...ada, id: 'person:grace', name: 'Grace Hopper', permissions: ['org:write'] };

const RequestedSchema = Schema.Struct({ output: Schema.Struct({ id: Schema.String }) });

async function requested(h: Harness): Promise<string> {
  return Schema.decodeUnknownSync(RequestedSchema)(await adding(h, notes, grace)).output.id;
}

function declining(h: Harness, id: string, caller = ada) {
  return h.call(operationNamed(h.operations, 'decline_connection_request'), caller, { id });
}

async function typesOf(h: Harness): Promise<readonly string[]> {
  return (await h.facts()).map(({ type }) => type);
}

describe('declining a request to connect', () => {
  it('records the decline and the removal, and answers the connection removed, its request closed', async () => {
    const h = harness({ decidedBy: approvingDeniedToGrace });
    const id = await requested(h);

    expect(await declining(h, id)).toMatchObject({
      status: 'succeeded',
      output: { id, status: 'removed', request: null },
    });
    expect(await typesOf(h)).toEqual([
      'connection_added',
      'connection_requested',
      'connection_request_declined',
      'connection_removed',
    ]);
  });
});

describe('declining what is not an open request', () => {
  it.each([
    ['a connection added with its link', async (h: Harness) => (await added(h, notes)).id, 'conflict'],
    [
      'a request declined already',
      async (h: Harness) => {
        const id = await requested(h);
        await declining(h, id);
        return id;
      },
      'conflict',
    ],
    ['a connection the org does not hold', () => Promise.resolve('nowhere'), 'not_found'],
  ])('is refused for %s, recording nothing', async (_case, made, reason) => {
    const h = harness({ decidedBy: approvingDeniedToGrace });
    const id = await made(h);
    const before = await typesOf(h);

    expect(await declining(h, id)).toMatchObject({ status: 'rejected', reason });
    expect(await typesOf(h)).toEqual(before);
  });

  it('is refused to a caller who may only read the org, by the permission it keeps beside the others', async () => {
    const h = harness();
    const { id } = await added(h, notes);

    expect(await declining(h, id, acmeReader)).toMatchObject({ status: 'rejected', reason: 'forbidden' });
  });
});
