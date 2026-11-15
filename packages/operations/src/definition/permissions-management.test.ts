import { Effect, Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import { defineCommand, defineQuery } from '../index.ts';

const Empty = Schema.Record(Schema.String, Schema.Never);

const probe = {
  name: 'probe',
  title: 'Probe',
  description: 'Probes the declaration of permissions management.',
  inputSchema: Empty,
  outputSchema: Empty,
  reasons: [],
  handle: () => Effect.succeed({}),
};

const get: { readonly method: 'GET'; readonly path: '/probe' } = { method: 'GET', path: '/probe' };

const post: { readonly method: 'POST'; readonly path: '/probe' } = { method: 'POST', path: '/probe' };

describe('an operation that declares permissions management', () => {
  it('is a command, which grants or changes access, and is registered so; every other operation declares it not', () => {
    const granting = defineCommand('org', { ...probe, route: post, permissionsManagement: true });
    const changing = defineCommand('org', { ...probe, route: post });
    const reading = defineQuery('org', { ...probe, route: get });

    expect(
      [granting, changing, reading].map(({ registration: { permissionsManagement } }) => permissionsManagement),
    ).toEqual([true, false, false]);
  });

  it('is refused where it is a query', () => {
    expect(() => defineQuery('org', { ...probe, route: get, permissionsManagement: true })).toThrow(
      'The query probe declares permissions management, which only a command that grants or changes access does',
    );
  });
});
