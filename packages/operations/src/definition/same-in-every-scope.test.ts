import { Effect, Schema } from 'effect';
import { describe, expect, expectTypeOf, it } from 'vitest';

import type { OrgContext } from '../caller/org-context.ts';
import type { PlaybookContext } from '../caller/playbook-context.ts';
import { defineQuery } from '../index.ts';
import type { Definition } from './definition.ts';

const Empty = Schema.Record(Schema.String, Schema.Never);

const probe = {
  name: 'probe',
  title: 'Probe',
  description: 'Probes the declaration that an operation is the same in every scope.',
  inputSchema: Empty,
  outputSchema: Empty,
  reasons: [],
  handle: () => Effect.succeed({}),
};

const get: { readonly method: 'GET'; readonly path: '/probe' } = { method: 'GET', path: '/probe' };

type Declarable<K extends 'query' | 'command', Services> = NonNullable<
  Definition<K, '/probe', typeof Empty, typeof Empty, never, Services>['sameInEveryScope']
>;

describe('an operation that declares it is the same in every scope', () => {
  it('is registered so at either scope; every other operation says nothing of it', () => {
    const inTheOrg = defineQuery('org', { ...probe, route: get, sameInEveryScope: true });
    const inAPlaybook = defineQuery('playbook', { ...probe, route: get, sameInEveryScope: true });
    const reading = defineQuery('org', { ...probe, route: get });

    expect([inTheOrg, inAPlaybook, reading].map(({ registration }) => registration.sameInEveryScope)).toEqual([
      true,
      true,
      undefined,
    ]);
    expect([inTheOrg, inAPlaybook].map(({ registration }) => registration.permissions)).toEqual([
      ['org:read'],
      ['playbook:read'],
    ]);
  });

  it('is a query whose handler is handed nothing, so it reads no org, playbook, caller or ledger', () => {
    expectTypeOf<Declarable<'query', never>>().toEqualTypeOf<true>();
    expectTypeOf<Declarable<'query', OrgContext>>().toEqualTypeOf<never>();
    expectTypeOf<Declarable<'query', PlaybookContext>>().toEqualTypeOf<never>();
    expectTypeOf<Declarable<'command', never>>().toEqualTypeOf<never>();
  });

  it('is refused where it takes a playbook', () => {
    expect(() =>
      defineQuery('org', {
        ...probe,
        route: get,
        inputSchema: Schema.Struct({ playbook: Schema.String }),
        sameInEveryScope: true,
      }),
    ).toThrow('The operation probe declares it is the same in every scope, so it may not take a playbook');
  });

  it('is refused where it declares a permission of its own', () => {
    expect(() =>
      defineQuery('org', { ...probe, route: get, permittedBy: ['org:read'], sameInEveryScope: true }),
    ).toThrow(
      'The operation probe declares it is the same in every scope, so the permission to read the scope it is asked in permits it, and it may declare no other',
    );
  });
});
