import { isAuthorized } from '@cedar-policy/cedar-wasm/web';
import { beforeAll, describe, expect, it } from 'vitest';

import { cedarOnDisk } from '../testing/access-testing.ts';
import { decidedFailingClosed, decisionOf, messageOf } from './cedar-decisions.ts';
import { cedarOf } from './cedar.ts';

const reading = {
  principal: { type: 'Person', id: 'user_ada' },
  action: { type: 'Action', id: 'read' },
  resource: { type: 'Definition', id: 'd-01' },
  context: {},
  entities: [{ uid: { type: 'Definition', id: 'd-01' }, attrs: {}, parents: [] }],
};

const readsAllowedButReasoningHidden = {
  staticPolicies: {
    'reads-allowed': 'permit (principal, action, resource);',
    'hide-reasoning': 'forbid (principal, action, resource) when { resource.definition_type == "reasoning" };',
  },
};

beforeAll(async () => {
  cedarOf(await cedarOnDisk());
});

describe('the answer of the engine', () => {
  it('is a deny where Cedar skips a forbid that errors and allows: the forbid cannot be read, so nothing is allowed', () => {
    const answer = isAuthorized({ ...reading, policies: readsAllowedButReasoningHidden });

    expect(answer).toMatchObject({
      type: 'success',
      response: { decision: 'allow', diagnostics: { reason: ['reads-allowed'] } },
    });
    expect(decisionOf(answer)).toEqual({
      decision: 'deny',
      determiningPolicies: [],
      errors: [expect.stringMatching(/^hide-reasoning: /u)],
    });
  });

  it('keeps the policies that decided a deny, beside any error', () => {
    const answer = isAuthorized({
      ...reading,
      policies: {
        staticPolicies: {
          ...readsAllowedButReasoningHidden.staticPolicies,
          'nothing-read': 'forbid (principal, action, resource);',
        },
      },
    });

    expect(decisionOf(answer)).toEqual({
      decision: 'deny',
      determiningPolicies: ['nothing-read'],
      errors: [expect.stringMatching(/^hide-reasoning: /u)],
    });
  });

  it('is an allow, with the policies that decided it, where no policy errs', () => {
    expect(
      decisionOf(
        isAuthorized({
          ...reading,
          policies: { staticPolicies: { 'reads-allowed': 'permit (principal, action, resource);' } },
        }),
      ),
    ).toEqual({ decision: 'allow', determiningPolicies: ['reads-allowed'], errors: [] });
  });
});

describe('the answer of the engine to what it cannot read', () => {
  it('is a deny with the errors of a request Cedar cannot read', () => {
    const answer = isAuthorized({
      ...reading,
      schema: 'entity Person; entity Definition; action "read" appliesTo { principal: Person, resource: Definition };',
      validateRequest: true,
      context: { unexpected: true },
      policies: readsAllowedButReasoningHidden,
    });

    expect(answer.type).toBe('failure');
    expect(decisionOf(answer)).toMatchObject({ decision: 'deny', determiningPolicies: [] });
    expect(decisionOf(answer).errors.length).toBeGreaterThan(0);
  });

  it('is a deny with what was thrown, where asking the engine throws', () => {
    expect(
      decidedFailingClosed(() => {
        throw new Error('the engine is not loaded');
      }),
    ).toEqual({ decision: 'deny', determiningPolicies: [], errors: ['the engine is not loaded'] });
    expect(messageOf('a thrown text')).toBe('a thrown text');
  });

  it('is a deny naming what failed, where the answer cannot be read', () => {
    expect(
      decidedFailingClosed(() => ({
        type: 'failure',
        get errors(): readonly { readonly message: string }[] {
          throw new Error('the answer cannot be read');
        },
      })),
    ).toEqual({
      decision: 'deny',
      determiningPolicies: [],
      errors: ['the answer cannot be read'],
    });
  });
});
