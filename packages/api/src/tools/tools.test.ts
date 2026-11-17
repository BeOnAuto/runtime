import { rejected, type Rejected } from '@on.auto/operations';
import { Result, Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import { ProblemSchema } from '../problem/problem-document.ts';
import { playbookArgumentOf, withPlaybookArgument } from './playbook-argument.ts';
import { unsuccessfulResultOf } from './tool-result.ts';

const unlicensed: Rejected = {
  ...rejected('conflict', 'This runtime has used its 100 free runs.', undefined, 'license_required'),
  resolve_at: 'https://studio.on.auto/licenses?installation=0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7a',
  runtime_id: '0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7a',
};

const exhausted: Rejected = {
  ...rejected('conflict', 'The org acme has no credits left.', undefined, 'credits_exhausted'),
  because: 'none_left',
  resolve_at: 'https://studio.on.auto/billing',
};

const capped: Rejected = {
  ...rejected(
    'conflict',
    "This runtime's organization has reached its overage cap of 125 credits.",
    undefined,
    'credits_exhausted',
  ),
  because: 'free_daily_limit',
  resolve_at: 'https://studio.on.auto/?settings=billing&org=org_acme',
  runtime_id: '0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7a',
  lifts_at: '2026-10-29T00:00:00.000Z',
  limited_because: 'cap',
};

const purged: Rejected = {
  ...rejected('conflict', 'The org acme was deleted for good.', undefined, 'account_closed'),
  because: 'org_purged',
  resolve_at: 'https://studio.example.com/orgs',
};

const textsIn = Schema.decodeUnknownSync(
  Schema.Array(Schema.Struct({ type: Schema.Literal('text'), text: Schema.String })),
);

function textsOf(rejection: Rejected): readonly string[] {
  const { content } = unsuccessfulResultOf(rejection, false, { kind: 'command', attempt: 'run the workflow “tally”' });
  return textsIn(content).map(({ text }) => text);
}

const problemIn = Schema.decodeUnknownSync(Schema.fromJsonString(ProblemSchema));

describe('the tool result of a refusal of the meter', () => {
  it('carries where a person resolves it and the id of the runtime in its problem, which its words point at', () => {
    const [words = '', problem = ''] = textsOf(unlicensed);

    expect(words).toContain('at the resolve_at link in the details below');
    expect(problemIn(problem)).toEqual({
      type: 'https://on.auto/problems/license_required',
      title: 'License required',
      status: 409,
      detail: 'This runtime has used its 100 free runs.',
      reason: 'conflict',
      kind: 'license_required',
      resolve_at: 'https://studio.on.auto/licenses?installation=0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7a',
      runtime_id: '0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7a',
    });
  });

  it('carries the case of a refusal for credits, and leaves out a runtime id it was not given', () => {
    const [, problem = ''] = textsOf(exhausted);

    expect(problemIn(problem)).toMatchObject({
      kind: 'credits_exhausted',
      because: 'none_left',
      resolve_at: 'https://studio.on.auto/billing',
    });
    expect(problemIn(problem)).not.toHaveProperty('runtime_id');
  });
});

describe('the tool result of a refusal at the free rate', () => {
  it('carries when the free rate lifts and why the runtime is limited to it, which its words name', () => {
    const [words = '', problem = ''] = textsOf(capped);

    expect(words).toContain("this runtime's organization has reached its overage cap, so the runtime is limited");
    expect(problemIn(problem)).toMatchObject({
      kind: 'credits_exhausted',
      because: 'free_daily_limit',
      lifts_at: '2026-10-29T00:00:00.000Z',
      limited_because: 'cap',
    });
  });
});

describe('the tool result of a refusal of a closed account', () => {
  it('says a run of an org whose account is closed never runs again once the org is purged, beside its problem', () => {
    const [words = '', problem = ''] = textsOf(purged);

    expect(words).toBe(
      'Could not run the workflow “tally”: the account it runs under is closed, since its org was deleted for good. Nothing was changed. The org can no longer be restored, so none of its runs will run again; the details below say more.',
    );
    expect(problemIn(problem)).toEqual({
      type: 'https://on.auto/problems/account_closed',
      title: 'Account closed',
      status: 409,
      detail: 'The org acme was deleted for good.',
      reason: 'conflict',
      kind: 'account_closed',
      because: 'org_purged',
      resolve_at: 'https://studio.example.com/orgs',
    });
  });
});

const playbookProperty = {
  type: 'string',
  pattern: '^[a-z][a-z0-9-]{2,47}$',
  description: 'The id of the playbook to act in',
};

const Labelled = {
  type: 'object',
  properties: { label: { type: 'string' } },
  required: ['label'],
  additionalProperties: false,
};

describe('withPlaybookArgument on an object', () => {
  it('adds a required playbook first to an object schema, keeping its fields', () => {
    expect(withPlaybookArgument(Labelled)).toEqual({
      type: 'object',
      properties: { playbook: playbookProperty, label: { type: 'string' } },
      required: ['playbook', 'label'],
      additionalProperties: false,
    });
  });

  it('adds a playbook to an object schema whose fields are all optional', () => {
    expect(withPlaybookArgument({ type: 'object', additionalProperties: false })).toEqual({
      type: 'object',
      properties: { playbook: playbookProperty },
      required: ['playbook'],
      additionalProperties: false,
    });
  });
});

describe('withPlaybookArgument on a union', () => {
  it('adds a playbook to every member, inlining a member that refers to a definition and dropping it', () => {
    const union = {
      type: 'object',
      anyOf: [{ $ref: '#/$defs/Labelled' }, { type: 'object', properties: { count: { type: 'integer' } } }],
      $defs: { Labelled },
    };

    expect(withPlaybookArgument(union)).toEqual({
      type: 'object',
      anyOf: [
        {
          ...Labelled,
          properties: { playbook: playbookProperty, label: { type: 'string' } },
          required: ['playbook', 'label'],
        },
        {
          type: 'object',
          properties: { playbook: playbookProperty, count: { type: 'integer' } },
          required: ['playbook'],
        },
      ],
    });
  });
});

describe('withPlaybookArgument on a referenced union', () => {
  it('keeps the definitions the inlined members still refer to', () => {
    const Tag = { type: 'string' };
    const Tagged = { type: 'object', properties: { tag: { $ref: '#/$defs/Tag' } } };

    expect(withPlaybookArgument({ anyOf: [{ $ref: '#/$defs/Tagged' }], $defs: { Tagged, Tag } })).toEqual({
      anyOf: [
        {
          type: 'object',
          properties: { playbook: playbookProperty, tag: { $ref: '#/$defs/Tag' } },
          required: ['playbook'],
        },
      ],
      $defs: { Tag },
    });
  });

  it('adds a playbook to a union without definitions', () => {
    expect(withPlaybookArgument({ anyOf: [Labelled] })).toEqual({
      anyOf: [
        {
          ...Labelled,
          properties: { playbook: playbookProperty, label: { type: 'string' } },
          required: ['playbook', 'label'],
        },
      ],
    });
  });
});

const recordOf = Schema.decodeUnknownSync(Schema.Record(Schema.String, Schema.Unknown));

const malformed = 'Expected a string matching the RegExp ^[a-z][a-z0-9-]{2,47}$';

const inputsWithoutPlaybook: ReadonlyArray<readonly [string, Readonly<Record<string, unknown>>, string]> = [
  ['without a playbook', { name: 'greeting' }, 'Missing key'],
  ['whose playbook is not a string', { playbook: 7 }, 'Expected string'],
  ['whose playbook is empty', { playbook: '' }, malformed],
  ['whose playbook has 2 characters', { playbook: 'ab' }, malformed],
  ['whose playbook has 49 characters', { playbook: `a${'b'.repeat(48)}` }, malformed],
  ['whose playbook has 100 000 characters', { playbook: 'a'.repeat(100_000) }, malformed],
  ['whose playbook ends with a newline', { playbook: 'alpha\n' }, malformed],
  ['whose playbook is uppercase', { playbook: 'Alpha' }, malformed],
  ['whose playbook has a fullwidth letter', { playbook: 'ａlpha' }, malformed],
  ['whose playbook has a Cyrillic lookalike', { playbook: 'аlpha' }, malformed],
  ['whose playbook has a NUL', { playbook: 'alp\u0000ha' }, malformed],
  ['whose playbook is *', { playbook: '*' }, malformed],
];

describe('playbookArgumentOf', () => {
  it('takes the playbook out of the input, leaving the operation its own fields', () => {
    expect(playbookArgumentOf({ playbook: 'alpha', name: 'greeting' })).toEqual(
      Result.succeed({ playbook: 'alpha', input: { name: 'greeting' } }),
    );
  });

  it('keeps an own __proto__ field for the operation to judge', () => {
    const parsed: unknown = JSON.parse('{"playbook":"alpha","__proto__":{"admin":true}}');

    const argument = playbookArgumentOf(recordOf(parsed));

    expect(Result.map(argument, ({ input: rest }) => Object.hasOwn(rest, '__proto__'))).toEqual(Result.succeed(true));
  });

  it.each(inputsWithoutPlaybook)(
    'rejects an input %s as invalid_input pointing at /playbook',
    (_case, input, detail) => {
      expect(playbookArgumentOf(input)).toEqual(
        Result.fail({
          status: 'rejected',
          reason: 'invalid_input',
          detail: 'The input does not match the input schema',
          issues: [{ detail, pointer: '/playbook' }],
        }),
      );
    },
  );
});
