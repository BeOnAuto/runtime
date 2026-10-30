import { beforeAll, describe, expect, it } from 'vitest';

import { compiledErrors, probeHeader as header, type RejectedProbe } from '../testing/compiled-probes.ts';

function defined(definer: 'defineQuery' | 'defineCommand', scope: 'org' | 'playbook', lines: readonly string[]) {
  return [
    ...header,
    `export const probe = Operations.${definer}('${scope}', {`,
    "  ...about, name: 'probe',",
    ...lines,
    '});',
  ];
}

const get = "  route: { method: 'GET', path: '/probe' },";

const post = "  route: { method: 'POST', path: '/probe' },";

const emptyInputAndOutput = ['  inputSchema: Empty,', '  outputSchema: Empty,', '  reasons: [],'];

const answering = '  handle: () => Effect.succeed({}),';

const conflicting = "  handle: () => Effect.fail(new Operations.Conflict({ detail: 'taken' })),";

const refusingInput =
  "  handle: () => Effect.fail(new Operations.InvalidInput({ detail: 'wrong', issues: [{ detail: 'wrong', pointer: '' }] })),";

function declaring(reason: string, handle: string): readonly string[] {
  return ['  inputSchema: Empty,', '  outputSchema: Empty,', `  reasons: ['${reason}'],`, handle];
}

function asking(service: string): string {
  return `  handle: () => Effect.gen(function* () { yield* Operations.${service}; return {}; }),`;
}

function callingOther(definer: 'defineQuery' | 'defineCommand', route: string, service: string) {
  return [
    ...header,
    `const other = Operations.${definer}('playbook', { ...about, name: 'other',`,
    route,
    ...emptyInputAndOutput,
    asking(service),
    '});',
  ];
}

function callerOfOther(definer: 'defineQuery' | 'defineCommand', route: string) {
  return [
    `export const probe = Operations.${definer}('playbook', { ...about, name: 'probe',`,
    route,
    ...emptyInputAndOutput,
    '  handle: () => other.call({}),',
    '});',
  ];
}

const accepted: Readonly<Record<string, readonly string[]>> = {
  'org-command-asks-org-writer.ts': defined('defineCommand', 'org', [
    post,
    ...emptyInputAndOutput,
    asking('OrgWriter'),
  ]),
  'playbook-command-asks-playbook-writer.ts': defined('defineCommand', 'playbook', [
    post,
    ...emptyInputAndOutput,
    asking('PlaybookWriter'),
  ]),
  'org-query-names-a-playbook-in-its-route.ts': defined('defineQuery', 'org', [
    "  route: { method: 'GET', path: '/playbooks/{playbook}' },",
    '  inputSchema: Schema.Struct({ playbook: Schema.String }),',
    '  outputSchema: Empty,',
    '  reasons: [],',
    answering,
  ]),
  'command-created.ts': defined('defineCommand', 'playbook', [
    post,
    '  successStatus: 201,',
    ...emptyInputAndOutput,
    answering,
  ]),
  'declared-rejection.ts': defined('defineCommand', 'playbook', [post, ...declaring('conflict', conflicting)]),
  'declared-invalid-input.ts': defined('defineQuery', 'playbook', [get, ...declaring('invalid_input', refusingInput)]),
  'query-posts-an-input-a-query-string-cannot-carry.ts': defined('defineQuery', 'playbook', [
    post,
    ...emptyInputAndOutput,
    answering,
  ]),
  'command-calls-query.ts': [
    ...callingOther('defineQuery', get, 'PlaybookReader'),
    ...callerOfOther('defineCommand', post),
  ],
};

const rejected: Readonly<Record<string, RejectedProbe>> = {
  'org-query-asks-playbook-context.ts': {
    because: "Type 'PlaybookContext' is not assignable to type 'Caller | OrgContext | OrgReader'",
    source: defined('defineQuery', 'org', [get, ...emptyInputAndOutput, asking('PlaybookContext')]),
  },
  'org-command-asks-playbook-writer.ts': {
    because: "Type 'PlaybookWriter' is not assignable to type 'Caller | OrgContext | OrgReader | OrgWriter'",
    source: defined('defineCommand', 'org', [post, ...emptyInputAndOutput, asking('PlaybookWriter')]),
  },
  'playbook-query-asks-org-reader.ts': {
    because:
      "Type 'OrgReader' is not assignable to type 'Caller | PlaybookContext | PlaybookLifecycle | PlaybookReader'",
    source: defined('defineQuery', 'playbook', [get, ...emptyInputAndOutput, asking('OrgReader')]),
  },
  'org-query-asks-org-writer.ts': {
    because: "Type 'OrgWriter' is not assignable to type 'Caller | OrgContext | OrgReader'",
    source: defined('defineQuery', 'org', [get, ...emptyInputAndOutput, asking('OrgWriter')]),
  },
  'playbook-query-asks-playbook-writer.ts': {
    because:
      "Type 'PlaybookWriter' is not assignable to type 'Caller | PlaybookContext | PlaybookLifecycle | PlaybookReader'",
    source: defined('defineQuery', 'playbook', [get, ...emptyInputAndOutput, asking('PlaybookWriter')]),
  },
  'query-calls-command.ts': {
    because:
      "Type 'PlaybookWriter' is not assignable to type 'Caller | PlaybookContext | PlaybookLifecycle | PlaybookReader'",
    source: [...callingOther('defineCommand', post, 'PlaybookWriter'), ...callerOfOther('defineQuery', get)],
  },
  'command-asks-ledger.ts': {
    because:
      "Type 'Ledger' is not assignable to type 'CallLineage | Caller | PlaybookContext | PlaybookLifecycle | PlaybookReader | PlaybookWriter'",
    source: defined('defineCommand', 'playbook', [post, ...emptyInputAndOutput, asking('Ledger')]),
  },
  'command-asks-playbook-registry.ts': {
    because: "Type 'PlaybookRegistry' is not assignable to type 'Caller | OrgContext | OrgReader | OrgWriter'",
    source: defined('defineCommand', 'org', [post, ...emptyInputAndOutput, asking('PlaybookRegistry')]),
  },
  'query-asks-incident-reporter.ts': {
    because:
      "Type 'IncidentReporter' is not assignable to type 'Caller | PlaybookContext | PlaybookLifecycle | PlaybookReader'",
    source: defined('defineQuery', 'playbook', [get, ...emptyInputAndOutput, asking('IncidentReporter')]),
  },
  'undeclared-rejection.ts': {
    because: "Type 'Conflict' is not assignable to type 'NotFound'",
    source: defined('defineCommand', 'playbook', [post, ...declaring('not_found', conflicting)]),
  },
  'undeclared-invalid-input.ts': {
    because: "Type 'InvalidInput' is not assignable to type 'Conflict'",
    source: defined('defineCommand', 'playbook', [post, ...declaring('conflict', refusingInput)]),
  },
  'org-input-names-org.ts': {
    because: "Types of property 'org' are incompatible",
    source: defined('defineQuery', 'org', [
      get,
      '  inputSchema: Schema.Struct({ org: Schema.String }),',
      '  outputSchema: Empty,',
      '  reasons: [],',
      answering,
    ]),
  },
  'playbook-input-names-playbook.ts': {
    because: "Types of property 'playbook' are incompatible",
    source: defined('defineQuery', 'playbook', [
      get,
      '  inputSchema: Schema.Struct({ playbook: Schema.String }),',
      '  outputSchema: Empty,',
      '  reasons: [],',
      answering,
    ]),
  },
  'path-parameter-missing-from-input.ts': {
    because: "Property 'name' is missing",
    source: defined('defineQuery', 'playbook', [
      "  route: { method: 'GET', path: '/probe/{name}' },",
      ...emptyInputAndOutput,
      answering,
    ]),
  },
  'path-parameter-not-a-string.ts': {
    because: "Types of property 'size' are incompatible",
    source: defined('defineQuery', 'playbook', [
      "  route: { method: 'GET', path: '/probe/{size}' },",
      '  inputSchema: Schema.Struct({ size: Schema.Number }),',
      '  outputSchema: Empty,',
      '  reasons: [],',
      answering,
    ]),
  },
  'record-keys-name-org-and-playbook.ts': {
    because: "Types of property 'org' are incompatible",
    source: defined('defineQuery', 'playbook', [
      get,
      "  inputSchema: Schema.Record(Schema.Literals(['playbook', 'org']), Schema.String),",
      '  outputSchema: Empty,',
      '  reasons: [],',
      answering,
    ]),
  },
  'path-parameter-missing-from-a-member.ts': {
    because: "Property 'name' is missing",
    source: defined('defineQuery', 'playbook', [
      "  route: { method: 'GET', path: '/probe/{name}' },",
      '  inputSchema: Schema.Union([Schema.Struct({ name: Schema.String }), Schema.Struct({ other: Schema.String })]),',
      '  outputSchema: Empty,',
      '  reasons: [],',
      answering,
    ]),
  },
  'path-parameter-optional.ts': {
    because: "Property 'name' is optional",
    source: defined('defineQuery', 'playbook', [
      "  route: { method: 'GET', path: '/probe/{name}' },",
      '  inputSchema: Schema.Struct({ name: Schema.optionalKey(Schema.String) }),',
      '  outputSchema: Empty,',
      '  reasons: [],',
      answering,
    ]),
  },
  'path-not-relative-to-scope.ts': {
    because: "Type '\"probe\"' is not assignable to type '`/${string}`'",
    source: defined('defineQuery', 'playbook', [
      "  route: { method: 'GET', path: 'probe' },",
      ...emptyInputAndOutput,
      answering,
    ]),
  },
  'query-puts.ts': {
    because: 'Type \'"PUT"\' is not assignable to type \'"GET" | "POST"\'',
    source: defined('defineQuery', 'playbook', [
      "  route: { method: 'PUT', path: '/probe' },",
      ...emptyInputAndOutput,
      answering,
    ]),
  },
  'command-gets.ts': {
    because: 'Type \'"GET"\' is not assignable to type \'"DELETE" | "POST" | "PUT"\'',
    source: defined('defineCommand', 'playbook', [get, ...emptyInputAndOutput, answering]),
  },
  'query-created.ts': {
    because: "Type '201' is not assignable to type '200'",
    source: defined('defineQuery', 'playbook', [get, '  successStatus: 201,', ...emptyInputAndOutput, answering]),
  },
  'input-not-an-object.ts': {
    because: "Type 'string' is not assignable to type 'ObjectValue'",
    source: defined('defineQuery', 'playbook', [
      get,
      '  inputSchema: Schema.String,',
      '  outputSchema: Empty,',
      '  reasons: [],',
      answering,
    ]),
  },
  'output-not-an-object.ts': {
    because: "Type 'number' is not assignable to type 'ObjectValue'",
    source: defined('defineQuery', 'playbook', [
      get,
      '  inputSchema: Empty,',
      '  outputSchema: Schema.Number,',
      '  reasons: [],',
      '  handle: () => Effect.succeed(1),',
    ]),
  },
};

describe('the compiler', () => {
  let errors: readonly string[] = [];

  beforeAll(() => {
    errors = compiledErrors('handler-rules', { accepted, rejected });
  });

  it('accepts every definition that keeps the rules and rejects every one that breaks them', () => {
    expect(new Set(errors.map((error) => error.slice(0, error.indexOf('('))))).toEqual(new Set(Object.keys(rejected)));
  });

  it.each(Object.entries(rejected))('rejects %s for the rule it breaks', (file, { because }) => {
    expect(errors.filter((error) => error.startsWith(`${file}(`)).join('\n')).toContain(because);
  });
});
