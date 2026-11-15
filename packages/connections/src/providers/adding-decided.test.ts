import {
  CallPermission,
  callPermissionDecidedBy,
  roleRefusalDetail,
  type AccessDecision,
  type AccessRequest,
  type CallerIdentity,
  type Outcome,
  type PolicyDecisionPoint,
} from '@on.auto/operations';
import { consentClientWith } from '@on.auto/tool-servers/testing';
import { Effect, Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import { makeProviderOffering } from '../index.ts';
import { connectionPolicyOf } from '../policy/connection-policy.ts';
import { ada, connectionServicesWith, harness, harnessPages, operationNamed } from '../testing/harness.ts';

const adaReading: CallerIdentity = { ...ada, permissions: ['org:read'] };

const allowed: AccessDecision = { decision: 'allow', determiningPolicies: ['by-the-test'], errors: [] };

const denied: AccessDecision = { decision: 'deny', determiningPolicies: [], errors: [] };

function decidedOf(addingDecided: AccessDecision): PolicyDecisionPoint {
  const decided = (request: AccessRequest) => (request.action.name === 'add_connection' ? addingDecided : allowed);
  return { decide: (request) => Effect.succeed(decided(request)) };
}

const AddingSchema = Schema.Struct({
  output: Schema.Struct({ may_add: Schema.Boolean, refusal: Schema.NullOr(Schema.String) }),
});

const addingIn = Schema.decodeUnknownSync(AddingSchema);

function listedBy(addingDecided: AccessDecision, caller: CallerIdentity): Promise<Outcome> {
  const h = harness({ decidedBy: decidedOf(addingDecided) });
  return h.call(operationNamed(h.operations, 'list_providers'), caller);
}

function offeredTo(addingDecided: AccessDecision, caller: CallerIdentity) {
  const offering = makeProviderOffering(
    connectionServicesWith({ policy: connectionPolicyOf({}), pages: harnessPages, consent: consentClientWith() }),
  );
  return Effect.runSync(
    offering(caller).pipe(Effect.provideService(CallPermission, callPermissionDecidedBy(decidedOf(addingDecided)))),
  );
}

describe('whether a caller may add a connection, where a policy decision point decides', () => {
  it('is what it decides of add_connection, whatever the credential grants, and its refusal for the role is said so', async () => {
    expect([
      addingIn(await listedBy(allowed, adaReading)).output,
      addingIn(await listedBy(denied, ada)).output,
    ]).toEqual([
      { may_add: true, refusal: null },
      { may_add: false, refusal: roleRefusalDetail },
    ]);
  });

  it('offers search the providers to a caller it allows to add, and none to a caller it does not', () => {
    expect(offeredTo(allowed, adaReading)).not.toHaveLength(0);
    expect(offeredTo(denied, ada)).toBeUndefined();
  });
});
