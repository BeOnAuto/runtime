import { Result, Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import { playbookArgumentOf, withPlaybookArgument } from './playbook-argument.ts';

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
