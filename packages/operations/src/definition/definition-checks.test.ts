import { Effect, Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import { defineCommand, defineQuery } from '../index.ts';

const Empty = Schema.Record(Schema.String, Schema.Never);

const probe = {
  name: 'probe',
  title: 'Probe',
  description: 'Probes the definition checks.',
  reasons: [],
  handle: () => Effect.succeed({}),
};

const get: { readonly method: 'GET'; readonly path: '/probe' } = { method: 'GET', path: '/probe' };

const named = Schema.Struct({ name: Schema.String });

interface Tree {
  readonly children: readonly Tree[];
}

const TreeSchema: Schema.Codec<Tree> = Schema.Struct({
  children: Schema.Array(Schema.suspend((): Schema.Codec<Tree> => TreeSchema)),
});

describe('the root of an input or output', () => {
  it('must be an object that declares its fields', () => {
    const undeclared = 'The input of probe must be an object that declares its fields';

    expect(() =>
      defineQuery('playbook', { ...probe, route: get, inputSchema: Schema.Any, outputSchema: Empty }),
    ).toThrow(undeclared);
    expect(() =>
      defineQuery('playbook', { ...probe, route: get, inputSchema: Schema.Struct({}), outputSchema: Empty }),
    ).toThrow(undeclared);
    expect(() =>
      defineQuery('playbook', {
        ...probe,
        route: get,
        inputSchema: Schema.Record(Schema.String, Schema.String),
        outputSchema: Empty,
      }),
    ).toThrow(undeclared);
    expect(() =>
      defineQuery('playbook', {
        ...probe,
        route: get,
        inputSchema: Schema.Union([named, Schema.Record(Schema.String, Schema.Json)]),
        outputSchema: Empty,
      }),
    ).toThrow(undeclared);
    expect(() =>
      defineQuery('playbook', { ...probe, route: get, inputSchema: Empty, outputSchema: Schema.Struct({}) }),
    ).toThrow('The output of probe must be an object that declares its fields');
  });
});

describe('an input or output below its root', () => {
  it('may not hold an empty struct at any depth', () => {
    const meta = Schema.Struct({ meta: Schema.Struct({}) });

    expect(() => defineQuery('playbook', { ...probe, route: get, inputSchema: meta, outputSchema: Empty })).toThrow(
      'The input of probe holds an empty struct, which accepts any value',
    );
    expect(() =>
      defineQuery('playbook', {
        ...probe,
        route: get,
        inputSchema: Empty,
        outputSchema: meta,
        handle: () => Effect.succeed({ meta: {} }),
      }),
    ).toThrow('The output of probe holds an empty struct, which accepts any value');
  });

  it('may be recursive, or a union of objects', () => {
    const shapes = Schema.Union([named, Schema.Struct({ name: Schema.Literal('square'), side: Schema.Finite })]);

    expect(
      defineQuery('playbook', {
        ...probe,
        route: get,
        inputSchema: Schema.Struct({ tree: TreeSchema }),
        outputSchema: Empty,
      }).registration.name,
    ).toBe('probe');
    expect(
      defineQuery('playbook', {
        ...probe,
        route: { method: 'GET', path: '/probe/{name}' },
        inputSchema: shapes,
        outputSchema: Empty,
      }).registration.pathParameters,
    ).toEqual(['name']);
  });
});

describe('the encoded fields of an input', () => {
  it('may not be named org, nor playbook at playbook scope, whatever the handler calls them', () => {
    const renaming = Schema.Struct({ organisation: Schema.String, target: Schema.String });

    expect(() =>
      defineQuery('org', {
        ...probe,
        route: get,
        inputSchema: renaming.pipe(Schema.encodeKeys({ organisation: 'org' })),
        outputSchema: Empty,
      }),
    ).toThrow('The input of probe may not have a field named org');
    expect(() =>
      defineQuery('playbook', {
        ...probe,
        route: get,
        inputSchema: renaming.pipe(Schema.encodeKeys({ target: 'playbook' })),
        outputSchema: Empty,
      }),
    ).toThrow('The input of probe may not have a field named playbook');
  });

  it('must carry the playbook an org operation targets under the name playbook', () => {
    expect(() =>
      defineCommand('org', {
        ...probe,
        route: { method: 'POST', path: '/probe' },
        inputSchema: Schema.Struct({ playbook: Schema.String }).pipe(Schema.encodeKeys({ playbook: 'target' })),
        outputSchema: Empty,
      }),
    ).toThrow('The input of probe must take its playbook field from a field named playbook');
  });
});

describe('a route parameter', () => {
  const missing = 'The route parameter name of probe must be a required string field of every input';
  const withName: `/${string}` = '/probe/{name}';

  it('must be a field of every member of the input, even where the compiler cannot see the path', () => {
    expect(() =>
      defineQuery('playbook', {
        ...probe,
        route: { method: 'GET', path: withName },
        inputSchema: Empty,
        outputSchema: Empty,
      }),
    ).toThrow(missing);
    expect(() =>
      defineQuery('playbook', {
        ...probe,
        route: { method: 'GET', path: withName },
        inputSchema: Schema.Union([named, Schema.Struct({ other: Schema.String })]),
        outputSchema: Empty,
      }),
    ).toThrow(missing);
  });

  it('must be required and a string once encoded', () => {
    const route: { readonly method: 'GET'; readonly path: '/probe/{name}' } = { method: 'GET', path: '/probe/{name}' };

    expect(() =>
      defineQuery('playbook', {
        ...probe,
        route: { method: 'GET', path: withName },
        inputSchema: Schema.Struct({ name: Schema.optionalKey(Schema.String) }),
        outputSchema: Empty,
      }),
    ).toThrow(missing);
    expect(() =>
      defineQuery('playbook', {
        ...probe,
        route,
        inputSchema: Schema.Struct({ name: Schema.NumberFromString.pipe(Schema.flip) }),
        outputSchema: Empty,
      }),
    ).toThrow(missing);
  });
});

describe('a route parameter that is a string once encoded', () => {
  it('may be any kind of string', () => {
    const route: { readonly method: 'GET'; readonly path: '/playbooks/{playbook}' } = {
      method: 'GET',
      path: '/playbooks/{playbook}',
    };

    expect(
      defineQuery('org', {
        ...probe,
        route,
        inputSchema: Schema.Struct({ playbook: Schema.Literals(['alpha', 'beta']) }),
        outputSchema: Empty,
      }).registration,
    ).toMatchObject({ pathParameters: ['playbook'], targetsPlaybook: true });
    expect(
      defineQuery('org', {
        ...probe,
        route,
        inputSchema: Schema.Struct({ playbook: Schema.TemplateLiteral(['b-', Schema.String]) }),
        outputSchema: Empty,
      }).registration.targetsPlaybook,
    ).toBe(true);
  });
});

const posted: { readonly method: 'POST'; readonly path: '/probe/{name}' } = { method: 'POST', path: '/probe/{name}' };

const noted = Schema.Struct({ name: Schema.String, note: Schema.optionalKey(Schema.String) });

function noteIssuesOf({ note }: typeof noted.Type): readonly Schema.FilterIssue[] {
  return [note].filter((given) => given === undefined).map(() => ({ path: ['note'], issue: 'Expected a note' }));
}

function refusesEmptyBody(inputSchema: Schema.Codec<{ readonly name: string; readonly note?: string }>): boolean {
  return defineCommand('playbook', { ...probe, route: posted, inputSchema, outputSchema: Empty }).registration
    .refusesEmptyBody;
}

describe('whether an input refuses an empty body', () => {
  it('is judged with the route parameters aside, by the fields and by the checks of the input', () => {
    const noteRequired = Schema.Struct({ name: Schema.String, note: Schema.String });

    expect([
      refusesEmptyBody(noted),
      refusesEmptyBody(noted.check(Schema.makeFilter(noteIssuesOf))),
      refusesEmptyBody(noteRequired),
      refusesEmptyBody(Schema.Union([noteRequired, noted])),
    ]).toEqual([false, true, true, false]);
  });
});

describe('the declared reasons', () => {
  it('are kept once each', () => {
    expect(
      defineQuery('playbook', {
        ...probe,
        route: get,
        inputSchema: Empty,
        outputSchema: Empty,
        reasons: ['not_found', 'not_found'],
      }).registration.reasons,
    ).toEqual(['not_found']);
  });
});

describe('the permissions that let a caller call an operation', () => {
  it('are the one of its kind and scope, or the ones it is permitted by', () => {
    const reading = defineQuery('org', { ...probe, route: get, inputSchema: Empty, outputSchema: Empty });
    const readingInsideAPlaybook = defineQuery('org', {
      ...probe,
      route: get,
      inputSchema: Empty,
      outputSchema: Empty,
      permittedBy: ['org:read', 'playbook:read'],
    });

    expect([reading.registration.permissions, readingInsideAPlaybook.registration.permissions]).toEqual([
      ['org:read'],
      ['org:read', 'playbook:read'],
    ]);
  });

  it('must be at least one', () => {
    expect(() =>
      defineCommand('org', {
        ...probe,
        route: { method: 'POST', path: '/probe' },
        inputSchema: Empty,
        outputSchema: Empty,
        permittedBy: [],
      }),
    ).toThrow('The operation probe is permitted by no permission');
  });
});
