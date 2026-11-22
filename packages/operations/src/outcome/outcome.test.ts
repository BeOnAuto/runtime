import { Result, Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import {
  IncompleteDetailsSchema,
  IncompleteReasonSchema,
  isKindWithType,
  kindsWithTypes,
  problemTypeOf,
  reasonOfKind,
  resolutionOf,
} from '../index.ts';
import { Conflict } from './conflict.ts';
import { Forbidden } from './forbidden.ts';
import { NotFound } from './not-found.ts';
import { cappedOptions, rejected } from './outcome.ts';
import { typedRejectionOf } from './typed-rejection.ts';
import { Unavailable } from './unavailable.ts';

describe('the options a refusal offers', () => {
  it('keep the question and every choice, each choice with at most one hundred issues of a detail and a pointer', () => {
    const issues = Array.from({ length: 150 }, (_unused, index) => ({
      detail: 'Write it',
      pointer: `/lines/${index}`,
      line: index,
    }));

    expect(cappedOptions({ question: 'Which way?', choices: [{ value: 'one', title: 'One', issues }] })).toEqual({
      question: 'Which way?',
      choices: [
        {
          value: 'one',
          title: 'One',
          issues: Array.from({ length: 100 }, (_unused, index) => ({ detail: 'Write it', pointer: `/lines/${index}` })),
        },
      ],
    });
  });
});

const decodeDetails = Schema.decodeUnknownResult(IncompleteDetailsSchema, { onExcessProperty: 'error' });

describe('the details of a run that succeeded with an answer a limit shaped', () => {
  it.each(['max_tool_calls', 'max_input_tokens', 'max_output_tokens'])('name the limit %s it reached', (reason) => {
    expect(Result.getOrThrow(decodeDetails({ reason }))).toEqual({ reason });
  });

  it('name no limit by another word, and hold the reason alone', () => {
    const offered: readonly unknown[] = [
      { reason: 'max_prompt_tokens' },
      { reason: 'length' },
      {},
      { reason: 'max_tool_calls', count: 25 },
    ];

    expect(offered.map((details: unknown) => Result.isFailure(decodeDetails(details)))).toEqual([
      true,
      true,
      true,
      true,
    ]);
  });

  it('name the three limits a run may answer at, in the order a reference lists them', () => {
    expect(IncompleteReasonSchema.literals).toEqual(['max_tool_calls', 'max_input_tokens', 'max_output_tokens']);
  });
});

describe('what a refusal says of its resolution', () => {
  it('keeps the wait a busy refusal gives, beside the other members, and nothing else', () => {
    expect([
      resolutionOf({ retry_after: 4 }),
      resolutionOf(new Unavailable({ detail: 'Later', kind: 'busy', retry_after: 4 })),
    ]).toEqual([{ retry_after: 4 }, { retry_after: 4 }]);
  });
});

describe('the types of problems', () => {
  it('are URIs under https://on.auto/problems/', () => {
    expect(problemTypeOf('unavailable')).toBe('https://on.auto/problems/unavailable');
  });

  it('give tools_unfinished, busy, tools_called, effect_unknown, the meter’s four refusals and cursor_not_held types of their own, and no other kind', () => {
    expect(kindsWithTypes).toEqual([
      'tools_unfinished',
      'busy',
      'tools_called',
      'effect_unknown',
      'credits_exhausted',
      'license_required',
      'license_invalid',
      'account_closed',
      'cursor_not_held',
    ]);
    expect([
      isKindWithType('tools_unfinished'),
      isKindWithType('tools_called'),
      isKindWithType('effect_unknown'),
      isKindWithType('credits_exhausted'),
      isKindWithType('account_closed'),
      isKindWithType('cursor_not_held'),
      isKindWithType('stalled'),
      isKindWithType('tool_not_offered'),
      isKindWithType('toString'),
      isKindWithType(),
    ]).toEqual([true, true, true, true, true, true, false, false, false, false]);
  });

  it('keep the reason of each kind with a type of its own', () => {
    expect(kindsWithTypes.map((kind) => reasonOfKind(kind))).toEqual([
      'unavailable',
      'unavailable',
      'conflict',
      'conflict',
      'conflict',
      'conflict',
      'conflict',
      'conflict',
      'invalid_input',
    ]);
  });
});

describe('a rejection a handler answers again as its own', () => {
  it('keeps the reason, the detail and a kind of that reason, and leaves out a kind of another', () => {
    expect([
      typedRejectionOf(rejected('forbidden', 'Not for you', undefined, 'permission_denied')),
      typedRejectionOf(rejected('forbidden', 'Not here')),
      typedRejectionOf(rejected('not_found', 'Nowhere')),
      typedRejectionOf(rejected('unavailable', 'Later')),
      typedRejectionOf({ ...rejected('unavailable', 'Busy', undefined, 'busy'), retry_after: 2 }),
      typedRejectionOf(rejected('unavailable', 'Not a kind of it', undefined, 'retired')),
      typedRejectionOf(rejected('conflict', 'Retired', undefined, 'retired')),
      typedRejectionOf(rejected('conflict', 'In the way', undefined, 'permission_denied')),
    ]).toEqual([
      new Forbidden({ detail: 'Not for you', kind: 'permission_denied' }),
      new Forbidden({ detail: 'Not here' }),
      new NotFound({ detail: 'Nowhere' }),
      new Unavailable({ detail: 'Later' }),
      new Unavailable({ detail: 'Busy', kind: 'busy', retry_after: 2 }),
      new Unavailable({ detail: 'Not a kind of it' }),
      new Conflict({ detail: 'Retired', kind: 'retired' }),
      new Conflict({ detail: 'In the way' }),
    ]);
  });
});
